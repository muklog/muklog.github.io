/**
 * `public/pwa-512.png`(npm run gen:icons 결과)에 안드로이드 런처에 가까운 마스크를 씌운 미리보기.
 *
 *   npm run gen:icons
 *   npm run preview:launcher-icon
 *
 * 산출: 프로젝트 루트 `launcher-icon-mask-preview.png` (한 파일에 좌:둥근 사각형 근사, 우:원형 근사)
 * 제조사·런처마다 실제 마스크는 조금 다릅니다. Android Studio 는 `twa-android` 열고 mipmap 런처에서
 * 여러 형태를 더 정확히 볼 수 있습니다.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcPath = join(root, "public", "pwa-512.png");
const outPath = join(root, "launcher-icon-mask-preview.png");

const SIDE = 512;
/** 스플래시 패치와 동일 비율 — 적응형 아이콘 스쿼클 근사 */
const SQUIRCLE_RX_RATIO = 0.22;

if (!existsSync(srcPath)) {
  console.error("[preview] 없음:", srcPath, "→ 먼저 npm run gen:icons");
  process.exit(1);
}

const base = await sharp(srcPath).ensureAlpha().png().toBuffer();

function squircleMask(side) {
  const r = Math.max(8, Math.round(side * SQUIRCLE_RX_RATIO));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
}

function circleMask(side) {
  const c = side / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${c}" cy="${c}" r="${c}" fill="#fff"/></svg>`,
  );
}

async function applyMask(buf, maskSvg) {
  return sharp(buf)
    .composite([{ input: maskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();
}

const squirclePng = await applyMask(base, squircleMask(SIDE));
const circlePng = await applyMask(base, circleMask(SIDE));

const gap = 20;
const pad = 16;
const labelBar = 36;
const totalW = SIDE * 2 + gap + pad * 2;
const totalH = SIDE + labelBar + pad * 2;

const labelSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${labelBar + pad}">
    <rect width="${totalW}" height="${labelBar + pad}" fill="#0f172a"/>
    <text x="${pad}" y="22" fill="#94a3b8" font-size="11" font-family="system-ui,sans-serif">둥근 사각형(스쿼클 근사)</text>
    <text x="${pad + SIDE + gap}" y="22" fill="#94a3b8" font-size="11" font-family="system-ui,sans-serif">원형 폴더(근사)</text>
  </svg>`,
);

await sharp({
  create: {
    width: totalW,
    height: totalH,
    channels: 4,
    background: { r: 15, g: 23, b: 42, alpha: 1 },
  },
})
  .composite([
    { input: labelSvg, left: 0, top: 0 },
    { input: squirclePng, left: pad, top: labelBar + pad },
    { input: circlePng, left: pad + SIDE + gap, top: labelBar + pad },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.warn("[preview] wrote", outPath);
console.warn("[preview] 가장자리가 아직 잘리면 gen-pwa-icons.mjs 의 ICON_CONTENT_RATIO 를 조금 줄이세요 (예: 0.70 → 0.66).");
