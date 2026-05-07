/** 당겨서 새로고침 직후 첫 페인트부터 풀스크린 로더를 보이기 위한 플래그·정리용 */

export const PULL_REFRESH_SESSION_KEY = "mealog_pull_refresh";

const SPLASH_ID = "mealog-ptr-splash";
const SPIN_KF_ID = "mealog-ptr-spin-keyframes";
const SPIN_ANIM_NAME = "mealog-ptr-spin";

function injectSplashSpinKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(SPIN_KF_ID)) return;
  const s = document.createElement("style");
  s.id = SPIN_KF_ID;
  s.textContent = `@keyframes ${SPIN_ANIM_NAME}{to{transform:rotate(360deg)}}`;
  document.head.appendChild(s);
}

/**
 * 새로고침이 실제 실행되기 직전(동기) 현재 탭 위에 즉시 올린다.
 * location.reload 직전에 호출해야 이전 페이지가 한 프레임 보이지 않는다.
 */
export function mountPullRefreshSplashNow(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(SPLASH_ID)) return;
  injectSplashSpinKeyframes();
  const splash = document.createElement("div");
  splash.id = SPLASH_ID;
  splash.setAttribute("role", "status");
  splash.setAttribute("aria-busy", "true");
  splash.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:#020617;font-family:Pretendard,system-ui,sans-serif;";
  const box = document.createElement("div");
  box.style.cssText =
    "display:flex;flex-direction:column;align-items:center;gap:14px;";
  const ring = document.createElement("div");
  ring.style.cssText =
    `width:42px;height:42px;border:3px solid rgba(52,211,153,.2);border-top-color:rgba(52,211,153,.92);border-radius:50%;animation:${SPIN_ANIM_NAME} .72s linear infinite;`;
  const cap = document.createElement("span");
  cap.textContent = "피드를 불러오는 중…";
  cap.style.cssText = "font-size:12px;color:#94a3b8;letter-spacing:0.03em;";
  box.appendChild(ring);
  box.appendChild(cap);
  splash.appendChild(box);
  document.body.appendChild(splash);
}

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
  document.getElementById(SPLASH_ID)?.remove();
}
