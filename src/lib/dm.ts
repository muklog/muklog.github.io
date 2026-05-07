import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { DmMessageDoc, DmThreadDoc } from "../types";
import { getFirebaseAuth, getFirestoreDb, isFirestoreMobileUa } from "./firebaseApp";
import { isCalendarConnectedPairFromServer } from "./friends";

/** Firebase/Firestore 에서 넘어오는 메시지 문자열 (객체 래핑·커스텀 에러 대응) */
function firebaseErrText(e: unknown): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  const o = e as Record<string, unknown>;
  if (typeof o?.message === "string" && o.message.trim()) return o.message;
  const nested = o?.customData as Record<string, unknown> | undefined;
  if (nested && typeof nested.message === "string") return nested.message;
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}") return s;
  } catch {
    /* ignore */
  }
  return String(e);
}

export function isFirestorePermissionDenied(e: unknown): boolean {
  return isPermissionDenied(e);
}

function isPermissionDenied(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "");
  const raw = firebaseErrText(e);
  return (
    code === "permission-denied" ||
    code.endsWith("/permission-denied") ||
    /insufficient permissions/i.test(raw) ||
    /missing or insufficient permissions/i.test(raw)
  );
}

/** DM 스레드 리스너 — 모바일 등에서 일시 연결 실패 시 소수 재시도 */
function listenerErrorMayRecover(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "");
  if (
    code === "resource-exhausted" ||
    code.endsWith("/resource-exhausted") ||
    /quota exceeded/i.test(firebaseErrText(e))
  ) {
    return false;
  }
  return (
    code === "permission-denied" ||
    code.endsWith("/permission-denied") ||
    code === "unauthenticated" ||
    code.endsWith("/unauthenticated") ||
    code === "unavailable" ||
    code.endsWith("/unavailable") ||
    code === "deadline-exceeded" ||
    code.endsWith("/deadline-exceeded") ||
    code === "aborted" ||
    code === "internal"
  );
}

function mutationMayRecoverWithRetry(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "");
  // 할당량 초과 시 재시도하면 백엔드 부하만 가중되므로 절대 재시도하지 않음
  if (
    code === "resource-exhausted" ||
    code.endsWith("/resource-exhausted") ||
    /quota exceeded/i.test(firebaseErrText(e))
  ) {
    return false;
  }
  if (
    code === "unavailable" ||
    code.endsWith("/unavailable") ||
    code === "deadline-exceeded" ||
    code.endsWith("/deadline-exceeded") ||
    code === "aborted" ||
    code === "internal" ||
    code === "unauthenticated" ||
    code.endsWith("/unauthenticated")
  ) {
    return true;
  }
  return isPermissionDenied(e);
}

