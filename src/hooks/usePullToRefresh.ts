import { type RefObject, useLayoutEffect, useState } from "react";

/** 손가락을 뗄 때 이 거리 이상이면 새로고침 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 56;
/** 토스트 progress 정규화(px) */
export const PULL_TO_REFRESH_PROGRESS_CAP_PX = 90;

function isTouchEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0)
  );
}

/**
 * 스크롤 영역 최상단에서 아래로 당겼다 떼면 `location.reload()`.
 *
 * `enabled`:
 * 초기 렌더에서 `<main>` 이 없거나 곧 빠졌던 기존 이슈: effect 가 `scrollEl.current === null` 로 끝나면
 * `scrollEl` 참조 변화 없이 재실행이 없어 폰에서 리프레시가 영원히 안 됨 → 메인이 붙을 때까지 false,
 * 같은 조건으로 true 가 되도록 상위(App)에서 넘김.
 */
export function usePullToRefresh(
  scrollEl: RefObject<HTMLElement | null>,
  enabled: boolean,
): { progress: number; pendingReload: boolean } {
  const [progress, setProgress] = useState(0);
  const [pendingReload, setPendingReload] = useState(false);

  useLayoutEffect(() => {
    if (!enabled || !isTouchEnvironment()) {
      setProgress(0);
      setPendingReload(false);
      return undefined;
    }

    let touchActive = false;
    let startY = 0;
    let maxPull = 0;

    const passiveOpt: AddEventListenerOptions = { passive: true };
    const blockingOpt: AddEventListenerOptions = { passive: false };

    const setup = (): (() => void) | undefined => {
      const el = scrollEl.current;
      if (!el) return undefined;

      const top = () => el.scrollTop <= 2;

      const onTouchStart: EventListener = (e) => {
        const te = e as TouchEvent;
        if (!top()) return;
        touchActive = true;
        startY = te.touches[0].clientY;
        maxPull = 0;
      };

      const onTouchMove: EventListener = (e) => {
        const te = e as TouchEvent;
        if (!touchActive) return;
        if (!top()) {
          touchActive = false;
          maxPull = 0;
          setProgress(0);
          return;
        }
        const pull = te.touches[0].clientY - startY;
        if (pull <= 5) return;

        /*
          삼성 인터넷·크롬 안드로이드 등은 맨 위 오버스크롤 때 기본 제스처로 터치 시퀀스를 빼 가는 경우가 있음.
          당김 중에만 선택적으로 막고, 세로 패닝은 touch-pan-y( main )로 유지.
        */
        if (te.cancelable && pull >= 20) {
          te.preventDefault();
        }

        maxPull = Math.max(maxPull, pull);
        setProgress(Math.min(1, maxPull / PULL_TO_REFRESH_PROGRESS_CAP_PX));
      };

      const onTouchEnd: EventListener = () => {
        if (!touchActive) return;
        touchActive = false;
        const go = top() && maxPull >= PULL_TO_REFRESH_THRESHOLD_PX;
        maxPull = 0;
        if (go) {
          setProgress(1);
          setPendingReload(true);
          window.location.reload();
        } else {
          setProgress(0);
        }
      };

      el.addEventListener("touchstart", onTouchStart, passiveOpt);
      el.addEventListener("touchmove", onTouchMove, blockingOpt);
      el.addEventListener("touchend", onTouchEnd, passiveOpt);
      el.addEventListener("touchcancel", onTouchEnd, passiveOpt);

      return () => {
        el.removeEventListener("touchstart", onTouchStart, passiveOpt);
        el.removeEventListener("touchmove", onTouchMove, blockingOpt);
        el.removeEventListener("touchend", onTouchEnd, passiveOpt);
        el.removeEventListener("touchcancel", onTouchEnd, passiveOpt);
      };
    };

    let cleanup = setup();
    let raf = 0;
    if (!cleanup) {
      raf = requestAnimationFrame(() => {
        cleanup = setup();
      });
    }

    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [enabled, scrollEl]);

  return { progress, pendingReload };
}
