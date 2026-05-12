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
  # Windows: JDK가 "Program Files" 아래면 경로에 공백이 들어가 bubblewrap의 apksigner 호출이 깨짐 → 8.3 짧은 경로 사용
  if ($IsWindows -or $env:OS -match "Windows") {
    try {
      $fso = New-Object -ComObject Scripting.FileSystemObject
      $jdkItem = Get-Item -LiteralPath $env:JAVA_HOME -ErrorAction Stop
      if ($jdkItem.PSIsContainer) {
        $short = ($fso.GetFolder($jdkItem.FullName)).ShortPath
        if ($short) { $env:JAVA_HOME = $short }
      }
    } catch { }
  }
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

# bubblewrap update 가 EBUSY 로 실패하면 gradlew 가 안 생기고 이후 build 가 'gradlew.bat 없음' 으로 깨짐
Write-Host ">>> 이전 Gradle 출력 정리 (파일 잠금·EBUSY 완화)"
$twaRoot = (Resolve-Path ".").Path
$twaDirName = Split-Path $twaRoot -Leaf

if (Test-Path ".\gradlew.bat") {
  try {
    & .\gradlew.bat --stop 2>$null | Out-Null
  } catch { }
}
Start-Sleep -Seconds 2

# Gradle 데몬·워커가 classes.dex 등을 잡고 있으면 Remove-Item 이 실패함
# (데몬 cmdline 에 프로젝트 경로가 안 보일 수 있어 GradleDaemon 문자열로도 종료)
foreach ($proc in Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" -ErrorAction SilentlyContinue) {
  $cmd = $proc.CommandLine
  if (-not $cmd) { continue }
  $hit =
    ($cmd -like "*${twaDirName}*") -or
    ($cmd -like "*twa-android*") -or
    ($cmd -match "(?i)GradleDaemon") -or
    ($cmd -match "(?i)org\.gradle\.launcher\.daemon")
  if ($hit) {
    Write-Host "    종료 java (Gradle 관련) PID $($proc.ProcessId)"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 3

$appBuild = Join-Path $twaRoot "app\build"
if (Test-Path $appBuild) {
  $removed = $false
  for ($i = 0; $i -lt 3; $i++) {
    try {
      Remove-Item -LiteralPath $appBuild -Recurse -Force -ErrorAction Stop
      $removed = $true
      Write-Host "    제거: app\build"
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $removed -and (Test-Path $appBuild)) {
    cmd /c "rmdir /s /q `"$appBuild`"" 2>$null | Out-Null
    Start-Sleep -Seconds 2
    if (Test-Path $appBuild) { $removed = $false } else { $removed = $true; Write-Host "    제거: app\build (rmdir)" }
  }
  if (-not $removed -and (Test-Path $appBuild)) {
    $trash = Join-Path (Split-Path $appBuild -Parent) ("build._trash_{0}" -f ([DateTime]::UtcNow.ToString("yyyyMMddHHmmss")))
    try {
      Move-Item -LiteralPath $appBuild -Destination $trash -Force -ErrorAction Stop
      Write-Host "    이름 변경: app\build -> $(Split-Path $trash -Leaf)"
    } catch {
      Write-Host ""
      Write-Host "[오류] app\build 를 비울 수 없습니다. 다음을 시도한 뒤 이 스크립트를 다시 실행하세요." -ForegroundColor Red
      Write-Host "  - Android Studio 에서 twa-android 프로젝트 완전히 닫기 (File -> Close Project)" -ForegroundColor Yellow
      Write-Host "  - 작업 관리자에서 java.exe 가 남아 있으면 종료 (다른 Java 앱 주의)" -ForegroundColor Yellow
      Write-Host "  - 탐색기로 app\build 폴더를 연 창 닫기, OneDrive/백신 실시간 검사 잠시 제외" -ForegroundColor Yellow
      exit 1
    }
  }
}

foreach ($rel in @(".\build")) {
  if (-not (Test-Path $rel)) { continue }
  try {
    Remove-Item -LiteralPath $rel -Recurse -Force -ErrorAction Stop
    Write-Host "    제거: $rel"
  } catch {
    Write-Warning "제거 실패(무시 가능): $rel"
  }
}

Write-Host ">>> bubblewrap update (Gradle 프로젝트 생성/갱신)"
# 대화형 버전 질문 회피 — twa-manifest 의 appVersion 과 맞춤(첫 빌드 후에는 버전만 올려서 재실행)
npx --yes @bubblewrap/cli@latest update --appVersionName="1.0.0"

Write-Host ">>> bubblewrap build (AAB/APK)"
npx --yes @bubblewrap/cli@latest build

Write-Host ">>> 완료. 같은 폴더에 app-release-bundle.aab 등이 생깁니다."
