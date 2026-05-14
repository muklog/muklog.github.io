import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useDmRealtime } from "../contexts/DmRealtimeContext";
import { isCalendarConnectedPairFromServer, subscribePeerIdentityForDm } from "../lib/friends";
import {
  dmErrorMessageForUi,
  ensureDmThreadWith,
  markDmThreadDeletedForMe,
  markDmThreadReadForMe,
  MAX_DM_MESSAGE_CHARS,
  otherUidInDmThreadId,
  sendDmMessage,
  subscribeDmMessages,
  userInDmThreadId,
} from "../lib/dm";
import { getFirestoreDb } from "../lib/firebaseApp";
import type { DmMessageDoc } from "../types";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { cls, dateKey, formatKoDate } from "../lib/utils";

export default function DmChatPage() {
  const { threadId = "" } = useParams();
  const navigate = useNavigate();
  const { user, firebaseReady, loading: authLoading } = useAuth();
  const { dmDeletedThreadIds } = useDmRealtime();
  const [messages, setMessages] = useState<DmMessageDoc[]>([]);
  const [allowed, setAllowed] = useState<null | boolean>(null);
  /** 참가자로 확인된 방에서는 메시지 전송 허용(달력 연결은 안내용) */
  const [canSend, setCanSend] = useState(false);
  const [calendarLinked, setCalendarLinked] = useState(true);
  const [peerIdentity, setPeerIdentity] = useState<{ displayName: string; photoURL?: string }>({
    displayName: "대화",
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** 전송 실패 시 짧은 안내(성공 시 자동 제거) */
  const [sendHint, setSendHint] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  /** scrollIntoView 는 조상 <main> 까지 움직여 DM 패널이 처음에 어긋난다 — 메시지 박스만 스크롤한다 */
  const scrollMessagesToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const box = messagesScrollRef.current;
      if (box) box.scrollTop = box.scrollHeight;
    });
  }, []);

  useLayoutEffect(() => {
    if (!allowed || !threadId) return;
    const main = document.querySelector("main");
    if (main instanceof HTMLElement) main.scrollTop = 0;
    scrollMessagesToBottom();
  }, [allowed, threadId, scrollMessagesToBottom]);

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
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, user?.uid]);

  useEffect(() => {
    if (!allowed || !threadId || !user?.uid) return;
    const peer = otherUidInDmThreadId(threadId, user.uid);
    if (!peer) return;
    const unsub = subscribePeerIdentityForDm(peer, user.uid, setPeerIdentity);
    return () => unsub();
  }, [allowed, threadId, user?.uid]);

  useEffect(() => {
    if (!threadId || !allowed) return;
    const unsub = subscribeDmMessages(threadId, (rows) => {
      setMessages(rows);
      scrollMessagesToBottom();
    });
    return () => unsub();
  }, [threadId, allowed, scrollMessagesToBottom]);

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

  const threadDeletedForMe = !!(threadId && dmDeletedThreadIds.has(threadId));

  async function deleteThisThread() {
    if (!threadId || !user?.uid) return;
    if (!confirm("이 대화를 목록에서 삭제할까요? 메시지 기록은 서버에 남을 수 있어요.")) return;
    try {
      await markDmThreadDeletedForMe(user.uid, threadId);
      navigate("/messages");
    } catch (e) {
      console.warn("[dm] delete thread prefs", e);
      alert(dmErrorMessageForUi(e));
    }
  }

  if (!firebaseReady) return <Placeholder>Firebase 연동이 필요해요.</Placeholder>;
  if (!user) {
    if (authLoading) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-5">
          <HeaderSkeleton />
        </div>
      );
    }
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
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden pl-2 pr-1 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom,0px))]">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 pb-3">
        <button type="button" onClick={() => navigate("/messages")} className="rounded-lg p-2 hover:bg-slate-800">
          <ArrowLeft size={20} />
        </button>
        <PeerAvatar photoURL={peerIdentity.photoURL} name={peerIdentity.displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">{peerIdentity.displayName}</p>
          <p className="text-[11px] text-slate-500">{threadDeletedForMe ? "삭제됨 · DM" : "DM"}</p>
        </div>
        <button
          type="button"
          onClick={() => void deleteThisThread()}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-rose-300"
          aria-label="대화 목록에서 삭제"
        >
          <Trash2 size={20} />
        </button>
      </header>

      {threadDeletedForMe ? (
        <p className="shrink-0 border-b border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-500">
          이 대화는 내 목록에서 삭제됨으로 표시했어요. 메시지는 그대로 열람할 수 있어요.
        </p>
      ) : null}

      <div
        ref={messagesScrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain py-2 pl-0.5 pr-0 [-webkit-overflow-scrolling:touch]"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">첫 메시지를 남겨 보세요.</p>
        ) : (
          messages.map((m, i) => {
            const mine = m.senderUid === meUid;
            const next = messages[i + 1];
            const showTime = !next || next.senderUid !== m.senderUid;
            const ts = m.createdAt ?? 0;
            const prevTs = messages[i - 1]?.createdAt ?? 0;
            const dk = (t: number) =>
              Number.isFinite(t) && t > 0 ? dateKey(new Date(t)) : "";
            const curDay = dk(ts);
            const prevDay = dk(prevTs);
            const showDayDivider =
              curDay !== "" &&
              (i === 0 || prevDay === "" || prevDay !== curDay);
            return (
              <Fragment key={m.id}>
                {showDayDivider ? (
                  <div
                    className="flex shrink-0 items-center gap-2 py-2"
                    role="separator"
                    aria-label={formatKoDate(new Date(ts))}
                  >
                    <span className="h-px flex-1 bg-slate-800" aria-hidden />
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      {formatKoDate(new Date(ts))}
                    </span>
                    <span className="h-px flex-1 bg-slate-800" aria-hidden />
                  </div>
                ) : null}
                <Bubble mine={mine} text={m.text} createdAt={ts} showTime={showTime} />
              </Fragment>
            );
          })
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1 border-t border-slate-800 bg-slate-950 pt-2">
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
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <textarea
              value={text}
              maxLength={MAX_DM_MESSAGE_CHARS}
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
              aria-describedby="dm-char-count"
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
          <p id="dm-char-count" className="pr-1 text-right text-[10px] tabular-nums text-slate-500">
            {text.length} / {MAX_DM_MESSAGE_CHARS}
          </p>
        </div>
      </div>
    </div>
  );
}

