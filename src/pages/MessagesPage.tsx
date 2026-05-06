import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getPublicProfile } from "../lib/friends";
import {
  dmErrorMessageForUi,
  ensureDmThreadWith,
  otherParticipantUid,
  subscribeDmReadMap,
  subscribeMyDmThreads,
  unreadDmThreadCount,
  verifyThreadParticipation,
} from "../lib/dm";
import { getFirebaseAuth } from "../lib/firebaseApp";
import type { DmThreadDoc } from "../types";
import FirebaseLoginCard from "../components/FirebaseLoginCard";

export default function MessagesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const peerFromQuery = searchParams.get("with")?.trim();
  const { user, firebaseReady, loading: authLoading } = useAuth();
  const [threads, setThreads] = useState<DmThreadDoc[]>([]);
  const [threadsListenErr, setThreadsListenErr] = useState<string | null>(null);
  const [readMap, setReadMap] = useState<Map<string, number>>(new Map());
  const [peerNames, setPeerNames] = useState<Map<string, string>>(new Map());
  const handledPeerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.uid || authLoading) return;
    let ua: (() => void) | undefined;
    let ub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        await getFirebaseAuth().currentUser?.getIdToken();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      const live = getFirebaseAuth().currentUser?.uid;
      if (!live || live !== user.uid) return;
      setThreadsListenErr(null);
      ua = subscribeMyDmThreads(
        user.uid,
        (rows) => {
          setThreadsListenErr(null);
          setThreads(rows);
        },
        (e) => setThreadsListenErr(dmErrorMessageForUi(e)),
      );
      ub = subscribeDmReadMap(user.uid, setReadMap, (e) =>
        console.warn("[messages] dm read map", e),
      );
    })();
    return () => {
      cancelled = true;
      ua?.();
      ub?.();
    };
  }, [user?.uid, authLoading]);

  useEffect(() => {
    if (!user?.uid || threads.length === 0) return;
    let cancelled = false;
    void (async () => {
      const peers = threads
        .map((t) => otherParticipantUid(t, user.uid!))
        .filter(Boolean) as string[];
      const uniq = [...new Set(peers)];
      const fetched = new Map<string, string>();
      for (const p of uniq) {
        if (cancelled) return;
        const prof = await getPublicProfile(p);
        if (cancelled) return;
        fetched.set(p, prof?.displayName ?? p.slice(0, 6));
      }
      if (cancelled) return;
      setPeerNames((prev) => {
        const merged = new Map(prev);
        for (const [k, v] of fetched) merged.set(k, v);
        return merged;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, threads]);

  useEffect(() => {
    if (!user?.uid || !peerFromQuery) return;
    if (peerFromQuery === user.uid) return;
    if (handledPeerRef.current === peerFromQuery) return;
    handledPeerRef.current = peerFromQuery;

    void (async () => {
      try {
        let tid: string;
        if (peerFromQuery.includes("_")) {
          tid = peerFromQuery;
          const ok = await verifyThreadParticipation(tid);
          if (!ok) throw new Error("참가할 수 없는 대화예요.");
        } else {
          tid = await ensureDmThreadWith(peerFromQuery);
        }
        navigate(`/messages/${tid}`, { replace: true });
      } catch (e) {
        handledPeerRef.current = null;
        alert(dmErrorMessageForUi(e));
        navigate("/messages", { replace: true });
      }
    })();
  }, [user?.uid, peerFromQuery, navigate]);

  const dmUnread = useMemo(
    () => (user?.uid ? unreadDmThreadCount(threads, user.uid, readMap) : 0),
    [threads, readMap, user?.uid],
  );

  if (!firebaseReady) return <Placeholder>Firebase 연동이 필요해요.</Placeholder>;
  if (!user) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <TitleBlock dmUnread={0} />
        <FirebaseLoginCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-28 pt-5">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} className="rounded-lg p-2 hover:bg-slate-800">
            <ArrowLeft size={20} />
          </button>
          <TitleBlock dmUnread={dmUnread} />
        </div>
      </header>

      {threadsListenErr && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {threadsListenErr}
        </p>
      )}

      {threads.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-400">
          아직 대화가 없어요. 친구 탭 또는 피드에서 친구 이름을 눌러 DM을 보내 보세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => {
            const peer = otherParticipantUid(t, user.uid)!;
            const label = peerNames.get(peer) ?? peer.slice(0, 6);
            const unread = unreadDmThreadCount([t], user.uid, readMap) > 0;
            return (
              <li key={t.id}>
                <Link
                  to={`/messages/${t.id}`}
                  className={
                    unread
                      ? "card flex flex-col gap-1 border-brand-500/30 bg-brand-500/5 p-4"
                      : "card flex flex-col gap-1 p-4 hover:bg-slate-900/40"
                  }
                >
                  <span className="font-semibold text-slate-100">{label}</span>
                  <span className="line-clamp-2 text-xs text-slate-400">
                    {t.lastSenderUid === user.uid ? "나 · " : ""}
                    {t.lastText || "(아직 메시지 없음)"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TitleBlock({ dmUnread }: { dmUnread: number }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-400">직접 메시지</p>
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <MessageCircle size={18} className="text-brand-400" />
        DM
        {dmUnread > 0 && (
          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">
            {dmUnread > 99 ? "99+" : dmUnread}
          </span>
        )}
      </h1>
    </div>
  );
}

function Placeholder({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <TitleBlock dmUnread={0} />
      <div className="card flex justify-center gap-2 p-8 text-sm text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        {children}
      </div>
    </div>
  );
}
