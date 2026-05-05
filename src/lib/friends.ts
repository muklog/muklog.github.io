import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import type {
  FollowRequest,
  HealthRecord,
  Meal,
  PublicProfile,
  Share,
  ShareScope,
} from "../types";
import { getFirebaseAuth, getFirestoreDb } from "./firebaseApp";
import {
  storedToHealth,
  storedToMeal,
  type HealthStored,
  type MealStored,
} from "./cloudSync";

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 팔로우 신청 대상은 Gmail 만 허용합니다.
 * (앱 자체가 Google Sign-In 만 지원하는데, 비-Gmail 도메인은 가입하지 못하므로
 *  팔로우를 신청해 두어도 끝내 수락될 수 없습니다 → 입력 단계에서 차단)
 */
export function isGmailAddress(email: string): boolean {
  // 단순 endsWith 가 아니라 "@gmail.com" 한 번만 등장하는지까지 확인.
  const e = normalizeEmail(email);
  return /^[^\s@]+@gmail\.com$/.test(e);
}

/** owner-viewer 한 방향당 한 문서 — `${ownerUid}_${viewerUid}`. */
export function shareIdFor(ownerUid: string, viewerUid: string): string {
  return `${ownerUid}_${viewerUid}`;
}

function requireUser(): FirebaseUser {
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) throw new Error("Google 로그인이 필요합니다.");
  return u;
}

function requireEmail(u: FirebaseUser): string {
  const e = u.email;
  if (!e) throw new Error("Google 계정에 이메일이 없습니다.");
  return normalizeEmail(e);
}

function isEmptyScope(s: ShareScope): boolean {
  return !s.calendar && !s.health;
}

// ---- 공개 프로필 --------------------------------------------------------

/** 로그인한 사용자의 공개 프로필을 Firestore 에 upsert (친구가 이름·이메일을 볼 수 있도록) */
export async function upsertMyPublicProfile(u: FirebaseUser): Promise<void> {
  const fs = getFirestoreDb();
  const email = requireEmail(u);
  const data: PublicProfile = {
    uid: u.uid,
    email,
    displayName: u.displayName ?? email,
    photoURL: u.photoURL ?? undefined,
    updatedAt: Date.now(),
  };
  const clean: Record<string, unknown> = { ...data };
  if (clean.photoURL === undefined) delete clean.photoURL;
  await setDoc(doc(fs, "publicProfiles", u.uid), clean, { merge: true });
}

export async function getPublicProfile(uid: string): Promise<PublicProfile | null> {
  const fs = getFirestoreDb();
  const snap = await getDoc(doc(fs, "publicProfiles", uid));
  if (!snap.exists()) return null;
  return snap.data() as PublicProfile;
}

// ---- follow 신청 --------------------------------------------------------

