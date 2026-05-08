/** IndexedDB 이름이 바뀌면 예전 DB 파일은 브라우저에 남습니다. 같은 출처에서는 `migrateLegacyIndexedDbIfEmpty` 로 `healthhealth` → `muklog`, 이어서 예전 이름 `mealog` → `muklog` 복사를 시도합니다. */
import Dexie, { type Table } from "dexie";
import type { AppSettings, HealthRecord, Meal, MealItem, User } from "../types";
import { isTransientIndexedDbError, withIndexedDbRetry } from "./idbRetry";

/**
 * v1 시절의 Meal 구조 — top-level 에 photo/menuText/rating/... 이 있고 items 가 없다.
 * upgrade 에서만 쓰기 때문에 여기에 로컬 타입으로 둔다.
 */
interface LegacyMealV1 {
  id: string;
  userId: string;
  date: string;
  slot: string;
  photo?: Blob;
  thumbnail?: Blob;
  menuText?: string;
  rating?: number;
  aiComment?: string;
  nutrition?: MealItem["nutrition"];
  analysisStatus?: MealItem["analysisStatus"];
  analysisError?: string;
  createdAt: number;
  updatedAt: number;
}

function legacyMealToItems(m: LegacyMealV1): MealItem[] {
  const hasPayload =
    !!m.photo || !!m.thumbnail || !!m.menuText || !!m.rating || !!m.aiComment || !!m.nutrition;
  if (!hasPayload) return [];
  return [
    {
      id: `${m.id}__i0`,
      photo: m.photo,
      thumbnail: m.thumbnail,
      menuText: m.menuText,
      rating: m.rating,
      aiComment: m.aiComment,
      nutrition: m.nutrition,
      analysisStatus: m.analysisStatus ?? (m.menuText ? "done" : "skipped"),
      analysisError: m.analysisError,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    },
  ];
}

/**
 * 방어적 정규화: items 가 없거나 레거시 top-level 사진/메뉴가 있는 Meal 을
 * 새 구조(items[]) 로 바꾼다. 클라우드에서 레거시 문서가 내려오는 상황 등
 * 런타임에서 바로 교정해야 하는 경로에서 사용.
 */
export function normalizeMeal(m: Meal | (LegacyMealV1 & { items?: MealItem[] })): Meal {
  const maybe = m as Meal & Partial<LegacyMealV1>;
  if (Array.isArray(maybe.items) && maybe.items.length > 0) {
    return {
      id: maybe.id,
      userId: maybe.userId,
      date: maybe.date,
      slot: maybe.slot as Meal["slot"],
      items: maybe.items,
      createdAt: maybe.createdAt,
      updatedAt: maybe.updatedAt,
    };
  }
  const items = legacyMealToItems(maybe as LegacyMealV1);
  return {
    id: maybe.id,
    userId: maybe.userId,
    date: maybe.date,
    slot: maybe.slot as Meal["slot"],
    items,
    createdAt: maybe.createdAt,
    updatedAt: maybe.updatedAt,
  };
}

/** Dexie 인스턴스에 먹로그 스키마 v1·v2 를 붙인다. (현재 DB·레거시 `healthhealth`·이전 이름 `mealog` 공통) */
function applyMuklogDexieVersions(d: Dexie) {
  d.version(1).stores({
    users: "id, name, createdAt",
    meals: "id, userId, date, slot, [userId+date], [date+slot], createdAt",
    health: "id, userId, type, recordDate, createdAt",
    settings: "id",
  });
  d.version(2)
    .stores({
      users: "id, name, createdAt",
      meals:
        "id, userId, date, slot, [userId+date], [date+slot], createdAt, updatedAt",
      health: "id, userId, type, recordDate, createdAt",
      settings: "id",
    })
    .upgrade(async (tx) => {
      const table = tx.table<LegacyMealV1>("meals");
      await table.toCollection().modify((rec) => {
        const current = rec as LegacyMealV1 & { items?: MealItem[] };
        if (Array.isArray(current.items)) return;
        current.items = legacyMealToItems(current);
        delete current.photo;
        delete current.thumbnail;
        delete current.menuText;
        delete current.rating;
        delete current.aiComment;
        delete current.nutrition;
        delete current.analysisStatus;
        delete current.analysisError;
      });
    });
}

class MuklogDB extends Dexie {
  users!: Table<User, string>;
  meals!: Table<Meal, string>;
  health!: Table<HealthRecord, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super("muklog");
    applyMuklogDexieVersions(this);
  }
}

export const db = new MuklogDB();

export const SETTINGS_KEY = "settings" as const;

function mergeSettingsPatch(cur: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...cur, ...patch, id: SETTINGS_KEY };
  if ("appSettingsUpdatedAt" in patch && patch.appSettingsUpdatedAt !== undefined) {
    next.appSettingsUpdatedAt = patch.appSettingsUpdatedAt;
  } else if ("activeUserId" in patch || "onboarded" in patch || "theme" in patch) {
    next.appSettingsUpdatedAt = Date.now();
  }
  if ("geminiApiKey" in patch) {
    next.geminiSettingsUpdatedAt = Date.now();
  }
  return next;
}

