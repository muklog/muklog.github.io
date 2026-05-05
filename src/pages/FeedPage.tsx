import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLiveQuery } from "dexie-react-hooks";
import { Home, Plus, Rss, Sparkles, UserPlus } from "lucide-react";
import { db, getAnalysisProfileForUser, getSettings, normalizeMeal } from "../lib/db";
import {
  subscribeFriendLatestMeals,
  subscribeOutgoingShares,
} from "../lib/friends";
import {
  MEAL_SLOT_EMOJI,
  MEAL_SLOT_LABELS,
  type Meal,
  type MealItem,
  type Share,
} from "../types";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { MealItemCard, MealItemEditDialog } from "../components/MealCard";
import MealSocialBlock from "../components/MealSocialBlock";
import FeedIntroBanner from "../components/FeedIntroBanner";
import { dateKey, formatKoDate, suggestMealSlotForNow } from "../lib/utils";
import { resolveDisplayName, resolveDisplayPhotoURL } from "../lib/identity";
import {
  deleteMealItem,
  saveMealItemPatch,
  updateMealItem,
} from "../lib/mealItems";
import { analyzeMealImage } from "../lib/ai";

/**
 * 피드 탭 — 인스타그램 피드처럼 나와 친구들의 식단 카드를 최신순으로.
 *
 * 데이터 소스:
 *  - 내 meals: Dexie 에서 실시간(useLiveQuery)
 *  - 친구 meals: 내가 viewer 인 share 들(subscribeOutgoingShares) 의 owner 별로
 *    최근 N 개 snapshots 를 구독해 병합.
 *  - 각 카드엔 작성자 프로필(나 | 친구), 날짜/슬롯, 여러 사진 항목, 좋아요/댓글 블록.
 */
interface FeedAuthor {
  uid: string;
  name: string;
  photoURL?: string;
  color?: string;
}

interface FeedEntry {
  author: FeedAuthor;
  meal: Meal;
  /** 나/친구 구분 — 사회 블록 표시 조건용 */
  isMine: boolean;
}

const MAX_PER_FRIEND = 15;
const MAX_MINE = 30;
/** 최초·추가로 그릴 피드 카드 개수 (무한 스크롤 단계) */
const FEED_PAGE_SIZE = 8;

