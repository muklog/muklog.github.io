import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  HeartPulse,
  Loader2,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import Calendar, { type DayCount } from "../components/Calendar";
import HealthScoreRing from "../components/HealthScoreRing";
import HealthRecordCard from "../components/HealthRecordCard";
import {
  getMyViewerShare,
  permissionDeniedMessage,
  subscribeFriendHealth,
  subscribeFriendMealsInRange,
} from "../lib/friends";
import { HEALTH_TYPE_LABELS, type HealthRecord, type Share } from "../types";
import { cls, dateKey, formatKoDate } from "../lib/utils";

type Tab = "calendar" | "health";

export default function FriendProfilePage() {
  const { uid: friendUid = "" } = useParams();
  const navigate = useNavigate();
  const { user, firebaseReady } = useAuth();
  // null = 로딩, "missing" = 권한 없음(=share 문서 없음)
  const [share, setShare] = useState<Share | null | "missing">(null);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    if (!user || !friendUid) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getMyViewerShare(friendUid);
        if (cancelled) return;
        setShare(s ?? "missing");
      } catch (e) {
        if (!cancelled) {
          console.warn("[friend profile] share fetch", e);
          setShare("missing");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, friendUid]);

  if (!firebaseReady) return <Shell>Firebase 연동이 필요해요.</Shell>;
  if (!user) return <Shell>로그인이 필요해요.</Shell>;
  if (share === null) {
    return (
      <Shell>
        <Loader2 size={16} className="mr-1 inline animate-spin" /> 불러오는 중…
      </Shell>
    );
  }
  if (share === "missing") {
    return (
      <Shell>
        <p className="mb-3">
          이 친구가 공개한 기록이 없어요. 팔로우 신청을 보내면 상대가 수락한 범위만 볼 수 있어요.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/friends")}
            className="btn-secondary flex-1 py-2 text-xs"
          >
            친구 목록으로
          </button>
          <button
            onClick={() => navigate("/friends")}
            className="btn-primary flex-1 py-2 text-xs"
          >
            <UserPlus size={12} /> 팔로우 신청
          </button>
        </div>
      </Shell>
    );
  }

  const name = share.ownerName || "친구";
  const email = share.ownerEmail || "";
  const canCalendar = share.scope.calendar;
  const canHealth = share.scope.health;
  // tab 미선택이거나 비공개 범위면 공개된 쪽으로 폴백.
  const activeTab: Tab =
    tab && ((tab === "calendar" && canCalendar) || (tab === "health" && canHealth))
      ? tab
      : canCalendar
        ? "calendar"
        : "health";

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
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">
            <Users size={12} className="mb-0.5 mr-0.5 inline" /> 친구 프로필
          </p>
          <h1 className="truncate text-lg font-bold">{name}</h1>
          <p className="truncate text-[11px] text-slate-500">{email}</p>
        </div>
      </header>

      {!canCalendar && !canHealth ? (
        <div className="card p-4 text-center text-sm text-slate-400">
          이 친구가 공개한 범위가 없어요.
        </div>
      ) : (
        <>
          <div className="flex gap-1 rounded-xl bg-slate-900/60 p-1">
            {canCalendar && (
              <TabBtn
                active={activeTab === "calendar"}
                onClick={() => setTab("calendar")}
              >
                <CalendarDays size={14} /> 달력
              </TabBtn>
            )}
            {canHealth && (
              <TabBtn
                active={activeTab === "health"}
                onClick={() => setTab("health")}
              >
                <HeartPulse size={14} /> 건강
              </TabBtn>
            )}
          </div>

          {activeTab === "calendar" && canCalendar && (
            <FriendCalendarTab friendUid={friendUid} />
          )}
          {activeTab === "health" && canHealth && (
            <FriendHealthTab friendUid={friendUid} />
          )}
        </>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header>
        <Link to="/friends" className="text-xs text-slate-400">
          ← 친구 목록
        </Link>
      </header>
      <div className="card p-4 text-sm text-slate-400">{children}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cls(
        "flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "bg-brand-500/20 text-brand-200"
          : "text-slate-400 hover:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

// ---- 달력 탭 -------------------------------------------------------------

function FriendCalendarTab({ friendUid }: { friendUid: string }) {
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<string>(dateKey());
  const [counts, setCounts] = useState<Map<string, DayCount> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  const { startKey, endKey } = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return { startKey: dateKey(start), endKey: dateKey(end) };
  }, [cursor]);

  useEffect(() => {
    setCounts(null);
    setErr(null);
    // 실시간 구독: 친구가 분석 완료/식단 변경 시 달력 수치도 곧바로 갱신된다.
    const unsub = subscribeFriendMealsInRange(
      friendUid,
      startKey,
      endKey,
      (meals) => {
        const map = new Map<string, DayCount>();
        for (const m of meals) {
          const cur = map.get(m.date) ?? { total: 0, ratings: [] };
          cur.total += 1;
          if (typeof m.rating === "number") cur.ratings.push(m.rating);
          map.set(m.date, cur);
        }
        setCounts(map);
      },
      (e) => setErr(permissionDeniedMessage(e)),
    );
    return () => unsub();
  }, [friendUid, startKey, endKey]);

  return (
    <>
      {err && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {err}
        </p>
      )}
      <Calendar
        cursor={cursor}
        setCursor={setCursor}
        selected={selected}
        onPick={(k) => {
          setSelected(k);
          navigate(`/friends/${friendUid}/day/${k}`);
        }}
        externalCounts={counts}
      />
      <div className="card p-4 text-center text-xs text-slate-500">
        날짜를 탭하면 그 날의 식사 기록을 볼 수 있어요.
        <br />
        <span className="text-slate-400">{formatKoDate(selected)}</span>
      </div>
    </>
  );
}

// ---- 건강 탭 -------------------------------------------------------------

function FriendHealthTab({ friendUid }: { friendUid: string }) {
  const [rows, setRows] = useState<HealthRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setErr(null);
    const unsub = subscribeFriendHealth(
      friendUid,
      (r) => setRows(r),
      (e) => setErr(permissionDeniedMessage(e)),
    );
    return () => unsub();
  }, [friendUid]);

  const latest = rows?.[0];

  if (err) {
    return (
      <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
        {err}
      </p>
    );
  }

  return (
    <>
      <section className="card flex items-center gap-4 p-5">
        <HealthScoreRing score={latest?.healthScore} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">최근 건강 평가</p>
          <h2 className="mt-0.5 break-words text-base font-semibold leading-snug text-slate-100">
            {latest?.summary ?? "아직 등록된 건강기록이 없어요."}
          </h2>
          {latest && (
            <p className="mt-1 text-xs text-slate-500">
              {HEALTH_TYPE_LABELS[latest.type]} · {formatKoDate(latest.recordDate)}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {rows === null && (
          <p className="card p-4 text-center text-xs text-slate-500">불러오는 중…</p>
        )}
        {rows?.length === 0 && (
          <p className="card p-4 text-center text-xs text-slate-500">
            등록된 건강기록이 없어요.
          </p>
        )}
        {rows?.map((r) => (
          <HealthRecordCard key={r.id} record={r} readOnly />
        ))}
      </section>
    </>
  );
}
