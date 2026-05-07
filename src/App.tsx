import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, patchSettings, runDexie } from "./lib/db";
import { requestAutoCloudSync } from "./lib/autoCloudSync";
import { useAuth } from "./contexts/AuthContext";
import { applyTheme, normalizeTheme } from "./lib/theme";
import { FeedStreamProvider } from "./contexts/FeedStreamContext";
import { usePullToRefresh, PULL_TO_REFRESH_MAX_VISUAL_PX, PULL_TO_REFRESH_THRESHOLD_PX } from "./hooks/usePullToRefresh";
import { RefreshCw } from "lucide-react";
import FeedPage from "./pages/FeedPage";
import HomePage from "./pages/HomePage";
import DayPage from "./pages/DayPage";
import HealthPage from "./pages/HealthPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingPage from "./pages/OnboardingPage";
import FriendsPage from "./pages/FriendsPage";
import FriendProfilePage from "./pages/FriendProfilePage";
import FriendDayPage from "./pages/FriendDayPage";
import InviteCodePage from "./pages/InviteCodePage";
import NotificationsPage from "./pages/NotificationsPage";
import MessagesPage from "./pages/MessagesPage";
import DmChatPage from "./pages/DmChatPage";
import BottomNav from "./components/BottomNav";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DmRealtimeProvider } from "./contexts/DmRealtimeContext";
import { tabLoadingMessage } from "./lib/tabLoadingMessage";
import type { AppSettings } from "./types";

/** 온보딩 완료 후 Dexie userCount 가 잠깐 0인 타이밍에 /onboarding 으로 튕기지 않도록, 완료 플래그를 우선한다. */
function shouldRedirectToOnboarding(settings: AppSettings, userCount: number): boolean {
  if (settings.onboarded === true) return false;
  return !settings.onboarded || userCount === 0;
}

