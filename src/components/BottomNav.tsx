import { Link, useLocation } from "react-router-dom";
import { Calendar, HeartPulse, Rss, Settings, Users } from "lucide-react";
import { cls } from "../lib/utils";
import { useFeedDotVisible } from "../contexts/FeedStreamContext";
import { useAuth } from "../contexts/AuthContext";
import { useDmRealtime } from "../contexts/DmRealtimeContext";
import { unreadDmThreadCount } from "../lib/dm";

const items = [
  { to: "/", label: "피드", icon: Rss },
  { to: "/home", label: "식단", icon: Calendar },
  { to: "/health", label: "건강", icon: HeartPulse },
  { to: "/friends", label: "친구", icon: Users },
  { to: "/settings", label: "설정", icon: Settings },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const feedDot = useFeedDotVisible();
  const { user } = useAuth();
  const { threads, readMap, dmDeletedThreadIds } = useDmRealtime();
  const myUid = user?.uid;
  const dmUnread = myUid
    ? unreadDmThreadCount(threads, myUid, readMap, { ignoreThreadIds: dmDeletedThreadIds })
    : 0;

  return (
    <nav
      className="bottom-nav fixed bottom-0 left-1/2 z-40 w-full max-w-screen-sm -translate-x-1/2 backdrop-blur"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <ul className="flex items-stretch justify-around">
        {items.map(({ to, label, icon: Icon }) => {
          const active = isActive(to, pathname);
          const showFeedDot = to === "/" && feedDot && !active;
          const showDmDot = dmUnread > 0 && !active && (to === "/" || to === "/friends");
          const feedAndDmDots = showFeedDot && showDmDot;
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                className={cls(
                  "relative flex flex-col items-center justify-center gap-1 py-3 text-[11px] transition-colors",
                  active ? "text-brand-400" : "text-slate-400 hover:text-slate-200",
                )}
                aria-label={
                  showDmDot && myUid
                    ? `${label}, 새 DM ${dmUnread > 99 ? "99+" : dmUnread}건`
                    : undefined
                }
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {showFeedDot && (
                  <span
                    className={cls(
                      "absolute top-2 h-2 w-2 rounded-full bg-rose-500 shadow ring-2 ring-slate-950",
                      feedAndDmDots ? "right-[calc(50%+6px)]" : "right-[calc(50%-18px)]",
                    )}
                    aria-hidden
                  />
                )}
                {showDmDot && (
                  <span
                    className={cls(
                      "absolute top-2 h-2 w-2 rounded-full bg-rose-500 shadow ring-2 ring-slate-950",
                      feedAndDmDots ? "right-[calc(50%-22px)]" : "right-[calc(50%-18px)]",
                    )}
                    aria-hidden
                  />
                )}
                <span className={cls(active && "font-semibold")}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function isActive(to: string, pathname: string): boolean {
  if (to === "/") return pathname === "/";
  if (to === "/home") return pathname === "/home" || pathname.startsWith("/day");
  if (to === "/friends") return pathname === "/friends" || pathname.startsWith("/friends/");
  return pathname === to;
}
