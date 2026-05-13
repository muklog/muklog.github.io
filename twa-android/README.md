# 먹로그 TWA (Bubblewrap 안드로이드)

웹앱 배포 주소: `https://muklog.github.io/`  
이 폴더의 `twa-manifest.json`으로 **Trusted Web Activity** 안드로이드 패키지를 만듭니다.

## 사전 준비

1. **JDK 17** (예: [Microsoft Build of OpenJDK 17](https://learn.microsoft.com/java/openjdk/download)) 설치 후 `java -version`, `keytool` 사용 가능해야 합니다.
2. **Node.js** (이미 웹 개발에 쓰는 버전이면 됩니다).

질문이 나오면 **JDK 자동 설치**: 이미 PC에 JDK 17을 썼다면 **`n`** (No) — Bubblewrap이 또 JDK를 받지 않습니다. **`Y`는 중복 설치**에 가깝습니다.

`setup-and-build.ps1` 는 `JAVA_HOME` 을 잡고, 첫 질문에 자동으로 `n` 을 넣도록 되어 있습니다. `bubblewrap update` 직후 **`npm run android:patch-splash`** 와 동일한 스플래시 패치를 실행해, TWA 첫 화면 아이콘 모서리를 둥글게 맞춥니다.

## 버전 규칙 (Play)

- **versionName** (`appVersionName`): 사용자에게 보이는 문자열. 예: `0.1.0`.
- **versionCode** (`appVersionCode`): **트랙(내부/비공개/프로덕션)과 관계없이 패키지마다 항상 증가**해야 합니다. 내부 테스트에 `8`을 썼다면 다음 번들은 **반드시 `9` 이상**이어야 합니다. (이름을 `0.1.0`으로 낮춰도 코드는 올려야 합니다.)

## 한 번에 빌드

```powershell
cd twa-android
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '첫-설치시-쓸-비밀번호'
$env:BUBBLEWRAP_KEY_PASSWORD      = '같게-또는-다르게'
.\setup-and-build.ps1
```

### 내부 테스트(11) + 비공개 테스트(12) AAB 두 개 연속 빌드

Play는 **트랙마다 다른 versionCode**를 쓰더라도 번들마다 코드가 올라가야 합니다. 아래는 **11 → 내부**, **12 → 비공개**로 두 번 빌드해 `twa-android/releases/`에 복사합니다.

```powershell
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '...'
$env:BUBBLEWRAP_KEY_PASSWORD      = '...'
npm run android:build-aabs:internal-closed
```

산출: `twa-android/releases/muklog-internal-v11.aab`, `muklog-closed-v12.aab`

처음에는 `android.keystore`가 없으므로 `create-keystore.ps1`이 자동으로 호출됩니다.  
**키스토어와 비밀번호를 분실하면 Play 앱 업데이트 서명이 불가능**하니 안전하게 보관하세요.

성공 시 이 디렉터리에 `app-release-bundle.aab`(Play 업로드용) 등이 생성됩니다.

### `EBUSY` / `gradlew.bat` 없음

- `bubblewrap update` 중 **`resource busy or locked`** 가 나오면 보통 **다른 프로세스가 `app\build` 를 잡고 있을 때**입니다. **Android Studio**에서 이 폴더를 연 프로젝트가 있으면 닫고, **탐색기**로 `app\build` 안을 보던 창도 닫은 뒤 `setup-and-build.ps1` 을 다시 실행하세요.
- 스크립트가 **Gradle 데몬(java)** 종료 → `app\build` 삭제/`rmdir`/이름 변경을 순서대로 시도합니다. 그래도 잠기면 **PC 재부팅** 후 `twa-android`에서만 다시 실행해 보세요.
- `update` 가 중간에 실패하면 **`gradlew.bat` 이 없어서** 이어지는 `build` 가 깨질 수 있습니다. 위 정리 후 **다시 `.\setup-and-build.ps1`** 하면 됩니다.

## 수동 단계 (같은 결과)

```powershell
npx --yes @bubblewrap/cli@latest update
npx --yes @bubblewrap/cli@latest build
```

## Play 업로드 후 필수 (`assetlinks.json`)

TWA가 스플래시에서 멈추면 **배포된 `assetlinks.json` 지문이 앱 서명과 불일치**한 경우가 대부분입니다.

1. 레포 루트에서 **업로드 키** + (권장) **Play 앱 서명** 지문을 넣습니다:

   ```powershell
   $env:BUBBLEWRAP_KEYSTORE_PASSWORD = '키스토어 비밀번호'
   $env:PLAY_APP_SIGNING_SHA256 = 'Play 콘솔 앱 서명 인증서 SHA-256'   # 콜론 있/없음 모두 가능
   npm run assetlinks:sync
   ```

2. `npm run build` 로 웹을 다시 배포해 `https://muklog.github.io/.well-known/assetlinks.json` 이 갱신되었는지 확인합니다.

## 폴더를 레포 밖에 두고 싶다면

이 디렉터리 전체를 `C:\work\muklog-twa-android` 등으로 복사한 뒤 같은 명령을 실행하면 됩니다.
