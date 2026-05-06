/**
 * public/favicon.svg → PWA용 PNG (Chrome/웨일 설치·스플래시에 SVG만으로는 부족한 경우가 많음)
 * favicon 변경 시: node scripts/gen-pwa-icons.mjs
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "public", "favicon.svg");

const sizes = [
  [192, "pwa-192.png"],
  [512, "pwa-512.png"],
];

for (const [px, name] of sizes) {
  const outPath = join(root, "public", name);
  await sharp(svgPath).resize(px, px).png({ compressionLevel: 9 }).toFile(outPath);
  console.warn(" wrote", name);
}
