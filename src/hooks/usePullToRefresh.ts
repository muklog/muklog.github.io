import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
  armPullRefreshBeforeReload,
  mountPullRefreshSplashNow,
} from "../lib/pullRefreshSplash";

/** 손가락 이동(px)으로 새로고침 여부 판단 — 시각적 당김은 damp 적용 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 56;
/** 당긴 거리 → 화면에 반영되는 최대 오프셋(px) */
export const PULL_TO_REFRESH_MAX_VISUAL_PX = 72;
/** 손가락 거리에 곱해 고무줄 느낌 */
const PULL_DAMPING = 0.42;

const SCROLL_TOP_EPS = 18;

function isMainAtScrollTop(mainEl: HTMLElement): boolean {
  return mainEl.scrollTop <= SCROLL_TOP_EPS;
}

function dampVisual(rawPull: number): number {
  const d = Math.round(rawPull * PULL_DAMPING);
  return Math.min(Math.max(0, d), PULL_TO_REFRESH_MAX_VISUAL_PX);
}

export type PullToRefreshGesture = {
  pullPx: number;
  isDragging: boolean;
  armed: boolean;
  pendingReload: boolean;
};

/**
 * `<main>` 맨 위에서 아래로 당겼다 떼면 `location.reload()`.
 *
 * - 리스너는 `window` 캡처에 붙여 손가락이 하단 탭으로 살짝 벗어나도 `touchmove` 가 끊기지 않게 한다.
 * - 스크롤 여부는 오직 `scrollEl`(보통 `<main>`)의 `scrollTop` 만 본다. DM 등 중첩 스크롤 라우트는 App 에서 비활성화한다.
 * - 터치 외 환경에서도 리스너는 등록되지만 이벤트가 거의 없다.
 */
export function usePullToRefresh(
  scrollEl: RefObject<HTMLElement | null>,
  enabled: boolean,
): PullToRefreshGesture {
  const [pullPx, setPullPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pendingReload, setPendingReload] = useState(false);

  const gestureMaxRawRef = useRef(0);
  const settleRafRef = useRef(0);

  useLayoutEffect(() => {
    if (!enabled) {
      gestureMaxRawRef.current = 0;
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = 0;
      setPullPx(0);
      setIsDragging(false);
      setArmed(false);
      setPendingReload(false);
      return undefined;
    }

    let touchActive = false;
    let startY = 0;

    const capPassive: AddEventListenerOptions = { capture: true, passive: true };
    const capBlocking: AddEventListenerOptions = { capture: true, passive: false };

    const setup = (): (() => void) | undefined => {
      const mainEl = scrollEl.current;
      if (!mainEl) return undefined;

      const targetInsideMain = (t: EventTarget | null) =>
        t instanceof Node && mainEl.contains(t);

      const top = () => isMainAtScrollTop(mainEl);

      const settleToZero = () => {
        cancelAnimationFrame(settleRafRef.current);
        setIsDragging(false);
        settleRafRef.current = requestAnimationFrame(() => {
          settleRafRef.current = requestAnimationFrame(() => {
            settleRafRef.current = 0;
            setPullPx(0);
            setArmed(false);
          });
        });
      };

      const onTouchStart: EventListener = (e) => {
        const te = e as TouchEvent;
        if (!targetInsideMain(te.target)) return;
        if (!top()) return;
        cancelAnimationFrame(settleRafRef.current);
        settleRafRef.current = 0;
        touchActive = true;
        startY = te.touches[0].clientY;
        gestureMaxRawRef.current = 0;
        setArmed(false);
        setIsDragging(true);
      };

      const onTouchMove: EventListener = (e) => {
        const te = e as TouchEvent;
        if (!touchActive) return;
        /** 제스처 중에는 맨 위만 유지하면 된다. 타깃은 바뀔 수 있음(캐러셀 등). */
        if (!top()) {
          touchActive = false;
          gestureMaxRawRef.current = 0;
          settleToZero();
          return;
        }
        const raw = te.touches[0].clientY - startY;
        if (raw <= 2) return;

        /** 아래로 당기기가 명확해지면 즉시 기본 스크롤을 막는다(iOS/Android 공통). */
        if (te.cancelable && raw > 6) {
          te.preventDefault();
        }

        gestureMaxRawRef.current = Math.max(gestureMaxRawRef.current, raw);
        setPullPx(dampVisual(raw));
        setArmed(gestureMaxRawRef.current >= PULL_TO_REFRESH_THRESHOLD_PX);
      };

      const onTouchEnd: EventListener = () => {
        if (!touchActive) return;
        touchActive = false;
        const maxRaw = gestureMaxRawRef.current;
        gestureMaxRawRef.current = 0;

        const go = top() && maxRaw >= PULL_TO_REFRESH_THRESHOLD_PX;

        if (go) {
          armPullRefreshBeforeReload();
          mountPullRefreshSplashNow();
          setPendingReload(true);
          setPullPx((v) => Math.max(v, 56));
          void document.body.offsetHeight;
          window.location.reload();
          return;
        }

        settleToZero();
      };

      window.addEventListener("touchstart", onTouchStart, capPassive);
      window.addEventListener("touchmove", onTouchMove, capBlocking);
      window.addEventListener("touchend", onTouchEnd, capPassive);
      window.addEventListener("touchcancel", onTouchEnd, capPassive);

      return () => {
        cancelAnimationFrame(settleRafRef.current);
        settleRafRef.current = 0;
        window.removeEventListener("touchstart", onTouchStart, capPassive);
        window.removeEventListener("touchmove", onTouchMove, capBlocking);
        window.removeEventListener("touchend", onTouchEnd, capPassive);
        window.removeEventListener("touchcancel", onTouchEnd, capPassive);
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
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = 0;
      cleanup?.();
    };
  }, [enabled, scrollEl]);

  return { pullPx, isDragging, armed, pendingReload };
}
