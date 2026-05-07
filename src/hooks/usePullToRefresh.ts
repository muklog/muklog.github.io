import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
  armPullRefreshBeforeReload,
  mountPullRefreshSplashNow,
} from "../lib/pullRefreshSplash";

/** 손가락 이동(px)으로 새로고침 여부 판단 — 시각적 당김은 damp 적용 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 72;
/** 당긴 거리 → 화면에 반영되는 최대 오프셋(px) */
export const PULL_TO_REFRESH_MAX_VISUAL_PX = 78;
/** 손가락 거리에 곱해 고무줄 느낌 */
const PULL_DAMPING = 0.38;

function isTouchEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0)
  );
}

function dampVisual(rawPull: number): number {
  const d = Math.round(rawPull * PULL_DAMPING);
  return Math.min(Math.max(0, d), PULL_TO_REFRESH_MAX_VISUAL_PX);
}

export type PullToRefreshGesture = {
  /** 페이지 상단 패딩으로 내려 보이는 양 */
  pullPx: number;
  /** 손가락을 대고 있는 동안 */
  isDragging: boolean;
  /** 이번 제스처에서 임계값을 넘었었는지 */
  armed: boolean;
  /** 새로고침 직전 */
  pendingReload: boolean;
};

/**
 * 스크롤 최상단에서 아래로 당겼다 떼면 `location.reload()`.
 * 패딩 + 고무줄 감쇠로 제스처와 UI를 맞추고, 임계 미만이면 스프링처럼 돌아온다.
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
    if (!enabled || !isTouchEnvironment()) {
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

    const passiveOpt: AddEventListenerOptions = { passive: true };
    const blockingOpt: AddEventListenerOptions = { passive: false };

    const setup = (): (() => void) | undefined => {
      const el = scrollEl.current;
      if (!el) return undefined;

      const top = () => el.scrollTop <= 2;

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
        if (!top()) {
          touchActive = false;
          gestureMaxRawRef.current = 0;
          settleToZero();
          return;
        }
        const raw = te.touches[0].clientY - startY;
        if (raw <= 4) return;

        if (te.cancelable && raw >= 18) {
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

      el.addEventListener("touchstart", onTouchStart, passiveOpt);
      el.addEventListener("touchmove", onTouchMove, blockingOpt);
      el.addEventListener("touchend", onTouchEnd, passiveOpt);
      el.addEventListener("touchcancel", onTouchEnd, passiveOpt);

      return () => {
        cancelAnimationFrame(settleRafRef.current);
        settleRafRef.current = 0;
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
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = 0;
      cleanup?.();
    };
  }, [enabled, scrollEl]);

  return { pullPx, isDragging, armed, pendingReload };
}
