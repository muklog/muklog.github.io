import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useFeedStream, type FeedAuthor, type FeedEntry } from "../contexts/FeedStreamContext";
import { useLiveQuery } from "dexie-react-hooks";
import { Home, Loader2, Plus, Rss, Sparkles, UserPlus } from "lucide-react";
import { getAnalysisProfileForUser, getSettings } from "../lib/db";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { MealItemCard, MealItemCardsCarousel, MealItemEditDialog } from "../components/MealCard";
import MealSocialBlock from "../components/MealSocialBlock";
import FeedIntroBanner from "../components/FeedIntroBanner";
import { dateKey, formatKoDate, suggestMealSlotForNow } from "../lib/utils";
import {
  deleteMealItem,
  saveMealItemPatch,
  updateMealItem,
} from "../lib/mealItems";
import { analyzeMealImage } from "../lib/ai";
import FeedAlertsHeaderIcons from "../components/FeedAlertsHeaderIcons";
import { MEAL_SLOT_EMOJI, MEAL_SLOT_LABELS, type MealItem } from "../types";

/**
 * 피드 탭 — 스트림은 App 의 FeedStreamProvider 에서 구독하고, 여기서는 렌더링만 합니다.
 */
const FEED_PAGE_SIZE = 8;

export default function FeedPage() {
  const { user, firebaseReady } = useAuth();
  const fs = useFeedStream();
  const entries = fs?.entries ?? [];
  const loading = fs?.loading ?? true;
  /** 친구 스트림·공유 목록이 준비된 뒤에만 목록·친구 유도 카드를 그림 — 준비 전엔 깜빡임 없이 로딩만 */
  const streamReady = !loading;
  const myUid = firebaseReady ? user?.uid : undefined;
  const myUserId = usePrimaryUserId();
  const settings = useLiveQuery(() => getSettings(), []);
  const apiKey = settings?.geminiApiKey;

  const markWatermark = fs?.markFeedWatermark;
  useEffect(() => () => void markWatermark?.(), [markWatermark]);

  const hasFriends = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (!e.isMine) set.add(e.author.uid);
    return set.size > 0;
  }, [entries]);

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

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">나와 친구들의 식단</p>
          <h1 className="text-xl font-bold">
            <Rss size={18} className="mb-0.5 mr-1 inline text-brand-400" />
            피드
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FeedAlertsHeaderIcons />
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
            <Home size={14} /> 식단
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

      {streamReady && !hasFriends && firebaseReady && myUid && (
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

      {!streamReady && (
        <div
          className="card flex flex-col items-center justify-center gap-3 py-14 text-center"
          aria-busy
          aria-live="polite"
        >
          <Loader2 className="h-8 w-8 animate-spin text-brand-400" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-200">피드를 불러오는 중…</p>
            {myUid && (
              <p className="text-xs text-slate-500">친구와 공유된 식단을 함께 가져오고 있어요.</p>
            )}
          </div>
        </div>
      )}

      {streamReady && entries.length === 0 && (
        <p className="card p-6 text-center text-sm text-slate-400">
          <Sparkles size={16} className="mb-0.5 mr-1 inline text-brand-400" />
          아직 기록이 없어요. 오늘의 첫 끼니를 찍어 올려볼까요?
        </p>
      )}

      {streamReady && entries.length > 0 && (
        <div className="space-y-4">
          {visibleEntries.map((e) => (
            <FeedCard
              key={`${e.author.uid}_${e.meal.id}`}
              entry={e}
              showSocial={!!myUid}
              myFirebaseUid={myUid}
              myUserId={myUserId}
              myApiKey={apiKey}
            />
          ))}
        </div>
      )}

      {streamReady && visibleCount < entries.length && (
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
  /** Firebase uid — 로그인 시 친구 닉네임에서 DM 진입 */
  myFirebaseUid: string | undefined;
  /** 내 local Dexie userId — "내 게시물" 수정/재분석에 필요 */
  myUserId: string | undefined;
  myApiKey: string | undefined;
}

function FeedCard({ entry, showSocial, myFirebaseUid, myUserId, myApiKey }: FeedCardProps) {
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
          <div className="flex items-center gap-1.5 min-w-0">
            {!isMine && myFirebaseUid ? (
              <Link
                to={`/messages?with=${encodeURIComponent(author.uid)}`}
                className="truncate text-sm font-semibold text-brand-200 hover:underline"
                title="DM 보내기"
              >
                {author.name}
              </Link>
            ) : (
              <p className="truncate text-sm font-semibold text-slate-100">{author.name}</p>
            )}
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
            to={`/friends/${author.uid}/day/${meal.date}?slot=${meal.slot}`}
            className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300 hover:text-slate-100"
          >
            상세
          </Link>
        )}
      </header>

      <div className="space-y-3 p-3">
        <MealItemCardsCarousel
          items={items}
          renderSlide={(it, idx) => (
            <MealItemCard
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
          )}
        />
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
