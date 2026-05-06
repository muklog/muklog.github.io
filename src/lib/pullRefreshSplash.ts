/** 당겨서 새로고침 직후 첫 페인트부터 풀스크린 로더를 보이기 위한 플래그·정리용 */

export const PULL_REFRESH_SESSION_KEY = "hh_pull_refresh";

export function armPullRefreshBeforeReload(): void {
  try {
    sessionStorage.setItem(PULL_REFRESH_SESSION_KEY, "1");
  } catch {
    /* private mode 등 */
  }
}

export function removePullRefreshSplash(): void {
  try {
    sessionStorage.removeItem(PULL_REFRESH_SESSION_KEY);
  } catch {
    /* */
  }
  document.getElementById("hh-ptr-splash")?.remove();
}
