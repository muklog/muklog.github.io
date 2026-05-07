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

/** 터치 입력이 없는 순수 데스크톱에서는 리스너를 생략한다 */
function isTouchEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0)
  );
}

const SCROLL_TOP_EPS = 8;

function isMainAtScrollTop(mainEl: HTMLElement): boolean {
  return mainEl.scrollTop <= SCROLL_TOP_EPS;
}

/**
 * `<main>` 과 터치 타깃 사이에 세로 스크롤이 남아 있으면 당김은 그 영역에 맡긴다.
 * - `overflow-x: auto` 만 준 가로 캐러셀은 CSS 에서 `overflow-y` 가 `auto` 로 바뀌는 경우가 많아
 *   세로 방해 요소로 오인하지 않도록 건너뛴다.
 */
function nestedVerticalScrollBlocksPull(mainEl: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (!mainEl.contains(target)) return false;
  let el: Element | null = target;
  while (el && el !== mainEl) {
    if (el instanceof HTMLElement) {
      const cs = window.getComputedStyle(el);
      const oy = cs.overflowY;
      const ox = cs.overflowX;

      const horizDominantStrip =
        (ox === "auto" || ox === "scroll" || ox === "overlay") &&
        el.scrollWidth > el.clientWidth + SCROLL_TOP_EPS &&
        el.scrollHeight <= el.clientHeight + SCROLL_TOP_EPS * 4;

      if (horizDominantStrip) {
        el = el.parentElement;
        continue;
      }

      const scrollableY =
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        el.scrollHeight > el.clientHeight + SCROLL_TOP_EPS;
      if (scrollableY && el.scrollTop > SCROLL_TOP_EPS) return true;
    }
    el = el.parentElement;
  }
  return false;
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

    /**
     * `<main>` 에만 붙이면 자식 쪽 기본 스크롤·타깃 변경과 순서가 꼬일 수 있다.
     * `window` 캡처에서 먼저 판단하고, 스크롤 루트는 여전히 ref 의 `<main>` 이다.
     */
    const capPassive: AddEventListenerOptions = { capture: true, passive: true };
    const capBlocking: AddEventListenerOptions = { capture: true, passive: false };

    const setup = (): (() => void) | undefined => {
      const mainEl = scrollEl.current;
      if (!mainEl) return undefined;

      const touchTargetInMain = (te: TouchEvent): boolean => {
        const t = te.target;
        return t instanceof Node && mainEl.contains(t);
      };

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
        if (!touchTargetInMain(te)) return;
        if (!top() || nestedVerticalScrollBlocksPull(mainEl, te.target)) return;
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
        /** touchmove 마다 `target` 이 바뀌므로 중첩 스크롤 검사는 하지 않는다 (시작 시점만 본다). */
        if (!touchTargetInMain(te)) {
          touchActive = false;
          gestureMaxRawRef.current = 0;
          settleToZero();
          return;
        }
        if (!top()) {
          touchActive = false;
          gestureMaxRawRef.current = 0;
          settleToZero();
          return;
        }
        const raw = te.touches[0].clientY - startY;
        if (raw <= 4) return;

        if (te.cancelable && raw >= 16) {
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
