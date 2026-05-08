import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import type {
  AppSettings,
  HealthRecord,
  Meal,
  MealItem,
  User,
} from "../types";
import { db as dexieDb, getSettings, normalizeMeal, runDexie, SETTINGS_KEY } from "./db";
import { getFirestoreDb, getFirebaseAuth } from "./firebaseApp";
import { base64ToBlob, blobToBase64, compressImage, makeThumbnail } from "./image";
import { dateKey } from "./utils";

const BATCH = 400;
/** Firestore 문서 상한 1MiB — Base64·메타 여유 */
const DOC_SAFE_BYTES = 900_000;

// 로컬(IndexedDB) `users` 는 이 기기에서 쓰는 활성 프로필 한 명분만 유지합니다. 친구 데이터는 Firestore 로만 조회합니다.
// Firestore 컬렉션명 `users/{uid}/members` 는 초기 멀티 프로필 시절의 잔재이지만,
// 기존 사용자 데이터와의 호환을 위해 이름은 그대로 둡니다.
// 코드 내부의 *Members 함수·변수도 같은 의미입니다.

export type MealItemStored = Omit<MealItem, "photo" | "thumbnail"> & {
  photoBase64?: string;
  photoMimeType?: string;
};

/**
 * Firestore 에 저장되는 Meal 문서.
 *
 * 신규 스키마: `items: MealItemStored[]`.
 * 레거시(v1) 스키마: top-level 에 photoBase64/menuText/rating/... 가 직접 있음.
 * 읽기 시 둘 다 처리하되, 쓰기는 항상 신규 스키마로 저장한다.
 */
export type MealStored = {
  id: string;
  userId: string;
  date: string;
  slot: Meal["slot"];
  items: MealItemStored[];
  createdAt: number;
  updatedAt: number;
  /** 레거시 — 읽기 전용 호환 필드 */
  photoBase64?: string;
  photoMimeType?: string;
  photoPath?: string;
  thumbnailPath?: string;
  menuText?: string;
  rating?: number;
  aiComment?: string;
  nutrition?: MealItem["nutrition"];
  analysisStatus?: MealItem["analysisStatus"];
  analysisError?: string;
};

export type HealthStored = Omit<HealthRecord, "photo" | "thumbnail"> & {
  photoBase64?: string;
  photoMimeType?: string;
  photoPath?: string;
  thumbnailPath?: string;
};

type PublicSettingsDoc = {
  activeUserId?: string;
  onboarded?: boolean;
  /** UI 테마 — 다른 기기와 함께 동기화 */
  theme?: AppSettings["theme"];
  updatedAt: number;
};

/** 본인 Firebase UID 하위만 접근 — Gemini 키(계정별) */
type PrivateSettingsDoc = {
  geminiApiKey?: string;
  updatedAt: number;
};

function userVer(u: User): number {
  return u.updatedAt ?? u.createdAt;
}

function cleanForFirestore<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

function docJsonSize(data: object): number {
  return new Blob([JSON.stringify(data)]).size;
}

function prunePendingDeletes(
  pd: AppSettings["cloudPendingDeletes"],
  meals: Meal[],
  health: HealthRecord[],
): AppSettings["cloudPendingDeletes"] {
  if (!pd) return undefined;
  const ml = new Set(meals.map((x) => x.id));
  const h = new Set(health.map((x) => x.id));
  const next = {
    meals: (pd.meals ?? []).filter((id) => ml.has(id)),
    health: (pd.health ?? []).filter((id) => h.has(id)),
  };
  if (next.meals.length + next.health.length === 0) return undefined;
  return next;
}

async function itemStoredToItem(s: MealItemStored): Promise<MealItem> {
  const { photoBase64, photoMimeType, ...rest } = s;
  const item: MealItem = { ...rest };
  if (photoBase64 && photoMimeType) {
    const blob = base64ToBlob(photoBase64, photoMimeType);
    item.photo = blob;
    item.thumbnail = await makeThumbnail(blob);
  }
  return item;
}

