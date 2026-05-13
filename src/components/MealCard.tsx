import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import type { MealItem } from "../types";
import { useMealItemCardImageSrc } from "../hooks/useMealItemCardImageSrc";
import { isRenderableImageBlob } from "../lib/image";
import { cls } from "../lib/utils";
import type { MealItemPatch } from "../lib/mealItems";
import { userFacingStorageErrorMessage } from "../lib/idbRetry";
import appIconSrc from "../../assets/app-icon.png?url";
export type { MealItemPatch } from "../lib/mealItems";

/** 사진 로딩 전·디코딩 전 자리 — 소스 아이콘과 동일한 비율의 둥근 모서리 */

/** `photoSrc` 가 바뀔 때마다 key 로 리마운트해 이전 사진의 `shown` 상태가 남지 않게 함 */
function MealItemCardPhotoBody({
  photoSrc,
  photoSrcPending,
  quietPhotoLoading,
  eagerFeedImage,
  onPhotoImgError,
}: {
  photoSrc: string | undefined;
  photoSrcPending: boolean;
  quietPhotoLoading: boolean;
  eagerFeedImage: boolean;
  onPhotoImgError: () => void;
}) {
  const [mealImgShown, setMealImgShown] = useState(false);
  const mealImgRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    if (!photoSrc) return;
    const el = mealImgRef.current;
    if (!el) return;
    if (el.complete && el.naturalHeight > 0) {
      setMealImgShown(true);
      return;
    }
    let cancelled = false;
    if (typeof el.decode === "function") {
      void el
        .decode()
        .then(() => {
          if (!cancelled) setMealImgShown(true);
        })
        .catch(() => {
          /* CORS·손상 이미지 등은 onLoad / onError 에 맡김 */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [photoSrc]);

  const showLogoUnderlay = !photoSrc || !mealImgShown;

  return (
    <>
      {showLogoUnderlay && (
        <div
          className="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-900"
          aria-hidden
        >
          <div
            className="relative h-[min(30%,5.75rem)] w-[min(30%,5.75rem)] shrink-0 overflow-hidden rounded-[22%] shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)] ring-1 ring-white/12"
            aria-hidden
          >
            <img
              src={appIconSrc}
              alt=""
              className="h-full w-full object-cover opacity-[0.94]"
              draggable={false}
            />
          </div>
        </div>
      )}
      {photoSrc ? (
        <img
          ref={mealImgRef}
          src={photoSrc}
          alt="식사 사진"
          loading={eagerFeedImage ? "eager" : "lazy"}
          fetchPriority={eagerFeedImage ? "high" : "auto"}
          decoding="async"
          className={cls(
            "relative z-10 aspect-square w-full object-cover transition-opacity duration-150",
            mealImgShown ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setMealImgShown(true)}
          onError={onPhotoImgError}
        />
      ) : (
        <div
          className="relative z-10 flex aspect-square w-full items-center justify-center"
          aria-busy
        >
          <span className="sr-only">
            {photoSrcPending ? "식사 사진 불러오는 중" : "식사 사진 표시 준비 중"}
          </span>
          {!quietPhotoLoading && (
            <Loader2
              className="absolute bottom-3 right-3 h-6 w-6 shrink-0 animate-spin text-slate-500/90"
              aria-hidden
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * 끼니 안의 한 "음식 항목" 카드.
 *
 * 한 끼니에 여러 번 먹거나 여러 음식이 있을 때 각 사진을 개별 카드로 표시한다.
 * 친구 페이지에서는 readOnly 로, 내 페이지에서는 재분석/수정/삭제 버튼이 표시된다.
 */
interface ItemCardProps {
  item: MealItem;
  index: number;
  readOnly?: boolean;
  canAnalyze?: boolean;
  /** true 면 이미지 위 전체 분석 중 오버레이 표시 (피드 등에서는 끌 수 있음) */
  showPhotoAnalyzingOverlay?: boolean;
  /** 재분석 API 진행 중 — 버튼에만 스피너 (카드 전체 대신) */
  reanalyzeBusy?: boolean;
  /** 부모에서 활성 슬라이드 카드만 넘기면 해당 카드 DOM 으로 PNG 공유 캡처 */
  shareCaptureRef?: MutableRefObject<HTMLDivElement | null>;
  /** 피드 상단 등 — Storage 이미지를 IO 대기 없이 바로 요청 */
  eagerFeedImage?: boolean;
  /** true 면 로딩 중에도 스피너 대신 정사각형 배경만 (회색 번쩍임·스피너 감소) */
  quietPhotoLoading?: boolean;
  onReanalyze?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  /** 이 끼니 항목(사진) 개수 — 2 이상일 때만 사진 위 #번호 배지 표시 */
  mealItemCount?: number;
}

export function MealItemCard({
  item,
  index,
  readOnly = false,
  canAnalyze = false,
  showPhotoAnalyzingOverlay = true,
  reanalyzeBusy = false,
  shareCaptureRef,
  eagerFeedImage = false,
  quietPhotoLoading = false,
  onReanalyze,
  onEdit,
  onRemove,
  mealItemCount = 1,
}: ItemCardProps) {
  const photoBlob = item.photo || item.thumbnail;
  const hasPhoto =
    isRenderableImageBlob(photoBlob) ||
    !!(item.thumbStoragePath || item.photoStoragePath);
  const { src: photoSrc, pending: photoSrcPending, onImgError: onPhotoImgError, wrapRef } =
    useMealItemCardImageSrc(item, { eagerImage: eagerFeedImage });

  return (
    <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/30 p-2">
      <div
        ref={(el) => {
          if (shareCaptureRef) shareCaptureRef.current = el;
        }}
        className="space-y-2"
      >
      <div
        ref={wrapRef}
        className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
      >
        {hasPhoto ? (
          <MealItemCardPhotoBody
            key={`${item.id}|${photoSrc ?? ""}`}
            photoSrc={photoSrc}
            photoSrcPending={photoSrcPending}
            quietPhotoLoading={quietPhotoLoading}
            eagerFeedImage={eagerFeedImage}
            onPhotoImgError={onPhotoImgError}
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center text-xs text-slate-500">
            사진 없음
          </div>
        )}
        {showPhotoAnalyzingOverlay && item.analysisStatus === "analyzing" && (
          <div
            className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 bg-slate-950/60 backdrop-blur-[2px]"
            aria-busy
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 shrink-0 animate-spin text-brand-400" aria-hidden />
            <span className="px-2 text-center text-[11px] font-medium text-slate-100">AI 분석 중…</span>
            <AnalyzingDelayHint active readOnly={readOnly} />
          </div>
        )}
        {mealItemCount >= 2 && (
          <span className="pointer-events-none absolute left-2 top-2 z-20 rounded-full bg-slate-950/85 px-2 py-0.5 text-[10px] font-semibold text-slate-200 shadow-sm ring-1 ring-slate-700/80 backdrop-blur">
            #{index + 1}
          </span>
        )}
      </div>
      <ItemAnalysisBlock
        item={item}
        readOnly={readOnly}
        canAnalyze={canAnalyze}
        reanalyzeBusy={reanalyzeBusy}
        onReanalyze={onReanalyze}
        onEdit={onEdit}
        onRemove={onRemove}
      />
      </div>
    </div>
  );
}

/** 사진·AI 분석 카드가 2장 이상일 때 가로 스냅 스와이프 (한 슬라이드 = 1항목 전체) */
export function MealItemCardsCarousel({
  items,
  renderSlide,
  scrollToItemId,
  onScrollToItemHandled,
  onActiveSlideChange,
}: {
  items: MealItem[];
  renderSlide: (item: MealItem, index: number) => ReactNode;
  /** 설정 시 해당 항목 슬라이드로 스크롤(추가 직후 등). 처리 후 `onScrollToItemHandled` 로 부모에서 비워 주세요 */
  scrollToItemId?: string | null;
  onScrollToItemHandled?: () => void;
  /** 가로 스크롤·항목 수 변경 시 현재 보이는 슬라이드 인덱스 (한 장이면 항상 0) */
  onActiveSlideChange?: (index: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);

  function syncSlideFromScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const idx = Math.round(el.scrollLeft / w);
    setSlide(Math.min(items.length - 1, Math.max(0, idx)));
  }

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || items.length <= 1) return;
    const ro = new ResizeObserver(() => syncSlideFromScroll());
    ro.observe(el);
    syncSlideFromScroll();
    return () => ro.disconnect();
  }, [items.length]);

  const itemIdsKey = useMemo(() => items.map((i) => i.id).join("|"), [items]);

  /** 한 장만 보일 때는 스크롤 UI 가 없어 부모 플래그만 바로 비운다 */
  useEffect(() => {
    if (items.length !== 1 || scrollToItemId == null || scrollToItemId === "") return;
    onScrollToItemHandled?.();
  }, [items.length, scrollToItemId, onScrollToItemHandled]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || items.length <= 1) return;

    if (!scrollToItemId) {
      syncSlideFromScroll();
      return;
    }

    const idx = items.findIndex((i) => i.id === scrollToItemId);
    if (idx < 0) {
      onScrollToItemHandled?.();
      return;
    }

    const scrollEl = el;
    let cancelled = false;
    let attempts = 0;
    function tryScroll() {
      if (cancelled) return;
      const w = scrollEl.clientWidth;
      if (w > 0) {
        scrollEl.scrollTo({ left: idx * w, behavior: "smooth" });
        setSlide(idx);
        onScrollToItemHandled?.();
        return;
      }
      attempts += 1;
      if (attempts < 12) requestAnimationFrame(tryScroll);
      else onScrollToItemHandled?.();
    }
    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [itemIdsKey, scrollToItemId]);

  useEffect(() => {
    if (items.length === 0) return;
    if (items.length <= 1) onActiveSlideChange?.(0);
    else onActiveSlideChange?.(slide);
  }, [items.length, slide, onActiveSlideChange]);

  if (items.length === 0) return null;

  if (items.length === 1) {
    return <>{renderSlide(items[0]!, 0)}</>;
  }

  return (
    <div className="w-full">
      <div
        ref={scrollerRef}
        data-muklog-carousel-scroller
        onScroll={() => requestAnimationFrame(syncSlideFromScroll)}
        className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((it, idx) => (
          <div
            key={it.id}
            data-muklog-carousel-slide={String(idx)}
            className="min-w-0 w-full shrink-0 flex-[0_0_100%] snap-center snap-always"
          >
            {renderSlide(it, idx)}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-1.5 py-2" aria-hidden>
        {items.map((_, i) => (
          <span
            key={i}
            className={cls(
              "h-1.5 w-1.5 rounded-full transition-colors",
              i === slide ? "bg-brand-400" : "bg-slate-600",
            )}
          />
        ))}
      </div>
    </div>
  );
}

interface AnalysisProps {
  item: MealItem;
  readOnly?: boolean;
  canAnalyze?: boolean;
  /** 재분석 요청 진행 중 — 해당 버튼에 스피너만 */
  reanalyzeBusy?: boolean;
  onReanalyze?: () => void;
  onEdit?: () => void;
  /** 사진 위가 아닌 분석 영역에서 삭제 (내 기록·피드 등) */
  onRemove?: () => void;
}

/** Firestore 상태 필드(analyzing)와 실제 본문이 잠깐 어긋나도 결과가 오면 받침판을 우선 표시한다. */
function mealItemHasSyncedAnalysisPayload(item: MealItem): boolean {
  if (item.menuText?.trim()) return true;
  if (item.aiComment?.trim()) return true;
  const n = item.nutrition;
  if (
    n &&
    (typeof n.calories === "number" ||
      typeof n.carbs === "number" ||
      typeof n.protein === "number" ||
      typeof n.fat === "number" ||
      typeof n.sugar === "number" ||
      (n.healthTags?.length ?? 0) > 0)
  ) {
    return true;
  }
  return typeof item.rating === "number" && item.rating >= 1;
}

const MACRO_ROWS: {
  key: "carbs" | "protein" | "fat" | "sugar";
  label: string;
  barClass: string;
}[] = [
  { key: "carbs", label: "탄수", barClass: "bg-amber-400" },
  { key: "protein", label: "단백질", barClass: "bg-sky-400" },
  { key: "fat", label: "지방", barClass: "bg-emerald-400" },
  { key: "sugar", label: "당", barClass: "bg-fuchsia-400" },
];

/** 탄·단·지·당 g 합 대비 각각의 비율을 가로 막대로 표시 */
function NutritionMacroBars({ nutrition }: { nutrition: NonNullable<MealItem["nutrition"]> }) {
  const values: Array<(typeof MACRO_ROWS)[number] & { g: number }> = [];
  for (const row of MACRO_ROWS) {
    const raw = nutrition[row.key];
    if (typeof raw === "number" && raw > 0) values.push({ ...row, g: raw });
  }

  if (values.length === 0) return null;

  const total = values.reduce((s, row) => s + row.g, 0);

  return (
    <div className="space-y-1.5" role="group" aria-label="영양소 비율 (그램 기준)">
      {values.map((row) => {
        const widthPct = total > 0 ? (row.g / total) * 100 : 0;
        return (
          <div key={row.key} className="flex items-center gap-2">
            <span className="w-[3.25rem] shrink-0 text-[10px] text-slate-400">{row.label}</span>
            <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-700/85">
              <div
                className={cls("h-full min-w-px rounded-full transition-[width]", row.barClass)}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-slate-300">{row.g}g</span>
          </div>
        );
      })}
    </div>
  );
}

/** AI 호출이 길어질 때(네트워크 등) 사용자에게 재시도 가능함을 알림 */
function AnalyzingDelayHint({ active, readOnly }: { active: boolean; readOnly: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active || readOnly) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), 45_000);
    return () => clearTimeout(t);
  }, [active, readOnly]);
  if (!show) return null;
  return (
    <p className="max-w-[16rem] text-center text-[10px] leading-snug text-slate-200/90">
      너무 오래 걸리면 자동으로 안내가 뜨니, 그때 「다시 시도」를 눌러 주세요.
    </p>
  );
}

export function ItemAnalysisBlock({
  item,
  readOnly = false,
  canAnalyze = false,
  reanalyzeBusy = false,
  onReanalyze,
  onEdit,
  onRemove,
}: AnalysisProps) {
  if (mealItemHasSyncedAnalysisPayload(item)) {
    return (
      <div className="space-y-3 rounded-xl bg-slate-800/40 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 break-words text-sm font-medium leading-relaxed text-slate-100">
            {item.menuText ?? "—"}
          </p>
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-300">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                size={12}
                className={cls(
                  i <= (item.rating ?? 0)
                    ? "fill-amber-300 text-amber-300"
                    : "text-amber-300/30",
                )}
              />
            ))}
            <span className="ml-0.5">{item.rating ?? "-"}</span>
          </span>
        </div>
        {item.aiComment && (
          <p className="break-words text-xs leading-relaxed text-slate-400 whitespace-pre-wrap">
            <Sparkles size={11} className="mb-0.5 mr-1 inline text-brand-400" />
            {item.aiComment}
          </p>
        )}
        {item.nutrition && (
          <div className="space-y-2">
            <NutritionMacroBars nutrition={item.nutrition} />
            {(item.nutrition.calories !== undefined ||
              (item.nutrition.healthTags?.length ?? 0) > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {item.nutrition.calories !== undefined && (
                  <span className="chip bg-slate-700/60 text-slate-200">
                    🔥 {item.nutrition.calories}kcal
                  </span>
                )}
                {item.nutrition.healthTags?.map((t) => (
                  <span key={t} className="chip bg-brand-500/15 text-brand-300">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {!readOnly && (
          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              {item.manuallyEdited ? (
                <>
                  <Pencil size={11} /> 직접 수정됨
                </>
              ) : (
                <>
                  <CheckCircle2 size={11} /> AI 분석 완료
                </>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {onEdit && (
                <button onClick={onEdit} className="inline-flex items-center gap-1 hover:text-slate-300">
                  <Pencil size={11} /> 수정
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="inline-flex items-center gap-1 text-rose-300/90 hover:text-rose-200"
                  aria-label="이 사진 삭제"
                >
                  <Trash2 size={11} /> 삭제
                </button>
              )}
              {canAnalyze && onReanalyze && (
                <button
                  type="button"
                  onClick={onReanalyze}
                  disabled={reanalyzeBusy}
                  className={cls(
                    "inline-flex items-center gap-1 hover:text-slate-300 disabled:pointer-events-none",
                    reanalyzeBusy && "text-slate-400",
                  )}
                >
                  {reanalyzeBusy ? (
                    <Loader2 size={11} className="animate-spin text-brand-400" aria-hidden />
                  ) : (
                    <RefreshCw size={11} />
                  )}
                  다시 분석
                </button>
              )}
            </div>
          </div>
        )}
        {readOnly && item.manuallyEdited && (
          <p className="pt-1 text-[10px] text-slate-500">
            <Pencil size={10} className="mb-0.5 mr-1 inline" /> 작성자가 직접 수정한 결과예요.
          </p>
        )}
      </div>
    );
  }

  if (item.analysisStatus === "analyzing") {
    return (
      <div className="flex flex-col gap-1 rounded-xl bg-slate-800/50 px-3 py-2.5 text-sm text-slate-300">
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-brand-400" />
          <span>
            {readOnly
              ? "친구가 분석을 마치면 결과가 곧 여기에도 나타나요. 잠시 후 새로고침해 보세요."
              : "AI가 식단을 분석하고 있어요…"}
          </span>
        </div>
        {!readOnly && <AnalyzingDelayHint active readOnly={readOnly} />}
      </div>
    );
  }
  if (item.analysisStatus === "error") {
    if (readOnly) {
      return (
        <p className="rounded-xl bg-slate-800/40 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
          이 식단의 AI 요약은 표시하지 않아요. 작성자 기기에서만 원인 안내가 보입니다.
        </p>
      );
    }
    return (
      <div className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5">
        <div className="flex items-start gap-2 text-sm text-rose-300">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span className="break-all">{item.analysisError ?? "분석 실패"}</span>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-1.5">
            {canAnalyze && onReanalyze && (
              <button
                type="button"
                onClick={onReanalyze}
                disabled={reanalyzeBusy}
                className="btn-secondary flex-1 py-2 text-sm disabled:opacity-60 sm:min-w-[7rem]"
              >
                {reanalyzeBusy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCw size={14} />
                )}
                다시 시도
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit} className="btn-secondary flex-1 py-2 text-sm sm:min-w-[7rem]">
                <Pencil size={14} /> 직접 입력
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="btn-secondary flex-1 border-rose-500/25 py-2 text-sm text-rose-200 hover:border-rose-500/40 hover:bg-rose-500/10 sm:min-w-[7rem]"
                aria-label="이 사진 삭제"
              >
                <Trash2 size={14} /> 삭제
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (readOnly) {
    return <p className="text-xs text-slate-500">분석 결과가 없어요.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {canAnalyze && onReanalyze && (
        <button
          type="button"
          onClick={onReanalyze}
          disabled={reanalyzeBusy}
          className="btn-secondary flex-1 py-2 text-sm disabled:opacity-60 sm:min-w-[8rem]"
        >
          {reanalyzeBusy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} />
          )}
          AI 분석 시작
        </button>
      )}
      {onEdit && (
        <button onClick={onEdit} className="btn-secondary flex-1 py-2 text-sm sm:min-w-[8rem]">
          <Pencil size={14} /> 직접 입력
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="btn-secondary flex-1 border-rose-500/25 py-2 text-sm text-rose-200 hover:border-rose-500/40 hover:bg-rose-500/10 sm:min-w-[8rem]"
          aria-label="이 사진 삭제"
        >
          <Trash2 size={14} /> 삭제
        </button>
      )}
    </div>
  );
}

// ---------------- 수동 수정 다이얼로그 -----------------
// MealItemPatch 타입은 lib/mealItems 에 정의되어 있고 파일 상단에서 import/re-export 함.

interface EditDialogProps {
  item: MealItem;
  /**
   * - edit: 사진 분석 후 결과를 고치는 흐름
   * - addManual: 사진 없이 새 항목만 적는 흐름(제목·안내 문구가 «추가»에 맞음)
   */
  variant?: "edit" | "addManual";
  /** 저장 후 AI 에게 별점·한줄평·영양·태그 재분석 요청 (텍스트 기반). 구현되어 있지 않으면 버튼 숨김. */
  canReanalyze?: boolean;
  onClose: () => void;
  onSave: (patch: MealItemPatch, opts: { reanalyze: boolean }) => Promise<void> | void;
}

export function MealItemEditDialog({
  item,
  variant = "edit",
  canReanalyze = false,
  onClose,
  onSave,
}: EditDialogProps) {
  const [menu, setMenu] = useState(item.menuText ?? "");
  const [cal, setCal] = useState<string>(numToStr(item.nutrition?.calories));
  const [carb, setCarb] = useState<string>(numToStr(item.nutrition?.carbs));
  const [pro, setPro] = useState<string>(numToStr(item.nutrition?.protein));
  const [fat, setFat] = useState<string>(numToStr(item.nutrition?.fat));
  const [sugar, setSugar] = useState<string>(numToStr(item.nutrition?.sugar));
  const [busy, setBusy] = useState<null | "save" | "reanalyze">(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dlgPhotoBlob = item.thumbnail ?? item.photo;
  const dlgHasPhoto =
    isRenderableImageBlob(dlgPhotoBlob) ||
    !!(item.thumbStoragePath || item.photoStoragePath);
  const {
    src: dlgImgSrc,
    pending: dlgImgPending,
    onImgError: onDlgImgError,
    wrapRef: dlgWrapRef,
  } = useMealItemCardImageSrc(item, { eagerImage: true });

  async function doSave(reanalyze: boolean) {
    if (!menu.trim()) {
      alert("메뉴 이름을 입력해 주세요.");
      return;
    }
    setBusy(reanalyze ? "reanalyze" : "save");
    try {
      const preservedTags = item.nutrition?.healthTags?.filter(Boolean) ?? [];
      const nutrition: MealItem["nutrition"] = {
        calories: strToNum(cal),
        carbs: strToNum(carb),
        protein: strToNum(pro),
        fat: strToNum(fat),
        sugar: strToNum(sugar),
        healthTags: preservedTags.length ? preservedTags : undefined,
      };
      const hasAny =
        nutrition.calories !== undefined ||
        nutrition.carbs !== undefined ||
        nutrition.protein !== undefined ||
        nutrition.fat !== undefined ||
        nutrition.sugar !== undefined ||
        (nutrition.healthTags && nutrition.healthTags.length > 0);
      await onSave(
        {
          menuText: menu.trim(),
          aiComment: item.aiComment?.trim() || undefined,
          nutrition: hasAny ? nutrition : undefined,
        },
        { reanalyze },
      );
      onClose();
    } catch (e) {
      alert(userFacingStorageErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl sm:rounded-2xl"
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100">
            {variant === "addManual" ? "식사 직접 기록" : "AI 분석 결과 수정"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-100"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </header>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-2">
          <div
            ref={dlgWrapRef}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
          >
            {dlgHasPhoto ? (
              <MealItemCardPhotoBody
                key={`dlg-${item.id}|${dlgImgSrc ?? ""}`}
                photoSrc={dlgImgSrc}
                photoSrcPending={dlgImgPending}
                quietPhotoLoading
                eagerFeedImage
                onPhotoImgError={onDlgImgError}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-0.5 text-center text-[9px] leading-tight text-slate-500">
                사진 없음
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-slate-400">
              {variant === "addManual"
                ? "사진 없이 메뉴와 영양 정보를 적어 저장하면 끼니에 추가돼요. 저장한 뒤에도 AI로 별점·한 줄 평을 받을 수 있어요."
                : "메뉴·영양 정보를 직접 고치고 AI 분석을 다시 받을 수 있어요. 태그는 AI만 붙입니다."}
            </p>
            {typeof item.rating === "number" && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-300">
                <Star size={11} className="fill-amber-300 text-amber-300" />
                현재 AI 별점 {item.rating}/5
                <span className="text-slate-500">· 별점은 AI 만 수정해요</span>
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Field label="메뉴">
            <input
              value={menu}
              onChange={(e) => setMenu(e.target.value)}
              placeholder="예: 김치찌개, 공깃밥"
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="칼로리 (kcal)">
              <input inputMode="numeric" value={cal} onChange={(e) => setCal(e.target.value)} className="input" />
            </Field>
            <Field label="탄수화물 (g)">
              <input inputMode="numeric" value={carb} onChange={(e) => setCarb(e.target.value)} className="input" />
            </Field>
            <Field label="단백질 (g)">
              <input inputMode="numeric" value={pro} onChange={(e) => setPro(e.target.value)} className="input" />
            </Field>
            <Field label="지방 (g)">
              <input inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} className="input" />
            </Field>
            <Field label="당 (g)" className="col-span-2">
              <input inputMode="numeric" value={sugar} onChange={(e) => setSugar(e.target.value)} className="input" />
            </Field>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {canReanalyze && (
            <button
              type="button"
              onClick={() => void doSave(true)}
              disabled={busy !== null || !menu.trim()}
              className="btn-primary w-full py-2 text-sm disabled:opacity-60"
            >
              {busy === "reanalyze" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Wand2 size={14} />
              )}
              저장하고 이 내용으로 AI {variant === "addManual" ? "분석" : "재분석"}
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy !== null}
              className="btn-secondary flex-1 py-2 text-sm"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void doSave(false)}
              disabled={busy !== null || !menu.trim()}
              className={cls(
                "flex-1 py-2 text-sm disabled:opacity-60",
                canReanalyze ? "btn-secondary" : "btn-primary",
              )}
            >
              {busy === "save" && <Loader2 size={14} className="animate-spin" />}
              저장만
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cls("block space-y-1 text-xs text-slate-400", className)}>
      <span className="font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function numToStr(n: number | undefined): string {
  return n === undefined || Number.isNaN(n) ? "" : String(n);
}

function strToNum(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}
