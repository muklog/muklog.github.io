import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, MessageCircle } from "lucide-react";
import { cls } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { useDmRealtime } from "../contexts/DmRealtimeContext";
import {
  subscribeActivityInbox,
  unreadActivityCount,
} from "../lib/activityInbox";
import { unreadDmThreadCount } from "../lib/dm";

/** 피드 헤더 — 활동 알림 · DM 진입 및 미읽음 배지.
 * DM 스트림은 DmRealtimeProvider 가 피드/DM 경로에서 유지합니다.
 * 백그라운드일 때는 알림함만 끄며 Firestore 부하를 줄입니다.
 */
export default function FeedAlertsHeaderIcons() {
  const { user, firebaseReady } = useAuth();
  const myUid = user?.uid;
  const { threads, readMap: dmReadMap } = useDmRealtime();

  const [tabVisible, setTabVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const [activityUnread, setActivityUnread] = useState(0);
  useEffect(() => {
    if (!myUid || !tabVisible) return;
    return subscribeActivityInbox(
      myUid,
      (rows) => setActivityUnread(unreadActivityCount(rows)),
      () => setActivityUnread(0),
    );
  }, [myUid, tabVisible]);

  const dmUnread = myUid ? unreadDmThreadCount(threads, myUid, dmReadMap) : 0;

  if (!firebaseReady || !myUid) return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Link
        to="/notifications"
        className={cls(
          "relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
          activityUnread > 0
            ? "border-brand-400/40 bg-brand-500/15 text-brand-200"
            : "border-slate-700 bg-slate-900/50 text-slate-300 hover:bg-slate-800",
        )}
        aria-label={`알림 ${activityUnread > 0 ? `미읽음 ${activityUnread}건` : ""}`}
      >
        <Bell size={18} strokeWidth={2} />
        {activityUnread > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500 shadow ring-2 ring-slate-950" />
        )}
      </Link>
      <Link
        to="/messages"
        className={cls(
          "relative flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
          dmUnread > 0
            ? "border-brand-400/40 bg-brand-500/15 text-brand-200"
            : "border-slate-700 bg-slate-900/50 text-slate-300 hover:bg-slate-800",
        )}
        aria-label={`DM ${dmUnread > 0 ? `미읽음 ${dmUnread}건` : ""}`}
      >
        <MessageCircle size={18} strokeWidth={2} />
        {dmUnread > 0 && (
          <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow ring-2 ring-slate-950">
            {dmUnread > 99 ? "99+" : dmUnread}
          </span>
        )}
      </Link>
    </div>
  );
}