export async function storedToMeal(s: MealStored): Promise<Meal> {
  const now = Date.now();
  // 신규 스키마: items 가 배열이면 길이 0 도 "빈 끼니"로 취급(레거시 top-level 과 섞이지 않도록)
  if (Array.isArray(s.items)) {
    const items =
      s.items.length > 0 ? await Promise.all(s.items.map(itemStoredToItem)) : [];
    return {
      id: s.id,
      userId: s.userId,
      date: s.date,
      slot: s.slot,
      items,
      createdAt: s.createdAt ?? now,
      updatedAt: s.updatedAt ?? now,
    };
  }
  // 레거시 v1 — items 배열이 없을 때 top-level 사진/메뉴가 있으면 items[0] 으로 변환해 읽는다.
  const legacyItem: MealItem | null =
    s.photoBase64 || s.menuText || s.rating || s.aiComment || s.nutrition
      ? {
          id: `${s.id}__i0`,
          photo:
            s.photoBase64 && s.photoMimeType
              ? base64ToBlob(s.photoBase64, s.photoMimeType)
              : undefined,
          menuText: s.menuText,
          rating: s.rating,
          aiComment: s.aiComment,
          nutrition: s.nutrition,
          analysisStatus: s.analysisStatus ?? (s.menuText ? "done" : "skipped"),
          analysisError: s.analysisError,
          createdAt: s.createdAt ?? now,
          updatedAt: s.updatedAt ?? now,
        }
      : null;
  if (legacyItem?.photo) {
    legacyItem.thumbnail = await makeThumbnail(legacyItem.photo);
  }
  return {
    id: s.id,
    userId: s.userId,
    date: s.date,
    slot: s.slot,
    items: legacyItem ? [legacyItem] : [],
    createdAt: s.createdAt ?? now,
    updatedAt: s.updatedAt ?? now,
  };
}

export async function storedToHealth(s: HealthStored): Promise<HealthRecord> {
  const { photoPath: _p, thumbnailPath: _t, photoBase64, photoMimeType, ...rest } = s;
  const rec: HealthRecord = { ...rest };
  if (photoBase64 && photoMimeType) {
    const blob = base64ToBlob(photoBase64, photoMimeType);
    rec.photo = blob;
    rec.thumbnail = await makeThumbnail(blob);
  }
  return rec;
}

function mergeUsers(local: User[], remote: User[]): User[] {
  const rMap = new Map(remote.map((x) => [x.id, x]));
  const lMap = new Map(local.map((x) => [x.id, x]));
  const ids = new Set([...lMap.keys(), ...rMap.keys()]);
  const out: User[] = [];
  for (const id of ids) {
    const l = lMap.get(id);
    const r = rMap.get(id);
    if (!l) out.push(r!);
    else if (!r) out.push(l);
    else if (userVer(l) >= userVer(r)) out.push(l);
    else out.push(r);
  }
  return out;
}

function itemHasRenderableImage(it: MealItem): boolean {
  return (it.photo?.size ?? 0) > 0 || (it.thumbnail?.size ?? 0) > 0;
}

/**
 * 문서 단위 LWW 로 원격 Meal 이 이겼을 때, 항목은 최신이지만 photoBase64 가 빠진 채
 * 올라온 경우(동기화 레이스·직접기록만 있는 기기 등) 로컬 IndexedDB 의 Blob 을 합쳐
 * "사진 없음" 으로 덮이는 현상을 막는다. 이후 push 로 Firestore 에 사진이 채워진다.
 */
async function hydrateMealPhotosFromLocal(remote: Meal, local: Meal): Promise<Meal> {
  const localById = new Map(local.items.map((x) => [x.id, x]));
  const items = await Promise.all(
    remote.items.map(async (it) => {
      if (itemHasRenderableImage(it)) return it;
      const loc = localById.get(it.id);
      if (!loc || !itemHasRenderableImage(loc)) return it;
      const photo = loc.photo?.size ? loc.photo : it.photo;
      let thumbnail = loc.thumbnail?.size ? loc.thumbnail : it.thumbnail;
      if (photo && photo.size > 0 && !(thumbnail?.size)) {
        thumbnail = await makeThumbnail(photo);
      }
      return { ...it, photo, thumbnail };
    }),
  );
  return { ...remote, items };
}

