import { getFirebaseAuth } from "./firebaseApp";
import {
  getLastCloudSyncIssueState,
  isCloudSyncMutation,
  syncCloudWithLocal,
} from "./cloudSync";

const DEBOUNCE_MS = 1500;

/**
 * 동기화가 실패(개별 사진 업로드 실패 또는 sync 자체 throw)하면, 사용자가 아무것도
 * 하지 않아도 스스로 복구되도록 지수 백오프로 자동 재시도한다. 한 번이라도 깨끗하게
 * 끝나면 백오프는 초기화된다. 새 변경(사진 추가 등)·탭 복귀·온라인 복귀 시에도 초기화.
 */
const RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 90_000];

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
    // 깨끗하게 끝남 — 백오프 초기화
    clearRetry();
    return;
  }
  if (retryAttempt >= RETRY_DELAYS_MS.length) {
    // 자동 재시도 소진 — 배너의 수동 «다시 시도» 와 online/visible 복귀에 맡긴다.
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
    // syncCloudWithLocal 내부 finally 에서 issue 이벤트를 이미 디스패치하므로
    // 여기서는 콘솔 경고만 남긴다(silent fail 방지는 UI 측 배너 + 자동 재시도가 담당).
    console.warn("[autoCloudSync]", e);
  } finally {
    running = false;
  }
}

/**
 * 한 사이클: 진행 중이면 후속 실행만 예약하고, 아니면 끝까지 돌린 뒤 남은 실패가
 * 있으면 자동 재시도를 예약한다.
 */
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
  void runSyncCycle();
}

/**
 * 로그인된 경우에만, 로컬 데이터 변경 후 Firestore 와 맞춥니다.
 * - immediate: 대기 없이 곧바로(탭 복귀·로그인 직후 등)
 * - 기본: DEBOUNCE_MS 후 한 번만(연속 저장 합침)
 *
 * 주의: 진행 중인 sync 의 로컬 트랜잭션 동안 들어온 요청을 버리면
 * AI 분석 완료처럼 sync 도중에 발생한 변경이 영영 클라우드로 올라가지
 * 않을 수 있다(친구 화면에서 `analyzing` 이 계속 보이는 원인). 따라서
 * sync 가 진행 중이어도 후속 실행이 보장되도록 항상 kickSync 까지 호출한다.
 */
export function requestAutoCloudSync(options?: { immediate?: boolean }): void {
  if (typeof window === "undefined" || !isAuthed()) return;

  // 새 사용자 변경·복귀가 들어오면 백오프 스케줄을 초기화해 즉시 다시 시도한다.
  // (오래된 백오프 대기 때문에 방금 추가한 사진 업로드가 늦어지는 것을 막는다.)
  retryAttempt = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  // 진행 중인 sync 가 있다면 즉시 후속 실행을 예약해 둔다(immediate 여부 무관).
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

export function ensureAutoCloudSyncListeners(): void {
  if (typeof window === "undefined" || listenersStarted) return;
  listenersStarted = true;
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      requestAutoCloudSync({ immediate: true });
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  /** 오프라인 이후 연결되면 한 번 즉시 맞춤(조용히 실패한 동기화 복구) */
  window.addEventListener("online", () => requestAutoCloudSync({ immediate: true }));
}
