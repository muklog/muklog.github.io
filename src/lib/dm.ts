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
import { isCalendarConnectedPair } from "./friends";

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
    const linked = await isCalendarConnectedPair(me, peerUid);
    if (!linked) {
      throw new Error("서로 친구로 연결된 경우에만 DM을 보낼 수 있어요.");
    }
    const now = Date.now();
    const p = participantsTuple(me, peerUid);
    await setDoc(ref, {
      participantUids: p,
      lastText: "",
      lastSenderUid: "",
      updatedAt: now,
      createdAt: now,
    });
  }
  return tid;
}

export function subscribeMyDmThreads(
  myUid: string,
  cb: (threads: DmThreadDoc[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const q = query(
    threadsCol(),
    where("participantUids", "array-contains", myUid),
    orderBy("updatedAt", "desc"),
    limit(40),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({
        ...(d.data() as Omit<DmThreadDoc, "id">),
        id: d.id,
      }));
      cb(rows);
    },
    (err) => {
      console.warn("[dm] threads subscribe", err);
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
  const linked = await isCalendarConnectedPair(p[0], p[1]);
  if (!linked) throw new Error("달력 공유가 끊겨 새 DM을 보낼 수 없어요.");

  const msgRef = doc(collection(fs, "dmThreads", threadId, "messages"));
  const now = Date.now();
  const batch = writeBatch(fs);
  batch.set(msgRef, { senderUid: me, text: trimmed, createdAt: now });
  batch.update(tref, {
    lastText: trimmed.slice(0, 280),
    lastSenderUid: me,
    updatedAt: now,
  });
  batch.set(dmReadDoc(me, threadId), { threadId, lastReadAt: now }, { merge: true });
  await batch.commit();
}

/** 대화 목록 또는 방에서 읽음 시각 갱신 (상대에게는 unread 로 보이게 두고, 내 배지만 줄임) */
export async function markDmThreadReadForMe(threadId: string): Promise<void> {
  const me = getFirebaseAuth().currentUser?.uid;
  if (!me) return;
  await setDoc(
    dmReadDoc(me, threadId),
    {
      threadId,
      lastReadAt: Date.now(),
    },
    { merge: true },
  );
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
