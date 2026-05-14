/**
 * Bubblewrap 이 만든 TWA res drawable 폴더의 splash.png 를
 * assets/app-icon.png 기반 둥근 아이콘 + 배경으로 덮어씁니다.
 *
 * bubblewrap update 직후 실행: npm run android:patch-splash
 * (setup-and-build.ps1 에서 update 다음에 자동 호출)
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconPath = join(root, "assets", "app-icon.png");
const resRoot = join(root, "twa-android", "app", "src", "main", "res");

/** gen-pwa-icons.mjs 의 ICON_CONTENT_RATIO 와 맞춤 — 스플래시 아이콘도 런처와 비슷한 비율로 안쪽 배치 */
const SPLASH_ICON_CONTENT_RATIO = 0.70;
const SPLASH_ICON_BG = { r: 15, g: 23, b: 42, alpha: 1 };

async function roundedIconPng(sidePx) {
  const radius = Math.max(8, Math.round(sidePx * 0.22));
  const inner = Math.max(1, Math.round(sidePx * SPLASH_ICON_CONTENT_RATIO));
  const innerBuf = await sharp(iconPath)
    .rotate()
    .resize(inner, inner, {
      fit: "contain",
      position: "centre",
      background: SPLASH_ICON_BG,
    })
    .png()
    .toBuffer();
  const pad = sidePx - inner;
  const off = Math.floor(pad / 2);
  const padded = await sharp({
    create: {
      width: sidePx,
      height: sidePx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: innerBuf, left: off, top: off }])
    .png()
    .toBuffer();
  const maskSvg = Buffer.from(
    `<svg width="${sidePx}" height="${sidePx}" xmlns="http://www.w3.org/2000/svg"><rect width="${sidePx}" height="${sidePx}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  return sharp(padded)
    .composite([{ input: maskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function buildSplash(outW, outH) {
  const iconSide = Math.round(Math.min(outW, outH) * 0.38);
  const iconBuf = await roundedIconPng(iconSide);
  const left = Math.round((outW - iconSide) / 2);
  const top = Math.round((outH - iconSide) / 2);
  return sharp({
    create: {
      width: outW,
      height: outH,
      channels: 3,
      background: "#0f172a",
    },
  })
    .composite([{ input: iconBuf, left, top }])
    .png()
    .toBuffer();
}

async function main() {
  if (!existsSync(iconPath)) {
    console.error("[patch-twa-splash] missing", iconPath);
    process.exit(1);
  }
  if (!existsSync(resRoot)) {
    console.warn("[patch-twa-splash] skip — no", resRoot);
    return;
  }
  const dirs = await readdir(resRoot);
  let count = 0;
  for (const d of dirs) {
    if (!d.startsWith("drawable")) continue;
    const splashPath = join(resRoot, d, "splash.png");
    if (!existsSync(splashPath)) continue;
    const meta = await sharp(splashPath).metadata();
    const w = meta.width ?? 450;
    const h = meta.height ?? 450;
    const buf = await buildSplash(w, h);
    await sharp(buf).png({ compressionLevel: 9 }).toFile(splashPath);
    console.log("[patch-twa-splash]", splashPath);
    count++;
  }
  console.log("[patch-twa-splash] done,", count, "file(s)");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
