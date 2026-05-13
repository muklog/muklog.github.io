/**
 * assets/app-icon.png → 탭 파비콘 + PWA PNG (설치·스플래시·apple-touch 아이콘)
 *
 * 원본 교체 후: node scripts/gen-pwa-icons.mjs
 *
 * 원본에 안전 여백이 있어 런처에서 테두리가 비어 보이면, 아래 비율로 가운데만 잘라 씁니다.
 * 이미 꽉 찬 아이콘이면 0 으로 두세요.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pngToIco from "png-to-ico";

/** 한쪽당 잘라낼 비율 (0.06 → 좌우·상하 각 6%, 가운데 88%만 사용) */
const EDGE_INSET_RATIO = 0.06;

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

const sizes = [
  [48, "favicon.png"],
  [192, "pwa-192.png"],
  [512, "pwa-512.png"],
];

if (inset > 0) {
  console.warn(
    `[gen-pwa-icons] 가장자리 ${Math.round(inset * 100)}%씩 크롭 후 리사이즈 (${sw}×${sh} → ${cropW}×${cropH})`,
  );
}

for (const [px, name] of sizes) {
  const outPath = join(root, "public", name);
  await basePipeline()
    .resize(px, px, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.warn(" wrote", name);
}

/** 브라우저 기본 요청 `/favicon.ico` — 루트에 ICO 가 있으면 404 콘솔 노이즈 제거 */
const icoSizes = [48, 32, 16];
const icoBuffers = [];
for (const px of icoSizes) {
  const buf = await basePipeline()
    .resize(px, px, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  icoBuffers.push(buf);
}
const icoOut = join(root, "public", "favicon.ico");
await writeFile(icoOut, await pngToIco(icoBuffers));
console.warn(" wrote favicon.ico");
