import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type SnapshotMetadata,
  type Unsubscribe,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import type {
  FollowRequest,
  FriendInviteCode,
  Meal,
  PublicProfile,
  Share,
  ShareScope,
  User,
} from "../types";
import { getFirebaseAuth, getFirestoreDb } from "./firebaseApp";
import { storedToMeal, type MealStored } from "./cloudSync";
import { resolveDisplayName, resolveDisplayPhotoURL } from "./identity";

/** Firestore 쓰기가 네트워크 때문에 끝없이 대기할 때 사용자에게 타임아웃 안내 */
function withFirestoreDeadline<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMsg: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(timeoutMsg)), ms);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

/** 초대 문서에는 짧은 http(s) 프로필만 — base64 등은 문서 과대·저장 지연을 유발 */
function sanitizeInviteProfilePhoto(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const u = raw.trim();
  if (u.length === 0 || u.length > 2048) return undefined;
  if (u.startsWith("data:") || u.startsWith("blob:")) return undefined;
  if (u.startsWith("https://") || u.startsWith("http://")) return u;
  return undefined;
}

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

/** shares 문서 기준으로 한쪽이라도 DM 가능한지(명시적 calendar:false 제외, scope 없으면 허용·규칙과 동일). */
export function shareDocAllowsDmConnection(share: Share): boolean {
  if (share.scope == null) return true;
  return share.scope.calendar !== false;
}

/**
 * 한쪽이라도 shares 가 있고 dm 연결이 허용되면 true.
 * 규칙의 dmCalendarConnected 과 맞춘다.
 */
export async function isCalendarConnectedPair(uidA: string, uidB: string): Promise<boolean> {
  if (!uidA || !uidB || uidA === uidB) return false;
  const fs = getFirestoreDb();
  const refs = [
    doc(fs, "shares", shareIdFor(uidA, uidB)),
    doc(fs, "shares", shareIdFor(uidB, uidA)),
  ];
  for (const ref of refs) {
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const sh = { id: snap.id, ...snap.data() } as Share;
    if (shareDocAllowsDmConnection(sh)) return true;
  }
  return false;
}

/**
 * DM 전송 등 서버 규칙과 맞출 때 사용 — 로컬 캐시만 보면 허용인데 Firestore 가 거절하는 불일치를 줄임.
 * 오프라인 등으로 서버 조회 실패 시 일반 getDoc 으로 한 번 더 시도한다.
 */
export async function isCalendarConnectedPairFromServer(uidA: string, uidB: string): Promise<boolean> {
  if (!uidA || !uidB || uidA === uidB) return false;
  const fs = getFirestoreDb();
  const refs = [
    doc(fs, "shares", shareIdFor(uidA, uidB)),
    doc(fs, "shares", shareIdFor(uidB, uidA)),
  ];
  for (const ref of refs) {
    let snap;
    try {
      snap = await getDocFromServer(ref);
    } catch {
      snap = await getDoc(ref);
    }
    if (!snap.exists()) continue;
    const sh = { id: snap.id, ...snap.data() } as Share;
    if (shareDocAllowsDmConnection(sh)) return true;
  }
  return false;
}