async function mergeMeals(local: Meal[], remote: MealStored[]): Promise<Meal[]> {
  const rMap = new Map(remote.map((x) => [x.id, x]));
  const lMap = new Map(local.map((x) => [x.id, normalizeMeal(x)]));
  const ids = new Set([...lMap.keys(), ...rMap.keys()]);
  const out: Meal[] = [];
  for (const id of ids) {
    const l = lMap.get(id);
    const r = rMap.get(id);
    if (!l) out.push(await storedToMeal(r!));
    else if (!r) out.push(l);
    else if (l.updatedAt >= r.updatedAt) out.push(l);
    else out.push(await hydrateMealPhotosFromLocal(await storedToMeal(r), l));
  }
  return out;
}

async function mergeHealth(local: HealthRecord[], remote: HealthStored[]): Promise<HealthRecord[]> {
  const rMap = new Map(remote.map((x) => [x.id, x]));
  const lMap = new Map(local.map((x) => [x.id, x]));
  const ids = new Set([...lMap.keys(), ...rMap.keys()]);
  const out: HealthRecord[] = [];
  for (const id of ids) {
    const l = lMap.get(id);
    const r = rMap.get(id);
    if (!l) out.push(await storedToHealth(r!));
    else if (!r) out.push(l);
    else if (l.updatedAt >= r.updatedAt) out.push(l);
    else out.push(await storedToHealth(r));
  }
  return out;
}

function isValidDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !v.trim()) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/** 수동 콘솔 편집 등으로 date 가 빠진 식단 문서 복구 */
function repairRemoteMealStored(s: MealStored): MealStored {
  if (isValidDateKey(s.date)) return s;
  const ts = Number.isFinite(s.updatedAt)
    ? s.updatedAt
    : Number.isFinite(s.createdAt)
      ? s.createdAt
      : Date.now();
  return { ...s, date: dateKey(new Date(ts)) };
}

/** recordDate 누락 시 보정 */
function repairRemoteHealthStored(s: HealthStored): HealthStored {
  if (isValidDateKey(s.recordDate)) return s;
  const ts = Number.isFinite(s.updatedAt)
    ? s.updatedAt
    : Number.isFinite(s.createdAt)
      ? s.createdAt
      : Date.now();
  return { ...s, recordDate: dateKey(new Date(ts)) };
}

/**
 * 식단/건강 문서의 `userId` 는 Firebase UID 가 아니라 Dexie 프로필(`members` 와 동일 id`)이다.
 * `members` 가 비었거나 예전 데이터만 있으면 병합 후 활성 프로필과 어긋나 피드·달력이 비어 보인다.
 * 원격 문서에 나타나는 소유자 id 에 대해 멤버 스텁을 채운다.
 */