function PeerAvatar({ name, photoURL }: { name: string; photoURL?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full border border-slate-800 object-cover"
      />
    );
  }
  const initial = name ? (Array.from(name)[0]?.toUpperCase() ?? "?") : "?";
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-800 text-sm font-semibold text-white">
      {initial}
    </div>
  );
}

function Bubble({
  mine,
  text,
  createdAt,
  showTime,
}: {
  mine: boolean;
  text: string;
  createdAt: number;
  showTime: boolean;
}) {
  const timeLabel = formatDmTimeLabel(createdAt);
  return (
    <div className={cls("flex w-full flex-col gap-0.5", mine ? "items-end" : "items-start")}>
      <div
        className={cls(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
          mine ? "bg-brand-600 text-white" : "border border-slate-800 bg-slate-900/80 text-slate-100",
        )}
      >
        {text}
      </div>
      {showTime && timeLabel && (
        <p
          className={cls(
            "px-1 text-[10px] tabular-nums text-slate-500",
            mine ? "text-right" : "text-left",
          )}
        >
          {timeLabel}
        </p>
      )}
    </div>
  );
}

/** 분 단위까지 (초 생략). 같은 날이면 시각만, 날이 바뀌면 날짜 포함 */
function formatDmTimeLabel(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const clock = d.toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (sameDay) return clock;
  const datePart = d.toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  return `${datePart} ${clock}`;
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
