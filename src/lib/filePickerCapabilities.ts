/**
 * 삼성 인터넷 에서만 확인된 <input capture> 오류 회피용.
 * 일반 설치형(PWA)·iOS standalone 은 capture 를 켜 두는 편이 카메라 직행에 유리합니다.
 */
export function shouldOmitCaptureOnFileInputs(): boolean {
  if (typeof navigator === "undefined") return false;

  try {
    if (/\bSamsungBrowser\/|SamsungBrowser\b/i.test(navigator.userAgent)) return true;
  } catch {
    /* */
  }

  return false;
}

/** 일부 삼성 인터넷에서 `blob:` 는 만들어져도 `<img>` 로드가 실패하는 경우가 있어 data URL 을 우선한다. */
export function browserPrefersDataUrlForBlobImages(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    if (/\bSamsungBrowser\/|SamsungBrowser\b/i.test(navigator.userAgent)) return true;
    if (/Samsung\s?Internet/i.test(navigator.userAgent)) return true;
  } catch {
    /* */
  }
  return false;
}
