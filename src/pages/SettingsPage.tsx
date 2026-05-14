import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Palette,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import {
  afterUserDataMutation,
  db,
  getSettings,
  patchSettings,
  runDexie,
} from "../lib/db";
import { requestAutoCloudSync } from "../lib/autoCloudSync";
import { pingGemini } from "../lib/ai";
import { usePrimaryUserIdState } from "../hooks/usePrimaryUserId";
import { normalizeTheme, persistTheme } from "../lib/theme";
import { THEME_IDS, THEME_LABELS, type ThemeId } from "../types";
import { cls } from "../lib/utils";
import { wipeMyCloudData } from "../lib/wipeCloud";
import { isEmbeddedBrowserLikelyBlockingGoogleOAuth } from "../lib/inAppBrowser";
import EmbeddedGoogleLoginNotice from "../components/EmbeddedGoogleLoginNotice";
import ProfileIdentitySection from "../components/ProfileIdentitySection";
import GeminiApiKeyGuide from "../components/GeminiApiKeyGuide";

export default function SettingsPage() {
  const {
    firebaseReady,
    user,
    loading: authLoading,
    signInBusy,
    signInError,
    clearSignInError,
    refreshUser,
    signInWithGoogle,
    signOutApp,
  } = useAuth();
  const settings = useLiveQuery(() => getSettings(), []);
  const { id: primaryId, loading: primaryLoading } = usePrimaryUserIdState();
  const profileUser = useLiveQuery(
    async () => (primaryId ? await runDexie(() => db.users.get(primaryId)) : undefined),
    [primaryId],
  );
  /** Dexie 가 깨어나기 전 잠깐의 undefined 와 "프로필 행이 정말 비었음" 을 구분 — 첫 진입 빈 화면 방지. */
  const profileLoading =
    primaryLoading || (primaryId !== undefined && profileUser === undefined);
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [pingState, setPingState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok"; model: string }
    | { kind: "fail"; msg: string }
  >({ kind: "idle" });
  const [keySavedFlash, setKeySavedFlash] = useState(false);

  const oauthInAppBlocked =
    typeof navigator !== "undefined" && isEmbeddedBrowserLikelyBlockingGoogleOAuth();

  useEffect(() => {
    if (!firebaseReady) return;
    refreshUser();
  }, [firebaseReady, refreshUser]);

  /**
   * 설정 탭 첫 진입 — 로그인 상태이고 프로필이 아직 안 잡혔으면 클라우드에서 즉시 한 번 끌어옴.
   * (앱 부팅 → 사용자가 동기화 끝나기 전에 탭으로 넘어와 "프로필 불러오는 중" 만 계속 보이는 현상 완화)
   */
  useEffect(() => {
    if (!firebaseReady || !user) return;
    if (profileUser !== undefined) return;
    requestAutoCloudSync({ immediate: true });
  }, [firebaseReady, user?.uid, profileUser]);

  useEffect(() => {
    if (settings?.geminiApiKey) setApiKey(settings.geminiApiKey);
  }, [settings?.geminiApiKey]);

  async function saveKey() {
    await patchSettings({
      geminiApiKey: apiKey.trim() || undefined,
    });
    setPingState({ kind: "idle" });
    setKeySavedFlash(true);
    window.setTimeout(() => setKeySavedFlash(false), 2500);
  }
  async function testKey() {
    setPingState({ kind: "busy" });
    try {
      const result = await pingGemini(apiKey.trim());
      setPingState({ kind: "ok", model: result.model });
    } catch (e) {
      setPingState({
        kind: "fail",
        msg: e instanceof Error ? e.message : "연결 실패",
      });
    }
  }

  async function wipeAll() {
    const loggedIn = !!user;
    const confirmMsg = loggedIn
      ? "⚠ 이 기기와 클라우드의 내 데이터를 모두 삭제합니다.\n\n" +
        "• 식단·건강기록·프로필\n" +
        "• 친구와의 공유 관계, 링크 초대(friendInviteCodes)\n" +
        "• 다른 사람이 내 식단에 단 댓글/좋아요\n" +
        "이 모든 것이 영구적으로 사라지며 되돌릴 수 없어요."
      : "⚠ 이 기기의 모든 데이터를 삭제합니다.\n\n" +
        "Google 로그인이 안 되어 있어 클라우드 데이터는 정리할 수 없어요. " +
        "클라우드까지 함께 지우려면 먼저 로그인한 뒤 다시 시도해 주세요.";
    if (!confirm(confirmMsg)) return;
    if (!confirm("정말로 확실한가요? 이 작업은 되돌릴 수 없어요.")) return;

    // 1) 로그아웃 전에 Firestore 내 데이터를 먼저 삭제한다 — 로그아웃 후엔 권한이
    //    없어서 어차피 못 지운다. 실패는 best-effort 로 보고하고 진행.
    let cloudReport: Awaited<ReturnType<typeof wipeMyCloudData>> | null = null;
    if (loggedIn && user) {
      try {
        cloudReport = await wipeMyCloudData(user);
      } catch (e) {
        console.error("[wipeAll] cloud wipe", e);
        if (
          !confirm(
            "클라우드 데이터를 일부 지우지 못했어요. 그래도 이 기기 데이터는 계속 삭제할까요?",
          )
        ) {
          return;
        }
      }
    }

    // 2) 로그아웃해서 자동 동기화가 멈추도록.
    try {
      await signOutApp();
    } catch (e) {
      console.warn("[wipeAll] signOut", e);
    }

    // 3) 로컬 Dexie 비우기.
    await runDexie(async () => {
      await db.transaction(
        "rw",
        db.users,
        db.meals,
        db.health,
        db.settings,
        async () => {
          await db.meals.clear();
          await db.health.clear();
          await db.users.clear();
          await db.settings.clear();
        },
      );
    });

    if (cloudReport && cloudReport.errors.length > 0) {
      alert(
        "일부 클라우드 항목을 지우지 못했어요. 네트워크 문제일 수 있으니 " +
          "다시 로그인해 한 번 더 시도해 주세요.",
      );
    }

    location.hash = "/";
    location.reload();
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-5">
      <header>
        <p className="text-xs text-slate-400">설정</p>
        <h1 className="text-xl font-bold">앱 설정</h1>
      </header>

      <section className="card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Cloud size={16} className="text-sky-400" /> Google 계정
        </h2>

        {!firebaseReady ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
            Firebase가 빌드에 없습니다. 배포 시 GitHub Actions Secrets에{" "}
            <code className="rounded bg-black/20 px-1">VITE_FIREBASE_*</code>를 넣고 다시 빌드하세요.
          </p>
        ) : null}

        {firebaseReady && !authLoading && !user && (
          <div className="space-y-2">
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
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200/95">
                <p className="whitespace-pre-wrap break-words">{signInError}</p>
                <button type="button" onClick={clearSignInError} className="mt-2 text-[11px] text-rose-300 underline">
                  닫기
                </button>
              </div>
            )}
          </div>
        )}

        {firebaseReady && !authLoading && user && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
              <span className="truncate text-slate-300">{user.email ?? user.displayName ?? "Google 계정"}</span>
              <button
                type="button"
                onClick={() => void signOutApp()}
                className="btn-secondary inline-flex shrink-0 items-center gap-1 py-1.5 pl-2 pr-2.5 text-xs"
              >
                <LogOut size={14} /> 로그아웃
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
          <UserRound size={16} className="text-brand-400" /> 프로필
        </h2>
        {profileUser ? (
          <div className="space-y-4">
            <ProfileIdentitySection user={profileUser} authUser={user} />
          </div>
        ) : profileLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin text-slate-400" />
            프로필을 불러오는 중이에요.
          </p>
        ) : (
          <p className="text-sm text-slate-500">표시할 프로필이 없어요.</p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
          <KeyRound size={16} className="text-brand-400" /> Google Gemini 키
        </h2>
        <p className="mb-2 text-xs leading-snug text-slate-400">
          식단·건강 AI 분석에는{" "}
          <strong className="font-semibold text-slate-200">Google API 키</strong>가 필요합니다. 무료 등급의
          키를 사용하시면 됩니다. 아래 사진을 확인한 후{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 underline"
          >
            Google AI Studio 키 페이지
          </a>
          로 이동해 키를 복사하고 돌아와주세요.
        </p>

        <div className="mb-2">
          <GeminiApiKeyGuide />
        </div>

        <div className="space-y-2">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="input pr-12"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="flex gap-2">
            <button onClick={saveKey} className="btn-primary flex-1 py-2 text-sm">
              저장
            </button>
            <button
              onClick={testKey}
              disabled={!apiKey || pingState.kind === "busy"}
              className="btn-secondary flex-1 py-2 text-sm"
            >
              {pingState.kind === "busy" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "연결 테스트"
              )}
            </button>
          </div>

          {pingState.kind === "ok" && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-400">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} /> 연결됨
              </span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-200">
                {pingState.model}
              </span>
            </p>
          )}
          {pingState.kind === "fail" && (
            <p className="flex items-start gap-1.5 text-xs text-rose-400">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{pingState.msg}</span>
            </p>
          )}
          {keySavedFlash && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={14} /> 저장됨
            </p>
          )}
        </div>
      </section>

      <ThemeSection currentTheme={normalizeTheme(settings?.theme)} />

      <section className="card p-4">
        <h2 className="mb-2 text-base font-semibold text-rose-300">위험 영역</h2>
        <p className="mb-3 text-xs text-slate-400">
          {user
            ? "이 기기의 내 식단·건강 기록·프로필·친구 공유 관계 등 모든 데이터를 삭제합니다. 친구가 보던 내 식단도 즉시 사라지며 되돌릴 수 없어요."
            : "이 기기의 식단·건강 기록과 프로필을 모두 삭제합니다. Google 로그인이 안 되어 있어 클라우드 데이터까지 정리하려면 먼저 로그인이 필요해요."}
        </p>
        <button
          onClick={wipeAll}
          className="btn-secondary w-full border-rose-500/30 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
        >
          <Trash2 size={14} /> 모든 데이터 삭제
        </button>
      </section>

      <section className="px-1 pb-6 text-center">
        <p className="mb-2 text-[11px] text-slate-600">
          <Link to="/privacy" className="text-brand-400 underline">
            개인정보 처리방침 · 서비스 안내
          </Link>
        </p>
        <p className="text-[11px] text-slate-600">먹로그 v0.1.5</p>
      </section>
    </div>
  );
}

