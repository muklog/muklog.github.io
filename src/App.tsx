import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, patchSettings } from "./lib/db";
import { applyTheme, normalizeTheme } from "./lib/theme";
import { FeedStreamProvider } from "./contexts/FeedStreamContext";
import {
  usePullToRefresh,
  PULL_TO_REFRESH_THRESHOLD_PX,
  PULL_TO_REFRESH_PROGRESS_CAP_PX,
} from "./hooks/usePullToRefresh";
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

export default function App() {
  const location = useLocation();
  const isOnboardingRoute = location.pathname.startsWith("/onboarding");
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isInviteRoute = location.pathname.startsWith("/friends/invite");

  // settings / userCount 를 분리 쿼리하면 커밋 직후 한 프레임만 어긋나도
  // 온보딩 직후 홈 ↔ 온보딩 리다이렉트가 꼬일 수 있어 한 스냅샷으로 읽는다.
  const gate = useLiveQuery(
    async () => ({
      settings: await getSettings(),
      userCount: await db.users.count(),
    }),
    [],
  );

  /**
   * 풀투새프레시: `<main>` 이 DOM 에 붙었을 때만 리스너를 붙인다.
   * (게이트 로딩/온보딩 Navigate 시 main 없이 effect 만 돌면 이후 재부착이 안 되던 문제)
   */
  const pullRefreshEnabled =
    gate !== undefined &&
    !(
      (!gate.settings.onboarded || gate.userCount === 0) &&
      !isOnboardingRoute &&
      !isSettingsRoute &&
      !isInviteRoute
    );

  /** 게이트로 조기 return 하기 전에 호출해야 함 — 그렇지 않으면 React #310 (훅 개수 불일치) */
  const mainRef = useRef<HTMLElement>(null);
  const { progress: ptrProgress } = usePullToRefresh(mainRef, pullRefreshEnabled);
  const ptrReady =
    ptrProgress >= PULL_TO_REFRESH_THRESHOLD_PX / PULL_TO_REFRESH_PROGRESS_CAP_PX;

  // 활성 사용자가 사라진 경우 자동 정리
  useEffect(() => {
    if (!gate?.settings.activeUserId) return;
    db.users.get(gate.settings.activeUserId).then((u) => {
      if (!u) patchSettings({ activeUserId: undefined });
    });
  }, [gate?.settings.activeUserId]);

  // 1인 모드: 프로필이 하나뿐이면 활성 ID를 그 프로필로 맞춤
  useEffect(() => {
    if (!gate || gate.userCount !== 1) return;
    db.users.orderBy("createdAt").first().then((u) => {
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
  const needsOnboarding = !settings.onboarded || userCount === 0;

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

  return (
    <FeedStreamProvider>
      <div
        className="app-shell mx-auto flex h-full min-h-0 w-full max-w-screen-sm flex-col"
        style={{
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
        }}
      >
        <main
          ref={mainRef}
          className="relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain overflow-x-hidden pb-24 [-webkit-overflow-scrolling:touch]"
        >
          <div
            className="pointer-events-none sticky top-1 z-[60] flex justify-center px-4 transition-opacity duration-150"
            style={{
              opacity: ptrProgress > 0.06 ? Math.min(1, ptrProgress * 1.2) : 0,
            }}
            aria-hidden
          >
            <span className="rounded-full border border-slate-700 bg-slate-900/92 px-3 py-1.5 text-[11px] font-medium text-slate-300 shadow-lg backdrop-blur-sm">
              {ptrReady ? "놓으면 새로고침···" : "당겨서 새로고침"}
            </span>
          </div>
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
        </main>
        {!isOnboardingRoute && <BottomNav />}
      </div>
    </FeedStreamProvider>
  );
}
