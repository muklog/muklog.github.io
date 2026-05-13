# twa-android/android.keystore 의 SHA-256 을 읽어 public/.well-known/assetlinks.json 을 갱신합니다.
#
#   $env:BUBBLEWRAP_KEYSTORE_PASSWORD = '키스토어 비밀번호'
#   npm run assetlinks:sync
#
# Play 앱 서명만 쓰는 경우: 콘솔의 "앱 서명 인증서" SHA-256 과 업로드 키 지문이 다를 수 있습니다.
#   $env:PLAY_APP_SIGNING_SHA256 = 'AA:BB:...'   # 콘솔 값 복사(콜론 있/없음 모두 가능)
# 를 같이 쓰면 assetlinks.json 의 sha256_cert_fingerprints 배열에 둘 다 넣습니다.

param(
  [string]$Keystore = "",
  [string]$StorePass = "",
  [string]$Alias = "",
  [string]$PackageName = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $repoRoot "twa-android\twa-manifest.json"
$outPath = Join-Path $repoRoot "public\.well-known\assetlinks.json"

if (-not $Keystore) {
  $Keystore = Join-Path $repoRoot "twa-android\android.keystore"
}
if (-not $StorePass) {
  $StorePass = $env:BUBBLEWRAP_KEYSTORE_PASSWORD
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
  Write-Error "twa-manifest.json 없음: $manifestPath"
}
$mf = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $PackageName) { $PackageName = $mf.packageId }
if (-not $Alias) { $Alias = $mf.signingKey.alias }

if (-not (Test-Path -LiteralPath $Keystore)) {
  Write-Error "키스토어 없음: $Keystore`n먼저 twa-android\create-keystore.ps1 를 실행하세요."
}
if (-not $StorePass) {
  Write-Error "환경 변수 BUBBLEWRAP_KEYSTORE_PASSWORD 를 설정하세요."
}

$keytool = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $keytool) {
  Write-Error "keytool 을 찾을 수 없습니다. JDK 를 설치하고 PATH 에 포함하세요."
}

$out = & keytool -list -v -keystore $Keystore -storepass $StorePass -alias $Alias 2>&1 | Out-String
if (-not $?) {
  Write-Error "keytool 실패: $out"
}

if ($out -notmatch '(?m)SHA256:\s*((?:[0-9A-Fa-f]{2}:)+[0-9A-Fa-f]{2})') {
  Write-Error "SHA256 줄을 찾지 못했습니다. keytool 출력을 확인하세요."
}
$fingerprint = $Matches[1].Trim().ToUpperInvariant()

function Normalize-Sha256Hex([string]$raw) {
  $t = $raw.Trim().ToUpperInvariant() -replace '\s', '' -replace ':', ''
  if ($t.Length -ne 64) {
    throw "SHA-256 hex 는 64자여야 합니다. 입력 길이: $($t.Length)"
  }
  $parts = @()
  for ($i = 0; $i -lt 64; $i += 2) {
    $parts += $t.Substring($i, 2)
  }
  return ($parts -join ':')
}

$fps = [System.Collections.Generic.List[string]]::new()
$fps.Add($fingerprint)

if ($env:PLAY_APP_SIGNING_SHA256 -and $env:PLAY_APP_SIGNING_SHA256.Trim().Length -gt 0) {
  $playFp = Normalize-Sha256Hex $env:PLAY_APP_SIGNING_SHA256
  if (-not $fps.Contains($playFp)) {
    $fps.Add($playFp)
    Write-Host "  + Play 앱 서명 SHA256 (PLAY_APP_SIGNING_SHA256)"
  }
}

# PowerShell ConvertTo-Json 은 요소 1개짜리 배열을 객체로 풀어 쓰는 경우가 있어, Digital Asset Links 규격(JSON 배열 루트)을 문자열로 고정한다.
$fpLines = ($fps | ForEach-Object { "        `"$_`"" }) -join ",`n"
$json = @"
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "$PackageName",
      "sha256_cert_fingerprints": [
$fpLines
      ]
    }
  }
]
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outPath, $json.TrimEnd() + "`n", $utf8NoBom)
Write-Host "작성됨: $outPath"
Write-Host "  package_name: $PackageName"
foreach ($fp in $fps) {
  Write-Host "  SHA256:       $fp"
}
Write-Host "다음: npm run build 후 배포해 https://muklog.github.io/.well-known/assetlinks.json 을 확인하세요."
