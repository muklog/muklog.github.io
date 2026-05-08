# muklog TWA — Bubblewrap update + build (AAB/APK)
# 사전: JDK 17, Node.js
# 한 번만 비밀번호 지정:
#   $env:BUBBLEWRAP_KEYSTORE_PASSWORD = '...'
#   $env:BUBBLEWRAP_KEY_PASSWORD      = '...'
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path =
  [System.Environment]::GetEnvironmentVariable("Path", "Machine") +
  ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")

# Bubblewrap 첫 실행 시 "JDK를 여기서 설치할까?" 질문이 뜸 — 이미 JDK 17을 쓰는 경우 **n** (No).
# JAVA_HOME 이 비어 있으면 PATH의 java.exe 로 추론하거나, Microsoft JDK 기본 경로를 시도한다.
if (-not $env:JAVA_HOME) {
  $javaCmd = Get-Command java -ErrorAction SilentlyContinue
  if ($javaCmd -and $javaCmd.Source) {
    $binDir = Split-Path $javaCmd.Source -Parent
    $env:JAVA_HOME = Split-Path $binDir -Parent
  } else {
    $guess = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
    if (Test-Path "$guess\bin\java.exe") {
      $env:JAVA_HOME = $guess
    }
  }
}
if ($env:JAVA_HOME) {
  $env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path"
  Write-Host ">>> JAVA_HOME=$env:JAVA_HOME"
}

if (-not $env:BUBBLEWRAP_KEYSTORE_PASSWORD -or -not $env:BUBBLEWRAP_KEY_PASSWORD) {
  Write-Error @"
서명용 비밀번호를 설정한 뒤 다시 실행하세요. 예:
  `$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '비밀번호1'
  `$env:BUBBLEWRAP_KEY_PASSWORD      = '비밀번호2'
"@
}

if (-not (Test-Path ".\android.keystore")) {
  Write-Host ">>> keystore 없음 — create-keystore.ps1 실행"
  & "$PSScriptRoot\create-keystore.ps1"
}

Write-Host ">>> bubblewrap update (Gradle 프로젝트 생성/갱신)"
# "JDK를 여기서 설치할까?" → No (이미 설치된 JDK 17 사용)
$n = "n`r`n"
$n | npx --yes @bubblewrap/cli@latest update

Write-Host ">>> bubblewrap build (AAB/APK)"
npx --yes @bubblewrap/cli@latest build

Write-Host ">>> 완료. 같은 폴더에 app-release-bundle.aab 등이 생깁니다."
