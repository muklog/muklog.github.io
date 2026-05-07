import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useDmRealtime } from "../contexts/DmRealtimeContext";
import { resolvePeerIdentityForDm, subscribePublicProfilesForUids, type PeerDmIdentity } from "../lib/friends";
import {
  ensureDmThreadWith,
  otherParticipantUid,
  otherUidInDmThreadId,
  unreadDmThreadCount,
  userInDmThreadId,
} from "../lib/dm";
import type { DmThreadDoc } from "../types";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { isFirestoreMobileUa } from "../lib/firebaseApp";

export default function MessagesPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const peerFromQuery = searchParams.get("with")?.trim();
  const { user, firebaseReady, loading: authLoading } = useAuth();
  const {
    threads,
    readMap,
    threadsListReady: listReady,
    threadsListError: listErr,
    retryDmList,
  } = useDmRealtime();

  const [peerIdMap, setPeerIdMap] = useState<Map<string, PeerDmIdentity>>(new Map());
  const handledPeerRef = useRef<string | null>(null);
  /** 모바일에서 목록 대기만 길게 걸릴 때 자동 재구독(한 번만) — PC는 스킵 */
  const listKickOnceRef = useRef(false);

  useEffect(() => {
    listKickOnceRef.current = false;
  }, [pathname]);

  useEffect(() => {
    if (!firebaseReady || !user?.uid) return;
    if (pathname !== "/messages") return;
    if (!isFirestoreMobileUa()) return;
    if (listReady || listErr) return;

    const t = window.setTimeout(() => {
      if (listKickOnceRef.current) return;
      listKickOnceRef.current = true;
      retryDmList();
    }, 8200);

    return () => window.clearTimeout(t);
  }, [firebaseReady, user?.uid, pathname, listReady, listErr, retryDmList]);

  const threadPeersKey = useMemo(() => {
    if (!user?.uid) return "";
    return [
      ...new Set(threads.map((t) => otherParticipantUid(t, user.uid)).filter(Boolean) as string[]),
    ]
      .sort()
      .join("|");
  }, [threads, user?.uid]);

  useEffect(() => {
    if (!user?.uid || threadPeersKey === "") {
      setPeerIdMap(new Map());
      return;
    }
    const myUid = user.uid;
    const peers = threadPeersKey.split("|").filter(Boolean);
    let cancelled = false;

    async function refresh() {
      const pairs = await Promise.all(
        peers.map(async (p) => [p, await resolvePeerIdentityForDm(p, myUid)] as const),
      );
      if (cancelled) return;
      setPeerIdMap(new Map(pairs));
    }

    const unsub = subscribePublicProfilesForUids(peers, () => {
      void refresh();
    });
    void refresh();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.uid, threadPeersKey]);

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
          if (!user?.uid || !userInDmThreadId(tid, user.uid)) {
            throw new Error("invalid thread");
          }
          const peer = otherUidInDmThreadId(tid, user.uid)!;
          await ensureDmThreadWith(peer);
        } else {
          tid = await ensureDmThreadWith(peerFromQuery);
        }
        navigate(`/messages/${tid}`, { replace: true });
      } catch {
        handledPeerRef.current = null;
        navigate("/messages", { replace: true });
      }
    })();
  }, [user?.uid, peerFromQuery, navigate]);

  const dmUnread = useMemo(
    () => (user?.uid ? unreadDmThreadCount(threads, user.uid, readMap) : 0),
    [threads, readMap, user?.uid],
  );

  const hasStaleThreads = threads.length > 0;
  const showFullListLoader = !listReady && !hasStaleThreads;

  if (!firebaseReady) return <Placeholder>Firebase 연동이 필요해요.</Placeholder>;
  if (!user) {
    if (authLoading) {
      return (
        <div className="flex flex-col gap-4 px-4 pt-5">
          <TitleBlock dmUnread={0} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <TitleBlock dmUnread={0} />
        <FirebaseLoginCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-3 pb-28 pt-5 sm:px-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} className="rounded-lg p-2 hover:bg-slate-800">
            <ArrowLeft size={20} />
          </button>
          <TitleBlock dmUnread={dmUnread} />
        </div>
      </header>

      {!listReady && hasStaleThreads && (
        <p className="flex items-center justify-center gap-2 py-1 text-center text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          대화 목록을 최신으로 맞추는 중…
        </p>
      )}

      {showFullListLoader ? (
        <p className="card flex items-center justify-center gap-2 p-8 text-center text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          대화 목록을 불러오는 중…
        </p>
      ) : listErr && !hasStaleThreads ? (
        <div className="card space-y-3 border-rose-500/35 bg-rose-500/5 p-4 text-sm text-rose-100">
          <p>{listErr}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn-primary w-full py-2 text-center text-sm font-medium"
              onClick={() => retryDmList()}
            >
              다시 시도
            </button>
            <button
              type="button"
              className="btn-secondary w-full py-2 text-center text-sm"
              onClick={() => window.location.reload()}
            >
              새로고침
            </button>
          </div>
        </div>
      ) : (
        <>
          {listErr && hasStaleThreads ? (
            <div className="card space-y-2 border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
              <p>{listErr}</p>
              <button
                type="button"
                className="btn-secondary w-full py-2 text-center text-sm"
                onClick={() => retryDmList()}
              >
                다시 시도
              </button>
            </div>
          ) : null}
          {threads.length === 0 && listReady ? (
            <div className="card space-y-3 p-6 text-center text-sm text-slate-400">
              <p className="text-slate-200">아직 열린 대화가 없어요.</p>
              <p className="text-xs leading-relaxed">
                DM은 목록에서 새로 만들 수 없고,{" "}
                <strong className="text-slate-300">친구 프로필</strong>에서 시작하거나{" "}
                <strong className="text-slate-300">피드</strong>에서 친구 이름을 눌러 주세요.
              </p>
              <Link to="/friends" className="btn-primary inline-block w-full py-3 text-center text-sm font-medium">
                친구 탭으로 이동
              </Link>
              <Link to="/" className="block text-center text-xs text-brand-400 underline-offset-2 hover:underline">
                피드로 가기
              </Link>
            </div>
          ) : threads.length > 0 ? (
            <ul className="space-y-2">
              {threads.map((t) => (
                <ThreadRowItem
                  key={t.id}
                  t={t}
                  uid={user.uid}
                  peerIdMap={peerIdMap}
                  readMap={readMap}
                />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

function ThreadRowItem({
  t,
  uid,
  peerIdMap,
  readMap,
}: {
  t: DmThreadDoc;
  uid: string;
  peerIdMap: Map<string, PeerDmIdentity>;
  readMap: Map<string, number>;
}) {
  const peer = otherParticipantUid(t, uid)!;
  const id = peerIdMap.get(peer);
  const label = id?.displayName?.trim() || "대화";
  const photoURL = id?.photoURL;
  const unread = unreadDmThreadCount([t], uid, readMap) > 0;
  return (
    <li>
      <Link
        to={`/messages/${t.id}`}
        className={
          unread
            ? "card flex flex-col gap-1 border-brand-500/30 bg-brand-500/5 p-4"
            : "card flex flex-col gap-1 p-4 hover:bg-slate-900/40"
        }
      >
        <div className="flex items-center gap-3">
          <DmRowAvatar name={label} photoURL={photoURL} />
          <div className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-slate-100">{label}</span>
            <span className="line-clamp-2 text-xs text-slate-400">
              {t.lastSenderUid === uid ? "나 · " : ""}
              {t.lastText || "(아직 메시지 없음)"}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

function DmRowAvatar({ name, photoURL }: { name: string; photoURL?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="h-11 w-11 shrink-0 rounded-full border border-slate-800 object-cover"
      />
    );
  }
  const initial = name && name !== "대화" ? Array.from(name)[0]?.toUpperCase() ?? "?" : "…";
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-300"
      aria-hidden
    >
      {initial}
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
