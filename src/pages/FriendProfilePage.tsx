import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Users,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import Calendar, { type DayCount } from "../components/Calendar";
import {
  getFriendConnection,
  permissionDeniedMessage,
  subscribeFriendMealsInRange,
} from "../lib/friends";
import { dateKey, formatKoDate } from "../lib/utils";

export default function FriendProfilePage() {
  const { uid: friendUid = "" } = useParams();
  const navigate = useNavigate();
  const { user, firebaseReady } = useAuth();
  // null = 로딩, "missing" = 양방향 share 없음 또는 DM 연결 불가
  const [connection, setConnection] = useState<
    Awaited<ReturnType<typeof getFriendConnection>> | "missing" | null
  >(null);

  useEffect(() => {
    if (!user || !friendUid) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getFriendConnection(friendUid);
        if (cancelled) return;
        setConnection(c ?? "missing");
      } catch (e) {
        if (!cancelled) {
          console.warn("[friend profile] share fetch", e);
          setConnection("missing");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, friendUid]);

  if (!firebaseReady) return <Shell>Firebase 연동이 필요해요.</Shell>;
  if (!user) return <Shell>로그인이 필요해요.</Shell>;
  if (connection === null) {
    return (
      <Shell>
        <Loader2 size={16} className="mr-1 inline animate-spin" /> 불러오는 중…
      </Shell>
    );
  }
  if (connection === "missing") {
    return (
      <Shell>
        <p className="mb-3">
          연결된 친구가 아니에요. 친구 탭에서 <strong className="text-slate-200">초대 링크</strong>로 맞추거나, 상대가 보낸 링크로
          수락해 주세요.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/friends")}
            className="btn-primary w-full py-2 text-sm"
          >
            친구 탭에서 초대 링크 보내기
          </button>
        </div>
      </Shell>
    );
  }

  const name = connection.displayName;

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
        </div>
        <Link
          to={`/messages?with=${encodeURIComponent(friendUid)}`}
          className="btn-secondary flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm"
          aria-label="DM 보내기"
        >
          <MessageCircle size={18} strokeWidth={2} />
          DM
        </Link>
      </header>

      {connection.canViewFriendCalendar ? (
        <FriendCalendarTab friendUid={friendUid} />
      ) : (
        <div className="card p-4 text-center text-sm text-slate-400">
          이 친구의 식단 달력은 아직 볼 수 없어요. 상대가 나에게 달력을 공개하면 여기에 표시돼요.
        </div>
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
          const items = m.items ?? [];
          if (items.length === 0) continue;
          const cur = map.get(m.date) ?? { total: 0, ratings: [] };
          cur.total += 1;
          for (const it of items) {
            if (typeof it.rating === "number") cur.ratings.push(it.rating);
          }
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

