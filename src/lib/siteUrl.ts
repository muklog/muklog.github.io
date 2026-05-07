/**
 * 친구 공유·이미지 워터마크 등에 쓰는 프로덕션 기준 URL.
 * 로컬에선 현재 origin + Vite base, SSR·예외 시에는 배포 주소로 폴백.
 */
const FALLBACK_PRODUCTION_APP_URL = "https://mealog.github.io/";

export function getAppShareAbsoluteUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const pathOnly =
    base === "/" ? "" : base.endsWith("/") ? base.slice(0, -1) : base;

  if (typeof window === "undefined") {
    return FALLBACK_PRODUCTION_APP_URL;
  }

  const fromOrigin = `${window.location.origin}${pathOnly}/`;
  /** 로컬·프리뷰 호스트가 아니면 실제 배포 주소와 불일치할 때만 폴백할 필요 없음 */
  return fromOrigin.endsWith("/") ? fromOrigin : `${fromOrigin}/`;
}
