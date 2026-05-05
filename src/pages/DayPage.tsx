import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  afterUserDataMutation,
  db,
  getAnalysisProfileForUser,
  getSettings,
  normalizeMeal,
  uid,
} from "../lib/db";
import { analyzeMealImage } from "../lib/ai";
import {
  deleteEntireMeal,
  deleteMealItem,
  saveMealItemPatch,
  updateMealItem,
} from "../lib/mealItems";
import {
  MEAL_SLOTS,
  MEAL_SLOT_EMOJI,
  MEAL_SLOT_LABELS,
  type Meal,
  type MealItem,
  type MealSlot,
} from "../types";
import PhotoUpload from "../components/PhotoUpload";
import {
  MealItemCard,
  MealItemCardsCarousel,
  MealItemEditDialog,
} from "../components/MealCard";
import MealSocialBlock from "../components/MealSocialBlock";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { useAuth } from "../contexts/AuthContext";
import { formatKoDate } from "../lib/utils";
import { MAX_MEAL_ITEMS } from "../lib/mealLimits";
import { cls } from "../lib/utils";

export default function DayPage() {
  const { date = "" } = useParams();
  const navigate = useNavigate();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const settings = useLiveQuery(() => getSettings(), []);
  const userId = usePrimaryUserId();
  const { user, firebaseReady } = useAuth();

  const meals = useLiveQuery(
    async () =>
      userId && date
        ? (
            await db.meals.where("[userId+date]").equals([userId, date]).toArray()
          ).map(normalizeMeal)
        : [],
    [userId, date],
  );

  const mealsBySlot = useMemo(() => {
    const m = new Map<MealSlot, Meal>();
    meals?.forEach((x) => m.set(x.slot, x));
    return m;
  }, [meals]);

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-2 hover:bg-slate-800"
          aria-label="뒤로"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="text-xs text-slate-400">식사 기록</p>
          <h1 className="text-lg font-bold">{formatKoDate(date)}</h1>
        </div>
      </header>

      {!settings?.geminiApiKey && (
        <Link
          to="/settings"
          className="card border-slate-700 bg-slate-900/40 px-4 py-3 text-xs text-slate-400"
        >
          AI 분석은 설정에 Gemini 키가 필요합니다.
        </Link>
      )}

      {!userId && (
        <div className="card p-4 text-center text-sm text-slate-400">
          프로필을 불러오는 중이에요.
        </div>
      )}

      {!validDate && (
        <div className="card p-4 text-center text-sm text-rose-300">잘못된 날짜입니다.</div>
      )}

      {userId && validDate &&
        MEAL_SLOTS.map((slot) => (
          <SlotSection
            key={slot}
            slot={slot}
            date={date}
            userId={userId}
            meal={mealsBySlot.get(slot)}
            apiKey={settings?.geminiApiKey}
            ownerUid={firebaseReady ? user?.uid : undefined}
          />
        ))}
    </div>
  );
}

interface SlotProps {
  slot: MealSlot;
  date: string;
  userId: string;
  meal?: Meal;
  apiKey?: string;
  ownerUid?: string;
}

