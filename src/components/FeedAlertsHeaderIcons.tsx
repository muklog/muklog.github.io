import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, MessageCircle } from "lucide-react";
import { cls } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { useDmRealtime } from "../contexts/DmRealtimeContext";
import {
  subscribeActivityInbox,
  unreadActivityCount,
} from "../lib/activityInbox";
import { feedDmIconHref, unreadDmThreadCount } from "../lib/dm";

const ICON_SLOT =
  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors";

/** 알림·DM 자리 폭 고정 (gap-1 + 40px + 40px) → 로딩 전후·배지 유무로 헤더가 흔들리지 않게 */
export const FEED_HEADER_ALERTS_WIDTH_CLASS = "w-[calc(5rem+0.25rem)] shrink-0";

/** 피드 헤더 — 활동 알림 · DM 진입 및 미읽음 배지.
 * DM 스트림은 DmRealtimeProvider 가 피드/DM 경로에서 유지합니다.
 */
export default function FeedAlertsHeaderIcons() {
  const { user, firebaseReady, loading: authLoading } = useAuth();
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
  const dmEntryHref = useMemo(
    () => (myUid ? feedDmIconHref(threads, dmReadMap, myUid) : "/friends"),
    [threads, dmReadMap, myUid],
  );
  const dmEntryIsFriends = dmEntryHref === "/friends";

  const showPlaceholders = !firebaseReady || authLoading;

  if (showPlaceholders) {
    return (
      <div
        className={cls("flex items-center justify-center gap-1", FEED_HEADER_ALERTS_WIDTH_CLASS)}
        aria-busy="true"
        aria-label="알림·DM 로드 중"
      >
        <span className={cls(ICON_SLOT, "border-slate-800 bg-slate-900/55 text-slate-600 pointer-events-none")}>
          <Bell size={18} strokeWidth={2} className="opacity-65" aria-hidden />
        </span>
        <span className={cls(ICON_SLOT, "border-slate-800 bg-slate-900/55 text-slate-600 pointer-events-none")}>
          <MessageCircle size={18} strokeWidth={2} className="opacity-65" aria-hidden />
        </span>
      </div>
    );
  }

  return (
    <div className={cls("flex items-center justify-center gap-1", FEED_HEADER_ALERTS_WIDTH_CLASS)}>
      <Link
        to="/notifications"
        className={cls(
          ICON_SLOT,
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
        to={dmEntryHref}
        className={cls(
          ICON_SLOT,
          dmUnread > 0
            ? "border-brand-400/40 bg-brand-500/15 text-brand-200"
            : "border-slate-700 bg-slate-900/50 text-slate-300 hover:bg-slate-800",
        )}
        title={dmEntryIsFriends ? "열린 대화가 없으면 친구 목록으로 이동해요" : undefined}
        aria-label={
          dmEntryIsFriends
            ? `DM — 친구에서 대화 시작 (${dmUnread > 0 ? `미읽음 ${dmUnread}건` : "미읽음 없음"})`
            : `DM ${dmUnread > 0 ? `미읽음 ${dmUnread}건` : ""}`
        }
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