export async function sendFollowRequest(
  toEmailRaw: string,
  requestedScope: ShareScope,
): Promise<FollowRequest> {
  const me = requireUser();
  const myEmail = requireEmail(me);
  const toEmail = normalizeEmail(toEmailRaw);
  if (!toEmail) throw new Error("이메일을 입력해 주세요.");
  if (!isGmailAddress(toEmail))
    throw new Error("Gmail 주소(@gmail.com)만 신청할 수 있어요.");
  if (toEmail === myEmail) throw new Error("본인에게는 신청할 수 없어요.");
  if (isEmptyScope(requestedScope))
    throw new Error("보고 싶은 범위를 하나 이상 선택해 주세요.");

  const fs = getFirestoreDb();

  // 같은 대상에게 pending 신청이 이미 있으면 재사용 (인스타에서도 follow 신청은 한 번만 가능)
  const existingSnap = await getDocs(
    query(
      collection(fs, "followRequests"),
      where("fromUid", "==", me.uid),
      where("toEmail", "==", toEmail),
      where("status", "==", "pending"),
    ),
  );
  if (!existingSnap.empty) {
    const d = existingSnap.docs[0];
    return { ...(d.data() as FollowRequest), id: d.id };
  }

  const id = doc(collection(fs, "followRequests")).id;
  const now = Date.now();
  const data: FollowRequest = {
    id,
    fromUid: me.uid,
    fromEmail: myEmail,
    fromName: me.displayName ?? myEmail,
    fromPhotoURL: me.photoURL ?? undefined,
    toEmail,
    requestedScope,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  const clean: Record<string, unknown> = { ...data };
  if (clean.fromPhotoURL === undefined) delete clean.fromPhotoURL;
  await setDoc(doc(fs, "followRequests", id), clean);
  return data;
}

export async function cancelFollowRequest(reqId: string): Promise<void> {
  const fs = getFirestoreDb();
  await deleteDoc(doc(fs, "followRequests", reqId));
}

export async function rejectFollowRequest(reqId: string): Promise<void> {
  const fs = getFirestoreDb();
  await updateDoc(doc(fs, "followRequests", reqId), {
    status: "rejected",
    updatedAt: Date.now(),
  });
}

/**
 * 수락 — 수신자(=수락자)가 owner 인 share 문서를 만들고 요청 상태를 갱신.
 * finalScope: 수락자가 실제로 공개할 범위 (요청대로 또는 조정).
 */
export async function acceptFollowRequest(
  reqId: string,
  finalScope: ShareScope,
): Promise<Share> {
  const me = requireUser();
  const myEmail = requireEmail(me);
  if (isEmptyScope(finalScope))
    throw new Error("공개할 범위를 하나 이상 선택해 주세요.");

  const fs = getFirestoreDb();
  const reqRef = doc(fs, "followRequests", reqId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("이미 사라진 팔로우 신청이에요.");
  const req = reqSnap.data() as FollowRequest;
  if (req.toEmail !== myEmail) throw new Error("내 계정으로 온 신청이 아니에요.");
  if (req.status !== "pending") throw new Error("이미 처리된 신청이에요.");
  if (req.fromUid === me.uid) throw new Error("본인 신청은 수락할 수 없어요.");

  const sid = shareIdFor(me.uid, req.fromUid);
  const now = Date.now();
  const share: Share = {
    id: sid,
    ownerUid: me.uid,
    viewerUid: req.fromUid,
    scope: finalScope,
    ownerEmail: myEmail,
    ownerName: me.displayName ?? myEmail,
    ownerPhotoURL: me.photoURL ?? undefined,
    viewerEmail: req.fromEmail,
    viewerName: req.fromName,
    viewerPhotoURL: req.fromPhotoURL,
    createdAt: now,
    updatedAt: now,
  };
  const clean: Record<string, unknown> = { ...share };
  if (clean.ownerPhotoURL === undefined) delete clean.ownerPhotoURL;
  if (clean.viewerPhotoURL === undefined) delete clean.viewerPhotoURL;

  const batch = writeBatch(fs);
  batch.update(reqRef, {
    status: "accepted",
    toUid: me.uid,
    updatedAt: now,
  });
  batch.set(doc(fs, "shares", sid), clean);
  await batch.commit();

  return share;
}

// ---- 실시간 구독 --------------------------------------------------------
// Firestore 는 서로 다른 필드의 equality 여러 개를 한 쿼리에 섞거나,
// array-contains + orderBy 를 같이 쓰면 복합 인덱스를 요구합니다.
// 인덱스 강제 생성을 피하기 위해 where 는 하나만 쓰고 정렬·필터는 클라이언트에서 처리.

function subscribeRequests(
  cons: QueryConstraint[],
  filter: (r: FollowRequest) => boolean,
  cb: (rows: FollowRequest[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const q = query(collection(fs, "followRequests"), ...cons);
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ ...(d.data() as FollowRequest), id: d.id }))
        .filter(filter)
        .sort((a, b) => b.createdAt - a.createdAt);
      cb(rows);
    },
    (err) => {
      console.error("[friends] requests subscribe", err);
      onErr?.(err);
    },
  );
}