function SlotSection({ slot, date, userId, meal, apiKey, ownerUid }: SlotProps) {
  const sectionRef = useRef<HTMLElement>(null);
  /** AI 분석은 한 번에 하나씩 돌려 API·DB 업데이트 레이스를 줄인다 */
  const analysisTailRef = useRef(Promise.resolve());
  const [searchParams] = useSearchParams();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [scrollCarouselToItemId, setScrollCarouselToItemId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("slot") !== slot) return;
    const t = window.setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => clearTimeout(t);
  }, [slot, searchParams]);

  const items = meal?.items ?? [];

  const clearCarouselScrollRequest = useCallback(() => setScrollCarouselToItemId(null), []);

  async function mealRowForSlot(): Promise<Meal | undefined> {
    if (meal?.id) {
      const row = await db.meals.get(meal.id);
      if (row) return normalizeMeal(row);
    }
    const rows = await db.meals
      .where("[userId+date]")
      .equals([userId, date])
      .filter((r) => r.slot === slot)
      .toArray();
    const row = rows[0];
    return row ? normalizeMeal(row) : undefined;
  }

  async function addItemWithPhoto(photo: Blob, thumbnail: Blob) {
    const base = await mealRowForSlot();
    const currentItems = base?.items ?? [];
    if (currentItems.length >= MAX_MEAL_ITEMS) {
      alert(`한 끼니에는 사진을 최대 ${MAX_MEAL_ITEMS}장까지 올릴 수 있어요.`);
      return;
    }
    const now = Date.now();
    const itemId = uid();
    const newItem: MealItem = {
      id: itemId,
      photo,
      thumbnail,
      analysisStatus: apiKey ? "analyzing" : "skipped",
      createdAt: now,
      updatedAt: now,
    };
    const mealId = base?.id ?? uid();
    const nextMeal: Meal = base
      ? { ...base, items: [...currentItems, newItem], updatedAt: now }
      : {
          id: mealId,
          userId,
          date,
          slot,
          items: [newItem],
          createdAt: now,
          updatedAt: now,
        };
    await db.meals.put(nextMeal);
    afterUserDataMutation();
    setScrollCarouselToItemId(itemId);

    if (apiKey) {
      const mid = nextMeal.id;
      analysisTailRef.current = analysisTailRef.current
        .then(() => runAnalysis(mid, itemId, photo, apiKey))
        .catch(() => {});
      void analysisTailRef.current;
    }
  }

  async function runAnalysis(mealId: string, itemId: string, photo: Blob, key: string) {
    try {
      const profile = await getAnalysisProfileForUser(userId);
      const result = await analyzeMealImage(key, photo, slot, undefined, profile);
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
    } catch (e) {
      await updateMealItem(mealId, itemId, (it) => ({
        ...it,
        analysisStatus: "error",
        analysisError: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  async function reAnalyzeItem(item: MealItem) {
    if (!meal || !apiKey || !item.photo) return;
    await updateMealItem(meal.id, item.id, (it) => ({
      ...it,
      analysisStatus: "analyzing",
      analysisError: undefined,
      manuallyEdited: false,
    }));
    analysisTailRef.current = analysisTailRef.current
      .then(() => runAnalysis(meal.id, item.id, item.photo!, apiKey))
      .catch(() => {});
    void analysisTailRef.current;
  }

  async function removeItem(itemId: string) {
    if (!meal) return;
    if (!confirm("이 사진을 삭제할까요?")) return;
    await deleteMealItem(meal.id, itemId, { ownerUid });
  }

  async function removeEntireSlot() {
    if (!meal) return;
    if (!confirm("이 끼니 전체를 지울까요? 사진과 분석 결과가 모두 사라져요.")) return;
    await deleteEntireMeal(meal.id, { ownerUid });
  }

  const editingItem = items.find((it) => it.id === editingItemId) ?? null;

  return (
    <section ref={sectionRef} id={slot} className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-xl">{MEAL_SLOT_EMOJI[slot]}</span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{MEAL_SLOT_LABELS[slot]}</h3>
            {items.length > 0 && (
              <p className="text-[11px] text-slate-400">
                사진 {items.length}장
              </p>
            )}
          </div>
          <ChevronDown
            size={16}
            className={cls(
              "ml-1 shrink-0 text-slate-500 transition-transform",
              !expanded && "-rotate-90",
            )}
          />
        </button>
        {meal && (
          <button
            onClick={removeEntireSlot}
            className="rounded-lg p-2 text-slate-500 hover:text-rose-400"
            aria-label="끼니 전체 삭제"
          >
            <Trash2 size={16} />
          </button>
        )}
      </header>

      {expanded && (
        <div className="space-y-3 p-4">
          {items.length > 0 && (
            <MealItemCardsCarousel
              items={items}
              scrollToItemId={scrollCarouselToItemId}
              onScrollToItemHandled={clearCarouselScrollRequest}
              renderSlide={(it, idx) => (
                <MealItemCard
                  item={it}
                  index={idx}
                  canAnalyze={!!apiKey}
                  onReanalyze={() => void reAnalyzeItem(it)}
                  onEdit={() => setEditingItemId(it.id)}
                  onRemove={() => void removeItem(it.id)}
                />
              )}
            />
          )}

          <PhotoUpload
            label={items.length === 0 ? "사진 찍어 기록하기" : "사진 추가하기"}
            onPicked={addItemWithPhoto}
            multipleGallery
            variant={items.length === 0 ? "primary" : "ghost"}
            disabled={items.length >= MAX_MEAL_ITEMS}
            square
          />
          {items.length >= MAX_MEAL_ITEMS && (
            <p className="text-center text-[11px] text-slate-500">
              이 끼니는 사진 {MAX_MEAL_ITEMS}장까지 추가할 수 있어요.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (items.length >= MAX_MEAL_ITEMS) {
                alert(`한 끼니에는 항목을 최대 ${MAX_MEAL_ITEMS}개까지 추가할 수 있어요.`);
                return;
              }
              // 분석 없이 메뉴만 기록하고 싶을 때를 위한 빠른 진입점.
              // 빈 슬롯에서도 사진 없이 바로 기록할 수 있게 항상 노출한다.
              const now = Date.now();
              const id = uid();
              const newItem: MealItem = {
                id,
                analysisStatus: "skipped",
                createdAt: now,
                updatedAt: now,
              };
              const base: Meal = meal
                ? { ...meal, items: [...items, newItem], updatedAt: now }
                : {
                    id: uid(),
                    userId,
                    date,
                    slot,
                    items: [newItem],
                    createdAt: now,
                    updatedAt: now,
                  };
              void (async () => {
                await db.meals.put(base);
                afterUserDataMutation();
                setEditingItemId(id);
              })();
            }}
            className="btn-secondary w-full py-2 text-xs"
          >
            <Plus size={14} /> 사진 없이 직접 기록 추가
          </button>

          {ownerUid && meal && <MealSocialBlock ownerUid={ownerUid} mealId={meal.id} />}
        </div>
      )}

      {editingItem && meal && (
        <MealItemEditDialog
          item={editingItem}
          canReanalyze={!!apiKey}
          onClose={() => setEditingItemId(null)}
          onSave={async (patch, opts) => {
            const res = await saveMealItemPatch(meal.id, editingItem.id, patch, opts, {
              userId,
              slot,
              apiKey,
            });
            if (opts.reanalyze && !res.reanalyzed && res.error) alert(res.error);
          }}
        />
      )}
    </section>
  );
}
