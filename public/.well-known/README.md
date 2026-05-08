# Digital Asset Links (`assetlinks.json`)

TWA(Trusted Web Activity)가 **주소창 없이** `https://muklog.github.io` 를 열 때, 앱 서명과 이 파일의 SHA-256 이 일치해야 합니다.

## 지금 올라간 값

- **package_name**: Bubblewrap 생성 시 예시로 쓴 `io.github.muklog.app` 와 맞춰 두었습니다. 실제 Android 패키지명이 다르면 이 문자열을 바꾸세요.
- **sha256_cert_fingerprints**: 아직 **플레이스홀더(0만 64자)** 입니다. Play Console → 앱 서명(App signing)의 **SHA-256 인증서 지문**을 **콜론 없이 대문자 16진**으로 넣고 배포해야 검증이 통과합니다.

## 작업 순서

1. Bubblewrap 으로 프로젝트 생성 시 입력한 **패키지명**과 위 `package_name` 을 일치.
2. Play에 올릴 AAB 의 서명에 맞는 **SHA-256** 을 복사해 위 배열의 첫 항목을 교체.
3. `npm run build` 후 배포하여 `https://muklog.github.io/.well-known/assetlinks.json` 이 새 내용인지 확인.

자세한 설명은 저장소 `docs/play-android-twa.md` 를 참고하세요.