/** 나↔peer 사이 share 를 조회. 상대 식단 보기 = incoming(owner=peer). 프로필/DM 표시용 */
export async function getFriendConnection(peerUid: string): Promise<{
  displayName: string;
  photoURL?: string;
  incoming: Share | null;
  outgoing: Share | null;
  canViewFriendCalendar: boolean;
} | null> {
  const me = requireUser();
  if (!peerUid || peerUid === me.uid) return null;
  const fs = getFirestoreDb();

  const incSnap = await getDoc(doc(fs, "shares", shareIdFor(peerUid, me.uid)));
  const outSnap = await getDoc(doc(fs, "shares", shareIdFor(me.uid, peerUid)));
  const incoming = incSnap.exists()
    ? ({ id: incSnap.id, ...incSnap.data() } as Share)
    : null;
  const outgoing = outSnap.exists()
    ? ({ id: outSnap.id, ...outSnap.data() } as Share)
    : null;

  const incOk = !!(incoming && shareDocAllowsDmConnection(incoming));
  const outOk = !!(outgoing && shareDocAllowsDmConnection(outgoing));

  if (!incOk && !outOk) return null;

  let displayName = "친구";
  let photoURL: string | undefined;
  if (incOk && incoming) {
    displayName = incoming.ownerName || displayName;
    photoURL = incoming.ownerPhotoURL ?? undefined;
  } else if (outOk && outgoing) {
    displayName = outgoing.viewerName || displayName;
    photoURL = outgoing.viewerPhotoURL ?? undefined;
  }

  const pub = await getPublicProfile(peerUid);
  const pubName = pub?.displayName?.trim();
  if (pubName) displayName = pubName;
  const pubPhoto = pub?.photoURL?.trim();
  if (pubPhoto) photoURL = pubPhoto;

  const canViewFriendCalendar = !!(
    incOk &&
    incoming &&
    incoming.scope?.calendar === true
  );

  return {
    displayName,
    photoURL,
    incoming: incOk ? incoming : null,
    outgoing: outOk ? outgoing : null,
    canViewFriendCalendar,
  };
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

/**
 * 로그인한 사용자의 공개 프로필을 Firestore 에 upsert.
 *
 * Dexie 의 localUser 가 주어지면 그 안의 닉네임/아바타(업로드/preset)를 우선
 * 사용한다. 주어지지 않으면 기본값은 Firebase auth 의 displayName/photoURL.
 */
export async function upsertMyPublicProfile(
  u: FirebaseUser,
  localUser?: User | null,
): Promise<void> {
  const fs = getFirestoreDb();
  const email = requireEmail(u);
  const name = resolveDisplayName(localUser, u) || email;
  const photoURL = resolveDisplayPhotoURL(localUser, u.photoURL);
  const data: PublicProfile = {
    uid: u.uid,
    email,
    displayName: name,
    photoURL,
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

/** 친구 목록 등 — 여러 uid 의 publicProfiles 를 실시간 구독 */
export function subscribePublicProfilesForUids(
  uids: string[],
  onNext: (map: Map<string, PublicProfile | null>) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const uniq = [...new Set(uids.filter(Boolean))];
  if (uniq.length === 0) {
    onNext(new Map());
    return () => {};
  }

  const map = new Map<string, PublicProfile | null>();
  for (const id of uniq) map.set(id, null);

  let scheduled = false;
  function emit() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      onNext(new Map(map));
    });
  }

  const unsubs = uniq.map((uid) =>
    onSnapshot(
      doc(fs, "publicProfiles", uid),
      (snap) => {
        map.set(uid, snap.exists() ? (snap.data() as PublicProfile) : null);
        emit();
      },
      () => {
        map.set(uid, null);
        emit();
      },
    ),
  );

  emit();
  return () => {
    for (const u of unsubs) u();
  };
}

/** DM·목록에서 보여 줄 상대 표시 정보 — 공개 프로필에 닉네임이 있으면 그걸 우선(앱 설정과 동일) */
export type PeerDmIdentity = { displayName: string; photoURL?: string };

function pickLatestPeerIdentityFromSharesOnly(
  peerUid: string,
  shares: Array<Share | null>,
): PeerDmIdentity {
  type Cand = { name: string; photo?: string; at: number };
  const candidates: Cand[] = [];
  for (const sh of shares) {
    if (!sh) continue;
    const peerIsOwner = sh.ownerUid === peerUid;
    const name = (peerIsOwner ? sh.ownerName : sh.viewerName)?.trim();
    if (!name) continue;
    const raw = peerIsOwner ? sh.ownerPhotoURL : sh.viewerPhotoURL;
    const photo =
      typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    candidates.push({ name, photo, at: sh.updatedAt ?? 0 });
  }
  if (candidates.length === 0) return { displayName: peerUid.slice(0, 6) };
  candidates.sort((a, b) => b.at - a.at);
  const best = candidates[0]!;
  return { displayName: best.name, photoURL: best.photo };
}

