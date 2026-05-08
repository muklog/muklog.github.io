import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { MealItemCard, MealItemCardsCarousel } from "../components/MealCard";
import MealSocialBlock from "../components/MealSocialBlock";
import {
  getMyViewerShare,
  getPublicProfile,
  permissionDeniedMessage,
  subscribeFriendMealsForDate,
} from "../lib/friends";
import {
  MEAL_SLOTS,
  MEAL_SLOT_EMOJI,
  MEAL_SLOT_LABELS,
  type Meal,
  type MealSlot,
  type Share,
} from "../types";
import { formatKoDate } from "../lib/utils";

export default function FriendDayPage() {
  const { uid: friendUid = "", date = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusSlot = searchParams.get("slot");
  const { user, firebaseReady } = useAuth();
  const [share, setShare] = useState<Share | null | "missing">(null);
  /** shares.ownerName 과 달리 publicProfiles 에 동기화된 앱 내 닉네임 — 친구 프로필 등과 동일 우선순위 */
  const [friendDisplayName, setFriendDisplayName] = useState("친구");
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  useEffect(() => {
    if (!user || !friendUid) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, pub] = await Promise.all([
          getMyViewerShare(friendUid),
          getPublicProfile(friendUid),
        ]);
        if (cancelled) return;
        setShare(s ?? "missing");
        const pubName = pub?.displayName?.trim();
        const fromShare = s?.ownerName?.trim();
        setFriendDisplayName(pubName || fromShare || "친구");
      } catch (e) {
        if (!cancelled) {
          console.warn("[friend day] share fetch", e);
          setShare("missing");
          setFriendDisplayName("친구");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, friendUid]);

  const canCalendar = useMemo(() => {
    if (!share || share === "missing") return false;
    return !!share.scope.calendar;
  }, [share]);

  useEffect(() => {
    if (!canCalendar || !validDate) return;
    setMeals(null);
    setErr(null);
    // 친구 기기에서 AI 분석이 끝나면 onSnapshot 이 곧바로 재호출돼 analyzing 상태가 풀린다.
    const unsub = subscribeFriendMealsForDate(
      friendUid,
      date,
      (rows) => setMeals(rows),
      (e) => setErr(permissionDeniedMessage(e)),
    );
    return () => unsub();
  }, [canCalendar, friendUid, date, validDate]);

  const mealsBySlot = useMemo(() => {
    const m = new Map<MealSlot, Meal>();
    meals?.forEach((x) => m.set(x.slot, x));
    return m;
  }, [meals]);

  useEffect(() => {
    if (!focusSlot || meals === null) return;
    if (!(MEAL_SLOTS as readonly string[]).includes(focusSlot)) return;
    const slot = focusSlot as MealSlot;
    const el = typeof document !== "undefined"
      ? document.getElementById(`meal-slot-${slot}`)
      : null;
    if (!el) return;
    requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [focusSlot, meals, date]);

  if (!firebaseReady) return <Shell onBack={() => navigate(-1)}>Firebase 연동이 필요해요.</Shell>;
  if (!user) return <Shell onBack={() => navigate(-1)}>로그인이 필요해요.</Shell>;
  if (!validDate) return <Shell onBack={() => navigate(-1)}>잘못된 날짜입니다.</Shell>;
  if (share === null) {
    return (
      <Shell onBack={() => navigate(-1)}>
        <Loader2 size={16} className="mr-1 inline animate-spin" /> 불러오는 중…
      </Shell>
    );
  }
  if (share === "missing" || !canCalendar) {
    return (
      <Shell onBack={() => navigate(-1)}>
        이 친구의 식사 기록이 내게 공개되어 있지 않아요.
      </Shell>
    );
  }

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
          <p className="text-xs text-slate-400">{friendDisplayName}님의 식사 기록</p>
          <h1 className="text-lg font-bold">{formatKoDate(date)}</h1>
        </div>
      </header>

      {err && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {err}
        </p>
      )}

      {meals === null && !err && (
        <p className="card p-4 text-center text-xs text-slate-500">불러오는 중…</p>
      )}

      {meals &&
        MEAL_SLOTS.map((slot) => (
          <SlotSection
            key={slot}
            slot={slot}
            meal={mealsBySlot.get(slot)}
            ownerUid={friendUid}
          />
        ))}
    </div>
  );
}

function Shell({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header className="flex items-center gap-2">
        <button onClick={onBack} className="rounded-lg p-2 hover:bg-slate-800" aria-label="뒤로">
          <ArrowLeft size={20} />
        </button>
      </header>
      <div className="card p-4 text-sm text-slate-400">{children}</div>
    </div>
  );
}

function SlotSection({
  slot,
  meal,
  ownerUid,
}: {
  slot: MealSlot;
  meal?: Meal;
  ownerUid: string;
}) {
  const items = meal?.items ?? [];
  return (
    <section id={`meal-slot-${slot}`} className="card scroll-mt-24 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <span className="text-xl">{MEAL_SLOT_EMOJI[slot]}</span>
        <h3 className="text-base font-semibold">{MEAL_SLOT_LABELS[slot]}</h3>
        {items.length > 1 && (
          <span className="ml-auto text-[11px] text-slate-400">사진 {items.length}장</span>
        )}
      </header>
      <div className="space-y-3 p-4">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">기록 없음</p>
        ) : (
          <MealItemCardsCarousel
            items={items}
            renderSlide={(it, idx) => (
              <MealItemCard item={it} index={idx} readOnly />
            )}
          />
        )}
        {meal && <MealSocialBlock ownerUid={ownerUid} mealId={meal.id} />}
      </div>
    </section>
  );
}
