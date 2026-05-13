import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// GitHub Pages 배포용 base (<org>.github.io 저장소면 "/". 프로젝트 페이지면 "/저장소이름/")
// CI 에서 VITE_BASE_PATH 로 설정. 로컬은 루트 기준과 동일하게 "/".
const base = process.env.VITE_BASE_PATH ?? "/";

/** navigateFallback 이 `/.well-known/*` 까지 가로채면 assetlinks.json 대신 index.html 이 내려감 */
const baseNoTrail = base.replace(/\/$/, "");
const escapedBase = baseNoTrail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const navigateFallbackDenylist = [
  escapedBase === "" ? /^\/\.well-known\// : new RegExp(`^${escapedBase}/\\.well-known/`),
];

/** HashRouter — 매니페스트 start_url 에 해시를 넣어 설치 후 첫 주소와 라우터 진입을 맞춤 */
const pwaStartUrl = base === "/" ? "/#/" : `${base.replace(/\/$/, "")}/#/`;

export default defineConfig(({ command }) => ({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      /** PNG 192·512 포함 — 크롬/웨일은 여기 빠지면 설치 플로우·스플래시가 깨지는 경우가 많음 (삼성 브라우저만 우연히 너그러운 현상 줄이기). */
      includeAssets: ["favicon.png", "favicon.ico", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "먹로그 — 식단·건강 기록",
        short_name: "먹로그",
        description: "달력·식단·AI 분석과 친구 피드 — 한 기기에서는 내 기록 중심",
        theme_color: "#10b981",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        lang: "ko",
        prefer_related_applications: false,
        start_url: pwaStartUrl,
        scope: base,
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "favicon.png",
            sizes: "48x48",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,json,webmanifest}"],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist,
        // 캐시는 자산만, API 호출은 항상 네트워크
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/generativelanguage\.googleapis\.com\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // auth-test 는 디버깅용 — dev 서버에서만 직접 접근(`npm run test:auth`).
      // 프로덕션 번들에 포함시키면 공개 사이트에 노출되므로 빌드 input 에서는 제외.
      input: {
        main: resolve(__dirname, "index.html"),
        ...(command === "build"
          ? {}
          : { authTest: resolve(__dirname, "auth-test.html") }),
      } as Record<string, string>,
      output: {
        manualChunks: {
          // 가장 큰 의존성들을 라우트와 분리해 첫 진입 시 캐싱 효율을 높인다.
          "vendor-firebase": [
            "firebase/app",
            "firebase/auth",
            "firebase/firestore",
          ],
          "vendor-gemini": ["@google/generative-ai"],
          "vendor-react": [
            "react",
            "react-dom",
            "react-router-dom",
          ],
          "vendor-utils": ["dexie", "date-fns", "lucide-react"],
        },
      },
    },
  },
}));
