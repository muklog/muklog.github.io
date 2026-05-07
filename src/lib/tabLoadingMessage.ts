/**
 * 하단 탭(피드·식단·건강·친구·설정)과 맞춘 로딩 문구 — 풀 새로고침 힌트·탭별 UI 공용.
 */
/** 인앱→브라우저 전환 직후 등 긴 로딩에 붙이는 안내 */
export const STALL_REFRESH_HINT = "5초 이상 걸리면 새로고침해 주세요.";

export function tabLoadingMessage(pathname: string): string {
  const p = (pathname.split(/[?#]/)[0] || "/").replace(/\/$/, "") || "/";

  if (p === "/") return "피드를 불러오는 중…";
  if (p.startsWith("/home") || p.startsWith("/day")) return "식단을 불러오는 중…";
  if (p.startsWith("/health")) return "건강을 불러오는 중…";
  if (p.startsWith("/friends")) return "친구를 불러오는 중…";
  if (p.startsWith("/settings")) return "설정을 불러오는 중…";
  if (p.startsWith("/messages")) return "메시지를 불러오는 중…";
  if (p.startsWith("/notifications")) return "알림을 불러오는 중…";
  if (p.startsWith("/onboarding")) return "시작 화면을 불러오는 중…";

  return "화면을 불러오는 중…";
}
