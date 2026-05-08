/** 당겨서 새로고침 플래그(sessionStorage) 및 옛 스플래시 DOM 정리 */

export const PULL_REFRESH_SESSION_KEY = "muklog_pull_refresh";
const LEGACY_PULL_REFRESH_SESSION_KEY = "mealog_pull_refresh";

const SPLASH_ID = "muklog-ptr-splash";
const LEGACY_SPLASH_ID = "mealog-ptr-splash";

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
    sessionStorage.removeItem(LEGACY_PULL_REFRESH_SESSION_KEY);
  } catch {
    /* */
  }
  document.getElementById(SPLASH_ID)?.remove();
  document.getElementById(LEGACY_SPLASH_ID)?.remove();
}