function pickLatestPeerDmIdentity(
  peerUid: string,
  pub: PublicProfile | null,
  shares: Array<Share | null>,
): PeerDmIdentity {
  const pubName = pub?.displayName?.trim();
  if (pubName && pub) {
    const pubPhoto =
      typeof pub.photoURL === "string" && pub.photoURL.trim() !== ""
        ? pub.photoURL.trim()
        : undefined;
    if (pubPhoto) return { displayName: pubName, photoURL: pubPhoto };
    const fromShares = pickLatestPeerIdentityFromSharesOnly(peerUid, shares);
    return { displayName: pubName, photoURL: fromShares.photoURL };
  }
  return pickLatestPeerIdentityFromSharesOnly(peerUid, shares);
}

export async function resolvePeerIdentityForDm(
  peerUid: string,
  myUid: string,
): Promise<PeerDmIdentity> {
  const fs = getFirestoreDb();
  const [pubSnap, s1, s2] = await Promise.all([
    getDoc(doc(fs, "publicProfiles", peerUid)),
    getDoc(doc(fs, "shares", shareIdFor(peerUid, myUid))),
    getDoc(doc(fs, "shares", shareIdFor(myUid, peerUid))),
  ]);
  const pub = pubSnap.exists() ? (pubSnap.data() as PublicProfile) : null;
  const shares: Array<Share | null> = [
    s1.exists() ? ({ id: s1.id, ...s1.data() } as Share) : null,
    s2.exists() ? ({ id: s2.id, ...s2.data() } as Share) : null,
  ];
  return pickLatestPeerDmIdentity(peerUid, pub, shares);
}

/** 채팅 헤더 등 — 상대 프로필·맞팔 shares 문서 변경 시 즉시 반영 */
export function subscribePeerIdentityForDm(
  peerUid: string,
  myUid: string,
  onNext: (v: PeerDmIdentity) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  let pub: PublicProfile | null = null;
  let shareForward: Share | null = null;
  let shareReverse: Share | null = null;

  function emit() {
    onNext(pickLatestPeerDmIdentity(peerUid, pub, [shareForward, shareReverse]));
  }

  const u1 = onSnapshot(
    doc(fs, "publicProfiles", peerUid),
    (snap) => {
      pub = snap.exists() ? (snap.data() as PublicProfile) : null;
      emit();
    },
    () => {
      pub = null;
      emit();
    },
  );
  const u2 = onSnapshot(
    doc(fs, "shares", shareIdFor(peerUid, myUid)),
    (snap) => {
      shareForward = snap.exists()
        ? ({ id: snap.id, ...snap.data() } as Share)
        : null;
      emit();
    },
    () => {
      shareForward = null;
      emit();
    },
  );
  const u3 = onSnapshot(
    doc(fs, "shares", shareIdFor(myUid, peerUid)),
    (snap) => {
      shareReverse = snap.exists()
        ? ({ id: snap.id, ...snap.data() } as Share)
        : null;
      emit();
    },
    () => {
      shareReverse = null;
      emit();
    },
  );
  return () => {
    u1();
    u2();
    u3();
  };
}

// ---- follow 신청 --------------------------------------------------------