/** 테마(강조색) 선택 — :root[data-theme] 와 settings.theme 양쪽을 동시에 갱신. */
function ThemeSection({ currentTheme }: { currentTheme: ThemeId }) {
  async function pick(t: ThemeId) {
    if (t === currentTheme) return;
    // DOM / localStorage 즉시 반영 후 Dexie + 클라우드에 영속 저장.
    persistTheme(t);
    await patchSettings({ theme: t });
    afterUserDataMutation();
  }

  // 각 테마의 실제 배경/카드/강조색 — 스와치에서 미니 미리보기로 보여줌.
  // (index.css 의 :root[data-theme] 정의와 같은 값 — 시각화 일관성 유지)
  const SWATCHES: Record<
    ThemeId,
    { app: string; card: string; border: string; brand: string }
  > = {
    green: { app: "6 26 22", card: "10 50 40", border: "18 70 56", brand: "16 185 129" },
    blue: { app: "8 22 46", card: "16 38 68", border: "28 60 100", brand: "14 165 233" },
    pink: { app: "38 14 32", card: "60 22 50", border: "100 38 80", brand: "236 72 153" },
    yellow: { app: "36 28 8", card: "64 50 14", border: "110 86 26", brand: "234 179 8" },
  };

  return (
    <section className="card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Palette size={16} className="text-brand-400" /> 테마
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        배경과 강조색을 함께 바꿔요. 선택은 자동 저장되고 같은 계정의 다른 기기에도 동기화됩니다.
      </p>
      <div className="grid grid-cols-4 gap-2">
        {THEME_IDS.map((t) => {
          const sel = t === currentTheme;
          const sw = SWATCHES[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => void pick(t)}
              aria-pressed={sel}
              className={cls(
                "flex flex-col items-center gap-2 rounded-xl border px-2 py-3 text-xs transition",
                sel
                  ? "border-brand-500 bg-brand-500/10 text-slate-100"
                  : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
              )}
            >
              {/* 미니 앱 미리보기 — 진짜 그 테마의 배경 위에 카드와 강조색 점이 얹힘 */}
              <span
                className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-lg ring-1 ring-black/40"
                style={{ backgroundColor: `rgb(${sw.app})` }}
                aria-hidden
              >
                <span
                  className="absolute inset-1.5 rounded-md"
                  style={{
                    backgroundColor: `rgb(${sw.card} / 0.7)`,
                    border: `1px solid rgb(${sw.border})`,
                  }}
                />
                <span
                  className="relative h-4 w-4 rounded-full shadow"
                  style={{ backgroundColor: `rgb(${sw.brand})` }}
                />
              </span>
              <span className="font-medium">{THEME_LABELS[t]}</span>
              {sel && (
                <span className="-mt-1 inline-flex items-center gap-1 text-[10px] text-brand-300">
                  <CheckCircle2 size={10} /> 사용 중
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
