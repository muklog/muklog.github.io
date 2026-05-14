/**
 * assets/app-icon.png → 탭 파비콘 + PWA PNG (설치·스플래시·TWA 런처)
 *
 * 원본 교체 후: node scripts/gen-pwa-icons.mjs
 *
 * 안드로이드 런처에 가까운 잘림 미리보기: `npm run preview:launcher-icon` → 루트에 `launcher-icon-mask-preview.png`
 * (제조사마다 마스크는 조금 다름). Android Studio 에서 `twa-android` mipmap 을 열면 더 정확한 형태별 미리보기 가능.
 *
 * 안드로이드 적응형 아이콘(둥근 사각형)은 가장자리가 잘리므로,
 * 그림을 캔버스의 일부 비율 안에만 맞춰 넣고 나머지는 배경색으로 채웁니다.
 *
 * (과거) 원본 가장자리를 잘라 쓰려면 EDGE_INSET_RATIO 를 0보다 크게.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pngToIco from "png-to-ico";

/** 원본에서 한쪽당 잘라낼 비율. 0 = 크롭 없음. */
const EDGE_INSET_RATIO = 0;

/**
 * 최종 PNG 한 변(px)에서 실제 그림이 들어가는 안쪽 정사각형 비율.
 * 작을수록 런처 마스크에 덜 잘림(여백↑). 0.66~0.78 권장.
 */
const ICON_CONTENT_RATIO = 0.74;

/** letterbox / 바깥 여백 — manifest background_color 와 맞춤 */
const ICON_BG = { r: 15, g: 23, b: 42, alpha: 1 };

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sourcePath = join(root, "assets", "app-icon.png");

if (!existsSync(sourcePath)) {
  console.error("missing", sourcePath);
  process.exit(1);
}

const meta = await sharp(sourcePath).rotate().metadata();
const sw = meta.width ?? 1;
const sh = meta.height ?? 1;
const inset = Math.min(EDGE_INSET_RATIO, 0.49);
const cropW = Math.max(1, Math.round(sw * (1 - 2 * inset)));
const cropH = Math.max(1, Math.round(sh * (1 - 2 * inset)));
const left = Math.max(0, Math.round((sw - cropW) / 2));
const top = Math.max(0, Math.round((sh - cropH) / 2));

function basePipeline() {
  const p = sharp(sourcePath).rotate();
  if (inset <= 0) return p;
  return p.extract({ left, top, width: cropW, height: cropH });
}

if (inset > 0) {
  console.warn(
    `[gen-pwa-icons] 가장자리 ${Math.round(inset * 100)}%씩 크롭 후 리사이즈 (${sw}×${sh} → ${cropW}×${cropH})`,
  );
}
console.warn(
  `[gen-pwa-icons] 안전 여백: 그림 ${Math.round(ICON_CONTENT_RATIO * 100)}% 안쪽에 맞춤 (배경 #0f172a)`,
);

/**
 * @param {number} px
 * @returns {Promise<Buffer>}
 */
async function renderAppIconPng(px) {
  const innerPx = Math.max(1, Math.round(px * ICON_CONTENT_RATIO));
  const innerBuf = await basePipeline()
    .resize(innerPx, innerPx, {
      fit: "contain",
      position: "centre",
      background: ICON_BG,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const pad = px - innerPx;
  const edge = Math.floor(pad / 2);
  return sharp(innerBuf)
    .extend({
      top: edge,
      bottom: pad - edge,
      left: edge,
      right: pad - edge,
      background: ICON_BG,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const sizes = [
  [48, "favicon.png"],
  [192, "pwa-192.png"],
  [512, "pwa-512.png"],
];

for (const [px, name] of sizes) {
  const outPath = join(root, "public", name);
  const buf = await renderAppIconPng(px);
  await sharp(buf).png({ compressionLevel: 9 }).toFile(outPath);
  console.warn(" wrote", name);
}

/** 브라우저 기본 요청 `/favicon.ico` */
const icoSizes = [48, 32, 16];
const icoBuffers = [];
for (const px of icoSizes) {
  icoBuffers.push(await renderAppIconPng(px));
}
const icoOut = join(root, "public", "favicon.ico");
await writeFile(icoOut, await pngToIco(icoBuffers));
console.warn(" wrote favicon.ico");
