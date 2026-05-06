import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from "firebase/firestore";

/** Android·iPhone·iPad 등 — 강제 롱폴링·IndexedDB 로컬캐시 조합에서 리스너가 자주 깨진다는 제보 대응 */
export function isFirestoreMobileUa(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;

/** Storage 는 Spark 플랜에서 막히는 경우가 많아 사용하지 않음 — 사진은 Firestore(Base64)만 사용 */
export function isFirebaseConfigured(): boolean {
  return !!(
    import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID
  );
}

export function initFirebase(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (app) return app;
  app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
  auth = getAuth(app);
  const mobile = isFirestoreMobileUa();

  /** 모바일: WebSocket 우선(autodetect) + 메모리 캐시만 — IDB 영속화·강제 롱폴링이 일부 브라우저에서 리스너 레이스를 키움. 데스크톱: 영속 캐시 유지 */
  const mobileOpts = {
    experimentalAutoDetectLongPolling: true as const,
    localCache: memoryLocalCache(),
  };
  const desktopTryOpts = {
    experimentalAutoDetectLongPolling: true as const,
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager({}),
    }),
  };

  try {
    firestore = mobile
      ? initializeFirestore(app, mobileOpts)
      : initializeFirestore(app, desktopTryOpts);
  } catch (e) {
    console.warn("[firebase] Firestore 로컬 캐시 미사용(메모리 캐시로 폴백)", e);
    try {
      firestore = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        localCache: memoryLocalCache(),
      });
    } catch (e2) {
      console.warn("[firebase] 메모리 캐시만 생략, 기본 초기화", e2);
      firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
    }
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  initFirebase();
  if (!auth) throw new Error("Firebase 인증이 설정되지 않았습니다.");
  return auth;
}

export function getFirestoreDb(): Firestore {
  initFirebase();
  if (!firestore) throw new Error("Firestore가 설정되지 않았습니다.");
  return firestore;
}