export function subscribeIncomingRequests(
  cb: (rows: FollowRequest[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const u = requireUser();
  const email = requireEmail(u);
  return subscribeRequests(
    [where("toEmail", "==", email)],
    (r) => r.status === "pending",
    cb,
    onErr,
  );
}

export function subscribeOutgoingRequests(
  cb: (rows: FollowRequest[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const u = requireUser();
  return subscribeRequests(
    [where("fromUid", "==", u.uid)],
    (r) => r.status === "pending",
    cb,
    onErr,
  );
}

function subscribeShares(
  cons: QueryConstraint[],
  cb: (rows: Share[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const q = query(collection(fs, "shares"), ...cons);
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ ...(d.data() as Share), id: d.id }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      cb(rows);
    },
    (err) => {
      console.error("[friends] shares subscribe", err);
      onErr?.(err);
    },
  );
}

/** 내가 팔로우 중인 사람들 (= 내가 viewer 인 share). */
export function subscribeOutgoingShares(
  cb: (rows: Share[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const u = requireUser();
  return subscribeShares([where("viewerUid", "==", u.uid)], cb, onErr);
}

/** 나를 팔로우 중인 사람들 (= 내가 owner 인 share). */
export function subscribeIncomingShares(
  cb: (rows: Share[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const u = requireUser();
  return subscribeShares([where("ownerUid", "==", u.uid)], cb, onErr);
}

// ---- share 변경 / 삭제 --------------------------------------------------

/** 내가 owner 인 share 의 공개 범위 변경. viewer 는 내 share 를 직접 변경할 수 없습니다. */
export async function updateOutgoingScope(
  viewerUid: string,
  newScope: ShareScope,
): Promise<void> {
  const u = requireUser();
  if (isEmptyScope(newScope))
    throw new Error("공개할 범위를 하나 이상 선택해 주세요.");
  const fs = getFirestoreDb();
  const sid = shareIdFor(u.uid, viewerUid);
  await updateDoc(doc(fs, "shares", sid), {
    scope: newScope,
    updatedAt: Date.now(),
  });
}

/** owner 또는 viewer 가 share 를 끊습니다 (인스타 unfollow / 팔로워 삭제 양쪽 가능). */
export async function removeShare(shareId: string): Promise<void> {
  const fs = getFirestoreDb();
  await deleteDoc(doc(fs, "shares", shareId));
}

/** 특정 owner 의 내(viewer) share 한 건을 직접 가져옵니다. (FriendProfilePage 등에서 권한 확인용) */
export async function getMyViewerShare(ownerUid: string): Promise<Share | null> {
  const me = requireUser();
  const fs = getFirestoreDb();
  const snap = await getDoc(doc(fs, "shares", shareIdFor(ownerUid, me.uid)));
  if (!snap.exists()) return null;
  return { ...(snap.data() as Share), id: snap.id };
}

// ---- 친구 데이터 읽기 (로컬 캐시 없음) -----------------------------------

/** 친구의 특정 날짜 구간 식사 기록. 월 단위 등으로 호출하는 것을 권장. */
export async function pullFriendMealsInRange(
  ownerUid: string,
  startDateKey: string,
  endDateKey: string,
): Promise<Meal[]> {
  const fs = getFirestoreDb();
  const q = query(
    collection(fs, "users", ownerUid, "meals"),
    where("date", ">=", startDateKey),
    where("date", "<=", endDateKey),
  );
  const snap = await getDocs(q);
  const rows = await Promise.all(
    snap.docs.map(async (d) =>
      storedToMeal({ ...(d.data() as MealStored), id: d.id }),
    ),
  );
  return rows;
}

export async function pullFriendMealsForDate(
  ownerUid: string,
  dateKey: string,
): Promise<Meal[]> {
  return pullFriendMealsInRange(ownerUid, dateKey, dateKey);
}

export async function pullFriendHealth(
  ownerUid: string,
): Promise<HealthRecord[]> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", ownerUid, "health"));
  const rows = await Promise.all(
    snap.docs.map(async (d) =>
      storedToHealth({ ...(d.data() as HealthStored), id: d.id }),
    ),
  );
  rows.sort((a, b) => {
    const d = b.recordDate.localeCompare(a.recordDate);
    if (d !== 0) return d;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  return rows;
}

// ---- 친구 데이터 실시간 구독 ---------------------------------------------
// 친구 기기에서 AI 분석이 완료돼 Firestore 가 갱신될 때 내 화면도 곧바로
// 반영되도록 onSnapshot 으로 구독한다. getDocs 일회성 호출만 쓰면
// "analyzing" 상태 그대로 멈춰 있는 문제가 발생한다.
//
// base64 사진을 Blob 으로 디코딩하는 작업이 비싸므로, 문서별 updatedAt 이
// 이전과 같으면 기존에 만들어 둔 Meal/HealthRecord 를 재사용한다.

/** 친구 meals 를 date 범위로 실시간 구독 */
export function subscribeFriendMealsInRange(
  ownerUid: string,
  startDateKey: string,
  endDateKey: string,
  cb: (rows: Meal[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const q = query(
    collection(fs, "users", ownerUid, "meals"),
    where("date", ">=", startDateKey),
    where("date", "<=", endDateKey),
  );
  const cache = new Map<string, { updatedAt: number; meal: Meal }>();
  return onSnapshot(
    q,
    async (snap) => {
      try {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const data = { ...(d.data() as MealStored), id: d.id };
            const cached = cache.get(d.id);
            if (cached && cached.updatedAt === data.updatedAt) {
              return cached.meal;
            }
            const meal = await storedToMeal(data);
            cache.set(d.id, { updatedAt: data.updatedAt, meal });
            return meal;
          }),
        );
        const alive = new Set(snap.docs.map((d) => d.id));
        for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
        cb(rows);
      } catch (e) {
        console.error("[friends] meals snapshot decode", e);
        onErr?.(e);
      }
    },
    (err) => {
      console.error("[friends] meals subscribe", err);
      onErr?.(err);
    },
  );
}

/** 친구 meals 단일 일자 실시간 구독 */
export function subscribeFriendMealsForDate(
  ownerUid: string,
  dateKey: string,
  cb: (rows: Meal[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  return subscribeFriendMealsInRange(ownerUid, dateKey, dateKey, cb, onErr);
}

/** 친구 health 전체 실시간 구독 */
export function subscribeFriendHealth(
  ownerUid: string,
  cb: (rows: HealthRecord[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const cache = new Map<string, { updatedAt: number; rec: HealthRecord }>();
  return onSnapshot(
    collection(fs, "users", ownerUid, "health"),
    async (snap) => {
      try {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const data = { ...(d.data() as HealthStored), id: d.id };
            const cached = cache.get(d.id);
            if (cached && cached.updatedAt === data.updatedAt) {
              return cached.rec;
            }
            const rec = await storedToHealth(data);
            cache.set(d.id, { updatedAt: data.updatedAt, rec });
            return rec;
          }),
        );
        const alive = new Set(snap.docs.map((d) => d.id));
        for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
        rows.sort((a, b) => {
          const d = b.recordDate.localeCompare(a.recordDate);
          if (d !== 0) return d;
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        });
        cb(rows);
      } catch (e) {
        console.error("[friends] health snapshot decode", e);
        onErr?.(e);
      }
    },
    (err) => {
      console.error("[friends] health subscribe", err);
      onErr?.(err);
    },
  );
}

// ---- 편의 함수 ----------------------------------------------------------

export function permissionDeniedMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === "permission-denied" || /insufficient permissions/i.test(msg)) {
    return "공유가 해제되었거나 권한이 없어요.";
  }
  return msg;
}
