import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Heart, Loader2, MessageCircle, Pencil, Send, Trash2, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "../contexts/AuthContext";
import { db, runDexie } from "../lib/db";
import { userFacingStorageErrorMessage } from "../lib/idbRetry";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { resolveDisplayName, resolveDisplayPhotoURL } from "../lib/identity";
import {
  addComment,
  deleteComment,
  editComment,
  setMyCommentLike,
  setMyLike,
  subscribeCommentLikes,
  subscribeComments,
  subscribeLikes,
} from "../lib/social";
import type { MealComment } from "../types";
import { cls } from "../lib/utils";

interface Props {
  ownerUid: string;
  mealId: string;
}

/**
 * 식단 좋아요·댓글 블록.
 *
 * - Firebase 가 ready 이고 로그인된 경우에만 렌더하세요.
 * - viewer 는 share 가 있어야 read 가 가능 (rules 가 통제). 권한 오류는 조용히 무시.
 * - 대댓글은 1단계만 지원(대댓글의 대댓글은 허용하지 않음) — UI 단순화와 트리 깊이 과다 방지.
 */
export default function MealSocialBlock({ ownerUid, mealId }: Props) {
  const { user } = useAuth();
  const myUid = user?.uid;
  const isOwner = myUid === ownerUid;
  const myUserId = usePrimaryUserId();
  const myProfile = useLiveQuery(
    async () => (myUserId ? await runDexie(() => db.users.get(myUserId)) : undefined),
    [myUserId],
  );
  const myIdentity = useMemo(
    () => ({
      name: resolveDisplayName(myProfile, user),
      photoURL: resolveDisplayPhotoURL(myProfile, user?.photoURL),
    }),
    [myProfile, user],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  const [likedUids, setLikedUids] = useState<string[] | null>(null);
  const [comments, setComments] = useState<MealComment[] | null>(null);
  const [accessErr, setAccessErr] = useState(false);

  useEffect(() => {
    if (!myUid) return;
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { root: null, rootMargin: "160px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [myUid]);

  useEffect(() => {
    if (!myUid || !inView) return;
    setAccessErr(false);
    const unsubL = subscribeLikes(
      ownerUid,
      mealId,
      (uids) => setLikedUids(uids),
      () => {
        setAccessErr(true);
        setLikedUids([]);
      },
    );
    const unsubC = subscribeComments(
      ownerUid,
      mealId,
      (rows) => setComments(rows),
      () => {
        setAccessErr(true);
        setComments([]);
      },
    );
    return () => {
      unsubL();
      unsubC();
    };
  }, [myUid, inView, ownerUid, mealId]);

  const liked = useMemo(
    () => (myUid && likedUids ? likedUids.includes(myUid) : false),
    [likedUids, myUid],
  );

  // parentCommentId === undefined → 최상위 댓글. 나머지는 대댓글.
  const { topLevel, repliesByParent, total } = useMemo(() => {
    const top: MealComment[] = [];
    const map = new Map<string, MealComment[]>();
    if (comments) {
      for (const c of comments) {
        if (c.parentCommentId) {
          const list = map.get(c.parentCommentId) ?? [];
          list.push(c);
          map.set(c.parentCommentId, list);
        } else {
          top.push(c);
        }
      }
    }
    return { topLevel: top, repliesByParent: map, total: comments?.length ?? 0 };
  }, [comments]);

  if (!myUid) return null;

  return (
    <div ref={wrapRef} className="space-y-3 border-t border-slate-800 px-3 pb-3 pt-3">
      {!inView ? (
        <p className="text-[11px] text-slate-500">이 카드가 화면에 보이면 댓글·좋아요를 불러와요.</p>
      ) : accessErr ? null : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <LikeRow
              ownerUid={ownerUid}
              mealId={mealId}
              liked={liked}
              likeCount={likedUids?.length ?? 0}
              loading={likedUids === null}
              actorOverride={myIdentity}
            />
            <div
              className="flex items-center gap-1.5 text-slate-400"
              aria-label={`댓글 ${total}개`}
            >
              <MessageCircle size={16} strokeWidth={2} className="shrink-0 opacity-90" />
              <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-slate-300">
                댓글{" "}
                <span className="inline-flex min-w-[1rem] items-center justify-center">
                  {total}
                </span>
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {comments === null ? (
              <p className="text-[11px] text-slate-500">불러오는 중…</p>
            ) : (
              topLevel.map((c) => (
                <ThreadItem
                  key={c.id}
                  comment={c}
                  replies={repliesByParent.get(c.id) ?? []}
                  myUid={myUid}
                  isOwner={isOwner}
                  ownerUid={ownerUid}
                  mealId={mealId}
                  actorOverride={myIdentity}
                />
              ))
            )}
            <NewCommentInput ownerUid={ownerUid} mealId={mealId} />
          </div>
        </>
      )}
    </div>
  );
}

function LikeRow({
  ownerUid,
  mealId,
  liked,
  likeCount,
  loading,
  actorOverride,
}: {
  ownerUid: string;
  mealId: string;
  liked: boolean;
  likeCount: number;
  loading: boolean;
  actorOverride?: { name?: string; photoURL?: string };
}) {
  const [busy, setBusy] = useState(false);
  const [pendingLiked, setPendingLiked] = useState<boolean | null>(null);
  const effectiveLiked = pendingLiked ?? liked;

  useEffect(() => {
    setPendingLiked(null);
  }, [liked]);

  async function toggle() {
    setBusy(true);
    setPendingLiked(!effectiveLiked);
    try {
      await setMyLike(ownerUid, mealId, !effectiveLiked, actorOverride);
    } catch (e) {
      setPendingLiked(null);
      alert(userFacingStorageErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || loading}
      title={effectiveLiked ? "좋아요 취소" : "좋아요"}
      className={cls(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors disabled:opacity-60",
        effectiveLiked
          ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/20"
          : "bg-slate-800/60 text-slate-300 hover:bg-slate-800",
      )}
      aria-pressed={effectiveLiked}
    >
      <Heart size={16} strokeWidth={2} className={cls("shrink-0", effectiveLiked && "fill-current")} />
      <span className="inline-flex min-w-[1.25rem] items-center justify-center text-xs font-medium tabular-nums">
        {likeCount}
      </span>
    </button>
  );
}

// ---- 스레드 (최상위 댓글 + 그 아래 대댓글 목록) --------------------------

function ThreadItem({
  comment,
  replies,
  myUid,
  isOwner,
  ownerUid,
  mealId,
  actorOverride,
}: {
  comment: MealComment;
  replies: MealComment[];
  myUid: string;
  isOwner: boolean;
  ownerUid: string;
  mealId: string;
  actorOverride?: { name?: string; photoURL?: string };
}) {
  const [replying, setReplying] = useState(false);
  return (
    <div className="space-y-2">
      <CommentRow
        comment={comment}
        myUid={myUid}
        isOwner={isOwner}
        ownerUid={ownerUid}
        mealId={mealId}
        actorOverride={actorOverride}
        onReplyClick={() => setReplying((v) => !v)}
        replying={replying}
      />
      {replies.length > 0 && (
        <div className="ml-6 space-y-2 border-l border-slate-800 pl-3">
          {replies.map((r) => (
            <CommentRow
              key={r.id}
              comment={r}
              myUid={myUid}
              isOwner={isOwner}
              ownerUid={ownerUid}
              mealId={mealId}
              actorOverride={actorOverride}
              isReply
            />
          ))}
        </div>
      )}
      {replying && (
        <div className="ml-6 border-l border-slate-800 pl-3">
          <NewCommentInput
            ownerUid={ownerUid}
            mealId={mealId}
            parentCommentId={comment.id}
            placeholder={`${comment.authorName}님에게 답글…`}
            onSent={() => setReplying(false)}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  myUid,
  isOwner,
  ownerUid,
  mealId,
  actorOverride,
  onReplyClick,
  replying,
  isReply,
}: {
  comment: MealComment;
  myUid: string;
  isOwner: boolean;
  ownerUid: string;
  mealId: string;
  actorOverride?: { name?: string; photoURL?: string };
  onReplyClick?: () => void;
  replying?: boolean;
  isReply?: boolean;
}) {
  const isMine = comment.authorUid === myUid;
  const canEdit = isMine;
  const canDelete = isMine || isOwner;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);

  // 댓글 좋아요
  const [likeUids, setLikeUids] = useState<string[] | null>(null);
  useEffect(() => {
    const unsub = subscribeCommentLikes(
      ownerUid,
      mealId,
      comment.id,
      (uids) => setLikeUids(uids),
      () => setLikeUids([]),
    );
    return () => unsub();
  }, [ownerUid, mealId, comment.id]);
  const liked = !!likeUids && likeUids.includes(myUid);
  const [pendingLike, setPendingLike] = useState<boolean | null>(null);
  const effectiveLiked = pendingLike ?? liked;

  useEffect(() => {
    setPendingLike(null);
  }, [liked]);

  useEffect(() => {
    setDraft(comment.text);
  }, [comment.text]);

  async function toggleLike() {
    setPendingLike(!effectiveLiked);
    try {
      await setMyCommentLike(ownerUid, mealId, comment.id, !effectiveLiked, actorOverride);
    } catch (e) {
      setPendingLike(null);
      alert(userFacingStorageErrorMessage(e));
    }
  }

  async function save() {
    setBusy("save");
    try {
      await editComment(ownerUid, mealId, comment.id, draft);
      setEditing(false);
    } catch (e) {
      alert(userFacingStorageErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("이 댓글을 삭제할까요?")) return;
    setBusy("delete");
    try {
      await deleteComment(ownerUid, mealId, comment.id);
    } catch (e) {
      alert(userFacingStorageErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={cls(
        "rounded-lg bg-slate-900/40 p-2.5 text-xs",
        isReply && "bg-slate-900/25",
      )}
    >
      <div className="flex items-start gap-2">
        <CommentAvatar name={comment.authorName} photoURL={comment.authorPhotoURL} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12px] font-semibold text-slate-200">
              {comment.authorName}
            </span>
            <span className="shrink-0 text-[10px] text-slate-500">
              {formatRelative(comment.createdAt)}
              {comment.updatedAt > comment.createdAt && " · 수정됨"}
            </span>
          </div>
          {editing ? (
            <CommentEditForm
              draft={draft}
              setDraft={setDraft}
              busy={busy === "save"}
              onCancel={() => {
                setEditing(false);
                setDraft(comment.text);
              }}
              onSave={save}
            />
          ) : (
            <p className="mt-0.5 break-words text-[12px] leading-relaxed text-slate-200 whitespace-pre-wrap">
              {comment.text}
            </p>
          )}
          {!editing && (
            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
              <CommentLikeButton
                effectiveLiked={effectiveLiked}
                likedOnServer={liked}
                serverCount={likeUids?.length ?? null}
                onToggle={() => void toggleLike()}
              />
              {!isReply && onReplyClick && (
                <button
                  type="button"
                  onClick={onReplyClick}
                  className="inline-flex items-center gap-1 hover:text-slate-300"
                >
                  <MessageCircle size={11} />
                  {replying ? "취소" : "답글"}
                </button>
              )}
            </div>
          )}
        </div>
        {!editing && (canEdit || canDelete) && (
          <div className="flex shrink-0 gap-0.5">
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="rounded p-1 text-slate-500 hover:text-slate-200"
                aria-label="수정"
              >
                <Pencil size={12} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={remove}
                disabled={busy !== null}
                className="rounded p-1 text-slate-500 hover:text-rose-400 disabled:opacity-50"
                aria-label="삭제"
              >
                {busy === "delete" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentLikeButton({
  effectiveLiked,
  likedOnServer,
  serverCount,
  onToggle,
}: {
  effectiveLiked: boolean;
  likedOnServer: boolean;
  serverCount: number | null;
  onToggle: () => void;
}) {
  const display =
    serverCount === null
      ? null
      : serverCount + (effectiveLiked ? 1 : 0) - (likedOnServer ? 1 : 0);
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={serverCount === null}
      className={cls(
        "inline-flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        effectiveLiked ? "text-rose-300" : "hover:text-slate-300",
      )}
      aria-pressed={effectiveLiked}
    >
      <Heart size={11} className={cls(effectiveLiked && "fill-current")} />
      <span className="inline-flex min-w-[0.875rem] items-center justify-center tabular-nums">
        {display === null ? (
          <Loader2 size={12} className="animate-spin text-slate-500" aria-hidden />
        ) : (
          Math.max(0, display)
        )}
      </span>
    </button>
  );
}

function CommentEditForm({
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
}: {
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(taRef, draft);
  return (
    <div className="mt-1.5 space-y-1.5">
      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (draft.trim() && !busy) onSave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={1}
        className="input resize-none text-xs leading-relaxed"
        autoFocus
      />
      <div className="flex gap-1.5">
        <button onClick={onCancel} className="btn-secondary flex-1 py-1 text-[11px]">
          취소
        </button>
        <button
          onClick={onSave}
          disabled={busy || !draft.trim()}
          className="btn-primary flex-1 py-1 text-[11px] disabled:opacity-60"
        >
          {busy && <Loader2 size={10} className="animate-spin" />}
          저장
        </button>
      </div>
    </div>
  );
}

function NewCommentInput({
  ownerUid,
  mealId,
  parentCommentId,
  placeholder,
  onSent,
  onCancel,
}: {
  ownerUid: string;
  mealId: string;
  parentCommentId?: string;
  placeholder?: string;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(taRef, text);

  // 댓글에 내 Dexie 프로필 기반 닉네임/아바타가 반영되도록 override 로 넘긴다.
  const { user: authUser } = useAuth();
  const myUserId = usePrimaryUserId();
  const myProfile = useLiveQuery(
    async () => (myUserId ? await runDexie(() => db.users.get(myUserId)) : undefined),
    [myUserId],
  );

  async function submit() {
    if (!text.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      await addComment(ownerUid, mealId, text, parentCommentId, {
        name: resolveDisplayName(myProfile, authUser),
        photoURL: resolveDisplayPhotoURL(myProfile, authUser?.photoURL),
      });
      setText("");
      onSent?.();
      if (!parentCommentId) taRef.current?.focus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) {
            onCancel();
          }
        }}
        rows={1}
        placeholder={placeholder ?? "댓글 달기…"}
        className="input min-w-0 flex-1 resize-none text-xs leading-relaxed"
        autoFocus={!!parentCommentId}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !text.trim()}
        className="btn-primary shrink-0 px-3 py-2 text-xs disabled:opacity-60"
        aria-label="댓글 보내기"
        title="Cmd / Ctrl + Enter 로도 보낼 수 있어요"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
      </button>
      {text && (
        <button
          type="button"
          onClick={() => setText("")}
          className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:text-slate-200"
          aria-label="지우기"
        >
          <X size={14} />
        </button>
      )}
      {err && <p className="basis-full text-[11px] text-rose-300">{err}</p>}
    </div>
  );
}

function CommentAvatar({ name, photoURL }: { name: string; photoURL?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="h-6 w-6 shrink-0 rounded-full border border-slate-800 object-cover"
      />
    );
  }
  const initial = name ? Array.from(name)[0]?.toUpperCase() ?? "?" : "?";
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-[10px] font-semibold text-slate-200">
      {initial}
    </div>
  );
}

function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  maxPx = 140,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [ref, value, maxPx]);
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
