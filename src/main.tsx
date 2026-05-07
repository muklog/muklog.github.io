import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import { bootstrapFirebaseAuth } from "./lib/bootstrapFirebaseAuth";
import { db } from "./lib/db";
import { installIndexedDbLifecycleHandlers, warmupIndexedDb } from "./lib/idbRetry";
import { applyTheme, getCachedTheme } from "./lib/theme";
import "./index.css";

void warmupIndexedDb(db);
installIndexedDbLifecycleHandlers(db);

// 첫 페인트 전에 직전 세션의 테마를 즉시 적용 — 페인트 깜빡임 방지.
// 정확한 값은 이후 Dexie 가 로드되면 settings.theme 로 다시 동기화됩니다.
applyTheme(getCachedTheme());

// Firebase 초기화·리다이렉트 로그인 잔여 처리 — 이걸 await 하면 그동안 #root 가 비어
// "배경만 보이는" 빈 화면이 될 수 있어, UI 먼저 그리고 병렬로 돌린다.
void bootstrapFirebaseAuth();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* GitHub Pages 호환을 위해 HashRouter 사용 */}
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
