/**
 * 친구 공유·이미지 워터마크 등에 쓰는 안내 URL.
 * 로컬·미러 호스트와 무관하게 항상 공식 사이트(muklog.github.io)를 넣어
 * 캡처·공유 텍스트가 동일하게 프로덕션으로 안내되도록 한다.
 */
const PRODUCTION_APP_URL = "https://muklog.github.io/";

export function getAppShareAbsoluteUrl(): string {
  return PRODUCTION_APP_URL;
}