export async function sendFollowRequest(
  toEmailRaw: string,
  requestedScope: ShareScope,
  localUser?: User | null,
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
  const myName = resolveDisplayName(localUser, me) || myEmail;
  const myPhoto = resolveDisplayPhotoURL(localUser, me.photoURL);
  const data: FollowRequest = {
    id,
    fromUid: me.uid,
    fromEmail: myEmail,
    fromName: myName,
    fromPhotoURL: myPhoto,
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
  localUser?: User | null,
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
  const myName = resolveDisplayName(localUser, me) || myEmail;
  const myPhoto = resolveDisplayPhotoURL(localUser, me.photoURL);
  const share: Share = {
    id: sid,
    ownerUid: me.uid,
    viewerUid: req.fromUid,
    scope: finalScope,
    ownerEmail: myEmail,
    ownerName: myName,
    ownerPhotoURL: myPhoto,
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

/** 링크 초대 코드 유효 시간 (72시간) */
export const FRIEND_INVITE_TTL_MS = 72 * 60 * 60 * 1000;

const INVITE_CODE_BYTES = 16;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 추측 어려운 초대 토큰 (문서 id 와 동일) */
export function secureRandomInviteId(): string {
  const bytes = new Uint8Array(INVITE_CODE_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * 1회용(또는 만료 전까지) 초대 문서 생성 — `/friendInviteCodes/{id}`.
 * 수락 시 수락자가 owner, 발급자가 viewer 가 되는 share 가 생깁니다.
 */
export async function createFriendInviteCode(
  localUser?: User | null,
  requestedScope: ShareScope = { calendar: true, health: false },
): Promise<FriendInviteCode> {
  const me = requireUser();
  const myEmail = requireEmail(me);
  await me.getIdToken();
  if (!requestedScope.calendar || requestedScope.health) {
    throw new Error("링크 초대는 식단(달력) 공개만 가능해요.");
  }

  const fs = getFirestoreDb();
  const id = secureRandomInviteId();
  const now = Date.now();
  const myName = resolveDisplayName(localUser, me) || myEmail;
  const myPhotoRaw = resolveDisplayPhotoURL(localUser, me.photoURL);
  const myPhoto = sanitizeInviteProfilePhoto(myPhotoRaw);

  const data: FriendInviteCode = {
    id,
    fromUid: me.uid,
    fromEmail: myEmail,
    fromName: myName.slice(0, 150),
    fromPhotoURL: myPhoto,
    requestedScope: { calendar: true, health: false },
    status: "pending",
    createdAt: now,
    expiresAt: now + FRIEND_INVITE_TTL_MS,
  };

  const clean: Record<string, unknown> = { ...data };
  if (clean.fromPhotoURL === undefined) delete clean.fromPhotoURL;

  await withFirestoreDeadline(
    setDoc(doc(fs, "friendInviteCodes", id), clean),
    45_000,
    "연결 시간이 초과됐어요. 네트워크를 확인하고 다시 시도해 주세요.",
  );
  return data;
}

/**
 * 초대 링크를 수락 — 트랜잭션으로 invite 사용 처리 + share 생성(또는 기존 share 유지).
 */
export async function acceptFriendInviteCode(
  codeId: string,
  finalScope: ShareScope,
  localUser?: User | null,
): Promise<Share> {
  const me = requireUser();
  const myEmail = requireEmail(me);
  if (isEmptyScope(finalScope)) {
    throw new Error("공개할 범위를 하나 이상 선택해 주세요.");
  }
  if (!finalScope.calendar || finalScope.health) {
    throw new Error("링크 초대 수락은 식단(달력) 공개만 가능해요.");
  }

  const fs = getFirestoreDb();
  const inviteRef = doc(fs, "friendInviteCodes", codeId);
  let outSid = "";

  await runTransaction(fs, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error("초대 링크를 찾을 수 없어요.");
    const inv = { ...(inviteSnap.data() as Omit<FriendInviteCode, "id">), id: inviteSnap.id };

    if (inv.status !== "pending") throw new Error("이미 사용되었거나 취소된 초대예요.");
    if (Date.now() > inv.expiresAt) throw new Error("초대 링크가 만료됐어요.");
    if (inv.fromUid === me.uid) throw new Error("본인이 만든 초대는 수락할 수 없어요.");

    outSid = shareIdFor(me.uid, inv.fromUid);
    const shareRef = doc(fs, "shares", outSid);
    const shareSnap = await transaction.get(shareRef);
    const now = Date.now();
    const myName = resolveDisplayName(localUser, me) || myEmail;
    const myPhoto = resolveDisplayPhotoURL(localUser, me.photoURL);

    if (!shareSnap.exists()) {
      const share: Share = {
        id: outSid,
        ownerUid: me.uid,
        viewerUid: inv.fromUid,
        scope: finalScope,
        ownerEmail: myEmail,
        ownerName: myName,
        ownerPhotoURL: myPhoto,
        viewerEmail: inv.fromEmail,
        viewerName: inv.fromName,
        viewerPhotoURL: inv.fromPhotoURL,
        createdAt: now,
        updatedAt: now,
      };
      const clean: Record<string, unknown> = { ...share };
      if (clean.ownerPhotoURL === undefined) delete clean.ownerPhotoURL;
      if (clean.viewerPhotoURL === undefined) delete clean.viewerPhotoURL;
      transaction.set(shareRef, clean);
    } else {
      const ex = shareSnap.data() as Share;
      if (ex.ownerUid !== me.uid || ex.viewerUid !== inv.fromUid) {
        throw new Error("이 초대와 맞지 않는 공유 설정이 이미 있어요.");
      }
      const patch: Record<string, unknown> = {
        scope: finalScope,
        ownerEmail: myEmail,
        ownerName: myName,
        viewerEmail: inv.fromEmail,
        viewerName: inv.fromName,
        updatedAt: now,
      };
      if (myPhoto !== undefined) patch.ownerPhotoURL = myPhoto;
      if (inv.fromPhotoURL !== undefined) patch.viewerPhotoURL = inv.fromPhotoURL;
      transaction.update(shareRef, patch);
    }

    transaction.update(inviteRef, {
      status: "used",
      usedByUid: me.uid,
      usedByEmail: myEmail,
      usedAt: now,
    });
  });

  const s = await getDoc(doc(fs, "shares", outSid));
  if (!s.exists()) throw new Error("공유 문서를 만들지 못했어요.");
  return { ...(s.data() as Share), id: s.id };
}

/** HashRouter 기준 절대 초대 URL (카카오톡 등 공유용) */
export function buildFriendInviteLink(inviteCode: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${location.origin}${base}#/friends/invite/c/${inviteCode}`;
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
  cb: (rows: Share[], meta: SnapshotMetadata) => void,
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
      cb(rows, snap.metadata);
    },
    (err) => {
      console.error("[friends] shares subscribe", err);
      onErr?.(err);
    },
  );
}

/** 내가 팔로우 중인 사람들 (= 내가 viewer 인 share). */
export function subscribeOutgoingShares(
  cb: (rows: Share[], meta: SnapshotMetadata) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const u = requireUser();
  return subscribeShares([where("viewerUid", "==", u.uid)], cb, onErr);
}

/** 나를 팔로우 중인 사람들 (= 내가 owner 인 share). */
export function subscribeIncomingShares(
  cb: (rows: Share[], meta: SnapshotMetadata) => void,
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

// ---- 친구 데이터 실시간 구독 ---------------------------------------------
// 친구 기기에서 AI 분석이 완료돼 Firestore 가 갱신될 때 내 화면도 곧바로
// 반영되도록 onSnapshot 으로 구독한다. getDocs 일회성 호출만 쓰면
// "analyzing" 상태 그대로 멈춰 있는 문제가 발생한다.
//
// base64 사진을 Blob 으로 디코딩하는 작업이 비싸므로 캐시한다. 상위 문서만
// updatedAt 이 같다고 같은 스냅샷이라 단정하면 안 된다 — items[].분석 상태만
// 바뀌었는데 meal.updatedAt 이 동일·지연 같은 경우 오래된 분석 상태를 들고 간다.

function mealFirestoreCacheKey(data: MealStored): string {
  const base = data.updatedAt ?? data.createdAt ?? 0;
  const items = data.items ?? [];
  const part = items
    .map((it) => {
      const errLen = typeof it.analysisError === "string" ? it.analysisError.length : 0;
      const mt = typeof it.menuText === "string" && it.menuText.length > 0 ? it.menuText : "";
      /** 길이만으로는 같은 길이의 다른 문자열을 구별 못해 짧게 본문 앞 부분 포함 */
      const menuSig =
        mt.length > 0 ? `${mt.length}:${mt.slice(0, 96)}` : "0";
      return [
        it.id,
        it.analysisStatus ?? "",
        it.updatedAt ?? 0,
        menuSig,
        errLen,
        typeof it.rating === "number" ? it.rating : "",
      ].join(":");
    })
    .join("|");
  return `${base}|${part}`;
}

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
  const cache = new Map<string, { key: string; meal: Meal }>();
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    async (snap) => {
      try {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const data = { ...(d.data() as MealStored), id: d.id };
            const sig = mealFirestoreCacheKey(data);
            const cached = cache.get(d.id);
            if (cached && cached.key === sig) {
              return cached.meal;
            }
            const meal = await storedToMeal(data);
            cache.set(d.id, { key: sig, meal });
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

/**
 * 특정 친구의 "최근 N 개 식사 기록" 을 실시간 구독한다 — 피드 탭용.
 *
 * 과거 레코드에 `updatedAt` 이 비어 있는 경우가 있어, 쿼리는 `orderBy("date","desc")` 로
 * 최근 일자부터 넉넉히 가져온 뒤 `updatedAt ?? createdAt` 기준으로 정렬해 상위 N 개만 넘긴다.
 *
 * 단일 필드 orderBy 로 자동 인덱스만 사용한다.
 */
export function subscribeFriendLatestMeals(
  ownerUid: string,
  max: number,
  cb: (rows: Meal[]) => void,
  onErr?: (e: unknown) => void,
): Unsubscribe {
  const fs = getFirestoreDb();
  const fetchCap = Math.min(56, Math.max(max * 3, max + 10));
  const q = query(
    collection(fs, "users", ownerUid, "meals"),
    orderBy("date", "desc"),
    limit(fetchCap),
  );
  const cache = new Map<string, { key: string; meal: Meal }>();
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    async (snap) => {
      try {
        const decoded = await Promise.all(
          snap.docs.map(async (d) => {
            const data = { ...(d.data() as MealStored), id: d.id };
            const stored = data as MealStored;
            const sig = mealFirestoreCacheKey(stored);
            const cached = cache.get(d.id);
            if (cached && cached.key === sig) {
              return cached.meal;
            }
            const meal = await storedToMeal(data);
            cache.set(d.id, { key: sig, meal });
            return meal;
          }),
        );
        const alive = new Set(snap.docs.map((d) => d.id));
        for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
        decoded.sort((a, b) => {
          const ta = (a.updatedAt ?? a.createdAt ?? 0) | 0;
          const tb = (b.updatedAt ?? b.createdAt ?? 0) | 0;
          return tb - ta;
        });
        cb(decoded.slice(0, max));
      } catch (e) {
        console.error("[friends] latest meals snapshot decode", e);
        onErr?.(e);
      }
    },
    (err) => {
      console.error("[friends] latest meals subscribe", err);
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

// 친구의 건강 기록은 앱 정책상 공유되지 않는다 — firestore.rules 에서도
// viewer 가 /users/{uid}/health 를 read 하지 못하도록 막혀 있으므로 관련
// subscribe/pull 헬퍼를 제거했다.

// ---- 편의 함수 ----------------------------------------------------------

export function permissionDeniedMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === "permission-denied" || /insufficient permissions/i.test(msg)) {
    return "공유가 해제되었거나 권한이 없어요.";
  }
  return msg;
}
