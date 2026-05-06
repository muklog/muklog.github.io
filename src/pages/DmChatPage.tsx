import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getPublicProfile, isCalendarConnectedPairFromServer } from "../lib/friends";
import {
  dmErrorMessageForUi,
  ensureDmThreadWith,
  markDmThreadReadForMe,
  otherUidInDmThreadId,
  sendDmMessage,
  subscribeDmMessages,
  userInDmThreadId,
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
  /** 참가자로 확인된 방에서는 메시지 전송 허용(달력 연결은 안내용) */
  const [canSend, setCanSend] = useState(false);
  const [calendarLinked, setCalendarLinked] = useState(true);
  const [peerLabel, setPeerLabel] = useState<string>("대화");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** 전송 실패 시 짧은 안내(성공 시 자동 제거) */
  const [sendHint, setSendHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadId || !user?.uid) return;

    if (!userInDmThreadId(threadId, user.uid)) {
      setAllowed(false);
      setCanSend(false);
      return;
    }

    setAllowed(true);
    let cancelled = false;
    void (async () => {
      setCanSend(false);
      try {
        const peer = otherUidInDmThreadId(threadId, user.uid)!;
        const fs = getFirestoreDb();
        const snap = await getDoc(doc(fs, "dmThreads", threadId));
        if (cancelled) return;
        if (!snap.exists()) await ensureDmThreadWith(peer);
        if (cancelled) return;
        setCanSend(true);
      } catch {
        if (!cancelled) {
          setAllowed(false);
          setCanSend(false);
        }
        return;
      }

      void markDmThreadReadForMe(threadId).catch(() => {});
      if (cancelled) return;

      const peer = otherUidInDmThreadId(threadId, user.uid)!;
      let linked = true;
      try {
        linked = await isCalendarConnectedPairFromServer(user.uid, peer);
      } catch {
        linked = false;
      }
      if (cancelled) return;
      setCalendarLinked(linked);
      try {
        const prof = await getPublicProfile(peer);
        if (cancelled) return;
        setPeerLabel(prof?.displayName ?? peer.slice(0, 6));
      } catch {
        if (!cancelled) setPeerLabel(peer.slice(0, 6));
      }
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
    setSendHint(null);
    try {
      await sendDmMessage(threadId, text);
      setText("");
    } catch (e) {
      console.warn("[dm] send failed", e);
      setSendHint(dmErrorMessageForUi(e));
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
        {!calendarLinked && (
          <p className="text-[11px] text-amber-400/90">
            달력 공유가 일시적으로 확인되지 않아요. 메시지는 보낼 수 있으며, 문제가 계속되면 친구 탭에서 공유를 확인해 주세요.
          </p>
        )}
        {sendHint && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
            {sendHint}
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSendHint(null);
            }}
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
