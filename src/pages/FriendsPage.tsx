import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  ChevronRight,
  Copy,
  Link2,
  Loader2,
  Share2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import {
  buildFriendInviteLink,
  createFriendInviteCode,
  FRIEND_INVITE_TTL_MS,
  removeShare,
  subscribeIncomingShares,
  subscribeOutgoingShares,
  updateOutgoingScope,
} from "../lib/friends";
import { db } from "../lib/db";
import type { Share, ShareScope } from "../types";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { cls } from "../lib/utils";

export default function FriendsPage() {
  const { user, firebaseReady } = useAuth();
  const [outShares, setOutShares] = useState<Share[] | null>(null);
  const [inShares, setInShares] = useState<Share[] | null>(null);
  const [errF, setErrF] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setOutShares(null);
      setInShares(null);
      setErrF(null);
      return;
    }
    const toMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
    const unsubOut = subscribeOutgoingShares(
      (rows) => {
        setErrF(null);
        setOutShares(rows);
      },
      (e) => setErrF(toMsg(e)),
    );
    const unsubIn = subscribeIncomingShares(
      (rows) => setInShares(rows),
      (e) => setErrF(toMsg(e)),
    );
    return () => {
      unsubOut();
      unsubIn();
    };
  }, [user?.uid]);

  if (!firebaseReady) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <Header />
        <div className="card border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
          친구 기능은 Firebase 연동이 필요해요. 환경변수(VITE_FIREBASE_*)를 설정해 주세요.
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-5">
        <Header />
        <FirebaseLoginCard />
        <div className="card border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          친구와 기록을 공유하려면 Google 계정으로 로그인해 주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <Header />

      <FriendsTab
        outShares={outShares}
        inShares={inShares}
        myUid={user.uid}
        error={errF}
      />
    </div>
  );
}

function Header() {
  return (
    <header>
      <p className="text-xs text-slate-400">공유</p>
      <h1 className="text-xl font-bold">
        <Users size={18} className="mb-0.5 mr-1 inline text-brand-400" />
        친구
      </h1>
    </header>
  );
}

// ---- 친구 목록 --------------------------------------------------------

interface FriendRow {
  /** 상대 uid */
  otherUid: string;
  name: string;
  email: string;
  photo?: string;
  /** 내가 owner — 내가 상대에게 공개하는 share */
  outgoing?: Share;
  /** 내가 viewer — 상대가 내게 공개하는 share */
  incoming?: Share;
}

/**
 * 두 종류 share 를 친구 1명당 한 줄로 모읍니다.
 *
 * 용어 주의(헷갈리기 쉬움):
 * - 라이브러리의 `subscribeOutgoingShares` 가 돌려주는 `outShares` = "내가 *신청자(viewer)* 인 share"
 *   = **내가 팔로우 중인 친구** → 친구 정보는 `ownerXxx` 필드에 들어 있음.
 * - 라이브러리의 `subscribeIncomingShares` 가 돌려주는 `inShares` = "내가 *수신자(owner)* 인 share"
 *   = **나를 팔로우 중인 친구** → 친구 정보는 `viewerXxx` 필드에 들어 있음.
 *
 * 한편 UI 의 `FriendRow.outgoing` / `incoming` 은
 * - `outgoing` = 내가 owner 인 share (= 내가 그 친구에게 공개)
 * - `incoming` = 내가 viewer 인 share (= 그 친구가 내게 공개, 내가 봄)
 * 이라 라이브러리 변수명과 정반대 의미입니다.
 */
