import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Home, Rss, Sparkles, UserPlus } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { db, normalizeMeal } from "../lib/db";
import {
  subscribeFriendLatestMeals,
  subscribeOutgoingShares,
} from "../lib/friends";
import {
  MEAL_SLOT_EMOJI,
  MEAL_SLOT_LABELS,
  type Meal,
  type Share,
} from "../types";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { MealItemCard } from "../components/MealCard";
import MealSocialBlock from "../components/MealSocialBlock";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { formatKoDate } from "../lib/utils";

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

export default function FeedPage() {
  const { user, firebaseReady } = useAuth();
  const myUid = firebaseReady ? user?.uid : undefined;
  const myUserId = usePrimaryUserId();

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
      name: myProfile?.name ?? user?.displayName ?? "나",
      photoURL: user?.photoURL ?? undefined,
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

  const hasFriends = (friendShares?.length ?? 0) > 0;
  const loading =
    myMeals === undefined ||
    (firebaseReady && myUid !== undefined && friendShares === null);

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">나와 친구들의 최근 식단</p>
          <h1 className="text-xl font-bold">
            <Rss size={18} className="mb-0.5 mr-1 inline text-brand-400" />
            피드
          </h1>
        </div>
        <Link to="/home" className="btn-secondary py-2 text-sm">
          <Home size={14} /> 달력
        </Link>
      </header>

      <FirebaseLoginCard />

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
        {entries.map((e) => (
          <FeedCard
            key={`${e.author.uid}_${e.meal.id}`}
            entry={e}
            showSocial={!!myUid}
          />
        ))}
      </div>
    </div>
  );
}

function FeedCard({ entry, showSocial }: { entry: FeedEntry; showSocial: boolean }) {
  const { author, meal, isMine } = entry;
  const items = meal.items ?? [];
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
        {items.length === 1 ? (
          <MealItemCard item={items[0]} index={0} readOnly />
        ) : (
          <div className="space-y-3">
            {items.map((it, idx) => (
              <MealItemCard key={it.id} item={it} index={idx} readOnly />
            ))}
          </div>
        )}
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
