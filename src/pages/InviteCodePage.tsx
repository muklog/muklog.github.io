import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Loader2, LogIn, UserPlus } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { db } from "../lib/db";
import { getFirestoreDb } from "../lib/firebaseApp";
import { acceptFriendInviteCode } from "../lib/friends";
import type { FriendInviteCode, ShareScope } from "../types";

const CALENDAR_ONLY_SCOPE: ShareScope = { calendar: true, health: false };

export default function InviteCodePage() {
  const { inviteCode = "" } = useParams();
  const navigate = useNavigate();
  const { user, firebaseReady, signInWithGoogle, signInBusy, signInError } = useAuth();
  const myLocalId = usePrimaryUserId();
  const localUser = useLiveQuery(
    async () => (myLocalId ? await db.users.get(myLocalId) : undefined),
    [myLocalId],
  );

  const [invite, setInvite] = useState<FriendInviteCode | null | "missing">(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyAccept, setBusyAccept] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [doneAccepted, setDoneAccepted] = useState(false);

  useEffect(() => {
    if (!firebaseReady || !user || !inviteCode.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const fs = getFirestoreDb();
        const snap = await getDoc(doc(fs, "friendInviteCodes", inviteCode.trim()));
        if (cancelled) return;
        if (!snap.exists()) {
          setInvite("missing");
        } else {
          setInvite({ ...(snap.data() as Omit<FriendInviteCode, "id">), id: snap.id });
        }
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
          setInvite("missing");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseReady, user?.uid, inviteCode]);

  if (!firebaseReady) {
    return <Shell>Firebase 연동이 설정되지 않았어요.</Shell>;
  }

  if (!user) {
    return (
      <Shell>
        <h2 className="text-base font-semibold text-slate-100">
          <UserPlus size={16} className="mb-0.5 mr-1 inline text-brand-400" />
          친구 초대
        </h2>
        <p className="text-sm text-slate-300">
          초대를 확인하려면 Google 계정으로 로그인해 주세요. 링크는 로그인한 뒤에도 다시 열 수 있어요.
        </p>
        <button
          type="button"
          disabled={signInBusy}
          onClick={() => void signInWithGoogle()}
          className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-60"
        >
          {signInBusy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {signInBusy ? "로그인 중…" : "Google로 로그인"}
        </button>
        {signInError && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {signInError}
          </p>
        )}
      </Shell>
    );
  }

  if (!inviteCode.trim()) {
    return (
      <Shell>
        <p className="text-sm text-slate-300">유효한 초대 링크가 아니에요.</p>
        <button type="button" onClick={() => navigate("/friends")} className="btn-secondary w-full py-2 text-sm">
          친구 탭으로
        </button>
      </Shell>
    );
  }

  if (invite === null) {
    return (
      <Shell>
        <p className="text-sm text-slate-400">
          <Loader2 size={14} className="mr-1 inline animate-spin" /> 초대를 불러오는 중…
        </p>
      </Shell>
    );
  }

  if (invite === "missing") {
    return (
      <Shell>
        <p className="text-sm text-slate-300">
          초대를 찾을 수 없거나, 잘못된 링크예요.
        </p>
        {loadErr && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            {loadErr}
          </p>
        )}
        <button type="button" onClick={() => navigate("/friends")} className="btn-secondary w-full py-2 text-sm">
          친구 탭으로
        </button>
      </Shell>
    );
  }

  if (user.uid === invite.fromUid) {
    return (
      <Shell>
        <p className="text-sm text-slate-300">
          이 링크는 <strong className="text-slate-100">내가 만들어 공유할 초대</strong>예요.
        </p>
        <p className="text-xs text-slate-500">
          받는 사람에게 카카오톡·문자 등으로 보내 주세요. 본인이 수락할 수는 없어요.
        </p>
        <Link to="/friends" className="btn-primary block w-full py-2 text-center text-sm">
          친구 탭으로
        </Link>
      </Shell>
    );
  }

  const expired = Date.now() > invite.expiresAt;

  if (invite.status === "revoked") {
    return (
      <Shell>
        <p className="text-sm text-slate-300">발급자가 이 초대를 취소했어요.</p>
        <button type="button" onClick={() => navigate("/friends")} className="btn-secondary w-full py-2 text-sm">
          친구 탭으로
        </button>
      </Shell>
    );
  }

  if (invite.status === "used") {
    return (
      <Shell>
        <p className="text-sm text-slate-300">이 초대 링크는 이미 사용됐어요.</p>
        <button type="button" onClick={() => navigate("/friends")} className="btn-secondary w-full py-2 text-sm">
          친구 탭으로
        </button>
      </Shell>
    );
  }

  if (expired) {
    return (
      <Shell>
        <p className="text-sm text-slate-300">초대 링크 유효 기간이 지났어요. 새 링크를 요청해 주세요.</p>
        <button type="button" onClick={() => navigate("/friends")} className="btn-secondary w-full py-2 text-sm">
          친구 탭으로
        </button>
      </Shell>
    );
  }

  if (invite.status !== "pending") {
    return (
      <Shell>
        <p className="text-sm text-slate-300">처리할 수 없는 초대예요.</p>
        <button type="button" onClick={() => navigate("/friends")} className="btn-secondary w-full py-2 text-sm">
          친구 탭으로
        </button>
      </Shell>
    );
  }

  if (doneAccepted) {
    return (
      <Shell>
        <p className="text-sm text-emerald-200">
          수락했어요. 이제 {invite.fromName}님이 내 식단 기록을 볼 수 있어요.
        </p>
        <Link to="/friends" className="btn-primary block w-full py-2 text-center text-sm">
          친구 탭으로
        </Link>
      </Shell>
    );
  }

  const codeId = invite.id;

  async function onAccept() {
    setActionErr(null);
    setBusyAccept(true);
    try {
      await acceptFriendInviteCode(codeId, CALENDAR_ONLY_SCOPE, localUser ?? undefined);
      setDoneAccepted(true);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAccept(false);
    }
  }

  return (
    <Shell>
      <h2 className="text-base font-semibold text-slate-100">
        <UserPlus size={16} className="mb-0.5 mr-1 inline text-brand-400" />
        친구 초대
      </h2>
      <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <InviteAvatar name={invite.fromName} photoURL={invite.fromPhotoURL} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">{invite.fromName}</p>
          <p className="truncate text-xs text-slate-500">{invite.fromEmail}</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] text-slate-400">
        <p>
          수락하면 내 <strong className="text-slate-200">식단(달력) 기록</strong>이 {invite.fromName}님에게
          공개돼요.
        </p>
        <p className="mt-1 text-slate-500">건강 기록은 앱에서 친구와 공유되지 않아요.</p>
      </div>

      {actionErr && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {actionErr}
        </p>
      )}

      <button
        type="button"
        onClick={() => void onAccept()}
        disabled={busyAccept}
        className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-60"
      >
        {busyAccept ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {busyAccept ? "처리 중…" : "수락하기"}
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6">
      <header>
        <Link to="/friends" className="text-xs text-slate-400">
          ← 친구 탭
        </Link>
      </header>
      <section className="card space-y-3 p-4">{children}</section>
    </div>
  );
}

function InviteAvatar({ name, photoURL }: { name: string; photoURL?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full border border-slate-800 object-cover"
        referrerPolicy="no-referrer"
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
