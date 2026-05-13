# 내부 테스트용(versionCode 11) + 비공개 테스트용(12) AAB를 연속 빌드합니다.
# 사전: JDK 17, Node, twa-android 에 Bubblewrap 프로젝트(gradlew.bat) 존재
#   $env:BUBBLEWRAP_KEYSTORE_PASSWORD = '...'
#   $env:BUBBLEWRAP_KEY_PASSWORD      = '...'
# 산출: twa-android/releases/muklog-internal-v11.aab, muklog-closed-v12.aab
$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$twaRoot = Join-Path $repoRoot "twa-android"
$manifest = Join-Path $twaRoot "twa-manifest.json"
$setVer = Join-Path $repoRoot "scripts\twa-set-version.mjs"

if (-not $env:BUBBLEWRAP_KEYSTORE_PASSWORD -or -not $env:BUBBLEWRAP_KEY_PASSWORD) {
  Write-Error @"
서명 비밀번호를 설정한 뒤 다시 실행하세요.
  `$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '...'
  `$env:BUBBLEWRAP_KEY_PASSWORD      = '...'
"@
}

if (-not (Test-Path $manifest)) { Write-Error "없음: $manifest" }
if (-not (Test-Path (Join-Path $twaRoot "gradlew.bat"))) {
  Write-Error "twa-android 에 gradlew.bat 이 없습니다. twa-android 에서 setup-and-build.ps1 을 한 번 실행해 프로젝트를 생성하세요."
}

$releases = Join-Path $twaRoot "releases"
New-Item -ItemType Directory -Force -Path $releases | Out-Null

function Build-Track {
  param([int]$Code, [string]$VersionName, [string]$OutFileName)
  Write-Host ""
  Write-Host "========== versionCode=$Code versionName=$VersionName → $OutFileName ==========" -ForegroundColor Cyan
  & node $setVer $manifest $Code $VersionName
  Push-Location $twaRoot
  try {
    & .\setup-and-build.ps1
  } finally {
    Pop-Location
  }
  $aab = Join-Path $twaRoot "app-release-bundle.aab"
  if (-not (Test-Path $aab)) { Write-Error "빌드 후 없음: $aab" }
  $dest = Join-Path $releases $OutFileName
  Copy-Item -LiteralPath $aab -Destination $dest -Force
  Write-Host "저장: $dest" -ForegroundColor Green
}

Build-Track -Code 11 -VersionName "0.1.1" -OutFileName "muklog-internal-v11.aab"
Build-Track -Code 12 -VersionName "0.1.1" -OutFileName "muklog-closed-v12.aab"

Write-Host ""
Write-Host "완료. 업로드용 파일:" -ForegroundColor Green
Write-Host "  (내부 테스트)   $releases\muklog-internal-v11.aab"
Write-Host "  (비공개 테스트) $releases\muklog-closed-v12.aab"
Write-Host "twa-manifest.json 은 versionCode 12 로 맞춰 두었습니다."