export default function FeedPage() {
  const { user, firebaseReady } = useAuth();
  const myUid = firebaseReady ? user?.uid : undefined;
  const myUserId = usePrimaryUserId();
  const settings = useLiveQuery(() => getSettings(), []);
  const apiKey = settings?.geminiApiKey;

  const myProfile = useLiveQuery(
    async () => (myUserId ? await db.users.get(myUserId) : undefined),
    [myUserId],
  );

  // 내 로컬 식단 (항상 표시)
  const myMeals = useLiveQuery(async () => {
    if (!myUserId) return [] as Meal[];
    const arr = await db.meals.where("userId").equals(myUserId).toArray();
    return arr
      .map(normalizeMeal)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_MINE);
  }, [myUserId]);

  // 친구(내가 viewer 인 share) 목록 실시간 구독
  const [friendShares, setFriendShares] = useState<Share[] | null>(null);
  useEffect(() => {
    if (!myUid) {
      setFriendShares(null);
      return;
    }
    const unsub = subscribeOutgoingShares(
      (rows) => setFriendShares(rows.filter((s) => s.scope.calendar)),
      (e) => console.warn("[feed] outgoing shares", e),
    );
    return () => unsub();
  }, [myUid]);

  // 각 친구별 최근 식단 구독 — 친구가 추가/삭제되면 unsubscribe/resubscribe.
  const [friendMealsByOwner, setFriendMealsByOwner] = useState<Map<string, Meal[]>>(
    new Map(),
  );
  useEffect(() => {
    if (!friendShares) return;
    const unsubs: (() => void)[] = [];
    const current = new Set<string>();
    for (const s of friendShares) {
      current.add(s.ownerUid);
      const unsub = subscribeFriendLatestMeals(
        s.ownerUid,
        MAX_PER_FRIEND,
        (rows) => {
          setFriendMealsByOwner((prev) => {
            const next = new Map(prev);
            next.set(s.ownerUid, rows);
            return next;
          });
        },
        () => {
          // 권한 오류 등은 조용히 무시 — 해당 친구는 피드에 표시 안 됨.
        },
      );
      unsubs.push(unsub);
    }
    // 더 이상 친구가 아닌 owner 의 식단은 상태에서 제거.
    setFriendMealsByOwner((prev) => {
      const next = new Map<string, Meal[]>();
      for (const [k, v] of prev) if (current.has(k)) next.set(k, v);
      return next;
    });
    return () => {
      for (const u of unsubs) u();
    };
  }, [friendShares]);

  // 모든 엔트리를 병합 후 최신순 정렬.
  const entries = useMemo<FeedEntry[]>(() => {
    const out: FeedEntry[] = [];
    const myAuthor: FeedAuthor = {
      uid: myUid ?? "local-me",
      name: resolveDisplayName(myProfile, user),
      photoURL: resolveDisplayPhotoURL(myProfile, user?.photoURL),
      color: myProfile?.color,
    };
    for (const m of myMeals ?? []) {
      if ((m.items ?? []).length === 0) continue;
      out.push({ author: myAuthor, meal: m, isMine: true });
    }
    for (const share of friendShares ?? []) {
      const rows = friendMealsByOwner.get(share.ownerUid) ?? [];
      for (const m of rows) {
        if ((m.items ?? []).length === 0) continue;
        out.push({
          author: {
            uid: share.ownerUid,
            name: share.ownerName,
            photoURL: share.ownerPhotoURL,
          },
          meal: m,
          isMine: false,
        });
      }
    }
    out.sort((a, b) => b.meal.updatedAt - a.meal.updatedAt);
    return out;
  }, [myMeals, friendShares, friendMealsByOwner, myProfile, user?.displayName, user?.photoURL, myUid]);

  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount((n) => Math.min(Math.max(n, FEED_PAGE_SIZE), entries.length));
  }, [entries.length]);

  const visibleEntries =
    entries.length <= visibleCount ? entries : entries.slice(0, visibleCount);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= entries.length) return;

    const obs = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setVisibleCount((prev) =>
            prev >= entries.length ? prev : Math.min(prev + FEED_PAGE_SIZE, entries.length),
          );
        }
      },
      { root: null, rootMargin: "240px", threshold: 0 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleCount, entries.length]);

  const hasFriends = (friendShares?.length ?? 0) > 0;
  const loading =
    myMeals === undefined ||
    (firebaseReady && myUid !== undefined && friendShares === null);

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">나와 친구들의 최근 식단</p>
          <h1 className="text-xl font-bold">
            <Rss size={18} className="mb-0.5 mr-1 inline text-brand-400" />
            피드
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {myUserId && (
            <Link
              to={`/day/${dateKey()}?slot=${suggestMealSlotForNow()}`}
              className="btn-primary inline-flex h-10 w-10 items-center justify-center rounded-full p-0"
              aria-label="오늘 식단 사진 추가"
              title="오늘 식단 기록"
            >
              <Plus size={22} strokeWidth={2.5} />
            </Link>
          )}
          <Link to="/home" className="btn-secondary whitespace-nowrap py-2 text-sm">
            <Home size={14} /> 달력
          </Link>
        </div>
      </header>

      <FeedIntroBanner />

      {firebaseReady && !user && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-center text-[11px] text-slate-400">
          친구 맞추기·동기화는{" "}
          <Link to="/settings" className="text-brand-400 underline-offset-2 hover:underline">
            설정
          </Link>
          에서 Google 로그인 후 이용할 수 있어요.
        </p>
      )}

      {!hasFriends && firebaseReady && myUid && (
        <Link
          to="/friends"
          className="card flex items-center justify-between gap-3 border-slate-800 bg-slate-900/40 p-4 hover:bg-slate-900/60"
        >
          <div>
            <p className="text-sm font-medium text-slate-100">
              <UserPlus size={14} className="mb-0.5 mr-1 inline text-brand-400" />
              친구를 더하고 서로의 식단을 응원해요
            </p>
            <p className="mt-1 text-xs text-slate-400">
              친구가 공개를 수락하면 여기에서 최신 식단이 바로 보여요.
            </p>
          </div>
        </Link>
      )}

      {loading && entries.length === 0 && (
        <p className="card p-4 text-center text-xs text-slate-500">피드를 불러오는 중…</p>
      )}

      {!loading && entries.length === 0 && (
        <p className="card p-6 text-center text-sm text-slate-400">
          <Sparkles size={16} className="mb-0.5 mr-1 inline text-brand-400" />
          아직 기록이 없어요. 오늘의 첫 끼니를 찍어 올려볼까요?
        </p>
      )}

      <div className="space-y-4">
        {visibleEntries.map((e) => (
          <FeedCard
            key={`${e.author.uid}_${e.meal.id}`}
            entry={e}
            showSocial={!!myUid}
            myUserId={myUserId}
            myApiKey={apiKey}
          />
        ))}
      </div>

      {!loading && visibleCount < entries.length && (
        <div ref={sentinelRef} className="flex justify-center py-6" aria-hidden>
          <span className="text-xs text-slate-500">더 불러오는 중…</span>
        </div>
      )}
    </div>
  );
}

interface FeedCardProps {
  entry: FeedEntry;
  showSocial: boolean;
  /** 내 local Dexie userId — "내 게시물" 수정/재분석에 필요 */
  myUserId: string | undefined;
  myApiKey: string | undefined;
}

