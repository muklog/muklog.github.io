import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getPublicProfile, isCalendarConnectedPair } from "../lib/friends";
import {
  markDmThreadReadForMe,
  sendDmMessage,
  subscribeDmMessages,
  verifyThreadParticipation,
} from "../lib/dm";
import { getFirestoreDb } from "../lib/firebaseApp";
import type { DmMessageDoc } from "../types";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { cls } from "../lib/utils";

export default function DmChatPage() {
  const { threadId = "" } = useParams();
  const navigate = useNavigate();
  const { user, firebaseReady } = useAuth();
  const [messages, setMessages] = useState<DmMessageDoc[]>([]);
  const [allowed, setAllowed] = useState<null | boolean>(null);
  /** 달력 공유가 있을 때만 새 메시지 작성 가능(읽기는 기존 참가자면 유지) */
  const [canSend, setCanSend] = useState(false);
  const [peerLabel, setPeerLabel] = useState<string>("대화");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadId || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      const ok = await verifyThreadParticipation(threadId);
      if (cancelled) return;
      setAllowed(ok);
      setCanSend(false);
      if (!ok) return;
      await markDmThreadReadForMe(threadId);
      const fs = getFirestoreDb();
      const snap = await getDoc(doc(fs, "dmThreads", threadId));
      const p = (snap.data() as { participantUids?: string[] } | undefined)?.participantUids ?? [];
      const peer = p.find((x) => x !== user.uid);
      if (cancelled || !peer) return;
      const linked = await isCalendarConnectedPair(user.uid, peer);
      if (cancelled) return;
      setCanSend(linked);
      const prof = await getPublicProfile(peer);
      if (cancelled) return;
      setPeerLabel(prof?.displayName ?? peer.slice(0, 6));
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, user?.uid]);

  useEffect(() => {
    if (!threadId || !allowed) return;
    const unsub = subscribeDmMessages(threadId, (rows) => {
      setMessages(rows);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    });
    return () => unsub();
  }, [threadId, allowed]);

  useEffect(() => {
    if (threadId && allowed && messages.length > 0) void markDmThreadReadForMe(threadId);
  }, [threadId, allowed, messages]);

  async function submit() {
    if (!threadId || !text.trim() || sending || !canSend) return;
    setSending(true);
    try {
      await sendDmMessage(threadId, text);
      setText("");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const meUid = user?.uid;

  if (!firebaseReady) return <Placeholder>Firebase 연동이 필요해요.</Placeholder>;
  if (!user) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <HeaderSkeleton />
        <FirebaseLoginCard />
      </div>
    );
  }
  if (!threadId) {
    navigate("/messages", { replace: true });
    return null;
  }
  if (allowed === false) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <HeaderSkeleton />
        <p className="card p-4 text-sm text-rose-300">이 대화방에 접근할 수 없어요.</p>
        <Link to="/messages" className="btn-secondary py-2 text-center text-sm">
          목록으로
        </Link>
      </div>
    );
  }
  if (allowed === null) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <HeaderSkeleton />
        <p className="card flex items-center justify-center gap-2 p-8 text-sm text-slate-400">
          <Loader2 className="animate-spin" size={18} /> 확인 중…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col px-4 pb-28 pt-4">
      <header className="mb-3 flex shrink-0 items-center gap-2 border-b border-slate-800 pb-3">
        <button type="button" onClick={() => navigate("/messages")} className="rounded-lg p-2 hover:bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">{peerLabel}</p>
          <p className="text-[11px] text-slate-500">DM</p>
        </div>
      </header>

      <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">첫 메시지를 남겨 보세요.</p>
        ) : (
          messages.map((m) => <Bubble key={m.id} mine={m.senderUid === meUid} text={m.text} />)
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-slate-800 pt-3">
        {!canSend && (
          <p className="text-[11px] text-amber-400/90">
            서로 달력을 공유 중일 때만 새 DM을 보낼 수 있어요. 이전 메시지는 계속 볼 수 있어요.
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder="메시지 보내기…"
            disabled={!canSend}
            className="input max-h-32 min-h-[44px] min-w-0 flex-1 resize-y text-sm disabled:opacity-50"
          />
          <button
            type="button"
            disabled={sending || !text.trim() || !canSend}
            onClick={() => void submit()}
            className="btn-primary shrink-0 self-end px-4 py-3 disabled:opacity-50"
            aria-label="보내기"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={cls("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div
        className={cls(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
          mine ? "bg-brand-600 text-white" : "border border-slate-800 bg-slate-900/80 text-slate-100",
        )}
      >
        {text}
      </div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <header className="flex items-center gap-2">
      <ArrowLeft size={20} className="opacity-40" />
      <h1 className="text-lg font-bold text-slate-500">DM</h1>
    </header>
  );
}

function Placeholder({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <HeaderSkeleton />
      <div className="card flex justify-center gap-2 p-8 text-sm text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        {children}
      </div>
    </div>
  );
}