/** 전송 단 transient / 토큰 stale 에 대해 소수 회 재시도 */
async function withFirestoreMutationRetries(job: () => Promise<void>): Promise<void> {
  const max = 4;
  let last: unknown;
  for (let i = 0; i < max; i++) {
    try {
      await job();
      return;
    } catch (e) {
      last = e;
      const recover = mutationMayRecoverWithRetry(e);
      if (!recover || i === max - 1) throw e;
      await getFirebaseAuth().currentUser?.getIdToken(true).catch(() => {});
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw last;
}

/** DM 전송·스레드 생성 실패 시 사용자에게 보여 줄 메시지 */
function dmFirestoreUserMessage(e: unknown, hint?: "messageDoc" | "threadMeta"): string {
  const code = String((e as { code?: string })?.code ?? "");
  const raw = firebaseErrText(e);
  if (
    code === "permission-denied" ||
    code.endsWith("/permission-denied") ||
    /insufficient permissions/i.test(raw) ||
    /missing or insufficient permissions/i.test(raw)
  ) {
    if (hint === "threadMeta") {
      return "대화 목록을 갱신하지 못했어요. Firestore 규칙(dmThreads 업데이트) 또는 네트워크를 확인해 주세요.";
    }
    if (hint === "messageDoc") {
      return "메시지 저장이 거절됐어요. 스레드 참가자·Firestore 규칙(dmThreads/…/messages)을 확인해 주세요. 로그인 계정이 이 대화방 참가자와 같은지도 확인해 주세요.";
    }
    return "메시지를 저장하지 못했어요. 로그인을 확인하고 잠시 후 다시 시도해 주세요. 계속되면 로그아웃 후 다시 로그인해 보세요.";
  }
  if (code === "unavailable" || code === "unauthenticated") {
    return "연결 또는 로그인 상태를 확인해 주세요.";
  }
  if (
    code === "resource-exhausted" ||
    code.endsWith("/resource-exhausted") ||
    /quota exceeded/i.test(raw)
  ) {
    return "Firestore 사용 한도(일일 읽기·쓰기 할당량)에 도달했습니다. 잠시 후 다시 시도하거나 Firebase 콘솔의 사용량·요금제를 확인해 주세요. 피드·알림 화면을 닫아 두면 부하가 줄어듭니다.";
  }
  if (code === "deadline-exceeded") {
    return "요청이 지연됐어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  return raw.length > 160 ? `${raw.slice(0, 158)}…` : raw;
}

/** alert 등 UI 용 — 위험한 원문 노출 줄임 */
export function dmErrorMessageForUi(
  e: unknown,
  hint?: "threadList" | "messageDoc" | "threadMeta",
): string {
  if (hint === "threadList" && isPermissionDenied(e)) {
    return "대화 목록을 불러오지 못했어요. 잠시 후 새로고침하거나 로그아웃 후 다시 로그인해 보세요. 계속되면 Firebase 규칙·네트워크를 확인해 주세요.";
  }
  return dmFirestoreUserMessage(e, hint === "threadList" ? undefined : hint);
}

/** threadId 규약: uid 문자열 순서 오름차순 [a,b] 일 때 `${a}_${b}` */
export function dmThreadIdForPair(uidA: string, uidB: string): string {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
}

/** 문서 id 가 규약에 맞는지 — Firebase UID 는 관례적으로 `_` 를 포함하지 않음 */
export function parseDmThreadPeers(threadId: string): [string, string] | null {
  const parts = threadId.split("_");
  if (parts.length !== 2) return null;
  const a = parts[0]!;
  const b = parts[1]!;
  if (!a.length || !b.length || a >= b) return null;
  return [a, b];
}

export function userInDmThreadId(threadId: string, me: string): boolean {
  const p = parseDmThreadPeers(threadId);
  if (!p) return false;
  return me === p[0] || me === p[1];
}

export function otherUidInDmThreadId(threadId: string, me: string): string | null {
  const p = parseDmThreadPeers(threadId);
  if (!p) return null;
  return me === p[0] ? p[1]! : me === p[1]! ? p[0]! : null;
}

function participantsTuple(uidA: string, uidB: string): [string, string] {
  return uidA < uidB ? [uidA, uidB] : [uidB, uidA];
}

function requireUser() {
  const u = getFirebaseAuth().currentUser;
  if (!u?.uid) throw new Error("로그인이 필요합니다.");
  return u.uid;
}

function threadsCol() {
  return collection(getFirestoreDb(), "dmThreads");
}

function snapshotToDmThreads(snap: QuerySnapshot, displayLimit: number): DmThreadDoc[] {
  return snap.docs
    .map((d) => ({
      ...(d.data() as Omit<DmThreadDoc, "id">),
      id: d.id,
    }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, displayLimit);
}

async function ensureDmThreadDocReady(threadId: string): Promise<void> {
  const me = requireUser();
  const peer = otherUidInDmThreadId(threadId, me);
  if (!peer) throw new Error("이 대화에 참가할 수 없습니다.");
  const fs = getFirestoreDb();
  const tref = doc(fs, "dmThreads", threadId);
  const snap = await getDoc(tref);
  if (!snap.exists()) await ensureDmThreadWith(peer);
}

function dmReadDoc(myUid: string, threadId: string) {
  return doc(getFirestoreDb(), "users", myUid, "dmReadState", threadId);
}

/** 상대방과 대화 시작 — 스레드 문서가 없으면 만든다 */
export async function ensureDmThreadWith(peerUid: string): Promise<string> {
  const me = requireUser();
  if (!peerUid || peerUid === me) throw new Error("DM 상대 정보가 필요합니다.");
  const tid = dmThreadIdForPair(me, peerUid);
  const ref = doc(getFirestoreDb(), "dmThreads", tid);
  const s = await getDoc(ref);
  if (!s.exists()) {
    const linked = await isCalendarConnectedPairFromServer(me, peerUid);
    if (!linked) {
      throw new Error("서로 친구로 연결된 경우에만 DM을 보낼 수 있어요.");
    }
    const now = Date.now();
    const p = participantsTuple(me, peerUid);
    try {
      await setDoc(ref, {
        participantUids: p,
        lastText: "",
        lastSenderUid: "",
        updatedAt: now,
        createdAt: now,
      });
    } catch (e) {
      throw new Error(
        isPermissionDenied(e)
          ? "대화방을 만들 수 없어요. 친구와 달력 공유가 되어 있는지 확인한 뒤 다시 시도해 주세요."
          : dmFirestoreUserMessage(e),
      );
    }
  }
  return tid;
}

/**
 * 내가 참가한 DM 스레드 구독.
 * - getDocs 웜업(재시도·서버 폴백)·웜업이 끝난 뒤에만 onSnapshot 을 붙여, 빈 로컬 캐시가 먼저 UI를 덮는 레이스를 줄임.
 * - 리스너가 끊겨도 한 번이라도 성공한 목록이 있으면 onErr 로 낙관을 보이지 않고 백오프 재구독
 */
export function subscribeMyDmThreads(
  myUid: string,
  cb: (threads: DmThreadDoc[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  /** Auth 세션 uid 와 인자가 다르면 빈 문자열 쿼리·권한 오류를 유발하므로 반드시 일치할 때만 구독 */
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid || uid !== myUid) {
    cb([]);
    return () => {};
  }

  const mobile = isFirestoreMobileUa();
  const warmMaxAttempts = mobile ? 10 : 6;

  const FETCH_LIMIT = 48;
  const DISPLAY_LIMIT = 25;
  const q = query(
    threadsCol(),
    where("participantUids", "array-contains", uid),
    limit(FETCH_LIMIT),
  );

  let unsub: Unsubscribe | null = null;
  let stopped = false;
  /** 일회 조회 또는 스냅샷으로라도 한 번 성공하면 리스너 오류는 UI에 노출하지 않음 */
  let hadSuccess = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotStallWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** permission-denied / unauthenticated 일 때 토큰 갱신 후 재구독 (초기 진입·모바일 레이스 대비) */
  let authRetryCount = 0;
  const MAX_AUTH_RETRY = 7;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const cancelSnapshotWatchdog = () => {
    if (snapshotStallWatchdog !== null) {
      window.clearTimeout(snapshotStallWatchdog);
      snapshotStallWatchdog = null;
    }
  };

  const scheduleSnapshotWatchdog = () => {
    cancelSnapshotWatchdog();
    const ms = mobile ? 28_000 : 18_000;
    snapshotStallWatchdog = window.setTimeout(() => {
      snapshotStallWatchdog = null;
      if (stopped || hadSuccess) return;
      console.warn("[dm] thread list — first snapshot stalled (mobile/slow net)");
      const err = Object.assign(new Error("대화 목록 응답이 너무 늦어요. 재시도를 눌러 주세요."), {
        code: "deadline-exceeded",
      });
      onErr?.(err);
    }, ms);
  };

  const scheduleSilentReconnect = () => {
    clearReconnect();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) attach();
    }, 6000);
  };

  /**
   * 로컬 캐시에 아직 목록이 없으면 빈 스냅샷(fromCache)·getDocs 결과가 나와 UI를 비운다.
   * 서버 결과(fromCache:false) 또는 문서가 있는 스냅샷만 반영한다. 반환값 false 는 "적용 안 함".
   */
  const applySnapshot = (snap: QuerySnapshot): boolean => {
    if (
      snap.empty &&
      snap.metadata.fromCache &&
      !snap.metadata.hasPendingWrites
    ) {
      return false;
    }
    cancelSnapshotWatchdog();
    hadSuccess = true;
    authRetryCount = 0;
    clearReconnect();
    cb(snapshotToDmThreads(snap, DISPLAY_LIMIT));
    return true;
  };

  const attach = () => {
    unsub?.();
    cancelSnapshotWatchdog();
    unsub = onSnapshot(
      q,
      (snap) => {
        void applySnapshot(snap);
      },
      async (err) => {
        if (stopped) return;
        if (authRetryCount < MAX_AUTH_RETRY && listenerErrorMayRecover(err)) {
          authRetryCount++;
          if (authRetryCount === 1) {
            await getFirebaseAuth().currentUser?.getIdToken(false).catch(() => {});
          } else {
            await getFirebaseAuth().currentUser?.getIdToken(true).catch(() => {});
          }
          await new Promise((r) => setTimeout(r, 400 * authRetryCount));
          if (!stopped) attach();
          return;
        }
        if (hadSuccess) {
          console.warn("[dm] threads 리스너 오류 — 이미 받은 목록 유지 후 재연결 예약", err);
          if (listenerErrorMayRecover(err)) scheduleSilentReconnect();
          return;
        }
        const code = String((err as { code?: string })?.code ?? "");
        if (code !== "permission-denied" && !code.endsWith("/permission-denied")) {
          console.warn("[dm] threads subscribe", err);
        }
        cancelSnapshotWatchdog();
        onErr?.(err);
      },
    );
    if (!stopped && !hadSuccess) scheduleSnapshotWatchdog();
  };

  /** 웜업이 끝난 뒤에만 onSnapshot 붙임 — 리스너가 prefetch/웜업보다 먼저 빈 목록을 덮는 레이스 제거 */
  void (async () => {
    for (let i = 0; i < warmMaxAttempts && !stopped; i++) {
      try {
        if (i > 0) {
          await getFirebaseAuth()
            .currentUser?.getIdToken(i < 3 ? false : true)
            .catch(() => {});
          const pauseMs = mobile ? 260 + i * 240 : 320 * i;
          await new Promise((r) => setTimeout(r, pauseMs));
        }
        const snap = await getDocs(q);
        if (stopped) return;
        if (applySnapshot(snap)) break;
      } catch (e) {
        if (stopped) return;
        if (!listenerErrorMayRecover(e)) break;
      }
    }
    if (!stopped && !hadSuccess) {
      try {
        await getFirebaseAuth().currentUser?.getIdToken(true).catch(() => {});
        const snap = await getDocsFromServer(q);
        if (!stopped) applySnapshot(snap);
      } catch (e) {
        if (!stopped) {
          console.warn("[dm] getDocsFromServer thread list fallback", e);
        }
      }
    }
    if (!stopped) attach();
  })();

  return () => {
    stopped = true;
    clearReconnect();
    cancelSnapshotWatchdog();
    unsub?.();
  };
}

/** DM 목록 화면 진입 등 — 리스너와 별도로 서버 우선 한 번 채워 느린 모바일·콜드 스타트를 줄임 */
export async function prefetchMyDmThreadsSnapshot(myUid: string): Promise<DmThreadDoc[]> {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid || uid !== myUid) return [];
  await getFirebaseAuth().authStateReady().catch(() => {});
  await getFirebaseAuth().currentUser?.getIdToken(true).catch(() => {});
  const q = query(
    threadsCol(),
    where("participantUids", "array-contains", uid),
    limit(48),
  );
  try {
    const snap = await getDocsFromServer(q);
    return snapshotToDmThreads(snap, 25);
  } catch (e) {
    try {
      const snap = await getDocs(q);
      return snapshotToDmThreads(snap, 25);
    } catch (e2) {
      if (isPermissionDenied(e2)) throw e2;
      return [];
    }
  }
}

/** 스레드에 내가 참가자인지(클라이언트 항상 확인) */
export async function verifyThreadParticipation(threadId: string): Promise<boolean> {
  const me = getFirebaseAuth().currentUser?.uid;
  if (!me || !userInDmThreadId(threadId, me)) return false;
  const s = await getDoc(doc(getFirestoreDb(), "dmThreads", threadId));
  if (!s.exists()) return false;
  const p = (s.data() as { participantUids?: string[] }).participantUids;
  return Array.isArray(p) && p.includes(me);
}

export function subscribeDmMessages(
  threadId: string,
  cb: (messages: DmMessageDoc[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();

  let unsub: Unsubscribe | null = null;
  let disposed = false;
  let authRetried = false;
  /** orderBy 에 실패하면(예: 과거 데이터에 createdAt 누락)·인덱스 일시 문제 시 폴백 */
  let plainFallback = false;

  const attach = () => {
    unsub?.();
    const col = collection(fs, "dmThreads", threadId, "messages");
    const q = plainFallback
      ? query(col, limit(100))
      : query(col, orderBy("createdAt", "desc"), limit(100));

    unsub = onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map((d) => ({ ...(d.data() as DmMessageDoc), id: d.id }));
        if (!plainFallback) rows.reverse();
        rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        cb(rows);
      },
      async (err) => {
        if (disposed) return;
        const code = String((err as { code?: string })?.code ?? "");
        if (
          !authRetried &&
          (code === "permission-denied" ||
            code.endsWith("/permission-denied") ||
            code === "unauthenticated" ||
            code.endsWith("/unauthenticated"))
        ) {
          authRetried = true;
          await getFirebaseAuth().currentUser?.getIdToken(true).catch(() => {});
          if (!disposed) attach();
          return;
        }
        if (!plainFallback && (code.includes("failed-precondition") || code.includes("index"))) {
          plainFallback = true;
          authRetried = false;
          if (!disposed) attach();
          return;
        }
        console.warn("[dm] messages subscribe", err);
        onErr?.(err);
      },
    );
  };

  attach();
  return () => {
    disposed = true;
    unsub?.();
  };
}

export async function sendDmMessage(threadId: string, rawText: string): Promise<void> {
  const me = requireUser();
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("메시지를 입력해 주세요.");
  if (trimmed.length > 4000) throw new Error("메시지가 너무 깁니다.");

  const fs = getFirestoreDb();
  const tref = doc(fs, "dmThreads", threadId);

  await withFirestoreMutationRetries(async () => {
    await ensureDmThreadDocReady(threadId);

    const msgColl = collection(fs, "dmThreads", threadId, "messages");
    const msgRef = doc(msgColl);
    const now = Date.now();
    const msgPayload = { senderUid: me, text: trimmed, createdAt: now };
    const threadPayload = {
      lastText: trimmed.slice(0, 280),
      lastSenderUid: me,
      updatedAt: now,
    };

    try {
      await runTransaction(fs, async (txn) => {
        const ts = await txn.get(tref);
        if (!ts.exists()) throw new Error("대화방을 불러오지 못했습니다.");
        const p = (ts.data() as { participantUids?: string[] }).participantUids;
        if (!Array.isArray(p) || !p.includes(me)) {
          throw new Error("이 대화에 참가할 수 없습니다.");
        }
        txn.set(msgRef, msgPayload);
        txn.update(tref, threadPayload);
      });
    } catch (txnErr) {
      const code = String((txnErr as { code?: string })?.code ?? "");
      const deny =
        code === "permission-denied" ||
        code.endsWith("/permission-denied") ||
        /insufficient permissions/i.test(firebaseErrText(txnErr));
      const ts = await getDoc(tref);
      if (!ts.exists()) throw txnErr;
      const p = (ts.data() as { participantUids?: string[] }).participantUids;
      if (!Array.isArray(p) || !p.includes(me)) throw txnErr;
      if (deny) throw txnErr;
      try {
        await setDoc(msgRef, msgPayload);
        await updateDoc(tref, threadPayload);
      } catch {
        throw txnErr;
      }
    }
  });

  try {
    await setDoc(
      dmReadDoc(me, threadId),
      { threadId, lastReadAt: Date.now() },
      { merge: true },
    );
  } catch (e) {
    console.warn("[dm] read state after send failed", e);
  }
}

/** 대화 목록 또는 방에서 읽음 시각 갱신 (상대에게는 unread 로 보이게 두고, 내 배지만 줄임) */
export async function markDmThreadReadForMe(threadId: string): Promise<void> {
  const me = getFirebaseAuth().currentUser?.uid;
  if (!me) return;
  try {
    await setDoc(
      dmReadDoc(me, threadId),
      {
        threadId,
        lastReadAt: Date.now(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn("[dm] mark read failed", e);
  }
}

/** 스레드에 내가 받은 메시지가 아직 안 읽은 상태인지 — lastRead 보다 상대방이 새로 보냈으면 unread */
export function isThreadUnreadForMe(
  thread: DmThreadDoc,
  myUid: string,
  lastReadAt: number | undefined,
): boolean {
  if (!thread.updatedAt || !thread.lastSenderUid) return false;
  if (thread.lastSenderUid === myUid) return false;
  return thread.updatedAt > (lastReadAt ?? 0);
}

export function otherParticipantUid(thread: DmThreadDoc, myUid: string): string | undefined {
  const [a, b] = thread.participantUids;
  return a === myUid ? b : b === myUid ? a : undefined;
}

export function dmPeerProfileLink(peerUid: string): string {
  return `/friends/${peerUid}`;
}

export function subscribeDmReadMap(
  myUid: string,
  cb: (readMap: Map<string, number>) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const col = collection(fs, "users", myUid, "dmReadState");
  return onSnapshot(
    col,
    (snap) => {
      const m = new Map<string, number>();
      snap.forEach((d) => {
        const t = d.data() as { lastReadAt?: number };
        m.set(d.id, t.lastReadAt ?? 0);
      });
      cb(m);
    },
    (err) => {
      console.warn("[dm] read state subscribe", err);
      onErr?.(err);
    },
  );
}

export function unreadDmThreadCount(
  threads: DmThreadDoc[],
  myUid: string,
  readMap: Map<string, number>,
): number {
  let n = 0;
  for (const t of threads) {
    if (isThreadUnreadForMe(t, myUid, readMap.get(t.id))) n += 1;
  }
  return n;
}

