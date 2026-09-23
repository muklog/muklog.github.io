/**
 * 카메라/앨범으로 사진을 고르는 동안(편집·저장 포함) 플래그.
 * 카메라 Intent 복귀 시 visibilitychange → 즉시 클라우드 sync / Dexie reconnect 가
 * 방금 저장한 식단을 덮어쓰거나 liveQuery 를 깨는 레이스를 줄인다.
 */

let depth = 0;
const idleListeners = new Set<() => void>();

export function isPhotoCaptureSessionActive(): boolean {
  return depth > 0;
}

export function beginPhotoCaptureSession(): void {
  depth += 1;
}

export function endPhotoCaptureSession(): void {
  if (depth <= 0) return;
  depth -= 1;
  if (depth === 0) {
    for (const fn of [...idleListeners]) {
      try {
        fn();
      } catch (e) {
        console.warn("[photoCaptureGate] idle listener", e);
      }
    }
  }
}

/** 세션이 이미 끝났으면 즉시, 아니면 종료 시 한 번 호출 */
export function whenPhotoCaptureIdle(fn: () => void): void {
  if (depth <= 0) {
    fn();
    return;
  }
  const once = () => {
    idleListeners.delete(once);
    fn();
  };
  idleListeners.add(once);
}

export function awaitPhotoCaptureIdle(): Promise<void> {
  return new Promise((resolve) => whenPhotoCaptureIdle(resolve));
}
