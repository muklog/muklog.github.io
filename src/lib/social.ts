import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import type { MealComment } from "../types";
import { getFirebaseAuth, getFirestoreDb } from "./firebaseApp";

interface AuthorRef {
  uid: string;
  name: string;
  photoURL?: string;
}

function requireAuthor(): AuthorRef {
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) throw new Error("Google 로그인이 필요합니다.");
  return {
    uid: u.uid,
    name: u.displayName ?? u.email ?? "익명",
    photoURL: u.photoURL ?? undefined,
  };
}

// ---- likes -------------------------------------------------------------
//
// 한 사용자당 한 likes 문서. id == viewerUid 라 unique 가 보장됨.
// 좋아요 수는 컬렉션 사이즈로 계산 (베타 규모이므로 충분).

function likesCol(ownerUid: string, mealId: string) {
  const fs = getFirestoreDb();
  return collection(fs, "users", ownerUid, "meals", mealId, "likes");
}

function commentsCol(ownerUid: string, mealId: string) {
  const fs = getFirestoreDb();
  return collection(fs, "users", ownerUid, "meals", mealId, "comments");
}

function commentLikesCol(ownerUid: string, mealId: string, commentId: string) {
  const fs = getFirestoreDb();
  return collection(
    fs,
    "users",
    ownerUid,
    "meals",
    mealId,
    "comments",
    commentId,
    "likes",
  );
}

/** 식단의 좋아요 누른 uid 목록을 실시간 구독. */
export function subscribeLikes(
  ownerUid: string,
  mealId: string,
  cb: (likedUids: string[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(likesCol(ownerUid, mealId)),
    (snap) => cb(snap.docs.map((d) => d.id)),
    (err) => {
      console.warn("[social] likes subscribe", err);
      onErr?.(err);
    },
  );
}

export async function setMyLike(
  ownerUid: string,
  mealId: string,
  liked: boolean,
): Promise<void> {
  const me = requireAuthor();
  const ref = doc(likesCol(ownerUid, mealId), me.uid);
  if (liked) {
    await setDoc(ref, { viewerUid: me.uid, createdAt: Date.now() });
  } else {
    await deleteDoc(ref);
  }
}

// ---- comments ----------------------------------------------------------

export function subscribeComments(
  ownerUid: string,
  mealId: string,
  cb: (rows: MealComment[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  // orderBy 를 별도 인덱스 없이 바로 쓰려면 단일 필드만 쓰는 게 안전.
  // createdAt 단일 필드는 자동 인덱스 대상.
  return onSnapshot(
    query(commentsCol(ownerUid, mealId)),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ ...(d.data() as MealComment), id: d.id }))
        .sort((a, b) => a.createdAt - b.createdAt);
      cb(rows);
    },
    (err) => {
      console.warn("[social] comments subscribe", err);
      onErr?.(err);
    },
  );
}

export async function addComment(
  ownerUid: string,
  mealId: string,
  text: string,
  parentCommentId?: string,
): Promise<MealComment> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("댓글을 입력해 주세요.");
  if (trimmed.length > 1000) throw new Error("댓글은 1000자 이내로 작성해 주세요.");
  const me = requireAuthor();
  const id = doc(commentsCol(ownerUid, mealId)).id;
  const now = Date.now();
  const data: MealComment = {
    id,
    ownerUid,
    mealId,
    authorUid: me.uid,
    authorName: me.name,
    authorPhotoURL: me.photoURL,
    text: trimmed,
    parentCommentId,
    createdAt: now,
    updatedAt: now,
  };
  const clean: Record<string, unknown> = { ...data };
  if (clean.authorPhotoURL === undefined) delete clean.authorPhotoURL;
  if (clean.parentCommentId === undefined) delete clean.parentCommentId;
  await setDoc(doc(commentsCol(ownerUid, mealId), id), clean);
  return data;
}

export async function editComment(
  ownerUid: string,
  mealId: string,
  commentId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("댓글을 입력해 주세요.");
  if (trimmed.length > 1000) throw new Error("댓글은 1000자 이내로 작성해 주세요.");
  await updateDoc(doc(commentsCol(ownerUid, mealId), commentId), {
    text: trimmed,
    updatedAt: Date.now(),
  });
}

export async function deleteComment(
  ownerUid: string,
  mealId: string,
  commentId: string,
): Promise<void> {
  // 대댓글/좋아요가 붙어 있으면 best-effort 로 같이 정리한다.
  // (Firestore 클라이언트 SDK 는 서브컬렉션을 자동 정리하지 않음)
  await Promise.allSettled([
    bestEffortDeleteCollection(commentLikesCol(ownerUid, mealId, commentId)),
  ]);
  await deleteDoc(doc(commentsCol(ownerUid, mealId), commentId));
}

// ---- 댓글 좋아요 + 대댓글 -------------------------------------------------

/** 특정 댓글의 좋아요를 누른 viewerUid 목록을 실시간 구독. */
export function subscribeCommentLikes(
  ownerUid: string,
  mealId: string,
  commentId: string,
  cb: (likedUids: string[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(commentLikesCol(ownerUid, mealId, commentId)),
    (snap) => cb(snap.docs.map((d) => d.id)),
    (err) => {
      console.warn("[social] comment likes subscribe", err);
      onErr?.(err);
    },
  );
}

export async function setMyCommentLike(
  ownerUid: string,
  mealId: string,
  commentId: string,
  liked: boolean,
): Promise<void> {
  const me = requireAuthor();
  const ref = doc(commentLikesCol(ownerUid, mealId, commentId), me.uid);
  if (liked) {
    await setDoc(ref, { viewerUid: me.uid, createdAt: Date.now() });
  } else {
    await deleteDoc(ref);
  }
}

// ---- meal 삭제 시 정리 -------------------------------------------------
//
// Firestore 클라이언트 SDK 는 부모 문서를 지워도 서브컬렉션을 자동으로 비우지
// 않아 likes / comments 가 고아로 남는다. 식단 소유자가 삭제할 때 best-effort
// 로 같이 청소한다(권한이 부족하거나 일부 실패해도 부모 삭제 흐름은 막지 않음).
//
// 베타 규모(슬롯당 좋아요·댓글 ≪ 100개) 라 클라이언트 일괄 삭제로 충분.

async function bestEffortDeleteCollection(colRef: ReturnType<typeof collection>) {
  try {
    const snap = await getDocs(colRef);
    await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (e) {
    console.warn("[social] cleanup failed", e);
  }
}

/** 식단 본인 삭제 시 호출 — 좋아요·댓글(및 그 하위 좋아요) 서브컬렉션을 같이 비웁니다. */
export async function cleanupMealSocial(
  ownerUid: string,
  mealId: string,
): Promise<void> {
  // 댓글 각 문서의 likes 서브컬렉션까지 지워야 해서 먼저 댓글을 훑는다.
  try {
    const snap = await getDocs(commentsCol(ownerUid, mealId));
    await Promise.allSettled(
      snap.docs.map((d) =>
        bestEffortDeleteCollection(commentLikesCol(ownerUid, mealId, d.id)),
      ),
    );
  } catch (e) {
    console.warn("[social] cleanup comments likes", e);
  }
  await Promise.allSettled([
    bestEffortDeleteCollection(likesCol(ownerUid, mealId)),
    bestEffortDeleteCollection(commentsCol(ownerUid, mealId)),
  ]);
}
