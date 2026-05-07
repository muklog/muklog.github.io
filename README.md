# 밀로그 (Mealog)

> **달력 기반 식단 + AI 건강 분석** 과 **친구 피드**까지 한곳에 두는 웹앱. 한 기기·한 브라우저에서는 **내 프로필 하나로** 기록하지만, 친구를 맞추면 서로의 식단을 피드에서 볼 수 있습니다.
> Galaxy S24 같은 모바일에 최적화되어 있고, 노트북 브라우저에서도 잘 작동합니다.
> **GitHub Pages로 100% 무료 호스팅**됩니다.

## ✨ 주요 기능

- 📅 **달력 메인 화면** — 월별 달력에서 매일의 식단을 한눈에. 평균 별점도 표시.
- 🍱 **식사 6슬롯 기록** — 아침 / 오전 간식 / 점심 / 오후 간식 / 저녁 / 야식. 모바일 카메라로 바로 촬영해 업로드.
- 🤖 **AI 식단 분석 (Gemini)** — 사진 → 메뉴 텍스트 변환, 5점 만점 별점, 한 줄 평, 칼로리/탄단지 추정. **끼니 시간대(아침/간식/점심/저녁/야식)에 맞춘 기준으로 평가** — 같은 라면이라도 점심에는 평범한 한 끼지만 야식이면 수면 부담이 커 점수가 낮아집니다.
- ❤️ **건강 프로필** — 건강검진표 / 인바디 사진을 올리면 OCR + 100점 만점 건강 점수 자동 평가, 강점·주의·권장 코멘트 제공.
- 👤 **프로필** — 내 식단·건강 기록을 이름·색으로 표시(기기당 활성 프로필 하나).
- 👥 **팔로우 공유 (Gmail)** — 인스타그램과 같은 단방향 팔로우. 이메일로 신청해 상대가 수락하면 그 사람의 기록을 내가 볼 수 있어요. 맞팔하려면 상대도 같은 절차로 신청하면 됩니다.
- ❤️ **좋아요 / 💬 댓글** — 팔로우 중인 친구의 식단 카드마다 좋아요와 댓글을 남길 수 있어요. 댓글은 작성자가 수정·삭제할 수 있고(`Cmd/Ctrl+Enter` 로 빠르게 보내기), 식단 소유자는 본인 게시물에 달린 모든 댓글을 모더레이션 차원에서 삭제할 수 있습니다. 식단을 삭제하면 좋아요·댓글도 함께 정리됩니다.
- 🎨 **테마** — 강조색과 배경색을 **그린(기본) / 블루 / 핑크 / 옐로** 중 선택할 수 있습니다. 선택은 자동 저장되고 같은 Google 계정으로 로그인한 다른 기기에도 동기화돼요. (구현은 Tailwind `brand-*` 와 `surface-*` 색을 CSS 변수로 바꾸고 `:root[data-theme="..."]` 별로 정의해, 같은 클래스가 테마에 따라 다른 색이 되도록 했습니다.)
- 📲 **PWA** — 모바일 홈 화면에 설치 가능, 오프라인 캐시 지원.
- 🔒 **기본 클라이언트 사이드** — 본인 데이터는 브라우저 IndexedDB 에 저장되고, Firebase 로그인 시 Firestore 로 동기화됩니다. 친구 공유는 Firestore 경유(로컬에 친구 데이터를 저장하지 않음).

## 🚀 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

## 🔑 Gemini API 키 발급 (1분, 무료)

1. <https://aistudio.google.com/apikey> 접속 (Google 계정 로그인)
2. **Create API key** 클릭 → 새 프로젝트 선택 → 키 복사
3. 앱 첫 실행 시 온보딩 화면 또는 **설정 → Google Gemini 키** 에 붙여넣고 저장
   - 같은 키 하나로 새 모델이 출시돼도 그대로 사용 가능합니다(키는 모델별이 아니라 프로젝트 단위 자격 증명).

