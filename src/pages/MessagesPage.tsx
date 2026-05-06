import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getPublicProfile } from "../lib/friends";
import {
  dmErrorMessageForUi,
  ensureDmThreadWith,
  otherParticipantUid,
  otherUidInDmThreadId,
  subscribeDmReadMap,
  subscribeMyDmThreads,
  unreadDmThreadCount,
  userInDmThreadId,
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
  /** 첫 스냅샷 전에는 빈 배열이라도 '대화 없음'으로 착각하지 않도록 분리 */
  const [listReady, setListReady] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [readMap, setReadMap] = useState<Map<string, number>>(new Map());
  const [peerNames, setPeerNames] = useState<Map<string, string>>(new Map());
  const handledPeerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.uid || authLoading) return;
    let ua: (() => void) | undefined;
    let ub: (() => void) | undefined;
    let cancelled = false;
    setListReady(false);
    setListErr(null);
    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      try {
        /** 강제 refresh(getIdToken(true)) 직후 Firestore 구독이 일시적으로 permission-denied 가 나는 사례가 있어 헤더 DM 과 동일하게 일반 로드만 사용 */
        await auth.currentUser?.getIdToken();
      } catch {
        /* 오프라인 등 */
      }
      if (cancelled) return;
      const live = getFirebaseAuth().currentUser?.uid;
      if (!live || live !== user.uid) {
        if (!cancelled) {
          setListReady(true);
          setListErr(
            "로그인 세션을 확인할 수 없어요. 새로고침하거나 로그아웃 후 다시 로그인해 주세요.",
          );
        }
        return;
      }
      ua = subscribeMyDmThreads(
        user.uid,
        (rows) => {
          setThreads(rows);
          setListReady(true);
          setListErr(null);
        },
        (e) => {
          setThreads([]);
          setListReady(true);
          setListErr(dmErrorMessageForUi(e, "threadList"));
        },
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

      {!listReady ? (
        <p className="card flex items-center justify-center gap-2 p-8 text-center text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          대화 목록을 불러오는 중…
        </p>
      ) : listErr ? (
        <div className="card space-y-3 border-rose-500/35 bg-rose-500/5 p-4 text-sm text-rose-100">
          <p>{listErr}</p>
          <button
            type="button"
            className="btn-secondary w-full py-2 text-center text-sm"
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      ) : threads.length === 0 ? (
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
