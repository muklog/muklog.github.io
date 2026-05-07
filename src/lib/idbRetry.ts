import Dexie from "dexie";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAppleMobileUa(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/**
 * Safari(iOS)·일부 모바일에서 IndexedDB 프로세스가 순간 끊길 때 흔한 메시지·이름 패턴.
 * (영문 기술 문구는 사용자에게 그대로 노출하지 않고 재시도·한글 안내로 처리)
 */
export function isTransientIndexedDbError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const lower = msg.toLowerCase();
  if (
    /indexed database|idbversionchange|connection[^a-z]*lost|database[^a-z]*closing|internal error opening backing store/i.test(
      msg,
    )
  ) {
    return true;
  }
  if (
    lower.includes("unknownerror") &&
    /indexed|idb|\bidb\b|database server/.test(lower)
  ) {
    return true;
  }
  return false;
}

/** 알림창용 — IndexedDB 등 영문 스택을 숨기고 행동 안내만 */
export function userFacingStorageErrorMessage(err: unknown): string {
  if (isTransientIndexedDbError(err)) {
    return (
      "브라우저 저장이 잠깐 불안정했어요. 보통 아래 중 하나면 바로 해결돼요.\n\n" +
      "• 화면을 아래로 당겨 새로고침 후 다시 시도\n" +
      "• 사파리에서 이 사이트를 연 다른 탭을 닫기\n" +
      "• 사설 보호 모드가 아닌지 확인"
    );
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/quota|exceeded|storage is full|저장 공간/i.test(raw)) {
    return "저장 공간이 부족해요. 기기 용량을 확보하거나 오래된 기록을 줄인 뒤 다시 시도해 주세요.";
  }
  if (raw && !/indexed database|indexeddb|idb/i.test(raw)) {
    return raw;
  }
  return "저장에 실패했어요. 새로고침 후 다시 시도해 주세요.";
}

/**
 * 네이티브 IndexedDB 연결이 끊긴 뒤에도 Dexie 는 열린 상태로 남는 경우가 있어,
 * 닫았다가 다시 연다. 호출은 직렬 큐로 묶어 동시에 두 번 닫기/열기가 겹치지 않게 한다.
 */
async function doRecoverDexieConnection(dexieDb: Dexie): Promise<void> {
  try {
    dexieDb.close();
  } catch {
    /* noop */
  }
  await sleep(isAppleMobileUa() ? 120 : 75);
  const openDelaysMs = isAppleMobileUa()
    ? [0, 90, 180, 340, 520, 850, 1300]
    : [0, 70, 160, 340];
  let lastErr: unknown;
  for (let i = 0; i < openDelaysMs.length; i++) {
    const d = openDelaysMs[i];
    if (d > 0) await sleep(d);
    try {
      await dexieDb.open();
      return;
    } catch (e) {
      lastErr = e;
      if (!isTransientIndexedDbError(e)) throw e;
    }
  }
  throw lastErr;
}

let recoverChain = Promise.resolve();

export async function recoverDexieConnection(dexieDb: Dexie): Promise<void> {
  const run = recoverChain.then(() => doRecoverDexieConnection(dexieDb));
  recoverChain = run.catch(() => {
    /* 다음 복구 요청이 체인에서 끊기지 않도록 */
  });
  await run;
}

/**
 * Safari(iOS) 등에서 탭이 백그라운드로 갔다 오면 IndexedDB 서버 연결이 끊긴 채로 남는 경우가 많아,
 * 포그라운드 복귀·bfcache 복원 시 선제적으로 한 번 재연결한다.
 */
export function installIndexedDbLifecycleHandlers(dexieDb: Dexie): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  let wasHidden = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReconnect = () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void recoverDexieConnection(dexieDb).catch((e) => {
        console.warn("[idb] lifecycle 재연결 실패", e);
      });
    }, 280);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      wasHidden = true;
      return;
    }
    if (document.visibilityState === "visible" && wasHidden) {
      wasHidden = false;
      scheduleReconnect();
    }
  });

  window.addEventListener("pageshow", (ev: Event) => {
    const pe = ev as PageTransitionEvent;
    if (pe.persisted) scheduleReconnect();
  });
}

export async function withIndexedDbRetry<T>(
  dexieDb: Dexie,
  fn: () => Promise<T>,
  opts?: { retries?: number },
): Promise<T> {
  const appleMobile = isAppleMobileUa();
  const retries = opts?.retries ?? (appleMobile ? 14 : 5);
  const delaysMs = appleMobile
    ? [
        45, 100, 180, 280, 420, 650, 900, 1200, 1500, 1900, 2300, 2800, 3300,
        4000,
      ]
    : [40, 120, 280, 600, 1200];

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (appleMobile && attempt === 0) {
        await sleep(25);
      }
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isTransientIndexedDbError(e)) throw e;
      /** iOS 는 첫 실패 직후부터 네이티브 연결 재수립이 안전하다. 데스크톱은 노이즈 줄이려 2번째부터 */
      const recoverFrom = appleMobile ? 0 : 2;
      if (attempt >= recoverFrom) await recoverDexieConnection(dexieDb);
      await sleep(delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 150);
    }
  }
  throw lastErr;
}

/** 첫 페인트 직후 연결을 미리 열고, 가능하면 저장소 eviction 완화 요청 */
export async function warmupIndexedDb(dexieDb: Dexie): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist();
    }
  } catch {
    /* noop */
  }
  try {
    const ios =
      typeof navigator !== "undefined" &&
      /iPhone|iPad|iPod/i.test(navigator.userAgent);
    await withIndexedDbRetry(dexieDb, () => dexieDb.open(), {
      retries: ios ? 14 : 8,
    });
  } catch (e) {
    console.warn("[idb] warmup 실패", e);
  }
}
