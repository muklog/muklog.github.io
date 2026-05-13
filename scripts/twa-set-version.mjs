/**
 * twa-manifest.json 의 appVersionCode / appVersionName / appVersion 갱신
 * 사용: node scripts/twa-set-version.mjs <twa-manifest.json 경로> <versionCode> <versionName>
 */
import fs from "fs";

const manifestPath = process.argv[2];
const code = Number(process.argv[3], 10);
const name = process.argv[4];
if (!manifestPath || !Number.isFinite(code) || code < 1 || !name) {
  console.error(
    "usage: node scripts/twa-set-version.mjs <path-to-twa-manifest.json> <versionCode> <versionName>",
  );
  process.exit(1);
}
const raw = fs.readFileSync(manifestPath, "utf8");
const j = JSON.parse(raw);
j.appVersionCode = code;
j.appVersionName = name;
j.appVersion = name;
fs.writeFileSync(manifestPath, JSON.stringify(j, null, 2) + "\n");
console.log(`[twa-set-version] ${manifestPath} → code=${code} name=${name}`);
