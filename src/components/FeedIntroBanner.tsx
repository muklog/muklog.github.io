import { Link } from "react-router-dom";
import { ArrowRight, HeartPulse, Rss, Sparkles } from "lucide-react";

/**
 * 피드 상단 슬롯 — 추후 광고 영역. 현재는 헬스헬스 소개 배너.
 */
export default function FeedIntroBanner() {
  return (
    <aside className="card relative overflow-hidden border-brand-500/25 bg-gradient-to-br from-brand-500/[0.08] via-slate-900/55 to-slate-950 px-4 py-3 shadow-lg shadow-black/10">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-400/15 blur-2xl" />
      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-400/90">
            <Sparkles size={12} className="inline" /> 헬스헬스
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-slate-100">
            나의 한 끼를 기록하고, 친구와 서로 응원하는 식단 다이어리
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            피드에서 내·친구 기록을 모아 보고, 달력·건강 탭까지 한곳에서 관리해요.
          </p>
          <Link
            to="/health"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
          >
            <HeartPulse size={13} /> 건강 기록·기록 활용 더 알아보기
            <ArrowRight size={13} />
          </Link>
        </div>
        <div className="hidden shrink-0 items-center rounded-xl border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-slate-500 sm:flex">
          <Rss size={28} strokeWidth={1.5} />
        </div>
      </div>
    </aside>
  );
}
