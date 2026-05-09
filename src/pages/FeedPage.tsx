import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useFeedStream, type FeedAuthor, type FeedEntry } from "../contexts/FeedStreamContext";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, Plus, Rss, Share2, Sparkles, UserPlus } from "lucide-react";
import { getAnalysisProfileForUser, getSettings } from "../lib/db";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { MealItemCard, MealItemCardsCarousel, MealItemEditDialog } from "../components/MealCard";
import MealSocialBlock from "../components/MealSocialBlock";
import MealMultiPhotoSummaryChips from "../components/MealMultiPhotoSummaryChips";
import FeedIntroBanner from "../components/FeedIntroBanner";
import { dateKey, formatKoDate, suggestMealSlotForNow } from "../lib/utils";
import {
  deleteMealItem,
  saveMealItemPatch,
  updateMealItem,
} from "../lib/mealItems";
import { analyzeMealImage } from "../lib/ai";
import { shareMealCardFromElement } from "../lib/shareMealCardImage";
import { getAppShareAbsoluteUrl } from "../lib/siteUrl";
import FeedAlertsHeaderIcons from "../components/FeedAlertsHeaderIcons";
import AddToHomeScreenButton from "../components/AddToHomeScreenButton";
import { MEAL_SLOT_EMOJI, MEAL_SLOT_LABELS, type MealItem } from "../types";
import { STALL_REFRESH_HINT } from "../lib/tabLoadingMessage";

/**
 * 피드 탭 — 스트림은 App 의 FeedStreamProvider 에서 구독하고, 여기서는 렌더링만 합니다.
 * 카드별 좋아요·댓글 리스너 부담을 줄이기 위해 초깃값만 제한 두되, 높은 뷰포트에서 센티널이
 * 계속 보이면 한 번에 여러 카드를 채워 «한 개만 보이고 스크롤 불가» 를 막습니다.
 */
const FEED_INITIAL_VISIBLE = 1;
/** 짧은 첫 카드 + 큰 창: bump 시 한 번에 부풀릴 카드 수(이후 레이아웃 시 한 장씩 더 채움) */
const FEED_LOAD_BURST = 8;

