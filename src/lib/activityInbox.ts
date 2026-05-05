import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import type { ActivityInboxDoc, ActivityInboxKind } from "../types";
import { getFirestoreDb } from "./firebaseApp";

function inboxCol(recipientUid: string) {
  return collection(getFirestoreDb(), "users", recipientUid, "activityInbox");
}

export type ActivityInboxWrite = Omit<ActivityInboxDoc, "id" | "read">;

/**
 * 식단 소유자·댓글 작성자 등 수신자에게 활동 알림을 남깁니다.
 * — recipientUid 가 actor 와 같으면 noop (규칙도 create 금지).
 */
export async function pushActivityInboxItem(
  recipientUid: string,
  partial: Omit<ActivityInboxWrite, "recipientUid" | "createdAt">,
): Promise<void> {
  if (!recipientUid || recipientUid === partial.actorUid) return;
  const fs = getFirestoreDb();
  const now = Date.now();
  const body: Record<string, unknown> = {
    recipientUid,
    kind: partial.kind,
    actorUid: partial.actorUid,
    actorName: partial.actorName,
    mealOwnerUid: partial.mealOwnerUid,
    mealId: partial.mealId,
    mealDate: partial.mealDate,
    mealSlot: partial.mealSlot,
    createdAt: now,
    read: false,
  };
  if (partial.actorPhotoURL) body.actorPhotoURL = partial.actorPhotoURL;
  if (partial.commentId) body.commentId = partial.commentId;
  if (partial.snippet) body.snippet = partial.snippet;
  await addDoc(collection(fs, "users", recipientUid, "activityInbox"), body);
}

export function subscribeActivityInbox(
  recipientUid: string,
  cb: (rows: ActivityInboxDoc[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const q = query(inboxCol(recipientUid), orderBy("createdAt", "desc"), limit(80));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ ...(d.data() as ActivityInboxDoc), id: d.id }));
      cb(rows);
    },
    (err) => {
      console.warn("[activityInbox] subscribe", err);
      onErr?.(err);
    },
  );
}

export async function markActivityItemRead(recipientUid: string, itemId: string): Promise<void> {
  await updateDoc(doc(getFirestoreDb(), "users", recipientUid, "activityInbox", itemId), {
    read: true,
  });
}

export async function markAllActivityRead(recipientUid: string, unreadIds: string[]): Promise<void> {
  if (unreadIds.length === 0) return;
  const fs = getFirestoreDb();
  const batch = writeBatch(fs);
  for (const id of unreadIds) {
    batch.update(doc(fs, "users", recipientUid, "activityInbox", id), { read: true });
  }
  await batch.commit();
}

export function unreadActivityCount(rows: ActivityInboxDoc[]): number {
  return rows.filter((x) => !x.read).length;
}

/** 알림 카드 라벨 */
export function activityKindLabel(kind: ActivityInboxKind): string {
  switch (kind) {
    case "meal_like":
      return "내 식단에 좋아요";
    case "meal_comment":
      return "내 식단에 댓글";
    case "comment_like":
      return "내 댓글에 좋아요";
    case "comment_reply":
      return "내 댓글에 답글";
    default:
      return "알림";
  }
}
