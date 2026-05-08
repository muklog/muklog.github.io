# 먹로그 TWA (Bubblewrap 안드로이드)

웹앱 배포 주소: `https://muklog.github.io/`  
이 폴더의 `twa-manifest.json`으로 **Trusted Web Activity** 안드로이드 패키지를 만듭니다.

## 사전 준비

1. **JDK 17** (예: [Microsoft Build of OpenJDK 17](https://learn.microsoft.com/java/openjdk/download)) 설치 후 `java -version`, `keytool` 사용 가능해야 합니다.
2. **Node.js** (이미 웹 개발에 쓰는 버전이면 됩니다).

질문이 나오면 **JDK 자동 설치**: 이미 PC에 JDK 17을 썼다면 **`n`** (No) — Bubblewrap이 또 JDK를 받지 않습니다. **`Y`는 중복 설치**에 가깝습니다.

`setup-and-build.ps1`는 `JAVA_HOME`을 잡고, 첫 질문에 자동으로 `n`을 넣도록 되어 있습니다.

## 한 번에 빌드

```powershell
cd twa-android
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '첫-설치시-쓸-비밀번호'
$env:BUBBLEWRAP_KEY_PASSWORD      = '같게-또는-다르게'
.\setup-and-build.ps1
```

처음에는 `android.keystore`가 없으므로 `create-keystore.ps1`이 자동으로 호출됩니다.  
**키스토어와 비밀번호를 분실하면 Play 앱 업데이트 서명이 불가능**하니 안전하게 보관하세요.

성공 시 이 디렉터리에 `app-release-bundle.aab`(Play 업로드용) 등이 생성됩니다.

## 수동 단계 (같은 결과)

```powershell
npx --yes @bubblewrap/cli@latest update
npx --yes @bubblewrap/cli@latest build
```

## Play 업로드 후 필수

1. Play Console → **앱 서명**에서 **SHA-256** 지문 복사
2. 레포 `public/.well-known/assetlinks.json`의 `sha256_cert_fingerprints`를 그 값으로 바꾸고 웹 재배포

## 폴더를 레포 밖에 두고 싶다면

이 디렉터리 전체를 `C:\work\muklog-twa-android` 등으로 복사한 뒤 같은 명령을 실행하면 됩니다.
