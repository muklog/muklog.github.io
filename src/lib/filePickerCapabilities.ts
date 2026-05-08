/**
 * 일부 환경(삼성 인터넷·홈 화면에 추가한 standalone 앱)에서만 <input capture> 가
 * 오류를 내는 사례가 있어, 그때는 capture 속성을 빼고 OS 기본 시트에 맡깁니다.
 *
 * `display-mode: fullscreen` / `minimal-ui` 는 일반 모바일 브라우저에서도
 * 잘못 매칭될 수 있어 standalone 만 본다.
 */
export function shouldOmitCaptureOnFileInputs(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;

  try {
    if (/\bSamsungBrowser\/|SamsungBrowser\b/i.test(navigator.userAgent)) return true;
  } catch {
    /* */
  }

  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* */
  }

  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  } catch {
    /* */
  }

  return false;
}
