import { getFirebaseAuth } from "./firebaseApp";
import {
  getLastCloudSyncIssueState,
  isCloudSyncMutation,
  syncCloudWithLocal,
} from "./cloudSync";
import {
  awaitPhotoCaptureIdle,
  isPhotoCaptureSessionActive,
  whenPhotoCaptureIdle,
} from "./photoCaptureGate";

const DEBOUNCE_MS = 1500;

/**
 * 동기화가 실패(개별 사진 업로드 실패 또는 sync 자체 throw)하면, 사용자가 아무것도
 * 하지 않아도 스스로 복구되도록 지수 백오프로 자동 재시도한다. 한 번이라도 깨끗하게
 * 끝나면 백오프는 초기화된다. 새 변경(사진 추가 등)·탭 복귀·온라인 복귀 시에도 초기화.
 */
const RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 90_000];

/** 카메라 복귀 직후 파일 처리·편집이 끝날 때까지 visibility sync 를 미룬다 */
let pendingVisibleSync = false;
let visibleSyncDelayTimer: ReturnType<typeof setTimeout> | null = null;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let runAgain = false;
let listenersStarted = false;

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function isAuthed(): boolean {
  try {
    return !!getFirebaseAuth().currentUser;
  } catch {
    return false;
  }
}

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

/** 직전 동기화 사이클에서 미해결 실패가 남았으면 백오프로 다음 시도를 예약한다. */
function scheduleRetryIfNeeded(cycleStartedAt: number): void {
  if (typeof window === "undefined") return;
  const issue = getLastCloudSyncIssueState();
  const hadIssues =
    !!issue &&
    issue.at >= cycleStartedAt &&
    (issue.failedItems.length > 0 || !!issue.lastError);

  if (!hadIssues) {
    clearRetry();
    return;
  }
  if (retryAttempt >= RETRY_DELAYS_MS.length) {
    return;
  }
  const delay = RETRY_DELAYS_MS[retryAttempt]!;
  retryAttempt++;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!isAuthed()) return;
    void runSyncCycle();
  }, delay);
}

async function runSyncOnce(): Promise<void> {
  if (!isAuthed()) return;
  if (isCloudSyncMutation()) return;

  running = true;
  try {
    await syncCloudWithLocal();
  } catch (e) {
    console.warn("[autoCloudSync]", e);
  } finally {
    running = false;
  }
}

async function runSyncCycle(): Promise<void> {
  if (running) {
    runAgain = true;
    return;
  }
  const cycleStartedAt = Date.now();
  await runSyncOnce();
  while (runAgain) {
    runAgain = false;
    await runSyncOnce();
  }
  scheduleRetryIfNeeded(cycleStartedAt);
}

/** 사용자가 배너에서 «다시 시도» 를 눌렀을 때 호출 — 백오프 초기화 후 즉시 한 사이클 */
export async function runCloudSyncNow(): Promise<void> {
  if (typeof window === "undefined" || !isAuthed()) return;
  clearRetry();
  await runSyncCycle();
}

function kickSync(): void {
  void (async () => {
    // 사진 촬영·편집·저장 중이면 끝날 때까지 기다린다 (스냅샷 bulkPut 덮어쓰기 방지)
    if (isPhotoCaptureSessionActive()) {
      await awaitPhotoCaptureIdle();
      await new Promise<void>((r) => setTimeout(r, 350));
    }
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          document.removeEventListener("visibilitychange", onVis);
          clearTimeout(timer);
          resolve();
        };
        const onVis = () => {
          if (document.visibilityState === "visible") finish();
        };
        document.addEventListener("visibilitychange", onVis);
        const timer = window.setTimeout(finish, 45_000);
      });
    }
    await runSyncCycle();
  })();
}

/**
 * 로그인된 경우에만, 로컬 데이터 변경 후 Firestore 와 맞춥니다.
 * - immediate: 대기 없이 곧바로(탭 복귀·로그인 직후 등)
 * - 기본: DEBOUNCE_MS 후 한 번만(연속 저장 합침)
 */
export function requestAutoCloudSync(options?: { immediate?: boolean }): void {
  if (typeof window === "undefined" || !isAuthed()) return;

  retryAttempt = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (isCloudSyncMutation()) {
    runAgain = true;
  }

  if (options?.immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    kickSync();
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    kickSync();
  }, DEBOUNCE_MS);
}

function flushPendingVisibleSync(): void {
  if (!pendingVisibleSync) return;
  if (isPhotoCaptureSessionActive()) {
    whenPhotoCaptureIdle(() => {
      window.setTimeout(() => flushPendingVisibleSync(), 400);
    });
    return;
  }
  pendingVisibleSync = false;
  requestAutoCloudSync({ immediate: true });
}

export function ensureAutoCloudSyncListeners(): void {
  if (typeof window === "undefined" || listenersStarted) return;
  listenersStarted = true;
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    // 카메라 Intent 복귀 직후 곧바로 sync 하면 아직 put 되기 전 스냅샷으로
    // 방금 저장한 식단을 덮어쓸 수 있어, 짧게 미룬 뒤 캡처 세션을 확인한다.
    if (visibleSyncDelayTimer) clearTimeout(visibleSyncDelayTimer);
    visibleSyncDelayTimer = setTimeout(() => {
      visibleSyncDelayTimer = null;
      if (isPhotoCaptureSessionActive()) {
        pendingVisibleSync = true;
        whenPhotoCaptureIdle(() => {
          window.setTimeout(() => flushPendingVisibleSync(), 400);
        });
        return;
      }
      requestAutoCloudSync({ immediate: true });
    }, 1800);
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", () => requestAutoCloudSync({ immediate: true }));
}