function ensureMembersForRemoteOwners(
  members: User[],
  remoteMeals: MealStored[],
  remoteHealth: HealthStored[],
): User[] {
  const byId = new Map(members.map((u) => [u.id, u]));
  const defaultColor = "#334155";
  const takeTs = (a?: number, b?: number) =>
    Number.isFinite(a) ? (a as number) : Number.isFinite(b) ? (b as number) : Date.now();

  for (const m of remoteMeals) {
    const pid = typeof m.userId === "string" ? m.userId.trim() : "";
    if (!pid || byId.has(pid)) continue;
    const ts = takeTs(m.updatedAt, m.createdAt);
    byId.set(pid, {
      id: pid,
      name: "내 프로필",
      color: defaultColor,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  for (const h of remoteHealth) {
    const pid = typeof h.userId === "string" ? h.userId.trim() : "";
    if (!pid || byId.has(pid)) continue;
    const ts = takeTs(h.updatedAt, h.createdAt);
    byId.set(pid, {
      id: pid,
      name: "내 프로필",
      color: defaultColor,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  return [...byId.values()];
}

function pickPrimarySelfProfile(pool: User[], firebaseUid: string): User {
  const byRecency = [...pool].sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  );
  const custom = byRecency.find(
    (u) => u.name?.trim() && u.name !== "내 프로필",
  );
  const base = custom ?? byRecency[0]!;
  const latest = Math.max(...pool.map((u) => u.updatedAt ?? u.createdAt));
  return {
    ...base,
    id: firebaseUid,
    updatedAt: Math.max(base.updatedAt ?? base.createdAt, latest),
  };
}

/**
 * Dexie 프로필 id(랜덤/재온보딩)와 식단·건강의 userId 가 갈라지면 활성 프로필과 어긋나 빈 피드가 됩니다.
 * Google 계정(Firebase UID) 한 개로 로컬·원격을 고정한다.
 */
function consolidateToFirebaseProfile(
  firebaseUid: string,
  members: User[],
  meals: Meal[],
  healthRows: HealthRecord[],
): { members: User[]; meals: Meal[]; health: HealthRecord[]; activeUserId: string } {
  const mealUserIds = new Set(meals.map((m) => m.userId));
  const healthUserIds = new Set(healthRows.map((h) => h.userId));
  const touchedIds = new Set([...mealUserIds, ...healthUserIds]);

  let pool = members.filter((u) => touchedIds.has(u.id));
  if (pool.length === 0) pool = [...members];

  if (pool.length === 0) {
    pool = [
      {
        id: firebaseUid,
        name: "나",
        color: "#334155",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  }

  const primary = pickPrimarySelfProfile(pool, firebaseUid);

  const idMap = new Map<string, string>();
  for (const u of members) {
    if (u.id !== firebaseUid) idMap.set(u.id, firebaseUid);
  }
  for (const id of mealUserIds) {
    if (id !== firebaseUid) idMap.set(id, firebaseUid);
  }
  for (const id of healthUserIds) {
    if (id !== firebaseUid) idMap.set(id, firebaseUid);
  }

  const remap = (legacyId: string) => idMap.get(legacyId) ?? legacyId;

  return {
    members: [primary],
    meals: meals.map((m) => ({ ...m, userId: remap(m.userId) })),
    health: healthRows.map((h) => ({ ...h, userId: remap(h.userId) })),
    activeUserId: firebaseUid,
  };
}

async function pullMembers(uid: string): Promise<User[]> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", uid, "members"));
  return snap.docs.map((d) => d.data() as User);
}

async function pullMealsStored(uid: string): Promise<MealStored[]> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", uid, "meals"));
  return snap.docs.map((d) => ({ ...(d.data() as MealStored), id: d.id }));
}

async function pullHealthStored(uid: string): Promise<HealthStored[]> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", uid, "health"));
  return snap.docs.map((d) => ({ ...(d.data() as HealthStored), id: d.id }));
}

async function pullPublicSettings(uid: string): Promise<PublicSettingsDoc | null> {
  const fs = getFirestoreDb();
  const d = await getDoc(doc(fs, "users", uid, "config", "public"));
  if (!d.exists) return null;
  return d.data() as PublicSettingsDoc;
}

async function pullPrivateSettings(uid: string): Promise<PrivateSettingsDoc | null> {
  const fs = getFirestoreDb();
  const d = await getDoc(doc(fs, "users", uid, "config", "private"));
  if (!d.exists) return null;
  return d.data() as PrivateSettingsDoc;
}

/**
 * Meal 한 건을 Firestore 문서 형태로 변환한다.
 *
 * items 마다 사진이 있을 수 있으므로, 전체 문서가 1MB 상한을 넘지 않도록
 * 공통 압축 레벨을 한 단계씩 낮춰가며 재시도한다. 레벨이 높은 쪽이 화질이 좋고,
 * 낮출수록 해상도·퀄리티를 함께 줄인다.
 */
async function mealToStored(m: Meal): Promise<MealStored | null> {
  const base: Omit<MealStored, "items"> = {
    id: m.id,
    userId: m.userId,
    date: m.date,
    slot: m.slot,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
  const rawItems = m.items ?? [];
  const items = rawItems.filter((it) => !it.draft);
  if (items.length === 0) {
    if (rawItems.length === 0) {
      return { ...base, items: [] };
    }
    return null;
  }

  const attempts: { maxDimension: number; quality: number }[] = [
    { maxDimension: 720, quality: 0.72 },
    { maxDimension: 640, quality: 0.62 },
    { maxDimension: 560, quality: 0.55 },
    { maxDimension: 480, quality: 0.5 },
    { maxDimension: 420, quality: 0.45 },
  ];

  function toItemMeta(it: MealItem): MealItemStored {
    return {
      id: it.id,
      menuText: it.menuText,
      rating: it.rating,
      aiComment: it.aiComment,
      nutrition: it.nutrition,
      analysisStatus: it.analysisStatus,
      analysisError: it.analysisError,
      manuallyEdited: it.manuallyEdited,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    };
  }

  let lastErr = `식사 기록(${m.date}) 사진이 동기화 한도를 넘깁니다. 더 작은 원본으로 다시 찍거나 해당 날짜의 사진 개수를 줄여 주세요.`;
  for (const opts of attempts) {
    const stored: MealItemStored[] = [];
    for (const it of items) {
      const source = it.photo?.size ? it.photo : it.thumbnail?.size ? it.thumbnail : null;
      const meta = toItemMeta(it);
      if (!source) {
        stored.push(meta);
        continue;
      }
      const compressed = await compressImage(source, {
        maxDimension: opts.maxDimension,
        quality: opts.quality,
        mimeType: "image/jpeg",
      });
      meta.photoBase64 = await blobToBase64(compressed);
      meta.photoMimeType = "image/jpeg";
      stored.push(meta);
    }
    const trial: MealStored = { ...base, items: stored };
    const cleaned = cleanForFirestore(trial);
    if (docJsonSize(cleaned) <= DOC_SAFE_BYTES) return cleaned;
    lastErr = `식사 기록(${m.date})의 사진 용량이 커서 동기화 한도(1MB)를 넘깁니다. 해당 끼니에 올린 사진 개수를 줄여 주세요.`;
  }
  throw new Error(lastErr);
}

async function healthToStored(h: HealthRecord): Promise<HealthStored> {
  const { photo, thumbnail, ...rest } = h;
  const base: HealthStored = { ...rest };
  const source = photo?.size ? photo : thumbnail?.size ? thumbnail : null;
  if (!source) return base;

  const attempts: { maxDimension: number; quality: number }[] = [
    { maxDimension: 1600, quality: 0.8 },
    { maxDimension: 1280, quality: 0.72 },
    { maxDimension: 960, quality: 0.64 },
    { maxDimension: 720, quality: 0.55 },
    { maxDimension: 520, quality: 0.5 },
  ];

  let lastErr = "Firestore 문서 한도를 넘습니다.";
  for (const opts of attempts) {
    const compressed = await compressImage(source, {
      maxDimension: opts.maxDimension,
      quality: opts.quality,
      mimeType: "image/jpeg",
    });
    const b64 = await blobToBase64(compressed);
    const trial: HealthStored = {
      ...base,
      photoBase64: b64,
      photoMimeType: "image/jpeg",
    };
    const cleaned = cleanForFirestore(trial);
    if (docJsonSize(cleaned) <= DOC_SAFE_BYTES) return cleaned;
    lastErr = `건강기록(${h.recordDate}) 사진이 동기화 한도를 넘깁니다.`;
  }
  throw new Error(lastErr);
}

async function deleteRemoteMembersNotIn(uid: string, keep: Set<string>): Promise<void> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", uid, "members"));
  for (const d of snap.docs) {
    if (!keep.has(d.id)) await deleteDoc(d.ref);
  }
}

async function deleteRemoteMealsNotIn(uid: string, keep: Set<string>): Promise<void> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", uid, "meals"));
  for (const d of snap.docs) {
    if (keep.has(d.id)) continue;
    // Firestore 클라이언트 SDK 는 부모 doc 만 지우면 서브컬렉션이 고아로 남는다.
    // 식단의 좋아요/댓글도 같이 best-effort 정리(다른 기기에서 삭제된 식단이 동기화될 때).
    await Promise.allSettled([
      deleteSubCollection(collection(d.ref, "likes")),
      deleteSubCollection(collection(d.ref, "comments")),
    ]);
    await deleteDoc(d.ref);
  }
}

async function deleteSubCollection(
  colRef: ReturnType<typeof collection>,
): Promise<void> {
  try {
    const snap = await getDocs(colRef);
    await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (e) {
    console.warn("[cloudSync] subcollection cleanup", e);
  }
}

async function deleteRemoteHealthNotIn(uid: string, keep: Set<string>): Promise<void> {
  const fs = getFirestoreDb();
  const snap = await getDocs(collection(fs, "users", uid, "health"));
  for (const d of snap.docs) {
    if (!keep.has(d.id)) await deleteDoc(d.ref);
  }
}

async function pushMembers(uid: string, users: User[]): Promise<void> {
  const fs = getFirestoreDb();
  let batch = writeBatch(fs);
  let n = 0;
  for (const u of users) {
    batch.set(doc(fs, "users", uid, "members", u.id), cleanForFirestore(u));
    n++;
    if (n >= BATCH) {
      await batch.commit();
      batch = writeBatch(fs);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

async function pushMeals(uid: string, meals: Meal[]): Promise<void> {
  const fs = getFirestoreDb();
  let batch = writeBatch(fs);
  let n = 0;
  for (const raw of meals) {
    const m = normalizeMeal(raw);
    const stored = await mealToStored(m);
    if (!stored) continue;
    batch.set(doc(fs, "users", uid, "meals", m.id), stored);
    n++;
    if (n >= BATCH) {
      await batch.commit();
      batch = writeBatch(fs);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

async function pushHealth(uid: string, rows: HealthRecord[]): Promise<void> {
  const fs = getFirestoreDb();
  let batch = writeBatch(fs);
  let n = 0;
  for (const h of rows) {
    const stored = await healthToStored(h);
    batch.set(doc(fs, "users", uid, "health", h.id), stored);
    n++;
    if (n >= BATCH) {
      await batch.commit();
      batch = writeBatch(fs);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

async function pushPublicSettings(uid: string, s: AppSettings): Promise<void> {
  const fs = getFirestoreDb();
  const updatedAt = s.appSettingsUpdatedAt ?? Date.now();
  const docData: PublicSettingsDoc = {
    activeUserId: s.activeUserId,
    onboarded: s.onboarded,
    theme: s.theme,
    updatedAt,
  };
  // model 은 더 이상 사용하지 않음 — 기존 사용자의 클라우드 잔여 필드를 정리.
  await setDoc(
    doc(fs, "users", uid, "config", "public"),
    { ...cleanForFirestore(docData), model: deleteField() },
    { merge: true },
  );
}

async function pushPrivateSettings(uid: string, s: AppSettings): Promise<void> {
  const fs = getFirestoreDb();
  const updatedAt = s.geminiSettingsUpdatedAt ?? Date.now();
  const primary = s.geminiApiKey?.trim();
  // geminiApiKeyBackup 은 더 이상 사용하지 않음 — 기존 사용자의 클라우드 잔여 필드를 정리.
  await setDoc(
    doc(fs, "users", uid, "config", "private"),
    {
      updatedAt,
      geminiApiKey: primary ? primary : deleteField(),
      geminiApiKeyBackup: deleteField(),
    },
    { merge: true },
  );
}

/** Firestore 규칙 미게시 등으로 동기화가 막힐 때 사용자 안내 */
export function formatCloudSyncError(e: unknown): string {
  const base = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code;
  if (code === "permission-denied" || /insufficient permissions/i.test(base)) {
    return `${base} — Firestore 규칙에 firestore.rules 를 콘솔에서 게시했는지 확인하세요.`;
  }
  return base;
}

let cloudSyncMutationDepth = 0;

/** 동기화 트랜잭션이 로컬 DB를 쓰는 동안 true — 자동 동기화 재호출 방지 */
export function isCloudSyncMutation(): boolean {
  return cloudSyncMutationDepth > 0;
}

/**
 * 원격과 로컬을 병합한 뒤 양쪽에 반영합니다.
 * Spark(무료) 플랜: Firebase Storage 없이 Firestore 문서에 압축 JPEG(Base64)만 저장합니다.
 * Gemini 키는 users/{uid}/config/private 에만 저장되며, Firestore 규칙으로 본인만 접근합니다.
 */
export async function syncCloudWithLocal(): Promise<void> {
  cloudSyncMutationDepth++;
  try {
    const auth = getFirebaseAuth();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("Google 로그인이 필요합니다.");

    const remoteMembers = await pullMembers(uid);
    const remoteMeals = (await pullMealsStored(uid)).map(repairRemoteMealStored);
    const remoteHealth = (await pullHealthStored(uid)).map(repairRemoteHealthStored);
    const remotePublic = await pullPublicSettings(uid);
    const remotePrivate = await pullPrivateSettings(uid);

    let mergedMembers: User[] = [];
    let mergedMeals: Meal[] = [];
    let mergedHealth: HealthRecord[] = [];

    await runDexie(async () => {
      const localMembers = await dexieDb.users.toArray();
      const localMeals = await dexieDb.meals.toArray();
      const localHealth = await dexieDb.health.toArray();
      const settingsRow = await dexieDb.settings.get(SETTINGS_KEY);
      let localSettings: AppSettings = settingsRow ?? { id: SETTINGS_KEY };

      const pd = localSettings.cloudPendingDeletes;
      const skipMeals = new Set(pd?.meals ?? []);
      const skipHealth = new Set(pd?.health ?? []);
      const remoteMealsFiltered = remoteMeals.filter((m) => !skipMeals.has(m.id));
      const remoteHealthFiltered = remoteHealth.filter((h) => !skipHealth.has(h.id));

      mergedMembers = mergeUsers(localMembers, remoteMembers);
      mergedMembers = ensureMembersForRemoteOwners(
        mergedMembers,
        remoteMealsFiltered,
        remoteHealthFiltered,
      );
      mergedMeals = await mergeMeals(localMeals, remoteMealsFiltered);
      mergedHealth = await mergeHealth(localHealth, remoteHealthFiltered);

      if (remotePublic && remotePublic.updatedAt > (localSettings.appSettingsUpdatedAt ?? 0)) {
        localSettings = {
          ...localSettings,
          activeUserId: remotePublic.activeUserId,
          onboarded: remotePublic.onboarded,
          theme: remotePublic.theme,
          appSettingsUpdatedAt: remotePublic.updatedAt,
          id: SETTINGS_KEY,
        };
      }

      if (remotePrivate && remotePrivate.updatedAt > (localSettings.geminiSettingsUpdatedAt ?? 0)) {
        localSettings = {
          ...localSettings,
          geminiApiKey: remotePrivate.geminiApiKey || undefined,
          geminiSettingsUpdatedAt: remotePrivate.updatedAt,
          id: SETTINGS_KEY,
        };
      }

      const consolidated = consolidateToFirebaseProfile(
        uid,
        mergedMembers,
        mergedMeals,
        mergedHealth,
      );
      mergedMembers = consolidated.members;
      mergedMeals = consolidated.meals;
      mergedHealth = consolidated.health;

      localSettings = {
        ...localSettings,
        activeUserId: consolidated.activeUserId,
        id: SETTINGS_KEY,
      };

      await dexieDb.transaction(
        "rw",
        dexieDb.users,
        dexieDb.meals,
        dexieDb.health,
        dexieDb.settings,
        async () => {
          const mu = new Set(mergedMembers.map((x) => x.id));
          const oldU = await dexieDb.users.toCollection().primaryKeys();
          await dexieDb.users.bulkDelete(oldU.filter((id) => !mu.has(id as string)) as string[]);
          await dexieDb.users.bulkPut(mergedMembers);

          const mm = new Set(mergedMeals.map((x) => x.id));
          const oldM = await dexieDb.meals.toCollection().primaryKeys();
          await dexieDb.meals.bulkDelete(oldM.filter((id) => !mm.has(id as string)) as string[]);
          await dexieDb.meals.bulkPut(mergedMeals);

          const mh = new Set(mergedHealth.map((x) => x.id));
          const oldH = await dexieDb.health.toCollection().primaryKeys();
          await dexieDb.health.bulkDelete(oldH.filter((id) => !mh.has(id as string)) as string[]);
          await dexieDb.health.bulkPut(mergedHealth);

          await dexieDb.settings.put({
            ...localSettings,
            lastCloudSyncAt: Date.now(),
            cloudPendingDeletes: prunePendingDeletes(
              localSettings.cloudPendingDeletes,
              mergedMeals,
              mergedHealth,
            ),
            id: SETTINGS_KEY,
          });
        },
      );
    });

    await deleteRemoteMembersNotIn(uid, new Set(mergedMembers.map((x) => x.id)));
    await deleteRemoteMealsNotIn(uid, new Set(mergedMeals.map((x) => x.id)));
    await deleteRemoteHealthNotIn(uid, new Set(mergedHealth.map((x) => x.id)));

    await pushMembers(uid, mergedMembers);
    await pushMeals(uid, mergedMeals);
    await pushHealth(uid, mergedHealth);

    const latestLocal = await getSettings();
    await pushPublicSettings(uid, latestLocal);
    await pushPrivateSettings(uid, latestLocal);
  } finally {
    cloudSyncMutationDepth--;
  }
}
