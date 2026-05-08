import {
  useEffect,
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
import { blobUrl } from "../lib/image";
import { cls } from "../lib/utils";
import type { MealItemPatch } from "../lib/mealItems";
import { userFacingStorageErrorMessage } from "../lib/idbRetry";
export type { MealItemPatch } from "../lib/mealItems";

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
  onReanalyze?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}

export function MealItemCard({
  item,
  index,
  readOnly = false,
  canAnalyze = false,
  showPhotoAnalyzingOverlay = true,
  reanalyzeBusy = false,
  shareCaptureRef,
  onReanalyze,
  onEdit,
  onRemove,
}: ItemCardProps) {
  const url = blobUrl(item.photo || item.thumbnail);

  return (
    <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/30 p-2">
      <div
        ref={(el) => {
          if (shareCaptureRef) shareCaptureRef.current = el;
        }}
        className="space-y-2"
      >
      <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {url ? (
          <img
            src={url}
            alt="식사 사진"
            loading="lazy"
            decoding="async"
            className="aspect-square w-full object-cover"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center text-xs text-slate-500">
            사진 없음
          </div>
        )}
        {showPhotoAnalyzingOverlay && item.analysisStatus === "analyzing" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/60 backdrop-blur-[2px]"
            aria-busy
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 shrink-0 animate-spin text-brand-400" aria-hidden />
            <span className="px-2 text-center text-[11px] font-medium text-slate-100">AI 분석 중…</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-slate-950/70 px-2 py-0.5 text-[10px] font-semibold text-slate-200 backdrop-blur">
          #{index + 1}
        </span>
        {!readOnly && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-2 top-2 rounded-full bg-slate-950/70 p-1.5 text-slate-200 backdrop-blur hover:text-rose-300"
            aria-label="이 사진 삭제"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <ItemAnalysisBlock
        item={item}
        readOnly={readOnly}
        canAnalyze={canAnalyze}
        reanalyzeBusy={reanalyzeBusy}
        onReanalyze={onReanalyze}
        onEdit={onEdit}
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
        data-mealog-carousel-scroller
        onScroll={() => requestAnimationFrame(syncSlideFromScroll)}
        className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((it, idx) => (
          <div
            key={it.id}
            data-mealog-carousel-slide={String(idx)}
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
  const denom = total > 0 ? total : 1;

  return (
    <div className="space-y-1.5" role="group" aria-label="영양소 비율 (그램 기준)">
      {values.map((row) => {
        const pct = Math.round((row.g / denom) * 1000) / 10;
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
            <span className="shrink-0 text-[10px] tabular-nums text-slate-300">
              {row.g}g
              <span className="text-slate-500"> ({pct}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ItemAnalysisBlock({
  item,
  readOnly = false,
  canAnalyze = false,
  reanalyzeBusy = false,
  onReanalyze,
  onEdit,
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
            <div className="flex items-center gap-3">
              {onEdit && (
                <button onClick={onEdit} className="inline-flex items-center gap-1 hover:text-slate-300">
                  <Pencil size={11} /> 수정
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
      <div className="flex items-center gap-2 rounded-xl bg-slate-800/50 px-3 py-2.5 text-sm text-slate-300">
        <Loader2 size={16} className="animate-spin text-brand-400" />
        {readOnly
          ? "친구가 분석을 마치면 결과가 곧 여기에도 나타나요. 잠시 후 새로고침해 보세요."
          : "AI가 식단을 분석하고 있어요…"}
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
          <div className="flex gap-1.5">
            {canAnalyze && onReanalyze && (
              <button
                type="button"
                onClick={onReanalyze}
                disabled={reanalyzeBusy}
                className="btn-secondary flex-1 py-2 text-sm disabled:opacity-60"
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
              <button onClick={onEdit} className="btn-secondary flex-1 py-2 text-sm">
                <Pencil size={14} /> 직접 입력
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
    <div className="flex gap-1.5">
      {canAnalyze && onReanalyze && (
        <button
          type="button"
          onClick={onReanalyze}
          disabled={reanalyzeBusy}
          className="btn-secondary flex-1 py-2 text-sm disabled:opacity-60"
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
        <button onClick={onEdit} className="btn-secondary flex-1 py-2 text-sm">
          <Pencil size={14} /> 직접 입력
        </button>
      )}
    </div>
  );
}

// ---------------- 수동 수정 다이얼로그 -----------------
// MealItemPatch 타입은 lib/mealItems 에 정의되어 있고 파일 상단에서 import/re-export 함.

interface EditDialogProps {
  item: MealItem;
  /** 저장 후 AI 에게 별점·한줄평 재분석 요청 (텍스트 기반). 구현되어 있지 않으면 버튼 숨김. */
  canReanalyze?: boolean;
  onClose: () => void;
  onSave: (patch: MealItemPatch, opts: { reanalyze: boolean }) => Promise<void> | void;
}

export function MealItemEditDialog({
  item,
  canReanalyze = false,
  onClose,
  onSave,
}: EditDialogProps) {
  const [menu, setMenu] = useState(item.menuText ?? "");
  const [comment, setComment] = useState(item.aiComment ?? "");
  const [cal, setCal] = useState<string>(numToStr(item.nutrition?.calories));
  const [carb, setCarb] = useState<string>(numToStr(item.nutrition?.carbs));
  const [pro, setPro] = useState<string>(numToStr(item.nutrition?.protein));
  const [fat, setFat] = useState<string>(numToStr(item.nutrition?.fat));
  const [sugar, setSugar] = useState<string>(numToStr(item.nutrition?.sugar));
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(item.nutrition?.healthTags ?? []);
  const [busy, setBusy] = useState<null | "save" | "reanalyze">(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const imgUrl = useMemo(() => blobUrl(item.thumbnail ?? item.photo), [item]);

  async function doSave(reanalyze: boolean) {
    if (!menu.trim()) {
      alert("메뉴 이름을 입력해 주세요.");
      return;
    }
    setBusy(reanalyze ? "reanalyze" : "save");
    try {
      const nutrition: MealItem["nutrition"] = {
        calories: strToNum(cal),
        carbs: strToNum(carb),
        protein: strToNum(pro),
        fat: strToNum(fat),
        sugar: strToNum(sugar),
        healthTags: tags.length ? tags : undefined,
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
          aiComment: comment.trim() || undefined,
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

  function addTag() {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
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
          <h2 className="text-base font-bold text-slate-100">AI 분석 결과 수정</h2>
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
          {imgUrl ? (
            <img src={imgUrl} alt="" className="h-16 w-16 rounded-lg border border-slate-800 object-cover" />
          ) : (
            <div className="h-16 w-16 rounded-lg border border-slate-800 bg-slate-900 text-center text-[10px] leading-[4rem] text-slate-500">
              사진 없음
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-slate-400">
              메뉴·영양 정보를 직접 고치고 원하면 그 값으로 AI 별점을 다시 받을 수 있어요.
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

          <Field label="한 줄 평 (선택)">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="예: 나트륨 조금 과했어요."
              className="input resize-none text-sm"
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

          <Field label="태그">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-1 text-xs text-brand-200"
                  >
                    #{t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="text-brand-200/70 hover:text-rose-300"
                      aria-label="태그 제거"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {tags.length === 0 && (
                  <span className="text-[11px] text-slate-500">예: 고단백, 균형잡힘</span>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="태그 입력 후 Enter"
                  className="input text-xs"
                />
                <button type="button" onClick={addTag} className="btn-secondary px-3 py-2 text-xs">
                  추가
                </button>
              </div>
            </div>
          </Field>
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
              저장하고 이 내용으로 AI 재분석
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
