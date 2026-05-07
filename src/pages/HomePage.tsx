import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles, ChevronRight, Plus } from "lucide-react";
import { db, getSettings, runDexie } from "../lib/db";
import Calendar from "../components/Calendar";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { dateKey, formatKoDate, suggestMealSlotForNow } from "../lib/utils";
import { MEAL_SLOTS, MEAL_SLOT_EMOJI, MEAL_SLOT_LABELS } from "../types";

export default function HomePage() {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<string>(dateKey());

  const settings = useLiveQuery(() => getSettings(), []);
  const userId = usePrimaryUserId();

  const dayMeals = useLiveQuery(
    async () =>
      userId
        ? await runDexie(() =>
            db.meals.where("[userId+date]").equals([userId, selected]).toArray(),
          )
        : [],
    [userId, selected],
  );

  const recentHealth = useLiveQuery(
    async () =>
      userId
        ? (
            await runDexie(() =>
              db.health.where("userId").equals(userId).toArray(),
            )
          ).sort((a, b) => {
            const d = b.recordDate.localeCompare(a.recordDate);
            if (d !== 0) return d;
            return (b.createdAt ?? 0) - (a.createdAt ?? 0);
          })
        : [],
    [userId],
  );
  const latestScore = recentHealth?.[0]?.healthScore;

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">오늘의 식단을 기록해요</p>
          <h1 className="text-xl font-bold">
            <Sparkles size={18} className="mb-0.5 mr-1 inline text-brand-400" />
            밀로그
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {userId && (
            <Link
              to={`/day/${dateKey()}?slot=${suggestMealSlotForNow()}`}
              className="btn-primary inline-flex h-10 w-10 items-center justify-center rounded-full p-0"
              aria-label="오늘 식단 사진 추가"
              title="오늘 식단 기록"
            >
              <Plus size={22} strokeWidth={2.5} />
            </Link>
          )}
          {latestScore !== undefined && (
            <Link
              to="/health"
              className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-200"
            >
              건강 {latestScore}점
            </Link>
          )}
        </div>
      </header>

      <Calendar
        cursor={cursor}
        setCursor={setCursor}
        selected={selected}
        onPick={(k) => setSelected(k)}
        userId={userId}
      />

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">선택한 날짜</p>
            <h2 className="text-base font-semibold">{formatKoDate(selected)}</h2>
          </div>
          <button
            onClick={() => navigate(`/day/${selected}`)}
            className="btn-secondary py-2 text-sm"
          >
            기록하기 <ChevronRight size={16} />
          </button>
        </div>

        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {MEAL_SLOTS.map((slot) => {
            const m = dayMeals?.find((x) => x.slot === slot);
            const items = m?.items ?? [];
            const ratings = items.map((it) => it.rating).filter((r): r is number => typeof r === "number");
            const avg =
              ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined;
            return (
              <li key={slot}>
                <button
                  onClick={() =>
                    navigate({ pathname: `/day/${selected}`, search: `?slot=${slot}` })
                  }
                  className="flex h-full w-full flex-col items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/40 p-2 hover:bg-slate-800/40"
                >
                  <span className="text-xl">{MEAL_SLOT_EMOJI[slot]}</span>
                  <span className="text-[11px] text-slate-300">
                    {MEAL_SLOT_LABELS[slot]}
                  </span>
                  {items.length > 0 ? (
                    <span className="text-[10px] font-bold text-amber-400">
                      {items.length > 1 ? `★ ${avg?.toFixed(1) ?? "-"} · ${items.length}개` : `★ ${avg?.toFixed(0) ?? "-"}`}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600">미기록</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {!settings?.geminiApiKey && (
        <Link
          to="/settings"
          className="card flex items-center justify-between gap-3 border-slate-700 bg-slate-900/40 p-4"
        >
          <span className="text-sm text-slate-200">AI 분석 — 설정에서 Gemini 키</span>
          <ChevronRight size={20} className="text-slate-500" />
        </Link>
      )}
    </div>
  );
}