export default function App() {
  const location = useLocation();
  const isOnboardingRoute = location.pathname.startsWith("/onboarding");
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isInviteRoute = location.pathname.startsWith("/friends/invite");
  /** DM 대화방은 안쪽 메시지 영역이 스크롤 — 풀투새프레시와 충돌하므로 이 라우트만 끈다 */
  const isDmThreadRoute = /^\/messages\/[^/]+$/.test(location.pathname);

  const { firebaseReady, user: firebaseUser } = useAuth();
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);

  // settings / userCount 를 분리 쿼리하면 커밋 직후 한 프레임만 어긋나도
  // 온보딩 직후 홈 ↔ 온보딩 리다이렉트가 꼬일 수 있어 한 스냅샷으로 읽는다.
  const gate = useLiveQuery(
    async () => ({
      settings: await getSettings(),
      userCount: await runDexie(() => db.users.count()),
    }),
    [],
  );

  const needsHydrationWait =
    gate !== undefined &&
    firebaseReady &&
    !!firebaseUser &&
    gate.userCount === 0 &&
    gate.settings.onboarded !== true &&
    gate.settings.lastCloudSyncAt == null;

  useEffect(() => {
    if (!needsHydrationWait) {
      setHydrationTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => setHydrationTimedOut(true), 22_000);
    return () => window.clearTimeout(t);
  }, [needsHydrationWait]);

  useEffect(() => {
    if (needsHydrationWait && firebaseUser) {
      requestAutoCloudSync({ immediate: true });
    }
  }, [needsHydrationWait, firebaseUser?.uid]);

  /**
   * 풀투새프레시: `<main>` 이 DOM 에 붙었을 때만 리스너를 붙인다.
   * (게이트 로딩/온보딩 Navigate 시 main 없이 effect 만 돌면 이후 재부착이 안 되던 문제)
   */
  const pullRefreshEnabled =
    gate !== undefined &&
    !isDmThreadRoute &&
    !(
      shouldRedirectToOnboarding(gate.settings, gate.userCount) &&
      !isOnboardingRoute &&
      !isSettingsRoute &&
      !isInviteRoute
    );

  /** 같은 pathname 등이라도 `<main>` DOM 노드가 바뀌면(ref 재바인딩) 세대가 증가 — 리스너가 새 노드에 붙음 */
  const mainRef = useRef<HTMLElement | null>(null);
  const [mainAttachGen, setMainAttachGen] = useState(0);
  const bindMainRef = useCallback((node: HTMLElement | null) => {
    mainRef.current = node;
    setMainAttachGen((n) => n + 1);
  }, []);

  /** 게이트로 조기 return 하기 전에 호출해야 함 — 그렇지 않으면 React #310 (훅 개수 불일치) */
  const ptr = usePullToRefresh(mainRef, pullRefreshEnabled, `${location.pathname}:${mainAttachGen}`);

  const pullNorm = Math.min(1, ptr.pullPx / PULL_TO_REFRESH_THRESHOLD_PX);
  const visualNorm = Math.min(1, ptr.pullPx / PULL_TO_REFRESH_MAX_VISUAL_PX);
  const hintOpacity =
    ptr.pendingReload || ptr.pullPx > 2 ? Math.min(1, Math.max(0, (ptr.pullPx - 2) / 26)) : 0;

  // 활성 사용자가 사라진 경우 자동 정리
  useEffect(() => {
    const activeId = gate?.settings.activeUserId;
    if (!activeId) return;
    void runDexie(() => db.users.get(activeId)).then((u) => {
      if (!u) patchSettings({ activeUserId: undefined });
    });
  }, [gate?.settings.activeUserId]);

  // 로컬 프로필이 하나뿐이면 활성 ID를 그 프로필로 맞춤
  useEffect(() => {
    if (!gate || gate.userCount !== 1) return;
    void runDexie(() => db.users.orderBy("createdAt").first()).then((u) => {
      if (u && gate.settings.activeUserId !== u.id) {
        void patchSettings({ activeUserId: u.id });
      }
    });
  }, [gate?.userCount, gate?.settings.activeUserId]);

  // 테마 동기화 — 클라우드에서 다른 기기의 선택이 동기화되어 들어와도 즉시 반영.
  useEffect(() => {
    if (!gate) return;
    applyTheme(normalizeTheme(gate.settings.theme));
  }, [gate?.settings.theme]);

  // 데이터 로딩 중
  if (gate === undefined) {
    return (
      <div className="app-shell flex h-full items-center justify-center text-slate-500">
        로딩 중…
      </div>
    );
  }

  const { settings, userCount } = gate;
  const needsOnboarding = shouldRedirectToOnboarding(settings, userCount);

  /** 예전(d561e64)처럼 `<main>` 을 유지 — 인증·클라우드 대기를 전체 화면 return 으로 바꾸면 PTR 리스너가 떨어진 DOM 에 붙는 버그가 난다 */
  const blockingHydration = needsHydrationWait && !hydrationTimedOut;

  // 인증·하이드레이션 스플래시 동안에는 온보딩 리다이렉트를 미룸(기존 조기 return 과 동일 순서)
  if (!blockingHydration) {
    // 온보딩 페이지에서 사용자가 닉네임·아바타를 다듬고 있는 동안에는 클라우드
    // 동기화로 user/onboarded 가 채워져도 자동으로 메인으로 이탈하지 않는다.
    // (이전엔 `if (!needsOnboarding && isOnboardingRoute) { Navigate("/") }` 가
    // 있었지만, 첫 로그인 직후 클라우드에서 기존 프로필이 들어오면 사용자가
    // 아직 입력 중인데도 페이지가 휙 넘어가는 버그를 일으켰다. 명시적으로
    // "시작하기" 를 눌러야만 finish() 가 navigate 하도록 단순화.)

    // 클라우드 복원: 온보딩 전에도 설정에서 Google 로그인 가능
    if (needsOnboarding && !isOnboardingRoute && !isSettingsRoute && !isInviteRoute) {
      return <Navigate to="/onboarding" replace />;
    }
  }

  return (
    <DmRealtimeProvider>
      <FeedStreamProvider>
        <div
          className="app-shell mx-auto flex h-full min-h-0 w-full max-w-screen-sm flex-col"
          style={{
            paddingTop: "var(--safe-top)",
            paddingBottom: "var(--safe-bottom)",
          }}
        >
          <main
            ref={bindMainRef}
            className={
              isDmThreadRoute
                ? "relative flex min-h-0 flex-1 touch-pan-y flex-col overflow-hidden overscroll-y-none overflow-x-hidden bg-slate-950 pb-24 [scrollbar-gutter:stable]"
                : "relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-auto overflow-x-hidden bg-slate-950 pb-24 [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]"
            }
          >
          {/* 풀투새로고침: 레이아웃 높이 0 유지 · absolute 로 가로 중앙 정렬 · motion 만 별도 레이어 */}
          <div
            className="pointer-events-none sticky top-0 z-[35] h-0 w-full overflow-visible"
            aria-hidden
          >
            <div
              className="absolute inset-x-0 top-0 flex justify-center px-4"
              style={{
                transform: `translate3d(0, ${ptr.pullPx}px, 0) scale(${0.93 + visualNorm * 0.07})`,
                opacity: ptr.pendingReload ? 1 : hintOpacity,
                transition:
                  ptr.isDragging || ptr.pendingReload
                    ? "none"
                    : "opacity 200ms ease-out, transform 300ms cubic-bezier(0.22, 1, 0.36, 1)",
                willChange: ptr.pullPx > 1 || ptr.isDragging ? "transform, opacity" : undefined,
              }}
            >
              <span className="inline-flex items-center gap-2.5 rounded-full border border-white/14 bg-slate-900/93 px-4 py-2 text-[11px] font-medium leading-none tracking-wide text-slate-200 whitespace-nowrap shadow-[0_8px_32px_-10px_rgba(0,0,0,0.75)] ring-1 ring-black/35 backdrop-blur-md">
                <RefreshCw
                  size={15}
                  strokeWidth={2.25}
                  className={`shrink-0 text-brand-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.25)] ${
                    ptr.pendingReload ? "animate-spin" : ""
                  }`}
                  style={
                    ptr.pendingReload
                      ? undefined
                      : {
                          transform: `rotate(${pullNorm * 360}deg)`,
                          opacity: ptr.armed ? 1 : 0.45 + pullNorm * 0.55,
                        }
                  }
                  aria-hidden
                />
                {ptr.pendingReload
                  ? tabLoadingMessage(location.pathname)
                  : ptr.armed
                    ? "놓으면 새로고침"
                    : "당겨서 새로고침"}
              </span>
            </div>
          </div>

            {blockingHydration ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 bg-slate-950 px-6 py-12 text-center text-slate-500">
                <p className="text-sm text-slate-300">계정 데이터를 불러오는 중…</p>
                <p className="text-xs text-slate-500">
                  같은 계정으로 다른 주소에서 쓰던 기록은 잠시 후 여기로 맞춰져요.
                </p>
              </div>
            ) : (
              <AppErrorBoundary>
                <div className={isDmThreadRoute ? "flex min-h-0 flex-1 flex-col" : undefined}>
                  <Routes>
                    {/* 첫 화면은 피드. 기존 달력 홈은 /home 으로 이동 */}
                    <Route path="/" element={<FeedPage />} />
                    <Route path="/home" element={<HomePage />} />
                    <Route path="/day/:date" element={<DayPage />} />
                    <Route path="/health" element={<HealthPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/onboarding" element={<OnboardingPage />} />
                    <Route path="/friends" element={<FriendsPage />} />
                    <Route path="/friends/invite/c/:inviteCode" element={<InviteCodePage />} />
                    <Route path="/friends/:uid" element={<FriendProfilePage />} />
                    <Route path="/friends/:uid/day/:date" element={<FriendDayPage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/messages" element={<MessagesPage />} />
                    <Route path="/messages/:threadId" element={<DmChatPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </div>
              </AppErrorBoundary>
            )}
          </main>
          {!isOnboardingRoute && !blockingHydration && <BottomNav />}
        </div>
      </FeedStreamProvider>
    </DmRealtimeProvider>
  );
}
