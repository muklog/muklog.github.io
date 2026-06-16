import { Sparkles } from "lucide-react";

/**
 * 피드 상단 슬롯 — 추후 광고 영역. 현재는 먹로그 한 줄 소개만.
 */
export default function FeedIntroBanner() {
  return (
    <aside className="card border-brand-500/25 bg-gradient-to-br from-brand-500/[0.08] via-slate-900/55 to-slate-950 px-4 py-3">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-400/90">
        <Sparkles size={12} className="inline" /> 먹로그
      </p>
      <p className="mt-1 text-sm font-semibold leading-snug text-slate-100">
        나의 한 끼를 기록하고,
        <br />
        친구와 서로 공유하는 식단 다이어리
      </p>
      <p className="mt-2 text-[11px] text-slate-500">
        <a
          href="mailto:gogojeje1022@gmail.com?subject=%EB%A8%B9%EB%A1%9C%EA%B7%B8%20%EB%AC%B8%EC%9D%98"
          className="font-medium text-brand-400 underline-offset-2 hover:underline"
        >
          문의 이메일 보내기
        </a>
      </p>
    </aside>
  );
}
