import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import {
  activityKindLabel,
  markActivityItemRead,
  markAllActivityRead,
  subscribeActivityInbox,
  unreadActivityCount,
} from "../lib/activityInbox";
import type { ActivityInboxDoc } from "../types";
import { MEAL_SLOT_LABELS } from "../types";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { cls } from "../lib/utils";
import { userFacingStorageErrorMessage } from "../lib/idbRetry";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user, firebaseReady } = useAuth();
  const [rows, setRows] = useState<ActivityInboxDoc[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeActivityInbox(
      user.uid,
      (next) => setRows(next),
      () => setRows([]),
    );
    return () => unsub();
  }, [user?.uid]);

  async function tapRow(it: ActivityInboxDoc) {
    if (!user?.uid) return;
    if (!it.read) {
      try {
        await markActivityItemRead(user.uid, it.id);
      } catch (e) {
        console.warn("[notifications] mark read", e);
      }
    }
    if (it.mealOwnerUid === user.uid) {
      navigate(`/day/${it.mealDate}?slot=${it.mealSlot}`);
    } else {
      navigate(`/friends/${it.mealOwnerUid}/day/${it.mealDate}?slot=${it.mealSlot}`);
    }
  }

  const unreadIds = useMemo(() => rows.filter((r) => !r.read).map((r) => r.id), [rows]);

  async function clearAllUnread() {
    if (!user?.uid || unreadIds.length === 0) return;
    try {
      await markAllActivityRead(user.uid, unreadIds);
    } catch (e) {
      alert(userFacingStorageErrorMessage(e));
    }
  }

  const uc = unreadActivityCount(rows);

  if (!firebaseReady) return <Placeholder>Firebase 연동이 필요해요.</Placeholder>;
  if (!user) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <TitleBlock />
        <FirebaseLoginCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-28 pt-5">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg p-2 hover:bg-slate-800"
            aria-label="뒤로"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <p className="text-xs text-slate-400">좋아요·댓글</p>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Bell size={18} className="text-brand-400" />
              알림
            </h1>
          </div>
        </div>
        {uc > 0 && (
          <button type="button" onClick={() => void clearAllUnread()} className="btn-secondary py-2 text-xs">
            모두 읽음
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-400">
          아직 알림이 없어요. 피드에서 친구를 응원해 보세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => void tapRow(it)}
                className={cls(
                  "card w-full p-4 text-left transition-colors hover:bg-slate-900/50",
                  !it.read && "border-brand-500/30 bg-brand-500/5",
                )}
              >
                <div className="flex gap-3">
                  <AvatarCircle name={it.actorName} url={it.actorPhotoURL} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-semibold text-brand-200">{activityKindLabel(it.kind)}</p>
                    <p className="text-sm font-medium text-slate-100">{it.actorName}</p>
                    <p className="text-[11px] text-slate-400">
                      {MEAL_SLOT_LABELS[it.mealSlot] ?? it.mealSlot} · {it.mealDate.replace(/-/g, ".")}
                      {it.snippet ? (
                        <>
                          {" "}
                          — <span className="text-slate-300">"{it.snippet}"</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {!it.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-400" aria-hidden />}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TitleBlock() {
  return (
    <header className="flex items-center gap-2">
      <Bell size={20} className="text-brand-400" />
      <div>
        <p className="text-xs text-slate-400">알림</p>
        <h1 className="text-xl font-bold">알림</h1>
      </div>
    </header>
  );
}

function Placeholder({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <TitleBlock />
      <div className="card flex items-center justify-center gap-2 p-8 text-sm text-slate-400">
        <Loader2 className="animate-spin" size={18} /> {children}
      </div>
    </div>
  );
}

function AvatarCircle({ name, url }: { name: string; url?: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
      />
    );
  }
  const ch = name ? Array.from(name)[0]?.toUpperCase() ?? "?" : "?";
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-100">
      {ch}
    </div>
  );
}
