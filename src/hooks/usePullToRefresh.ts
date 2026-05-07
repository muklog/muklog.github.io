import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
  armPullRefreshBeforeReload,
  mountPullRefreshSplashNow,
} from "../lib/pullRefreshSplash";

/** 손가락 이동(px)으로 새로고침 여부 판단 — 시각적 당김은 damp 적용 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 52;
/** 당긴 거리 → 화면에 반영되는 최대 오프셋(px) */
export const PULL_TO_REFRESH_MAX_VISUAL_PX = 72;
/** 손가락 거리에 곱해 고무줄 느낌 */
const PULL_DAMPING = 0.42;

/** 맨 위 판정 — 살짝 밀린 scrollTop 에서도 PTR 이 붙도록 여유 */
const SCROLL_TOP_EPS = 48;

/** 이 거리 이상 당기면 “커밋”: 이후에는 scrollTop 요동으로 제스처를 끊지 않음 */
const PULL_COMMIT_RAW_PX = 12;

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
 * iOS 등에서 아래로 당기기 시작할 때 잠깐 scrollTop 이 튀면 기존 로직이 즉시 제스처를 끊었고,
 * 오늘 바뀐 `overscroll-behavior` 도 브라우저별로 PTR 과 상성이 달라 문제를 키울 수 있다.
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
    let startedAtTop = false;
    let pullCommitted = false;
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
        startedAtTop = top();
        pullCommitted = false;
        if (!startedAtTop) return;
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
        if (!touchActive || !startedAtTop) return;

        const raw = te.touches[0].clientY - startY;
        if (raw <= 2) return;

        /** 고무줄이 한 프레임이라도 scrollTop 을 밀면 그 다음 줄에서 PTR 이 끊기므로, 맨 위에서 아래로 당길 때는 먼저 막는다 */
        if (te.cancelable && raw > 4) {
          te.preventDefault();
        }

        if (!pullCommitted) {
          if (!top()) {
            touchActive = false;
            gestureMaxRawRef.current = 0;
            settleToZero();
            return;
          }
          if (raw >= PULL_COMMIT_RAW_PX) pullCommitted = true;
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
        pullCommitted = false;

        /** 떼는 순간 scrollTop 이 살짝 어긋나 새로고침이 씹히지 않게, 시작이 맨 위였고 당김만 본다 */
        const go = startedAtTop && maxRaw >= PULL_TO_REFRESH_THRESHOLD_PX;

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
