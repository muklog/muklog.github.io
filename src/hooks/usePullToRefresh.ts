import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { armPullRefreshBeforeReload } from "../lib/pullRefreshSplash";

/** 손가락 이동(px)으로 새로고침 여부 판단 — 시각적 당김은 damp 적용 */
export const PULL_TO_REFRESH_THRESHOLD_PX = 72;
/** 당긴 거리 → 화면에 반영되는 최대 오프셋(px) */
export const PULL_TO_REFRESH_MAX_VISUAL_PX = 78;
/** 손가락 거리에 곱해 고무줄 느낌 */
const PULL_DAMPING = 0.38;

/** 터치 없는 순수 데스크톱에서는 리스너 생략 — gogojeje1022.github.io/healthhealth 동작과 동일 */
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
  pullPx: number;
  isDragging: boolean;
  armed: boolean;
  pendingReload: boolean;
};

/**
 * 스크롤 최상단에서 아래로 당겼다 떼면 `location.reload()`.
 *
 * 리스너는 스크롤 컨테이너(`<main>`) 자체에만 붙인다(window 캡처 X).
 *
 * `rebindKey`: `<main>` 이 조건부 렌더로 언마운트됐다 다시 붙을 때(예: 계정 복원 로딩 화면),
 * enabled 와 ref 객체는 그대로여도 effect 가 다시 돌아 새 DOM 에 리스너를 붙이게 한다.
 */
export function usePullToRefresh(
  scrollEl: RefObject<HTMLElement | null>,
  enabled: boolean,
  rebindKey: string,
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

    let cleanup: (() => void) | undefined;
    let raf = 0;
    const retryAttach = () => {
      cleanup?.();
      cleanup = setup();
      if (!cleanup) {
        raf = requestAnimationFrame(() => {
          cleanup?.();
          cleanup = setup();
          raf = 0;
        });
      }
    };

    retryAttach();

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = 0;
      cleanup?.();
    };
  }, [enabled, scrollEl, rebindKey]);

  return { pullPx, isDragging, armed, pendingReload };
}
