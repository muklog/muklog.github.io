import { useEffect } from "react";
import { Cloud, Loader2, LogIn, LogOut } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { isEmbeddedBrowserLikelyBlockingGoogleOAuth } from "../lib/inAppBrowser";
import EmbeddedGoogleLoginNotice from "./EmbeddedGoogleLoginNotice";

/** 메인 등 — Firebase 미연결 시 Google 로그인 유도 */
export default function FirebaseLoginCard() {
  const {
    firebaseReady,
    user,
    loading,
    signInBusy,
    signInError,
    clearSignInError,
    refreshUser,
    signInWithGoogle,
    signOutApp,
  } = useAuth();

  useEffect(() => {
    if (!firebaseReady) return;
    refreshUser();
  }, [firebaseReady, refreshUser]);

  const oauthInAppBlocked =
    typeof navigator !== "undefined" && isEmbeddedBrowserLikelyBlockingGoogleOAuth();

  if (!firebaseReady) return null;

  if (loading) {
    return (
      <section className="card flex items-center gap-2 border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        <Loader2 size={14} className="animate-spin" /> 로그인 확인 중…
      </section>
    );
  }

  if (user) {
    return (
      <section className="card border-sky-500/25 bg-sky-500/5 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-sky-200/90">
              <Cloud size={14} className="mr-1 inline align-text-bottom" />
              <span className="font-medium text-sky-100">
                {user.email ?? user.displayName ?? "Google"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOutApp()}
            className="btn-secondary inline-flex shrink-0 items-center gap-1 py-1.5 pl-2 pr-2.5 text-xs"
          >
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card border-sky-500/30 bg-sky-500/10 px-4 py-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-100">
        <Cloud size={16} className="text-sky-400" /> 데이터 동기화
      </h2>
      <EmbeddedGoogleLoginNotice />
      {!oauthInAppBlocked && (
        <button
          type="button"
          disabled={signInBusy}
          onClick={() => void signInWithGoogle()}
          className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-60"
        >
          {signInBusy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {signInBusy ? "로그인 중…" : "Google로 로그인"}
        </button>
      )}
      {!oauthInAppBlocked && signInError && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200/95">
          <p className="whitespace-pre-wrap break-words">{signInError}</p>
          <button type="button" onClick={clearSignInError} className="mt-2 text-[11px] text-rose-300 underline">
            닫기
          </button>
        </div>
      )}
    </section>
  );
}
