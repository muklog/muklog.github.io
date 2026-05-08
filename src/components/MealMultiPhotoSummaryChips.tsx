import type { MealItem } from "../types";

/** 피드 카드·식단 상세 등 — 사진 2장 이상일 때 평균 별·합계 kcal 칩 (항목 전부 기준, 피드와 동일) */
export default function MealMultiPhotoSummaryChips({ items }: { items: MealItem[] }) {
  if (items.length < 2) return null;

  const totalCalories = items.reduce(
    (sum, it) => (typeof it.nutrition?.calories === "number" ? sum + it.nutrition.calories : sum),
    0,
  );
  const rs = items.map((it) => it.rating).filter((r): r is number => typeof r === "number");
  const avgRating = rs.length === 0 ? undefined : rs.reduce((a, b) => a + b, 0) / rs.length;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
      <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-slate-300">
        사진 {items.length}장
      </span>
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
    </div>
  );
}