export default function FeedPage() {
  const { user, firebaseReady, loading: authLoading } = useAuth();
  const fs = useFeedStream();
  const entries = fs?.entries ?? [];
  const loading = fs?.loading ?? true;
  const settled = fs?.settled ?? false;
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

  const entriesLenRef = useRef(0);
  entriesLenRef.current = entries.length;

  const [visibleCount, setVisibleCount] = useState(FEED_INITIAL_VISIBLE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** 짧은 카드 + 높은 뷰포트에서 레이아웃 루프가 끝나지 않게 상한 */
  const layoutFillPassesRef = useRef(0);

  /** 다른 탭에서 남은 main 스크롤이 있으면 감지 줄이 화면 밖으로 밀려 IO가 영원히 안 도는 경우가 있음 */
  useLayoutEffect(() => {
    document.querySelector<HTMLElement>("[data-app-scroll-root]")?.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    layoutFillPassesRef.current = 0;
    const len = entries.length;
    setVisibleCount((n) =>
      len === 0 ? FEED_INITIAL_VISIBLE : Math.min(Math.max(n, FEED_INITIAL_VISIBLE), len),
    );
  }, [entries.length]);

  const visibleEntries =
    entries.length <= visibleCount ? entries : entries.slice(0, visibleCount);
  const [emptyHintReady, setEmptyHintReady] = useState(false);
  const [friendPromptReady, setFriendPromptReady] = useState(false);
  const [loadMoreHintReady, setLoadMoreHintReady] = useState(false);
  useEffect(() => {
    if (!streamReady || !settled || entries.length > 0) {
      setEmptyHintReady(false);
      return;
    }
    const t = window.setTimeout(() => setEmptyHintReady(true), 900);
    return () => window.clearTimeout(t);
  }, [streamReady, settled, entries.length]);
  useEffect(() => {
    if (!streamReady || !settled || hasFriends) {
      setFriendPromptReady(false);
      return;
    }
    const t = window.setTimeout(() => setFriendPromptReady(true), 1200);
    return () => window.clearTimeout(t);
  }, [streamReady, settled, hasFriends]);
  useEffect(() => {
    if (!streamReady || entries.length === 0 || visibleCount >= entries.length) {
      setLoadMoreHintReady(false);
      return;
    }
    const t = window.setTimeout(() => setLoadMoreHintReady(true), 1400);
    return () => window.clearTimeout(t);
  }, [streamReady, entries.length, visibleCount]);

  /**
   * PC 등 뷰포트가 높을 때 첫 카드만 짧아도 센티널이 보이지만 IntersectionObserver/스크롤이 한 번만
   * 카운트를 올려 «스크롤이 필요 없음» 상태가 된다. 레이아웃 직후 센티널이 여전히 보이면 카드를 더 연다.
   */
  useLayoutEffect(() => {
    if (!streamReady || entries.length === 0) return;
    if (visibleCount >= entries.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;
    if (!(vh > 0)) return;
    const r = sentinel.getBoundingClientRect();
    if (!(r.bottom > 0 && r.top < vh)) return;
    layoutFillPassesRef.current += 1;
    if (layoutFillPassesRef.current > 72) return;
    setVisibleCount((c) => Math.min(c + FEED_LOAD_BURST, entries.length));
  }, [streamReady, entries.length, visibleCount, visibleEntries.length]);

  /** IntersectionObserver + main 스크롤 보조(IO 첫 프레임 누락·스크롤 위치 오류 방지). entriesLenRef 로 콜백 스테일 길이 방지 */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= entries.length) return;

    const main = document.querySelector<HTMLElement>("[data-app-scroll-root]");
    let alive = true;

    /** 뷰포트 기준 — 스크롤이 main 안이든 window 든 센티널이 보이면 로드 */
    const bumpIfVisible = () => {
      if (!alive) return;
      const target = sentinelRef.current;
      if (!target) return;
      const len = entriesLenRef.current;
      const s = target.getBoundingClientRect();
      const vh = typeof window !== "undefined" ? window.innerHeight : 0;
      if (!(vh > 0 && s.bottom > 0 && s.top < vh)) return;
      setVisibleCount((prev) => {
        if (prev >= len) return prev;
        const dynamicStep = Math.max(FEED_LOAD_BURST, Math.ceil((len - prev) / 3));
        return Math.min(prev + dynamicStep, len);
      });
    };

    let scrollRaf = 0;
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        bumpIfVisible();
      });
    };

    /** root 를 main 에만 두면 창 스크롤만 있는 레이아웃에서 교차 검사가 영원히 false 인 경우가 있음 */
    const opts: IntersectionObserverInit = {
      root: null,
      rootMargin: "680px 0px",
      threshold: 0,
    };

    const obs = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) bumpIfVisible();
      },
      opts,
    );
    obs.observe(el);

    window.addEventListener("scroll", onScroll, { passive: true });
    main?.addEventListener("scroll", onScroll, { passive: true });

    const rafId = requestAnimationFrame(() => {
      bumpIfVisible();
      requestAnimationFrame(bumpIfVisible);
    });

    /** 레이아웃·폰트·이미지 직후 한 번 더(첫 진입 때 IO만으로는 교차 보고가 없는 환경 대비) */
    const tStale = window.setTimeout(bumpIfVisible, 300);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      window.clearTimeout(tStale);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      window.removeEventListener("scroll", onScroll);
      main?.removeEventListener("scroll", onScroll);
      obs.disconnect();
    };
  }, [visibleCount, entries.length]);

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">나와 친구들의 식단</p>
          <h1 className="text-xl font-bold">
            <Rss size={18} className="mb-0.5 mr-1 inline text-brand-400" />
            피드
          </h1>
        </div>
        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          <FeedAlertsHeaderIcons />
          {/* 프로필 id 가 늦게 잡혀도 플러스 자리 폭 고정으로 우측 아이콘 정렬 유지 */}
          <div className="flex h-10 w-[2.5rem] shrink-0 items-center justify-center">
            {myUserId ? (
              <Link
                to={`/day/${dateKey()}?slot=${suggestMealSlotForNow()}`}
                className="btn-primary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0"
                aria-label="오늘 식단 사진 추가"
                title="오늘 식단 기록"
              >
                <Plus size={22} strokeWidth={2.5} />
              </Link>
            ) : (
              <span className="invisible inline-flex h-10 w-10 shrink-0" aria-hidden />
            )}
          </div>
          <AddToHomeScreenButton />
        </div>
      </header>

      <FeedIntroBanner />

      {firebaseReady && !user && !authLoading && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-center text-[11px] text-slate-400">
          친구 맞추기·동기화는{" "}
          <Link to="/settings" className="text-brand-400 underline-offset-2 hover:underline">
            설정
          </Link>
          에서 Google 로그인 후 이용할 수 있어요.
        </p>
      )}

      {streamReady && !hasFriends && friendPromptReady && firebaseReady && myUid && (
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
              초대 링크로 친구가 수락하면 서로의 식단이 맞팔로 공개되고, 여기 피드에서도 볼 수 있어요.
            </p>
          </div>
        </Link>
      )}

      {/* 식단 카드 목록이 들어갈 영역만 로딩 — 헤더·배너는 그대로 */}
      <section className="flex flex-col gap-4" aria-busy={!streamReady}>
        {!streamReady ? (
          <div
            className="card flex min-h-[11rem] flex-col items-center justify-center gap-3 px-4 py-6 text-center"
            aria-live="polite"
          >
            <Loader2 className="h-7 w-7 shrink-0 animate-spin text-brand-400" aria-hidden />
            <div className="space-y-1">
              {myUid && (
                <p className="text-xs text-slate-500">친구와 공유된 식단을 함께 가져오고 있어요.</p>
              )}
              <p className="text-[11px] text-slate-500">{STALL_REFRESH_HINT}</p>
            </div>
          </div>
        ) : (
          <>
            {entries.length === 0 && emptyHintReady && (
              <p className="card p-6 text-center text-sm text-slate-400">
                <Sparkles size={16} className="mb-0.5 mr-1 inline text-brand-400" />
                아직 기록이 없어요. 오늘의 첫 끼니를 찍어 올려볼까요?
              </p>
            )}

            {entries.length > 0 && (
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

            {visibleCount < entries.length && (
              <div
                ref={sentinelRef}
                className="flex flex-col items-center gap-1 py-5 text-center"
                aria-hidden
              >
                {loadMoreHintReady && (
                  <span className="text-[11px] text-slate-500">아래로 스크롤하면 더 보여요</span>
                )}
              </div>
            )}
          </>
        )}
      </section>
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

function queryCarouselSlideRoots(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-muklog-carousel-slide]")];
}

function activeCarouselIdxFromDom(root: HTMLElement): number | null {
  const scroller = root.querySelector<HTMLElement>("[data-muklog-carousel-scroller]");
  if (!scroller) return null;
  const w = scroller.clientWidth;
  if (w <= 0) return null;
  return Math.max(0, Math.round(scroller.scrollLeft / w));
}

function FeedCard({ entry, showSocial, myFirebaseUid, myUserId, myApiKey }: FeedCardProps) {
  const { author, meal, isMine } = entry;
  const items = meal.items ?? [];
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  /** 공유·캡처 시 현재 보이는 슬라이드와 맞춤 */
  const [carouselSlideIdx, setCarouselSlideIdx] = useState(0);
  /** 피드에서 사진 재분석 중일 때 버튼 스피너만 씀 (전 카드 분석 중 UI 없음) */
  const [imageReanalyzeBusyId, setImageReanalyzeBusyId] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const mealShareRef = useRef<HTMLDivElement | null>(null);
  const editingItem = items.find((it) => it.id === editingItemId) ?? null;

  async function handleShareActiveCard() {
    const el = mealShareRef.current;
    if (!el || shareBusy || items.length === 0) return;
    setShareBusy(true);
    const slides = queryCarouselSlideRoots(el);
    const restore: Array<{ node: HTMLElement; display: string; position: string }> = [];
    if (items.length > 1 && slides.length > 1) {
      const fromDom = activeCarouselIdxFromDom(el);
      const activeIdx =
        fromDom !== null ? Math.min(fromDom, slides.length - 1) : carouselSlideIdx;
      slides.forEach((node, i) => {
        if (i !== activeIdx) {
          restore.push({
            node,
            display: node.style.display,
            position: node.style.position,
          });
          node.style.display = "none";
          node.style.position = "absolute";
        }
      });
    }
    try {
      const promoUrl = getAppShareAbsoluteUrl();
      await shareMealCardFromElement(el, {
        filename: `muklog-meal-${Date.now()}.png`,
        promoUrl,
        shareTitle: "먹로그 식단",
        shareText: `먹로그에서 기록한 식단이에요 — ${promoUrl}`,
      });
    } catch (e) {
      console.error("[FeedCard] share", e);
      alert(e instanceof Error ? e.message : "이미지를 만들지 못했습니다.");
    } finally {
      for (const r of restore) {
        r.node.style.display = r.display;
        r.node.style.position = r.position;
      }
      setShareBusy(false);
    }
  }

  async function handleReanalyzeByImage(item: MealItem) {
    if (!isMine || !myApiKey || !item.photo || !myUserId) return;
    setImageReanalyzeBusyId(item.id);
    try {
      const profile = await getAnalysisProfileForUser(myUserId);
      const result = await analyzeMealImage(
        myApiKey,
        item.photo,
        meal.slot,
        undefined,
        profile,
      );
      await updateMealItem(
        meal.id,
        item.id,
        (it) => ({
          ...it,
          menuText: result.menuText,
          rating: result.rating,
          aiComment: result.aiComment,
          nutrition: result.nutrition,
          isMealPhoto: result.isMealPhoto,
          analysisStatus: "done",
          analysisError: undefined,
          manuallyEdited: false,
        }),
        { bumpMealUpdatedAt: false },
      );
    } catch (e) {
      await updateMealItem(
        meal.id,
        item.id,
        (it) => ({
          ...it,
          analysisStatus: "error",
          analysisError: e instanceof Error ? e.message : String(e),
        }),
        { bumpMealUpdatedAt: false },
      );
    } finally {
      setImageReanalyzeBusyId(null);
    }
  }

  async function handleRemoveItem(item: MealItem) {
    if (!isMine) return;
    if (!confirm("이 사진을 삭제할까요?")) return;
    await deleteMealItem(meal.id, item.id, { ownerUid: author.uid });
  }

  return (
    <article className="card overflow-hidden">
      <div ref={mealShareRef} className="overflow-hidden">
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
          {items.length > 0 && (
            <button
              type="button"
              disabled={shareBusy}
              onClick={() => void handleShareActiveCard()}
              className="exclude-from-share-capture shrink-0 rounded-lg bg-slate-800/60 p-2 text-slate-200 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
              aria-label="카드 이미지로 공유"
              title="카카오톡·인스타 등에 카드 이미지 공유"
            >
              {shareBusy ? (
                <Loader2 size={18} className="animate-spin shrink-0" aria-hidden />
              ) : (
                <Share2 size={18} className="shrink-0" aria-hidden />
              )}
            </button>
          )}
        </header>

        <div className="space-y-3 p-3">
          <MealItemCardsCarousel
            items={items}
            onActiveSlideChange={setCarouselSlideIdx}
            renderSlide={(it, idx) => (
              <MealItemCard
                item={it}
                index={idx}
                readOnly={!isMine}
                canAnalyze={isMine && !!myApiKey}
                showPhotoAnalyzingOverlay={false}
                reanalyzeBusy={imageReanalyzeBusyId === it.id}
                onEdit={isMine ? () => setEditingItemId(it.id) : undefined}
                onReanalyze={
                  isMine && it.photo ? () => void handleReanalyzeByImage(it) : undefined
                }
                onRemove={isMine ? () => void handleRemoveItem(it) : undefined}
              />
            )}
          />
          <MealMultiPhotoSummaryChips items={items} />
        </div>
      </div>
      {showSocial && <MealSocialBlock ownerUid={author.uid} mealId={meal.id} />}

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
