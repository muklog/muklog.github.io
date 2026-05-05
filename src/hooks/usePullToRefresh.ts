import { type RefObject, useEffect, useState } from "react";

/** 이 거리(px) 이상 당기면 손을 떼었을 때 새로고침 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 72;
/** progress 정규화 기준(px) — 힌트 채워지는 속도용 */
export const PULL_TO_REFRESH_PROGRESS_CAP_PX = 100;

/**
 * 스크롤이 맨 위일 때 아래 방향으로 당겼다 놓으면 `window.location.reload()`.
 * 터치 기기에서만 활성화(데스크톱 무시).
 */
export function usePullToRefresh(scrollEl: RefObject<HTMLElement | null>): {
  /** 0 ~ 1, 임계치 넘으면 놓았을 때 리로드 */
  progress: number;
} {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = scrollEl.current;
    if (!el || typeof window === "undefined" || !("ontouchstart" in window)) {
      return undefined;
    }

    let touchActive = false;
    let startY = 0;
    let maxPull = 0;

    const scrollTopAlmostTop = () => el.scrollTop <= 1;

    const onTouchStart = (e: TouchEvent) => {
      if (!scrollTopAlmostTop()) return;
      touchActive = true;
      startY = e.touches[0].clientY;
      maxPull = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive) return;
      if (!scrollTopAlmostTop()) {
        touchActive = false;
        setProgress(0);
        maxPull = 0;
        return;
      }
      const pull = e.touches[0].clientY - startY;
      if (pull <= 0) {
        maxPull = 0;
        setProgress(0);
        return;
      }
      maxPull = Math.max(maxPull, pull);
      setProgress(Math.min(1, maxPull / PULL_TO_REFRESH_PROGRESS_CAP_PX));
    };

    const onTouchEnd = () => {
      if (!touchActive) return;
      touchActive = false;
      const shouldReload =
        scrollTopAlmostTop() && maxPull >= PULL_TO_REFRESH_THRESHOLD_PX;
      maxPull = 0;
      setProgress(0);
      if (shouldReload) window.location.reload();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollEl]);

  return { progress };
}