/** Safari 등 IndexedDB 일시 오류 시 재시도 — 페이지·라이브쿼리에서 직접 Dexie 를 쓸 때 감싼다. */
export async function runDexie<T>(fn: () => Promise<T>): Promise<T> {
  return withIndexedDbRetry(db, fn);
}

/** 온보딩 완료: 사용자 행 + 설정을 한 트랜잭션으로 저장. iOS 는 runDexie 재시도 후에도 한 번 더 전체 패스를 돈다. */
export async function finishOnboardingSave(args: {
  userRow: User;
  settingsPatch: Partial<AppSettings>;
}): Promise<void> {
  const ios =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const passes = ios ? 4 : 1;
  let lastErr: unknown;

  for (let p = 0; p < passes; p++) {
    try {
      await runDexie(async () => {
        await db.transaction("rw", db.users, db.settings, async () => {
          await db.users.put(args.userRow);
          const cur = await db.settings.get(SETTINGS_KEY);
          const base = (cur ?? { id: SETTINGS_KEY }) as AppSettings;
          const next = mergeSettingsPatch(base, args.settingsPatch);
          await db.settings.put(next);
        });
      });
      scheduleAutoSyncAfterSettings(args.settingsPatch);
      return;
    } catch (e) {
      lastErr = e;
      if (!ios || p === passes - 1 || !isTransientIndexedDbError(e)) throw e;
      await new Promise((r) => setTimeout(r, 320 + p * 480));
    }
  }
  throw lastErr;
}

export async function getSettings(): Promise<AppSettings> {
  return runDexie(async () => {
    const s = await db.settings.get(SETTINGS_KEY);
    return s ?? { id: SETTINGS_KEY };
  });
}

/** 로그아웃·Google 계정 전환 시: 로컬 프로필·기록·설정 전부 초기화(다음 로그인 계정의 클라우드로 채움). */
export async function clearLocalProfileDataPreservingDevicePreferences(): Promise<void> {
  await runDexie(async () => {
    await db.transaction("rw", db.users, db.meals, db.health, db.settings, async () => {
      await db.users.clear();
      await db.meals.clear();
      await db.health.clear();
      await db.settings.clear();
      await db.settings.put({ id: SETTINGS_KEY });
    });
  });
}

// db.ts ↔ cloudSync.ts ↔ autoCloudSync.ts 사이의 순환 의존성을 끊기 위해
// autoCloudSync 는 동적으로만 import 한다. (vite 가 dynamic+static 동시 import 경고를
// 띄우지만 같은 청크라 실제 분리되지 않으니 무시해도 됩니다.)
function scheduleAutoSyncAfterSettings(_patch: Partial<AppSettings>): void {
  void import("./autoCloudSync").then((m) => {
    m.ensureAutoCloudSyncListeners();
    m.requestAutoCloudSync();
  });
}

/** 식단·건강·프로필 등 로컬 데이터 변경 후 호출 — 로그인 시 클라우드와 자동 맞춤 */
export function afterUserDataMutation(): void {
  void import("./autoCloudSync").then((m) => {
    m.ensureAutoCloudSyncListeners();
    m.requestAutoCloudSync();
  });
}

export async function patchSettings(patch: Partial<AppSettings>): Promise<void> {
  await runDexie(async () => {
    const cur = await db.settings.get(SETTINGS_KEY);
    const base = (cur ?? { id: SETTINGS_KEY }) as AppSettings;
    const next = mergeSettingsPatch(base, patch);
    await db.settings.put(next);
  });
  scheduleAutoSyncAfterSettings(patch);
}

/**
 * 온보딩에서 Google 계정 id 로 프로필 primary key 를 맞출 때, 식단·건강의 userId 도 같이 옮긴다.
 */
export async function migrateLocalProfileAndRecordsToUserId(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  await runDexie(async () => {
    await db.transaction("rw", db.users, db.meals, db.health, async () => {
      const row = await db.users.get(fromId);
      if (!row) return;
      await db.users.delete(fromId);
      await db.users.put({ ...row, id: toId, updatedAt: Date.now() });
      await db.meals.where("userId").equals(fromId).modify({ userId: toId });
      await db.health.where("userId").equals(fromId).modify({ userId: toId });
    });
  });
}

