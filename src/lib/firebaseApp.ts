import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { initializeFirestore, type Firestore } from "firebase/firestore";

/** 모바일 WebKit/WebView 등에서 WebSocket·감지형 롱폴링이 꼬이면 초기 리스너가 permission-denied 로 떨어지는 경우가 있어 폴백 */
function prefersFirestoreForcedLongPolling(): boolean {
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
  firestore = initializeFirestore(
    app,
    prefersFirestoreForcedLongPolling()
      ? {
          experimentalForceLongPolling: true,
        }
      : {
          experimentalAutoDetectLongPolling: true,
        },
  );
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
