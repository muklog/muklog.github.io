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
import { prefetchDownloadUrlsForStoragePaths } from "../lib/userMediaStorage";

/**
 * 피드 탭 — 스트림은 App 의 FeedStreamProvider 에서 구독하고, 여기서는 렌더링만 합니다.
 * 첫 화면은 1장부터 시작하고, 스트림 준비 후 센티널·뷰포트에 따라 1장씩 연다.
 * (짧은 콘텐츠에서는 자동 보충으로 스크롤이 생길 때까지 채움)
 * MealSocialBlock 은 카드가 뷰포트 근처에 올 때만 구독합니다.
 */
const FEED_INITIAL_VISIBLE = 1;
/** 센티널 교차·스크롤 보충 시 한 번에 추가하는 카드 수 */
const FEED_LOAD_CHUNK = 1;
/** 보이는 카드 + 바로 다음 몇 장까지 썸네일 URL 선요청 */
const FEED_PREFETCH_AHEAD = 2;
/** 피드 상단 N개 카드는 Storage 썸네일을 IO 대기 없이 바로 요청 */
const FEED_EAGER_IMAGE_CARDS = 6;

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
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** 스크롤·휠 시 추가로 «다음 장» 로드 허용(스트림 준비 후 기본 true 로 IO 도 동작) */
  const feedScrollEngagedRef = useRef(false);
  /** IO 교차: false→true 일 때만 1장 추가(계속 교차인 채로 연속 증가 방지) */
  const feedIoWasIntersectingRef = useRef(false);

  /** 다른 탭에서 남은 main 스크롤이 있으면 감지 줄이 화면 밖으로 밀려 IO가 영원히 안 도는 경우가 있음 */
  useLayoutEffect(() => {
    document.querySelector<HTMLElement>("[data-app-scroll-root]")?.scrollTo(0, 0);
  }, []);

  /** 항목 수가 줄면 보이는 개수만큼만 유지 (삭제·필터 등) */
  useEffect(() => {
    const len = entries.length;
    if (len === 0) {
      setVisibleCount(FEED_INITIAL_VISIBLE);
      return;
    }
    setVisibleCount((n) => Math.min(Math.max(n, FEED_INITIAL_VISIBLE), len));
  }, [entries.length]);

  const visibleEntries =
    entries.length <= visibleCount ? entries : entries.slice(0, visibleCount);

  /** 현재까지 연 카드 + 앞으로 1~2장 분량만 선요청 (한 장씩 열 때 네트워크 낭비 줄임) */
  useEffect(() => {
    if (!streamReady || !settled || entries.length === 0) return;
    const cap = Math.min(visibleCount + FEED_PREFETCH_AHEAD, entries.length);
    const paths: string[] = [];
    for (const e of entries.slice(0, cap)) {
      for (const it of (e.meal.items ?? []).slice(0, 2)) {
        const p = it.thumbStoragePath || it.photoStoragePath;
        if (p) paths.push(p);
      }
    }
    prefetchDownloadUrlsForStoragePaths(paths, 24);
  }, [streamReady, settled, entries, visibleCount]);

  const [emptyHintReady, setEmptyHintReady] = useState(false);
  const [friendPromptReady, setFriendPromptReady] = useState(false);
  useEffect(() => {
    if (!streamReady || !settled || entries.length > 0) {
      setEmptyHintReady(false);
      return;
    }
    const t = window.setTimeout(() => setEmptyHintReady(true), 420);
    return () => window.clearTimeout(t);
  }, [streamReady, settled, entries.length]);
  useEffect(() => {
    if (!streamReady || !settled || hasFriends) {
      setFriendPromptReady(false);
      return;
    }
    const t = window.setTimeout(() => setFriendPromptReady(true), 700);
    return () => window.clearTimeout(t);
  }, [streamReady, settled, hasFriends]);
  /** 더 불러올 카드가 있을 때만 표시 — 지연 없음(스크롤로 바로 채워지면 거의 안 보임) */
  const loadMoreHintVisible =
    streamReady && entries.length > 0 && visibleCount < entries.length;

  /**
   * 피드 스트림이 준비되면 «스크롤 한 번» 없이도 센티널·IO 가 다음 장을 열 수 있게 한다.
   * (한 장만으로도 스크롤이 생기면 기존 autoFill 이 멈추고, engage 가 false 면 첫 화면에서 멈춤)
   */
  useEffect(() => {
    if (!streamReady || !settled || entries.length === 0) return;
    feedScrollEngagedRef.current = true;
  }, [streamReady, settled, entries.length]);

  /** 스크롤·휠·터치 후에만 다음 카드 로드(IO 교차 + 스크롤 보조) */
  useEffect(() => {
    if (!streamReady || !settled) return;
    const el = sentinelRef.current;
    if (!el || visibleCount >= entries.length) return;

    let main = document.querySelector<HTMLElement>("[data-app-scroll-root]");
    let alive = true;
    let autoFillTimer: number | null = null;

    /** 한 번이라도 스크롤·휠·터치하면 로드 허용. 이미 센티널이 보이는 경우 IO 가 다시 안 울 수 있어 1프레임 뒤 직접 1장 연다. */
    const engage = () => {
      if (feedScrollEngagedRef.current) return;
      feedScrollEngagedRef.current = true;
      requestAnimationFrame(() => {
        if (!alive) return;
        const t = sentinelRef.current;
        if (!t) return;
        const vh = window.innerHeight;
        const r = t.getBoundingClientRect();
        if (!(vh > 0 && r.bottom > 0 && r.top < vh)) return;
        const len = entriesLenRef.current;
        setVisibleCount((prev) => {
          if (prev >= len) return prev;
          return Math.min(prev + FEED_LOAD_CHUNK, len);
        });
        feedIoWasIntersectingRef.current = true;
      });
    };

    const tryLoadOneMore = () => {
      if (!alive || !feedScrollEngagedRef.current) return;
      const len = entriesLenRef.current;
      setVisibleCount((prev) => {
        if (prev >= len) return prev;
        return Math.min(prev + FEED_LOAD_CHUNK, len);
      });
    };

    /**
     * PC 큰 화면에서 "카드 1개 + 안내문"만으로 스크롤 높이가 생기지 않으면
     * engage 이벤트가 오지 않아 영원히 멈출 수 있다.
     * 이 경우에는 뷰포트를 채울 때까지 한 장씩 자동 보충한다.
     */
    const autoFillIfNotScrollable = () => {
      if (!alive) return;
      if (!main) {
        main = document.querySelector<HTMLElement>("[data-app-scroll-root]");
      }
      if (!main) return;
      if (visibleCountRef.current >= entriesLenRef.current) return;
      if (main.scrollHeight > main.clientHeight + 8) return;
      const len = entriesLenRef.current;
      let increased = false;
      setVisibleCount((prev) => {
        if (prev >= len) return prev;
        const next = Math.min(prev + FEED_LOAD_CHUNK, len);
        if (next > prev) increased = true;
        return next;
      });
      if (increased) scheduleAutoFillCheck();
    };

    const scheduleAutoFillCheck = () => {
      if (!alive) return;
      if (autoFillTimer !== null) window.clearTimeout(autoFillTimer);
      autoFillTimer = window.setTimeout(() => {
        autoFillTimer = null;
        autoFillIfNotScrollable();
      }, 120);
    };

    /** IntersectionObserver: 센티널이 뷰포트에 들어올 때 한 장 추가 */
    const opts: IntersectionObserverInit = {
      root: null,
      rootMargin: "900px 0px",
      threshold: 0,
    };

    /** effect 재실행·visibleCount 증가 직후에도 첫 교차를 false→true 로 잡아 한 장 더 연다 */
    feedIoWasIntersectingRef.current = false;

    const obs = new IntersectionObserver(
      (records) => {
        const rec = records[0];
        const now = !!rec?.isIntersecting;
        const was = feedIoWasIntersectingRef.current;
        feedIoWasIntersectingRef.current = now;
        if (!feedScrollEngagedRef.current) return;
        if (now && !was) tryLoadOneMore();
      },
      opts,
    );
    obs.observe(el);

    /** 센티널이 계속 보이면 IO 가 재발하지 않아 멈추는 경우 보충(스로틀) */
    let lastScrollFill = 0;
    const SCROLL_FILL_MS = 340;
    const onScrollFill = () => {
      if (!alive || !feedScrollEngagedRef.current) return;
      if (visibleCountRef.current >= entriesLenRef.current) return;
      const now = Date.now();
      if (now - lastScrollFill < SCROLL_FILL_MS) return;
      const t = sentinelRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const vh = window.innerHeight;
      if (!(vh > 0 && r.bottom > 0 && r.top < vh)) return;
      lastScrollFill = now;
      tryLoadOneMore();
    };

    window.addEventListener("scroll", engage, { passive: true });
    window.addEventListener("wheel", engage, { passive: true });
    window.addEventListener("touchmove", engage, { passive: true });
    main?.addEventListener("scroll", engage, { passive: true });
    main?.addEventListener("wheel", engage, { passive: true });

    window.addEventListener("scroll", onScrollFill, { passive: true });
    main?.addEventListener("scroll", onScrollFill, { passive: true });

    const rafA = requestAnimationFrame(autoFillIfNotScrollable);
    const rafB = requestAnimationFrame(() => requestAnimationFrame(autoFillIfNotScrollable));
    scheduleAutoFillCheck();
    const onResize = () => autoFillIfNotScrollable();
    window.addEventListener("resize", onResize, { passive: true });
    const mainResizeObs = main ? new ResizeObserver(() => autoFillIfNotScrollable()) : null;
    if (main && mainResizeObs) mainResizeObs.observe(main);

    return () => {
      alive = false;
      if (autoFillTimer !== null) window.clearTimeout(autoFillTimer);
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
      window.removeEventListener("scroll", engage);
      window.removeEventListener("wheel", engage);
      window.removeEventListener("touchmove", engage);
      main?.removeEventListener("scroll", engage);
      main?.removeEventListener("wheel", engage);
      window.removeEventListener("scroll", onScrollFill);
      main?.removeEventListener("scroll", onScrollFill);
      window.removeEventListener("resize", onResize);
      mainResizeObs?.disconnect();
      obs.disconnect();
    };
  }, [streamReady, settled, entries.length, visibleCount]);

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
                {visibleEntries.map((e, idx) => (
                  <FeedCard
                    key={`${e.author.uid}_${e.meal.id}`}
                    entry={e}
                    showSocial={!!myUid}
                    myFirebaseUid={myUid}
                    myUserId={myUserId}
                    myApiKey={apiKey}
                    eagerFeedImage={idx < FEED_EAGER_IMAGE_CARDS}
                    quietPhotoLoading
                  />
                ))}
              </div>
            )}

            {visibleCount < entries.length && (
              <div
                ref={sentinelRef}
                className="flex flex-col items-center gap-1 py-5 text-center"
              >
                {loadMoreHintVisible && (
                  <span className="text-[11px] text-slate-500">아래로 스크롤하면 더 보여요</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((prev) =>
                      Math.min(prev + FEED_LOAD_CHUNK, entries.length),
                    )
                  }
                  className="btn-secondary mt-2 py-1.5 text-[11px]"
                >
                  더 불러오기
                </button>
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
  eagerFeedImage?: boolean;
  quietPhotoLoading?: boolean;
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

function FeedCard({
  entry,
  showSocial,
  myFirebaseUid,
  myUserId,
  myApiKey,
  eagerFeedImage = false,
  quietPhotoLoading = true,
}: FeedCardProps) {
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
    await deleteMealItem(meal.id, item.id, {
      ownerUid: author.uid,
      mealSeed: meal,
    });
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
                mealItemCount={items.length}
                readOnly={!isMine}
                canAnalyze={isMine && !!myApiKey}
                showPhotoAnalyzingOverlay={false}
                reanalyzeBusy={imageReanalyzeBusyId === it.id}
                eagerFeedImage={eagerFeedImage}
                quietPhotoLoading={quietPhotoLoading}
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