function FeedCard({ entry, showSocial, myUserId, myApiKey }: FeedCardProps) {
  const { author, meal, isMine } = entry;
  const items = meal.items ?? [];
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const editingItem = items.find((it) => it.id === editingItemId) ?? null;

  const totalCalories = useMemo(
    () =>
      items.reduce(
        (sum, it) => (typeof it.nutrition?.calories === "number" ? sum + it.nutrition.calories : sum),
        0,
      ),
    [items],
  );
  const avgRating = useMemo(() => {
    const rs = items
      .map((it) => it.rating)
      .filter((r): r is number => typeof r === "number");
    if (rs.length === 0) return undefined;
    return rs.reduce((a, b) => a + b, 0) / rs.length;
  }, [items]);

  async function handleReanalyzeByImage(item: MealItem) {
    if (!isMine || !myApiKey || !item.photo || !myUserId) return;
    await updateMealItem(meal.id, item.id, (it) => ({
      ...it,
      analysisStatus: "analyzing",
      analysisError: undefined,
      manuallyEdited: false,
    }));
    try {
      const profile = await getAnalysisProfileForUser(myUserId);
      const result = await analyzeMealImage(
        myApiKey,
        item.photo,
        meal.slot,
        undefined,
        profile,
      );
      await updateMealItem(meal.id, item.id, (it) => ({
        ...it,
        menuText: result.menuText,
        rating: result.rating,
        aiComment: result.aiComment,
        nutrition: result.nutrition,
        analysisStatus: "done",
        analysisError: undefined,
        manuallyEdited: false,
      }));
    } catch (e) {
      await updateMealItem(meal.id, item.id, (it) => ({
        ...it,
        analysisStatus: "error",
        analysisError: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  async function handleRemoveItem(item: MealItem) {
    if (!isMine) return;
    if (!confirm("이 사진을 삭제할까요?")) return;
    await deleteMealItem(meal.id, item.id, { ownerUid: author.uid });
  }

  return (
    <article className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <AuthorAvatar author={author} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-slate-100">{author.name}</p>
            {isMine && (
              <span className="shrink-0 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] text-brand-200">
                나
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {MEAL_SLOT_EMOJI[meal.slot]} {MEAL_SLOT_LABELS[meal.slot]} · {formatKoDate(meal.date)}
          </p>
        </div>
        {isMine ? (
          <Link
            to={`/day/${meal.date}?slot=${meal.slot}`}
            className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300 hover:text-slate-100"
          >
            열기
          </Link>
        ) : (
          <Link
            to={`/friends/${author.uid}/day/${meal.date}`}
            className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300 hover:text-slate-100"
          >
            상세
          </Link>
        )}
      </header>

      <div className="space-y-3 p-3">
        <div className="space-y-3">
          {items.map((it, idx) => (
            <MealItemCard
              key={it.id}
              item={it}
              index={idx}
              readOnly={!isMine}
              canAnalyze={isMine && !!myApiKey}
              onEdit={isMine ? () => setEditingItemId(it.id) : undefined}
              onReanalyze={
                isMine && it.photo ? () => void handleReanalyzeByImage(it) : undefined
              }
              onRemove={isMine ? () => void handleRemoveItem(it) : undefined}
            />
          ))}
        </div>
        {(avgRating !== undefined || totalCalories > 0) && (
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
            {avgRating !== undefined && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300">
                ★ 평균 {avgRating.toFixed(1)}
              </span>
            )}
            {totalCalories > 0 && (
              <span className="rounded-full bg-slate-800/60 px-2 py-0.5">
                🔥 {Math.round(totalCalories)} kcal
              </span>
            )}
            {items.length > 1 && (
              <span className="rounded-full bg-slate-800/60 px-2 py-0.5">
                사진 {items.length}장
              </span>
            )}
          </div>
        )}
        {showSocial && <MealSocialBlock ownerUid={author.uid} mealId={meal.id} />}
      </div>

      {isMine && editingItem && myUserId && (
        <MealItemEditDialog
          item={editingItem}
          canReanalyze={!!myApiKey}
          onClose={() => setEditingItemId(null)}
          onSave={async (patch, opts) => {
            const res = await saveMealItemPatch(meal.id, editingItem.id, patch, opts, {
              userId: myUserId,
              slot: meal.slot,
              apiKey: myApiKey,
            });
            if (opts.reanalyze && !res.reanalyzed && res.error) alert(res.error);
          }}
        />
      )}
    </article>
  );
}

function AuthorAvatar({ author }: { author: FeedAuthor }) {
  if (author.photoURL) {
    return (
      <img
        src={author.photoURL}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full border border-slate-800 object-cover"
      />
    );
  }
  const initial = author.name ? Array.from(author.name)[0]?.toUpperCase() ?? "?" : "?";
  const bg = author.color ?? "#1f2937";
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 text-sm font-semibold text-white"
      style={{ backgroundColor: bg }}
    >
      {initial}
    </div>
  );
}