> 기본 모델은 **gemini-2.5-flash-lite** (무료 티어에서 상대적으로 한도 여유). Google 정책에 따라 수치는 변동됩니다. 모델 선택 UI는 단순화를 위해 제공하지 않습니다.

## ☁️ GitHub Pages 배포 (무료)

이미 `.github/workflows/deploy.yml` 이 있어서, **저장소만 만들고 푸시 + Pages 소스 한 번 지정**하면 됩니다.

### 자동 배포 설정 (1회)

1. **GitHub에서 새 저장소**를 만듭니다. 조직 `mealog` 에 **`mealog.github.io`** 이름 저장소면 `https://mealog.github.io/` 에 바로 배포됩니다. (그 외 프로젝트 저장소면 `https://<owner>.github.io/<repo>/`)
   - 이미 로컬에 Git이 있다면 README/라이선스만 있는 저장소를 만들 때 **“Add a README” 체크는 끄는 것**이 푸시할 때 덜 헷갈립니다.

2. **반드시 먼저:** GitHub 웹에서 해당 저장소 → **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.  
   (이걸 하지 않으면 GitHub에 “Pages 사이트”가 없어서, 예전 워크플로의 `configure-pages` 단계가 404로 실패할 수 있습니다. 지금 워크플로에서는 해당 단계를 제거했지만, **실제 사이트 배포를 위해 이 설정은 여전히 필수**입니다.)

3. **원격 저장소 연결 후 `main` 브랜치로 푸시**합니다. (PowerShell에서 `npm` 대신 `npm.cmd`를 쓰는 환경이면 그대로 두고, 아래는 Git만 해당합니다.)

   ```bash
   git branch -M main
   git remote add origin https://github.com/<YOUR_ID>/<REPO_NAME>.git
   git add .
   git commit -m "chore: GitHub Pages 배포용 푸시"
   git push -u origin main
   ```

   아직 `git init`을 안 했다면 프로젝트 폴더에서 한 번만 `git init` 후 커밋·푸시하면 됩니다.

4. **Actions** 탭을 열어 **“Deploy to GitHub Pages”** 워크플로가 초록색으로 끝났는지 확인합니다.  
   처음 한 번 **“Approve and deploy”** / 환경(`github-pages`) 승인을 요구하면 승인합니다.

5. 같은 **Settings → Pages** 에서 **Visit site** 또는 표시된 URL로 접속합니다.  
   배포 반영까지 **1~3분** 걸릴 수 있습니다.

이후에는 **`main`에 푸시할 때마다** 같은 워크플로가 빌드 후 자동 배포합니다.  
배포 URL 형태: `https://<YOUR_ID>.github.io/<REPO_NAME>/` (저장소가 `<USER>.github.io` 특수 저장소면 루트 `/` 로 빌드됩니다.)

### base path 자동 처리

- 워크플로우가 저장소 이름을 감지해 Vite 의 `base` 를 자동 설정합니다.
  - 일반 저장소 → `/<REPO_NAME>/`
  - `<USER>.github.io` 저장소 → `/`
- SPA 라우팅은 `HashRouter` + `404.html` fallback 으로 새로고침해도 안전합니다.

### Firebase — 같은 프로젝트, 새 주소만 허용

호스트만 `mealog.github.io` 로 바꿔도 **Firestore·로그인 데이터는 그대로**입니다. 아래만 **Firebase Console** 에서 한 번씩 해 주세요.