function combineRows(outShares: Share[], inShares: Share[]): FriendRow[] {
  const map = new Map<string, FriendRow>();

  // outShares: 내가 viewer · 친구가 owner → 친구 정보는 owner* 필드.
  // FriendRow 관점에서는 "내가 보는 share" 이므로 incoming.
  for (const s of outShares) {
    const other = s.ownerUid;
    map.set(other, {
      otherUid: other,
      name: s.ownerName,
      email: s.ownerEmail,
      photo: s.ownerPhotoURL,
      incoming: s,
    });
  }

  // inShares: 내가 owner · 친구가 viewer → 친구 정보는 viewer* 필드.
  // FriendRow 관점에서는 "내가 공개하는 share" 이므로 outgoing.
  for (const s of inShares) {
    const other = s.viewerUid;
    const cur = map.get(other);
    if (cur) {
      cur.outgoing = s;
      cur.name = s.viewerName || cur.name;
      cur.email = s.viewerEmail || cur.email;
      cur.photo = s.viewerPhotoURL || cur.photo;
    } else {
      map.set(other, {
        otherUid: other,
        name: s.viewerName,
        email: s.viewerEmail,
        photo: s.viewerPhotoURL,
        outgoing: s,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      (b.outgoing?.updatedAt ?? b.incoming?.updatedAt ?? 0) -
      (a.outgoing?.updatedAt ?? a.incoming?.updatedAt ?? 0),
  );
}

function FriendsTab({
  outShares,
  inShares,
  myUid,
  error,
}: {
  outShares: Share[] | null;
  inShares: Share[] | null;
  myUid: string;
  error?: string | null;
}) {
  const rows = useMemo(() => {
    if (!outShares || !inShares) return null;
    return combineRows(outShares, inShares);
  }, [outShares, inShares]);

  return (
    <>
      <LinkInviteCard />
      <section className="space-y-3">
        {error && <ErrorBanner message={error} />}
        {!error && rows === null && (
          <p className="card p-4 text-center text-xs text-slate-500">불러오는 중…</p>
        )}
        {rows?.length === 0 && (
          <p className="card p-4 text-center text-xs text-slate-500">
            아직 친구가 없어요. 위에서 초대 링크를 만들어 공유해 보세요.
          </p>
        )}
        {rows?.map((r) => (
          <FriendCard key={r.otherUid} row={r} myUid={myUid} />
        ))}
      </section>
    </>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="card border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
      <p className="font-semibold">Firestore 에서 데이터를 읽지 못했어요.</p>
      <p className="mt-1 break-all text-[11px] text-rose-200/80">{message}</p>
      <p className="mt-2 text-[11px] text-rose-200/70">
        규칙이 배포되지 않았거나 복합 인덱스가 필요할 수 있어요. 브라우저 콘솔(F12)에서
        상세 오류를 확인해 주세요.
      </p>
    </div>
  );
}

// 건강 기록은 민감 정보라 공유 불가. scope.health 는 항상 false 로 강제한다.
const CALENDAR_ONLY_SCOPE: ShareScope = { calendar: true, health: false };

const INVITE_VALID_HOURS = Math.round(FRIEND_INVITE_TTL_MS / (60 * 60 * 1000));

function LinkInviteCard() {
  const myUserId = usePrimaryUserId();
  const localUser = useLiveQuery(
    async () => (myUserId ? await db.users.get(myUserId) : undefined),
    [myUserId],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setErr(null);
    setBusy(true);
    try {
      const inv = await createFriendInviteCode(localUser ?? undefined, CALENDAR_ONLY_SCOPE);
      setLastLink(buildFriendInviteLink(inv.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!lastLink) return;
    try {
      await navigator.clipboard.writeText(lastLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("링크를 복사하세요", lastLink);
    }
  }

  async function shareNative() {
    if (!lastLink) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "헬스헬스 친구 초대",
          text: "내 식단을 볼 수 있도록 초대했어요. 링크에서 수락해 주세요.",
          url: lastLink,
        });
      } else {
        await copyLink();
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        await copyLink();
      }
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <h3 className="text-sm font-semibold text-slate-200">
        <Share2 size={14} className="mb-0.5 mr-1 inline text-brand-400" />
        링크로 초대 (카카오톡·문자)
      </h3>
      <p className="text-[11px] text-slate-400">
        1회용 초대 링크를 만들면 상대가 Gmail을 몰라도 수락할 수 있어요. 링크는 약{" "}
        <strong className="text-slate-200">{INVITE_VALID_HOURS}시간</strong> 동안 유효하고, 한 번
        수락되면 더 이상 쓸 수 없어요.
      </p>
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="btn-primary w-full py-2.5 text-sm disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
        초대 링크 만들기
      </button>
      {err && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {err}
        </p>
      )}
      {lastLink && (
        <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs text-emerald-100/90">
          <p className="font-medium">아래 링크를 보내 주세요.</p>
          <p className="break-all rounded-lg bg-slate-900/60 px-2 py-1.5 font-mono text-[11px] text-slate-300">
            {lastLink}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void copyLink()} className="btn-secondary flex-1 py-2 text-xs">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "복사됨" : "복사"}
            </button>
            {"share" in navigator && typeof navigator.share === "function" ? (
              <button type="button" onClick={() => void shareNative()} className="btn-secondary flex-1 py-2 text-xs">
                <Share2 size={12} /> 공유
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function FriendCard({ row, myUid }: { row: FriendRow; myUid: string }) {
  const { otherUid, name, email, photo, outgoing, incoming } = row;
  const mutual = !!outgoing && !!incoming;
  const [busy, setBusy] = useState<"stopOut" | "stopIn" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 기존 사용자가 scope.health=true 로 저장된 share 가 있을 수 있다.
  // 앱은 더 이상 건강을 공유하지 않으므로, 공개 중이라면 달력 전용으로 강제 재저장.
  useEffect(() => {
    if (outgoing && outgoing.scope.health) {
      void updateOutgoingScope(otherUid, { calendar: true, health: false }).catch((e) => {
        console.warn("[friends] 강제 calendar-only 전환 실패", e);
      });
    }
  }, [outgoing?.id, outgoing?.scope.health, otherUid]);

  async function stopOutgoing() {
    if (!outgoing) return;
    if (!confirm(`${name}님에게 내 기록 공개를 중단할까요?`)) return;
    setBusy("stopOut");
    try {
      await removeShare(outgoing.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function stopIncoming() {
    if (!incoming) return;
    if (!confirm(`${name}님에 대한 팔로우를 끊을까요?`)) return;
    setBusy("stopIn");
    try {
      await removeShare(incoming.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  void myUid;

  return (
    <div className="card overflow-hidden">
      <Link
        to={`/friends/${otherUid}`}
        className="flex items-center gap-3 p-3 hover:bg-slate-900/60"
      >
        <Avatar name={name} photoURL={photo} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-100">{name}</p>
            {mutual ? (
              <span className="shrink-0 rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                맞팔
              </span>
            ) : incoming ? (
              <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
                팔로우 중
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                나를 팔로우
              </span>
            )}
          </div>
          <p className="truncate text-xs text-slate-500">{email}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <RoleBadge prefix="내가 공개" active={!!outgoing} tone="brand" />
            <RoleBadge prefix="내가 보는 범위" active={!!incoming} tone="slate" />
          </div>
        </div>
        <ChevronRight size={18} className="shrink-0 text-slate-500" />
      </Link>
      <div className="space-y-2 border-t border-slate-800 px-3 py-2">
        {err && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
            {err}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {outgoing && (
            <button
              onClick={stopOutgoing}
              disabled={busy !== null}
              className="btn-secondary flex-1 py-1.5 text-xs text-rose-300 disabled:opacity-60"
            >
              {busy === "stopOut" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              공개 중단
            </button>
          )}
          {incoming && (
            <button
              onClick={stopIncoming}
              disabled={busy !== null}
              className="btn-secondary flex-1 py-1.5 text-xs text-rose-300 disabled:opacity-60"
            >
              {busy === "stopIn" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <X size={12} />
              )}
              팔로우 끊기
            </button>
          )}
        </div>
        {!incoming && (
          <p className="rounded-lg bg-slate-900/50 px-2 py-1.5 text-center text-[11px] leading-relaxed text-slate-400">
            상대 식단을 보고 싶다면 위에서 <strong className="text-slate-300">초대 링크</strong>를 만들어 보내거나,
            상대가 보낸 링크로 수락해 주세요.
          </p>
        )}
      </div>
    </div>
  );
}

function RoleBadge({
  prefix,
  active,
  tone,
}: {
  prefix: string;
  active: boolean;
  tone: "brand" | "slate";
}) {
  return (
    <span
      className={cls(
        "inline-flex rounded-full px-2 py-0.5 text-[10px]",
        tone === "brand"
          ? "bg-brand-500/15 text-brand-200"
          : "bg-slate-800 text-slate-300",
      )}
    >
      {prefix}: {active ? "달력(식사)" : "없음"}
    </span>
  );
}

function Avatar({ name, photoURL }: { name: string; photoURL?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full border border-slate-800 object-cover"
      />
    );
  }
  const initial = name ? Array.from(name)[0]?.toUpperCase() ?? "?" : "?";
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-200">
      {initial}
    </div>
  );
}
