import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, patchSettings } from "./lib/db";
import { applyTheme, normalizeTheme } from "./lib/theme";
import { FeedStreamProvider } from "./contexts/FeedStreamContext";
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
  // settings / userCount 를 분리 쿼리하면 커밋 직후 한 프레임만 어긋나도
  // 온보딩 직후 홈 ↔ 온보딩 리다이렉트가 꼬일 수 있어 한 스냅샷으로 읽는다.
  const gate = useLiveQuery(
    async () => ({
      settings: await getSettings(),
      userCount: await db.users.count(),
    }),
    [],
  );

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
  const isOnboardingRoute = location.pathname.startsWith("/onboarding");
  const isSettingsRoute = location.pathname.startsWith("/settings");
  // 친구 초대 링크는 앱을 처음 쓰는 사람이 수신하므로 온보딩 전에도 접근 허용.
  const isInviteRoute = location.pathname.startsWith("/friends/invite");

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
        className="app-shell mx-auto flex h-full w-full max-w-screen-sm flex-col"
        style={{
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
        }}
      >
        <main className="flex-1 overflow-y-auto pb-24">
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