1. [Firebase Console](https://console.firebase.google.com/) → **본인 프로젝트** (기존과 동일) 선택  
2. **Authentication** → **Settings** 탭 → **Authorized domains**  
3. **도메인 추가** → `mealog.github.io` 입력 후 저장  
4. (선택) 예전에 `*.github.io` 만 있었다면 기존 `gogojeje1022.github.io` 는 당분간 두어도 됩니다.

**GitHub Actions 빌드**는 새 저장소(`mealog/mealog.github.io`)에도 예전과 **동일한 이름**의 **Repository secrets** 가 필요합니다. (**Variables** 탭이 아니라 **Secrets** 입니다.)

- 저장소 → **Settings** → **Secrets and variables** → **Actions** → **Repository secrets**

각 항목 옆 **연필(Update)** 으로 열어 **Firebase에 나온 값만** 다시 붙여 넣고 **Update secret** 을 누르세요. GitHub는 저장 후 값을 다시 보여 주지 않습니다 — 비었는지는 배포 워크플로 로그의 **「Firebase Secrets 채워졌는지 확인」** 단계 경고로 확인합니다.

| Secret 이름 | Firebase 웹 앱 `firebaseConfig` |
|-------------|--------------------------------|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` (선택, 넣는 것 권장) |

클라우드 로그인을 쓰려면 **위 표에서 맨 위 네 개**는 반드시 채워야 합니다.

값 위치: Firebase Console → **프로젝트 설정(톱니바퀴)** → **일반** → **내 앱**에서 웹 앱 선택 → **Firebase SDK snippet** 의 **구성** 객체.

등록 후 **Actions** 에서 워크플로를 **Re-run workflow** 하세요.

### 커스텀 도메인 사용시

`public/CNAME` 파일에 도메인을 한 줄로 적고, 워크플로우 환경변수에서 `VITE_BASE_PATH=/` 로 설정하세요.

## 👥 친구(팔로우) 공유 기능

Gmail(Firebase Auth) 기반의 **단방향 팔로우** 모델입니다. 인스타그램과 동일한 의미로 "내가 신청 = 상대 기록을 보고 싶어요" 입니다.

### 사용 방법

1. **로그인** — 설정 탭에서 Google 계정으로 로그인.
2. **팔로우 신청** — 하단의 **친구** 탭 → 상대 이메일 입력 + **내가 보고 싶은 범위**(달력/건강) 선택 → "팔로우 신청 보내기".
3. **초대 링크 공유** — 신청 직후 표시되는 **링크 복사** 또는 **메일로 열기** 버튼으로 상대에게 전달.
4. **수락** — 받은 사람은 같은 이메일의 Google 계정으로 로그인 후 **친구 → 받은 신청**(또는 초대 링크)에서 **요청대로 공개** 또는 **직접 선택**해 수락. 수락하면 그 사람(=수락자)의 기록 중 선택된 범위만 신청자에게 공개됩니다.
5. **프로필 열람** — 친구 카드를 탭하면 상대가 공개한 범위(달력/건강)만 읽기 전용으로 볼 수 있어요.
6. **상태 표시** — 친구 카드에 **맞팔 / 팔로우 중 / 나를 팔로우** 뱃지가 표시되며, 한 방향만 연결된 상대에게는 **나도 팔로우 신청** 버튼이 노출됩니다.
7. **변경 / 끊기** — 내가 owner 인 share 는 **공개 범위 변경 / 공개 중단** 가능, viewer 인 share 는 **팔로우 끊기** 가능.

> 한 방향당 하나의 share 문서가 만들어집니다. 맞팔이면 두 개의 share. 어느 한쪽이 share 를 끊으면 그 방향만 즉시 차단되고 반대 방향은 영향이 없습니다.

### Firestore 규칙 배포

친구 기능은 [`firestore.rules`](firestore.rules) 의 새로운 규칙을 요구합니다. 처음 배포하거나 규칙을 바꾼 뒤에는 아래 명령을 실행하세요.

```bash
npm run deploy:firestore-rules
```

규칙 요약:

- `users/{uid}/meals|health` — 본인은 전체, 친구는 `shares/{ownerUid}_{viewerUid}` 문서에 본인이 viewer 로 있고 해당 scope 가 true 일 때만 read.
- `publicProfiles/{uid}` — 로그인 사용자 모두 read, 본인만 write.
- `followRequests/{id}` — 보낸 사람 또는 `toEmail == auth.token.email` 만 read/update/delete.
- `shares/{ownerUid}_{viewerUid}` — 당사자(owner/viewer) 모두 read 가능, owner 만 create/update, 양쪽 모두 delete 가능.
- `friendships/{fid}` — 레거시. 신규 코드는 더 이상 사용하지 않으며 read/delete 만 허용됩니다. 기존 사용자는 한 번 다시 팔로우 신청을 주고받으면 됩니다.
- `users/{ownerUid}/meals/{mealId}/likes/{viewerUid}` — owner 또는 calendar viewer 만 read. 본인 좋아요만 create/delete (문서 id 가 본인 uid 인지 강제).
- `users/{ownerUid}/meals/{mealId}/comments/{cid}` — owner 또는 calendar viewer 만 read/create. update 는 작성자만, delete 는 작성자 또는 식단 소유자.

### Firestore 복합 인덱스 안내

친구의 달력을 열 때 월 단위 범위로 식사 기록을 쿼리합니다.

```
collection: users/{uid}/meals
where: date >= $start && date <= $end
```

- 단일 필드 범위 쿼리라 보통 자동 인덱스로 충분합니다.
- 콘솔에서 "The query requires an index" 오류가 뜨면 링크를 눌러 **meals** 컬렉션에 `date` 단일 필드 인덱스를 만들어 주세요. (다른 where 절을 추가하지 않는 한 복합 인덱스는 필요 없습니다.)

## 🧱 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프레임워크 | React 18 + TypeScript + Vite |
| 라우팅 | react-router-dom (HashRouter) |
| 스타일 | Tailwind CSS, Pretendard 폰트 |
| 데이터 저장 | IndexedDB (Dexie.js) — 사진은 Blob 으로 저장 |
| AI | Google Gemini API (`@google/generative-ai`), 클라이언트 직접 호출 |
| PWA | vite-plugin-pwa |
| 호스팅 | GitHub Pages + GitHub Actions |

## 📂 폴더 구조

```
src/
├── components/     # Calendar, BottomNav, PhotoUpload, HealthRecordCard, MealCard 등
├── pages/          # Home, Day(식사), Health, Settings, Onboarding, Friends, FriendProfile, FriendDay, Invite
├── lib/
│   ├── db.ts       # Dexie 스키마 + getSettings/patchSettings
│   ├── ai.ts       # Gemini 식단/건강 분석
│   ├── image.ts    # 이미지 압축, 썸네일, blob URL 캐시
│   ├── friends.ts  # publicProfiles / followRequests / shares CRUD·구독
│   └── utils.ts    # 날짜, 점수, 색상 유틸
├── types.ts        # User, Meal, HealthRecord, MealSlot, Share, FollowRequest 등
├── App.tsx         # 라우터 + 온보딩 가드
├── main.tsx
└── index.css       # Tailwind + 공용 컴포넌트 클래스
```

## 🛡️ 데이터 / 프라이버시

- 사진과 텍스트는 우선 **브라우저 IndexedDB(Dexie)** 에 저장됩니다.
- Google 로그인 시 **Firestore 의 본인 UID 하위(`users/{uid}/...`)** 에 자동 동기화돼, 같은 Google 계정으로 다른 기기에 로그인하면 기록이 이어집니다. 사진은 무료 플랜을 위해 압축 JPEG(Base64) 형태로 Firestore 문서에 직접 저장됩니다.
- Gemini API 키는 본인 UID 하위 `users/{uid}/config/private` 에만 저장되어 본인만 읽을 수 있습니다(Firestore 규칙). AI 분석을 요청할 때만 Google 서버로 전송됩니다.
- 친구 공유는 Firestore 경유로만 이뤄지며, 친구의 데이터는 로컬에 캐시하지 않습니다.
- "설정 → 모든 데이터 삭제" 는 **이 기기의 로컬 데이터**를 비우고 자동으로 로그아웃합니다. 같은 계정으로 재로그인 시 클라우드 기록은 복원될 수 있어요.

## 🗺️ 향후 로드맵 (선택)

- [ ] 데이터 JSON 내보내기/가져오기 (간이 백업)
- [ ] 주간/월간 영양 통계 차트
- [ ] 클라우드 동기화·백업 고도화
- [ ] 음성 메모, 식사 시간 자동 기록
- [ ] 건강 점수 추세 그래프

## 📄 라이선스

MIT
