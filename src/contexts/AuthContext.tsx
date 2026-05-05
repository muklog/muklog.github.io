import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  onIdTokenChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { ensureAutoCloudSyncListeners, requestAutoCloudSync } from "../lib/autoCloudSync";
import { isEmbeddedBrowserLikelyBlockingGoogleOAuth } from "../lib/inAppBrowser";
import { clearLocalProfileDataPreservingDevicePreferences, db, getSettings } from "../lib/db";
import { getFirebaseAuth, initFirebase, isFirebaseConfigured } from "../lib/firebaseApp";
import { upsertMyPublicProfile } from "../lib/friends";

/** 로그인했던 흔적은 있는데 Firebase 세션이 없을 때(쿠키만 삭제 등) 로컬 DB 정리용 */
const LAST_FB_UID_KEY = "healthhealth_last_fb_uid";

function formatSignInError(e: unknown): string {
  const o = e as { code?: string; message?: string };
  const code = o?.code ?? "";
  if (code === "auth/popup-blocked") {
    return "팝업이 차단되었습니다. 주소창에서 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.";
  }
  if (code === "auth/unauthorized-domain") {
    return "Firebase 콘솔 → Authentication → 승인된 도메인에 이 사이트 주소를 추가하세요.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Firebase에서 Google 로그인 제공업체를 켜 주세요.";
  }
  if (code === "auth/web-storage-unsupported" || /storage/i.test(String(o?.message))) {
    return "브라우저가 저장소(세션)를 막고 있을 수 있습니다. 사생활 보호 모드를 끄거나 다른 브라우저로 시도해 보세요.";
  }
  return o?.message ? `${code ? `${code}: ` : ""}${o.message}` : String(e);
}

type AuthState = {
  firebaseReady: boolean;
  user: User | null;
  loading: boolean;
  signInBusy: boolean;
  signInError: string | null;
  clearSignInError: () => void;
  refreshUser: () => void;
  signInWithGoogle: () => Promise<void>;
  signOutApp: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const firebaseReady = isFirebaseConfigured();
  /** `auth.authStateReady()` 전에는 `currentUser === null` 깜빡임이 들어와도 로컬 DB 를 지우면 안 됨 */
  const authSessionResolvedRef = useRef(false);
  const prevFirebaseUidRef = useRef<string | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseReady);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const clearSignInError = useCallback(() => setSignInError(null), []);

  const refreshUser = useCallback(() => {
    if (!firebaseReady) {
      setUser(null);
      return;
    }
    try {
      setUser(getFirebaseAuth().currentUser);
    } catch {
      setUser(null);
    }
  }, [firebaseReady]);

  useEffect(() => {
    if (user) setSignInBusy(false);
  }, [user]);

  useEffect(() => {
    if (!firebaseReady || !user) return;
    ensureAutoCloudSyncListeners();
    requestAutoCloudSync({ immediate: true });
    // 친구 기능: 본인 공개 프로필을 Firestore 에 upsert — 실패는 로그만 남기고 앱 플로우는 계속.
    // Dexie 쪽 활성 사용자 프로필(닉네임·아바타) 이 있으면 그 값을 우선 반영.
    void (async () => {
      try {
        const s = await getSettings();
        const localUser = s?.activeUserId
          ? await db.users.get(s.activeUserId)
          : undefined;
        await upsertMyPublicProfile(user, localUser ?? null);
      } catch (e) {
        console.warn("[auth] publicProfile upsert 실패", e);
      }
    })();
  }, [firebaseReady, user?.uid]);

  useEffect(() => {
    if (!firebaseReady) {
      setUser(null);
      setAuthReady(true);
      return;
    }
    initFirebase();
    const auth = getFirebaseAuth();
    void setPersistence(auth, browserLocalPersistence).catch(() => {});

    const applyAuthUser = async (nextUser: User | null) => {
      const nextUid = nextUser?.uid;
      const prevUid = prevFirebaseUidRef.current;

      if (firebaseReady && !nextUid && authSessionResolvedRef.current) {
        const hasStoredUid =
          typeof localStorage !== "undefined" && !!localStorage.getItem(LAST_FB_UID_KEY);
        const staleCloud = hasStoredUid
          ? false
          : !!(await getSettings()).lastCloudSyncAt;
        if (hasStoredUid || staleCloud) {
          await clearLocalProfileDataPreservingDevicePreferences();
          if (typeof localStorage !== "undefined") localStorage.removeItem(LAST_FB_UID_KEY);
          prevFirebaseUidRef.current = undefined;
          setUser(null);
          return;
        }
      }

      if (prevUid !== undefined && prevUid !== nextUid) {
        await clearLocalProfileDataPreservingDevicePreferences();
        if (typeof localStorage !== "undefined") localStorage.removeItem(LAST_FB_UID_KEY);
      }

      prevFirebaseUidRef.current = nextUid;
      if (nextUid && typeof localStorage !== "undefined") {
        localStorage.setItem(LAST_FB_UID_KEY, nextUid);
      }
      setUser(nextUser);
    };

    const unsubAuth = onAuthStateChanged(auth, (u) => void applyAuthUser(u));
    const unsubToken = onIdTokenChanged(auth, (u) => void applyAuthUser(u));

    void auth.authStateReady().then(() => {
      authSessionResolvedRef.current = true;
      void applyAuthUser(auth.currentUser);
      setAuthReady(true);
    });

    const timeouts = [50, 200, 600, 1500].map((ms) =>
      window.setTimeout(() => void applyAuthUser(auth.currentUser), ms),
    );

    const onVis = () => {
      if (document.visibilityState === "visible") void applyAuthUser(auth.currentUser);
    };
    const onShow = () => void applyAuthUser(auth.currentUser);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onShow);

    return () => {
      unsubAuth();
      unsubToken();
      timeouts.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onShow);
    };
  }, [firebaseReady]);

  const loading = firebaseReady && !authReady;

  const signInWithGoogle = useCallback(async () => {
    setSignInError(null);
    if (typeof navigator !== "undefined" && isEmbeddedBrowserLikelyBlockingGoogleOAuth()) {
      setSignInError(
        "인앱 브라우저에서는 Google 로그인을 쓸 수 없어요. 먼저 «기본 브라우저로 열기» 또는 «주소 복사하기»로 기본 브라우저에서 이 페이지를 연 뒤 다시 시도해 주세요.",
      );
      return;
    }
    setSignInBusy(true);
    const resetBusyLater = window.setTimeout(() => setSignInBusy(false), 15_000);
    try {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      void setPersistence(auth, browserLocalPersistence).catch(() => {});
      const provider = new GoogleAuthProvider();
      provider.addScope("profile");
      provider.addScope("email");
      provider.setCustomParameters({ prompt: "select_account" });
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await signInWithPopup(auth, provider);
      refreshUser();
    } catch (e) {
      console.error("[auth] Google 로그인", e);
      setSignInError(formatSignInError(e));
    } finally {
      window.clearTimeout(resetBusyLater);
      setSignInBusy(false);
    }
  }, [refreshUser]);

  const signOutApp = useCallback(async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (e) {
      console.error("[auth] 로그아웃", e);
    }
  }, []);

  const value = useMemo(
    () => ({
      firebaseReady,
      user,
      loading,
      signInBusy,
      signInError,
      clearSignInError,
      refreshUser,
      signInWithGoogle,
      signOutApp,
    }),
    [
      firebaseReady,
      user,
      loading,
      signInBusy,
      signInError,
      clearSignInError,
      refreshUser,
      signInWithGoogle,
      signOutApp,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 안에서만 사용할 수 있습니다.");
  return ctx;
}