export function uid(): string {
  // 안전한 32-bit 랜덤 ID
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

/** 식단·건강 삭제 시 클라우드 동기화가 원격 문서를 다시 끌어오지 않도록 표시 */
export async function registerCloudDeletes(ids: {
  meals?: string[];
  health?: string[];
}): Promise<void> {
  const cur = await getSettings();
  const pd = cur.cloudPendingDeletes ?? {};
  const meals = new Set([...(pd.meals ?? []), ...(ids.meals ?? [])]);
  const health = new Set([...(pd.health ?? []), ...(ids.health ?? [])]);
  const cloudPendingDeletes =
    meals.size + health.size === 0
      ? undefined
      : { meals: [...meals], health: [...health] };
  await patchSettings({ cloudPendingDeletes });
}

export async function registerCloudDelete(
  kind: "meals" | "health",
  id: string,
): Promise<void> {
  await registerCloudDeletes({ [kind]: [id] });
}

/**
 * AI 분석에 넘길 사용자 프로필을 로컬 Dexie 에서 조립한다.
 *
 * 로그인 전이거나 프로필이 없는 경우 undefined 반환. 나이는 YYYY-MM-DD 로
 * 저장된 birthDate 로부터 현재 시점 기준으로 계산한다 (birthYear 만 있는
 * 기존 사용자는 1월 1일 기준 근사).
 */
export async function getAnalysisProfileForUser(
  userId: string | undefined,
): Promise<
  | {
      heightCm?: number;
      weightKg?: number;
      ageYears?: number;
      gender?: User["gender"];
      focusConditions?: string[];
    }
  | undefined
> {
  if (!userId) return undefined;
  const u = await runDexie(() => db.users.get(userId));
  if (!u) return undefined;
  let ageYears: number | undefined;
  if (u.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(u.birthDate)) {
    const [y, m, d] = u.birthDate.split("-").map((x) => Number(x));
    const now = new Date();
    let age = now.getFullYear() - y;
    const passed =
      now.getMonth() + 1 > m ||
      (now.getMonth() + 1 === m && now.getDate() >= d);
    if (!passed) age -= 1;
    ageYears = age >= 0 && age < 130 ? age : undefined;
  } else if (typeof u.birthYear === "number") {
    const age = new Date().getFullYear() - u.birthYear;
    ageYears = age >= 0 && age < 130 ? age : undefined;
  }
  return {
    heightCm: typeof u.heightCm === "number" ? u.heightCm : undefined,
    weightKg: typeof u.weightKg === "number" ? u.weightKg : undefined,
    ageYears,
    gender: u.gender,
    focusConditions:
      Array.isArray(u.focusConditions) && u.focusConditions.length > 0
        ? u.focusConditions
        : undefined,
  };
}

const LEGACY_IDB_NAME = "healthhealth";

const RENAMED_PREVIOUS_IDB_NAME = "mealog";

/**
 * 예전 `healthhealth` 또는 리브랜드 직전 `mealog` 이름 DB 가 같은 출처에 남아 있으면,
 * 현재 `muklog` DB 가 비어 있을 때 한 번만 복사합니다.
 * (출처(origin)가 다르면 브라우저가 DB를 분리해 두므로 이 함수만으로는 다른 도메인 데이터를 읽을 수 없습니다.)
 */
async function copyDexieSourceIntoCurrentDbIfStillEmpty(fromDbName: string): Promise<boolean> {
  if (!(await Dexie.exists(fromDbName))) return false;
  await db.open();
  const [nu, nm] = await Promise.all([db.users.count(), db.meals.count()]);
  if (nu > 0 || nm > 0) return false;

  const Src = new Dexie(fromDbName);
  applyMuklogDexieVersions(Src);

  await Src.open();
  const users = await Src.table("users").toArray();
  const mealsRaw = await Src.table("meals").toArray();
  const health = await Src.table("health").toArray();
  const settingsRow = await Src.table("settings").get(SETTINGS_KEY);
  await Src.close();

  const hasAny =
    users.length > 0 ||
    mealsRaw.length > 0 ||
    health.length > 0 ||
    settingsRow != null;
  if (!hasAny) return false;

  await runDexie(async () => {
    await db.transaction("rw", db.users, db.meals, db.health, db.settings, async () => {
      if (users.length > 0) await db.users.bulkPut(users as User[]);
      if (mealsRaw.length > 0) {
        await db.meals.bulkPut(
          (mealsRaw as Meal[]).map((m) => normalizeMeal(m)),
        );
      }
      if (health.length > 0) await db.health.bulkPut(health as HealthRecord[]);
      if (settingsRow != null) {
        await db.settings.put({ ...(settingsRow as AppSettings), id: SETTINGS_KEY });
      }
    });
  });
  console.info(`[db] IndexedDB (${fromDbName}) → muklog 복사 완료`);
  void import("./autoCloudSync").then((m) => {
    m.ensureAutoCloudSyncListeners();
    m.requestAutoCloudSync({ immediate: true });
  });
  return true;
}

export async function migrateLegacyIndexedDbIfEmpty(): Promise<void> {
  try {
    await copyDexieSourceIntoCurrentDbIfStillEmpty(LEGACY_IDB_NAME);
    await copyDexieSourceIntoCurrentDbIfStillEmpty(RENAMED_PREVIOUS_IDB_NAME);
  } catch (e) {
    console.warn("[db] 레거시 IndexedDB 복사 실패", e);
  }
}
