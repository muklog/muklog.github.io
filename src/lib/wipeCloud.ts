/**
 * 본인의 Firestore 데이터 전부 삭제.
 *
 * 삭제 대상 (모두 보안 규칙상 본인이 직접 delete 가능):
 *   1) /users/{me}/** : meals(+서브컬렉션 likes/comments/comments/{cid}/likes),
 *      health, members, settings/public, settings/private 등 모든 하위 문서
 *   2) /publicProfiles/{me}
 *   3) /shares 중 ownerUid === me 또는 viewerUid === me
 *   4) /followRequests 중 fromUid === me 또는 toEmail === myEmail
 *   5) /friendInviteCodes 중 fromUid === me (내가 발급한 초대 토큰)
 *
 * Firestore 클라이언트 SDK 는 서브컬렉션을 자동으로 정리하지 않으므로 트리를
 * 명시적으로 순회한다. 일부 문서가 실패해도 나머지는 계속 시도(best-effort).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import { getFirestoreDb } from "./firebaseApp";

interface WipeReport {
  errors: { step: string; error: unknown }[];
  /** 통계 — 사용자에게 보여주거나 로그용 */
  counts: {
    meals: number;
    comments: number;
    likes: number;
    health: number;
    members: number;
    shares: number;
    followRequests: number;
    friendInviteCodes: number;
  };
}

async function safe<T>(step: string, fn: () => Promise<T>, report: WipeReport): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[wipeCloud] ${step} 실패`, error);
    report.errors.push({ step, error });
    return null;
  }
}

async function deleteAllInCollection(
  fs: ReturnType<typeof getFirestoreDb>,
  path: string[],
  report: WipeReport,
  step: string,
): Promise<number> {
  const colRef = collection(fs, path[0], ...path.slice(1));
  const snap = await safe(step, () => getDocs(colRef), report);
  if (!snap || snap.empty) return 0;
  // writeBatch 한도(500) 단위로 나눠서 commit.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(fs);
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await safe(`${step}.commit`, () => batch.commit(), report);
  }
  return docs.length;
}

export async function wipeMyCloudData(
  authUser: FirebaseUser,
): Promise<WipeReport> {
  const fs = getFirestoreDb();
  const uid = authUser.uid;
  const email = (authUser.email ?? "").trim().toLowerCase();
  const report: WipeReport = {
    errors: [],
    counts: {
      meals: 0,
      comments: 0,
      likes: 0,
      health: 0,
      members: 0,
      shares: 0,
      followRequests: 0,
      friendInviteCodes: 0,
    },
  };

  // ---- 1) meals (+서브컬렉션) ----
  const mealsSnap = await safe(
    "meals.list",
    () => getDocs(collection(fs, "users", uid, "meals")),
    report,
  );
  if (mealsSnap) {
    for (const m of mealsSnap.docs) {
      // 식단 좋아요
      report.counts.likes += await deleteAllInCollection(
        fs,
        ["users", uid, "meals", m.id, "likes"],
        report,
        `meals.${m.id}.likes`,
      );
      // 댓글들 (각 댓글 아래의 likes 도)
      const commentsSnap = await safe(
        `meals.${m.id}.comments.list`,
        () => getDocs(collection(fs, "users", uid, "meals", m.id, "comments")),
        report,
      );
      if (commentsSnap) {
        for (const c of commentsSnap.docs) {
          report.counts.likes += await deleteAllInCollection(
            fs,
            ["users", uid, "meals", m.id, "comments", c.id, "likes"],
            report,
            `meals.${m.id}.comments.${c.id}.likes`,
          );
          await safe(
            `meals.${m.id}.comments.${c.id}.delete`,
            () => deleteDoc(c.ref),
            report,
          );
          report.counts.comments += 1;
        }
      }
      await safe(`meals.${m.id}.delete`, () => deleteDoc(m.ref), report);
      report.counts.meals += 1;
    }
  }

  // ---- 2) health ----
  report.counts.health += await deleteAllInCollection(
    fs,
    ["users", uid, "health"],
    report,
    "health",
  );

  // ---- 3) members ----
  report.counts.members += await deleteAllInCollection(
    fs,
    ["users", uid, "members"],
    report,
    "members",
  );

  // ---- 4) settings public / private ----
  await safe(
    "settings.public.delete",
    () => deleteDoc(doc(fs, "users", uid, "settings", "public")),
    report,
  );
  await safe(
    "settings.private.delete",
    () => deleteDoc(doc(fs, "users", uid, "settings", "private")),
    report,
  );

  // ---- 5) publicProfiles/{uid} ----
  await safe(
    "publicProfile.delete",
    () => deleteDoc(doc(fs, "publicProfiles", uid)),
    report,
  );

  // ---- 6) shares (owner or viewer) ----
  const ownerSnap = await safe(
    "shares.owner.list",
    () =>
      getDocs(
        query(collection(fs, "shares"), where("ownerUid", "==", uid)),
      ),
    report,
  );
  const viewerSnap = await safe(
    "shares.viewer.list",
    () =>
      getDocs(
        query(collection(fs, "shares"), where("viewerUid", "==", uid)),
      ),
    report,
  );
  const shareDocs = [
    ...(ownerSnap?.docs ?? []),
    ...(viewerSnap?.docs ?? []),
  ];
  // ownerUid === viewerUid 인 자기참조 share 는 없지만, 안전하게 dedupe.
  const seen = new Set<string>();
  for (let i = 0; i < shareDocs.length; i += 400) {
    const batch = writeBatch(fs);
    let used = 0;
    shareDocs.slice(i, i + 400).forEach((d) => {
      if (seen.has(d.ref.path)) return;
      seen.add(d.ref.path);
      batch.delete(d.ref);
      used += 1;
    });
    if (used > 0) {
      await safe("shares.commit", () => batch.commit(), report);
      report.counts.shares += used;
    }
  }

  // ---- 7) followRequests (from or to) ----
  const fromSnap = await safe(
    "followReq.from.list",
    () =>
      getDocs(
        query(collection(fs, "followRequests"), where("fromUid", "==", uid)),
      ),
    report,
  );
  const toSnap = email
    ? await safe(
        "followReq.to.list",
        () =>
          getDocs(
            query(
              collection(fs, "followRequests"),
              where("toEmail", "==", email),
            ),
          ),
        report,
      )
    : null;
  const reqDocs = [
    ...(fromSnap?.docs ?? []),
    ...(toSnap?.docs ?? []),
  ];
  const seenReq = new Set<string>();
  for (let i = 0; i < reqDocs.length; i += 400) {
    const batch = writeBatch(fs);
    let used = 0;
    reqDocs.slice(i, i + 400).forEach((d) => {
      if (seenReq.has(d.ref.path)) return;
      seenReq.add(d.ref.path);
      batch.delete(d.ref);
      used += 1;
    });
    if (used > 0) {
      await safe("followReq.commit", () => batch.commit(), report);
      report.counts.followRequests += used;
    }
  }

  // ---- 8) friendInviteCodes (issued by me) ----
  const inviteSnap = await safe(
    "friendInviteCodes.from.list",
    () =>
      getDocs(
        query(
          collection(fs, "friendInviteCodes"),
          where("fromUid", "==", uid),
        ),
      ),
    report,
  );
  if (inviteSnap && !inviteSnap.empty) {
    const inviteDocs = inviteSnap.docs;
    for (let i = 0; i < inviteDocs.length; i += 400) {
      const batch = writeBatch(fs);
      inviteDocs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await safe("friendInviteCodes.commit", () => batch.commit(), report);
    }
    report.counts.friendInviteCodes = inviteDocs.length;
  }

  return report;
}
