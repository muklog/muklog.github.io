# 구글 플레이 배포 준비 (Trusted Web Activity, TWA)

`muklog.github.io` 웹앱을 **네이티브 껍데기 없이**(실제 로딩은 웹 그대로) 플레이에 올리는 일반적인 방법은 구글 **[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)** 으로 TWA 패키지를 만드는 것입니다.

---

## 플레이 심사·보안 거절이 걱정될 때 (요약)

| 걱정 | 설명 |
|------|------|
| “예전 안드로이드로 만들어 졌다” | 실제로는 **`minSdkVersion` / `targetSdkVersion`** 입니다. **최신 Bubblewrap CLI**로 프로젝트를 만들면 플레이 정책에 맞는 기본값으로 잡히는 경우가 많고, 업로드 시 **Play 정책에 맞는 target API**(정책은 매년 바뀜)를 맞춰야 합니다. “구버전에서 개발” 자체가 자동 거절 사유는 아닙니다. |
| TWA(WebView 같은 앱) | **Chrome 기반 검증 브라우저** 로 당신의 도메인을 여는 패턴이라, 순수 무작위 WebView 로 아무 페이지나 여는 스팸류와 구분됩니다. 다만 **콘솔 설명·스크린샷·프라이버시**를 성실하게 넣어야 통과 확률이 올라갑니다. |
| 개인정보 / 데이터 처리 | 사용자 계정(Google), 글·식단 내용 등이 있으면 **개인정보처리방침 URL**(스토어·앱 정보에 제공) 준비를 권장합니다. 플레이는 이 부분에서 자주 까다롭습니다. |

---

## Firebase / “구글키” 암호화 여부

- 웹 번들 안에 들어가는 **Firebase 클라이언트용 API 키**는 원래부터 **브라우저에 노출**되는 전제입니다. 진짜 방어선은 **`firestore.rules` 등 백엔드 규칙** 과 **GCP 콘솔에서 API 키 제한**(도메인, 앱 패키지+서명 등)입니다.
- TWA 안드로이드 앱을 Firebase 콘솔의 **Android 앱** 으로 등록하고 패키지명·디지털 지문으로 제한하면, 키를 “암호화해서 숨김”이 아니라 **남용을 줄이는** 형태가 됩니다.
- **Gemini API 키**는 사용자가 앱 안에 입력한 값이라, 디바이스 **IndexedDB(웹 저장소)** 에 저장되는 구조에 가깝습니다. 플레이가 “키를 AES로 저장하라”고 요구하지는 않는 경우가 대부분이며, 오히려 **HTTPS**, **어떤 데이터를 어디로 보내는지**(프라이버시 고지), **외부 계정 제공자(Google)** 가 무엇인지가 명확한지가 중요합니다.  
원하면 나중에 **앱 패스코드/OS 보안 저장소**(네이티브 연동 라이브러리 등)로 옮길 여지는 있지만, 레포 수정 없이 **플레이 통과**만 목표로 한다면 필수는 아닙니다.

---

## 1단계: 웹 매니페스트 URL 확인

운영 빌드가 올라가면 보통 다음과 같습니다(루트 Pages 기준):

- 매니페스트: `https://muklog.github.io/manifest.webmanifest`

로컬에서 `npm run build` 후 `dist/manifest.webmanifest` 내용이 실제 배포물과 같은지 확인하세요.

---

## 2단계: Bubblewrap 으로 Android 프로젝트 생성

1. JDK / Android 개발 도구 준비(공식 문서의 요구 버전 참고).
2. 저장소 **밖**(또는 `android-shell/` 같은 별도 디렉터리) 에서 새 폴더를 만들 것을 권장합니다(생성 결과물은 용량·keystore 때문에 보통 깃 추적 안 함).

```bash
npx --yes @bubblewrap/cli@latest init --manifest=https://muklog.github.io/manifest.webmanifest
```

안내 질문에 **패키지명**(예: `io.github.muklog.app` 같은 **실제 고유값**)/앱 이름/서명을 입력합니다.

- **최신 Bubblewrap CLI** 로 생성해 `compileSdkVersion` / `targetSdkVersion` 등을 현재 플레이 요구와 맞추는 것을 권장합니다.

---

## 3단계: 디지털 자산 연결 (`assetlinks.json`)

TWA가 **주소표시줄 없이** 신뢰 가능한 상태로 여는지 검증할 때 필요합니다.

1. 플레이 **앱 서명**(또는 Play App Signing 이 켜졌으면 플레이 콘솔에서 보이는 인증서)의 **SHA-256** 값을 확인합니다.
2. `docs/assetlinks.example.json` 을 참고해 `package_name`, `sha256_cert_fingerprints`를 채운 **최종 `assetlinks.json`** 을 준비합니다.
3. 사이트에 **`https://muklog.github.io/.well-known/assetlinks.json`** 로 배포합니다.

   GitHub Pages + 이 레포의 `public/` 은 빌드 시 루트로 그대로 복사되므로, 검증까지 맞춘 파일을 아래처럼 두면 배포 파이프라인을 타고 함께 올라갑니다:

   ```
   public/.well-known/assetlinks.json
   ```

   **패키지명·SHA-256이 확정되기 전에는 빈 채 또는 잘못된 값으로 `public/`에 두지 마세요.**(잘못된 검증 정보는 TWA 연결만 실패하지, 정적 사이트 전체 배포에는 보통 무해합니다.)

4. 브라우저에서 해당 URL 이 **200**, **JSON 배열** 형태인지 확인합니다.

참고: 이 앱은 **Hash 라우팅 (`/#/`)** 을 사용합니다. TWA 런처 URL 은 매니페스트 `start_url` 과 맞물리므로, Bubblewrap 초기화 시 기본 제공 URL 로 두는 편이 단순합니다.

---

## 4단계: 빌드·업로드

```bash
# 생성된 디렉터리에서 (Bubblewrap 문서 명령과 동일)
bubblewrap build
```

생성된 AAB 를 Play Console 에 올립니다.

---

## `package.json` 스크립트

```bash
npx --yes @bubblewrap/cli@latest --help
```

위처럼 직접 호출하면 됩니다(대화형 `init` 이 있어 NPM 스크립트로 고정 두기는 어렵습니다).

---

## 체크리스트 (통과 확률 올리기)

- [ ] 스토어 **데이터 안전 목록** / **카테고리** / 타겟 연령 정직하게 작성  
- [ ] **개인정보 처리방침** URL 준비(웹 페이지로 `muklog.github.io` 또는 별도 URL)  
- [ ] 계정 기능이 있음 → 로그인·데이터 처리 설명이 설명글과 일치하는지 확인  
- [ ] Firebase 규칙·쿼터·API 키 제한 검토  

이 문서만으로 플레이 통과가 **보장되는 것은 아니며**(정책은 수시 변경), 레포 공개 여부보다 위 항목이 서비스 운영에 더 큰 영향을 줍니다.
