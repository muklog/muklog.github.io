/**
 * Meal.items 를 조작하는 공통 헬퍼.
 *
 * DayPage 의 "편집/재분석/삭제" 로직을 FeedPage 에서도 동일하게 쓰기 위해
 * 한 곳에 모아둔다. (둘 다 "내 것" 에 대해서만 호출된다 — 친구 데이터는
 * 쓰기 권한이 없어서 애초에 이 함수들이 돌 일이 없다.)
 *
 * 모든 함수는 내부에서:
 *   1) Dexie 의 meals 를 put/delete 하고
 *   2) afterUserDataMutation() 으로 클라우드 동기화를 예약한다.
 *
 * 삭제가 발생해 meal 이 비게 되면 서버측 meal 문서도 지우고
 * 소셜(댓글/좋아요) 서브컬렉션도 best-effort 로 정리한다.
 */
import {
  db,
  normalizeMeal,
  afterUserDataMutation,
  registerCloudDelete,
  getAnalysisProfileForUser,
  runDexie,
} from "./db";
import { cleanupMealSocial } from "./social";
import { reanalyzeMealFromText } from "./ai";
import type { MealItem, MealSlot } from "../types";

/**
 * 편집 다이얼로그에서 사용자가 저장할 때 넘기는 값. (별점은 AI 전용이라 포함 안 됨.)
 * UI 컴포넌트(MealItemEditDialog) 와 이 헬퍼가 공유한다.
 */
export interface MealItemPatch {
  menuText: string;
  aiComment?: string;
  nutrition?: MealItem["nutrition"];
}

export async function updateMealItem(
  mealId: string,
  itemId: string,
  transform: (it: MealItem) => MealItem,
  options?: { bumpMealUpdatedAt?: boolean },
): Promise<void> {
  const now = Date.now();
  const bumpMeal = options?.bumpMealUpdatedAt !== false;
  /** 성공 후 동기화 정책용 */
  let nextItemSnapshot: MealItem | undefined;

  async function attempt(): Promise<boolean> {
    return runDexie(async () => {
      const cur = await db.meals.get(mealId);
      if (!cur) return false;
      const normalized = normalizeMeal(cur);
      const hasItem = normalized.items.some((it) => it.id === itemId);
      if (!hasItem) return false;
      const nextItems = normalized.items.map((it) =>
        it.id === itemId ? { ...transform(it), updatedAt: now } : it,
      );
      nextItemSnapshot = nextItems.find((it) => it.id === itemId);
      await db.meals.put({
        ...normalized,
        items: nextItems,
        updatedAt: bumpMeal ? now : normalized.updatedAt,
      });
      return true;
    });
  }

  if (!(await attempt())) {
    // 클라우드 병합·Dexie 쓰기 직후 레이스로 항목이 아직 안 보일 수 있음
    await new Promise((r) => setTimeout(r, 120));
    if (!(await attempt())) {
      console.warn("[updateMealItem] 항목을 찾지 못함", mealId, itemId);
      return;
    }
  }
  afterUserDataMutation();
  /** AI 분석 완료/실패는 친구 피드에 곧 보이도록 디바운스를 쓰지 않고 바로 푸시 */
  const st = nextItemSnapshot?.analysisStatus;
  if (st === "done" || st === "error") {
    void import("./autoCloudSync").then((m) => {
      m.ensureAutoCloudSyncListeners();
      m.requestAutoCloudSync({ immediate: true });
    });
  }
}

export interface DeleteItemOptions {
  /** 원격 cleanup 에 필요한 owner(내 Firebase uid). 없으면 원격 소셜 정리만 건너뜀. */
  ownerUid?: string | null;
}

export async function deleteMealItem(
  mealId: string,
  itemId: string,
  { ownerUid }: DeleteItemOptions = {},
): Promise<void> {
  let deletedWholeMealId: string | undefined;
  await runDexie(async () => {
    const cur = await db.meals.get(mealId);
    if (!cur) return;
    const normalized = normalizeMeal(cur);
    const remaining = normalized.items.filter((it) => it.id !== itemId);
    if (remaining.length === 0) {
      await db.meals.delete(normalized.id);
      deletedWholeMealId = normalized.id;
    } else {
      await db.meals.put({
        ...normalized,
        items: remaining,
        updatedAt: Date.now(),
      });
    }
  });
  if (deletedWholeMealId) {
    await registerCloudDelete("meals", deletedWholeMealId);
    if (ownerUid) void cleanupMealSocial(ownerUid, deletedWholeMealId);
  }
  afterUserDataMutation();
}

export async function deleteEntireMeal(
  mealId: string,
  { ownerUid }: DeleteItemOptions = {},
): Promise<void> {
  await runDexie(async () => {
    await db.meals.delete(mealId);
  });
  await registerCloudDelete("meals", mealId);
  if (ownerUid) void cleanupMealSocial(ownerUid, mealId);
  afterUserDataMutation();
}

export interface SaveItemContext {
  userId: string;
  slot: MealSlot;
  apiKey?: string;
}

/**
 * 편집 다이얼로그의 저장 핸들러.
 *
 * opts.reanalyze=false: 사용자가 수동으로 수정한 값만 반영(manuallyEdited=true).
 * opts.reanalyze=true : 값 반영 → analyzing 플래그 → Gemini 텍스트 기반 재분석
 *                      → rating/aiComment/healthTags 갱신. 실패 시 error 상태로.
 *
 * apiKey 가 없으면 reanalyze 요청이 와도 조용히 수동 저장으로 폴백한다.
 */
export async function saveMealItemPatch(
  mealId: string,
  itemId: string,
  patch: MealItemPatch,
  opts: { reanalyze: boolean },
  ctx: SaveItemContext,
): Promise<{ reanalyzed: boolean; error?: string }> {
  await updateMealItem(mealId, itemId, (it) => ({
    ...it,
    menuText: patch.menuText,
    aiComment: patch.aiComment,
    nutrition: patch.nutrition,
    analysisStatus: opts.reanalyze && ctx.apiKey ? "analyzing" : "done",
    analysisError: undefined,
    manuallyEdited: !(opts.reanalyze && ctx.apiKey),
  }));

  if (!opts.reanalyze) return { reanalyzed: false };
  if (!ctx.apiKey) {
    return {
      reanalyzed: false,
      error: "Gemini API 키가 없어 재분석을 건너뛰었어요. 설정에서 키를 등록해 주세요.",
    };
  }

  try {
    const profile = await getAnalysisProfileForUser(ctx.userId);
    const result = await reanalyzeMealFromText(
      ctx.apiKey,
      { menuText: patch.menuText, nutrition: patch.nutrition },
      ctx.slot,
      undefined,
      profile,
    );
    await updateMealItem(mealId, itemId, (it) => ({
      ...it,
      menuText: result.menuText,
      rating: result.rating,
      aiComment: result.aiComment,
      nutrition: result.nutrition,
      analysisStatus: "done",
      analysisError: undefined,
      manuallyEdited: false,
    }));
    return { reanalyzed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateMealItem(mealId, itemId, (it) => ({
      ...it,
      analysisStatus: "error",
      analysisError: msg,
    }));
    return { reanalyzed: false, error: msg };
  }
}
