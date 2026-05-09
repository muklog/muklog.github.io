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

  /** 빌드에 VITE_FIREBASE_* 가 없으면 카드가 통째로 사라져 온보딩에서 구글 로그인 영역이 비어 보임 */
  if (!firebaseReady) {
    return (
      <section className="card border-amber-500/30 bg-amber-500/10 px-4 py-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-100">
          <Cloud size={16} className="text-amber-400" /> Google 로그인
        </h2>
        <p className="text-xs leading-relaxed text-amber-100/90">
          이 빌드에는 Firebase 웹 설정이 포함되지 않았습니다. 배포라면{" "}
          <strong className="text-amber-50">저장소 Settings → Secrets and variables → Actions</strong>에{" "}
          <code className="rounded bg-black/25 px-1 py-0.5 text-[11px] text-amber-100/95">VITE_FIREBASE_*</code> 를
          채운 뒤 워크플로를 다시 실행하세요. 로컬이라면{" "}
          <code className="rounded bg-black/25 px-1 py-0.5 text-[11px]">.env.local</code> 에 같은 이름으로 넣고 개발
          서버를 재시작해 주세요.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-amber-200/75">
          Firebase Console → Authentication →{" "}
          <strong className="font-medium text-amber-100/85">승인된 도메인</strong>에 이 사이트 호스트(예:{" "}
          <code className="rounded bg-black/25 px-1">muklog.github.io</code>)도 추가해야 로그인이 동작합니다.
        </p>
      </section>
    );
  }

  if (loading) {
    return null;
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
