import { getFirebaseAuth } from "./firebaseApp";
import { isCloudSyncMutation, syncCloudWithLocal } from "./cloudSync";

const DEBOUNCE_MS = 1500;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let runAgain = false;
let listenersStarted = false;

async function runSyncOnce(): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
  } catch {
    return;
  }
  if (isCloudSyncMutation()) return;

  running = true;
  try {
    await syncCloudWithLocal();
  } catch (e) {
    // syncCloudWithLocal 내부 finally 에서 issue 이벤트를 이미 디스패치하므로
    // 여기서는 콘솔 경고만 남긴다(silent fail 방지는 UI 측 배너가 담당).
    console.warn("[autoCloudSync]", e);
  } finally {
    running = false;
  }
}

/** 사용자가 배너에서 «다시 시도» 를 눌렀을 때 호출 — 동기화 한 번 강제 실행 */
export async function runCloudSyncNow(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (!getFirebaseAuth().currentUser) return;
  } catch {
    return;
  }
  if (running) {
    runAgain = true;
    return;
  }
  await runSyncOnce();
  while (runAgain) {
    runAgain = false;
    await runSyncOnce();
  }
}

function kickSync(): void {
  void (async () => {
    if (running) {
      runAgain = true;
      return;
    }
    await runSyncOnce();
    while (runAgain) {
      runAgain = false;
      await runSyncOnce();
    }
  })();
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
  if (typeof window === "undefined") return;
  try {
    if (!getFirebaseAuth().currentUser) return;
  } catch {
    return;
  }

  // 진행 중인 sync 가 있다면 즉시 후속 실행을 예약해 둔다(immediate 여부 무관).
  // kickSync 안에서도 동일한 처리를 하지만, 호출 자체를 생략하지 않도록 보장한다.
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
