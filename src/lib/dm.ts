import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import type { DmMessageDoc, DmThreadDoc } from "../types";
import { getFirebaseAuth, getFirestoreDb } from "./firebaseApp";
import { isCalendarConnectedPairFromServer } from "./friends";

function isPermissionDenied(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const raw = e instanceof Error ? e.message : String(e);
  return code === "permission-denied" || /insufficient permissions/i.test(raw);
}

/** DM 전송·스레드 생성 실패 시 사용자에게 보여 줄 메시지 */
function dmFirestoreUserMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const raw = e instanceof Error ? e.message : String(e);
  if (code === "permission-denied" || /insufficient permissions/i.test(raw)) {
    return "메시지를 저장하지 못했어요. 로그인을 확인하고 잠시 후 다시 시도해 주세요. 계속되면 로그아웃 후 다시 로그인해 보세요.";
  }
  if (code === "unavailable" || code === "unauthenticated") {
    return "연결 또는 로그인 상태를 확인해 주세요.";
  }
  if (code === "deadline-exceeded" || code === "resource-exhausted") {
    return "요청이 지연됐어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  return raw.length > 160 ? `${raw.slice(0, 158)}…` : raw;
}

/** threadId 규약: uid 문자열 순서 오름차순 [a,b] 일 때 `${a}_${b}` */
export function dmThreadIdForPair(uidA: string, uidB: string): string {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
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
 * array-contains + orderBy 복합 쿼리는 규칙 평가와 맞지 않아 전체가 permission-denied 되는 경우가 있어,
 * 단일 필터 쿼리 후 클라이언트에서 updatedAt 기준 정렬한다.
 */
export function subscribeMyDmThreads(
  myUid: string,
  cb: (threads: DmThreadDoc[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const authUid = getFirebaseAuth().currentUser?.uid;
  const uid = authUid && myUid === authUid ? myUid : authUid ?? "";
  if (!uid) {
    cb([]);
    return () => {};
  }

  const FETCH_LIMIT = 100;
  const DISPLAY_LIMIT = 40;

  const q = query(
    threadsCol(),
    where("participantUids", "array-contains", uid),
    limit(FETCH_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({
          ...(d.data() as Omit<DmThreadDoc, "id">),
          id: d.id,
        }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, DISPLAY_LIMIT);
      cb(rows);
    },
    (err) => {
      const code = (err as { code?: string })?.code;
      if (code !== "permission-denied") {
        console.warn("[dm] threads subscribe", err);
      }
      onErr?.(err);
    },
  );
}

/** 스레드에 내가 참가자인지(클라이언트 항상 확인) */
export async function verifyThreadParticipation(threadId: string): Promise<boolean> {
  const me = getFirebaseAuth().currentUser?.uid;
  if (!me) return false;
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
  const q = query(
    collection(fs, "dmThreads", threadId, "messages"),
    orderBy("createdAt", "asc"),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as DmMessageDoc), id: d.id }))),
    (err) => {
      console.warn("[dm] messages subscribe", err);
      onErr?.(err);
    },
  );
}

export async function sendDmMessage(threadId: string, rawText: string): Promise<void> {
  const me = requireUser();
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("메시지를 입력해 주세요.");
  if (trimmed.length > 4000) throw new Error("메시지가 너무 깁니다.");

  const fs = getFirestoreDb();
  const tref = doc(fs, "dmThreads", threadId);
  const threadSnap = await getDoc(tref);
  if (!threadSnap.exists()) throw new Error("대화방을 불러오지 못했습니다.");
  const p = (threadSnap.data() as { participantUids?: string[] }).participantUids;
  if (!Array.isArray(p) || p.length !== 2 || !p.includes(me)) {
    throw new Error("이 대화에 참가할 수 없습니다.");
  }

  const msgRef = doc(collection(fs, "dmThreads", threadId, "messages"));
  const now = Date.now();

  const runBatch = async () => {
    const batch = writeBatch(fs);
    batch.set(msgRef, { senderUid: me, text: trimmed, createdAt: now });
    batch.update(tref, {
      lastText: trimmed.slice(0, 280),
      lastSenderUid: me,
      updatedAt: now,
    });
    await batch.commit();
  };

  try {
    await runBatch();
  } catch (e) {
    if (isPermissionDenied(e)) {
      const auth = getFirebaseAuth();
      await auth.currentUser?.getIdToken(true);
      try {
        await runBatch();
      } catch (e2) {
        throw new Error(dmFirestoreUserMessage(e2));
      }
    } else {
      throw new Error(dmFirestoreUserMessage(e));
    }
  }

  try {
    await setDoc(dmReadDoc(me, threadId), { threadId, lastReadAt: now }, { merge: true });
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
