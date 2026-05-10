export type MealSlot =
  | "breakfast"
  | "morningSnack"
  | "lunch"
  | "afternoonSnack"
  | "dinner"
  | "eveningSnack";

export const MEAL_SLOTS: MealSlot[] = [
  "breakfast",
  "morningSnack",
  "lunch",
  "afternoonSnack",
  "dinner",
  "eveningSnack",
];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "아침",
  morningSnack: "오전 간식",
  lunch: "점심",
  afternoonSnack: "오후 간식",
  dinner: "저녁",
  eveningSnack: "야식 / 간식",
};

export const MEAL_SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: "🌅",
  morningSnack: "☕",
  lunch: "🥗",
  afternoonSnack: "🍎",
  dinner: "🍚",
  eveningSnack: "🌙",
};

export type HealthRecordType = "checkup" | "inbody" | "other";

export const HEALTH_TYPE_LABELS: Record<HealthRecordType, string> = {
  checkup: "건강검진표",
  inbody: "인바디",
  other: "기타 건강기록",
};

export interface User {
  id: string;
  name: string;
  /** 사용자 식별 색상 (HEX) — 이니셜 폴백 표시에 쓰임 */
  color: string;
  /**
   * 표시 아바타 종류.
   * - "google": Firebase Auth 의 photoURL(구글 프로필 사진) 그대로 사용.
   * - "upload": 사용자가 업로드한 사진(avatarDataUrl) 사용.
   * - "preset": 앱이 제공하는 기본 샘플(아이콘/이모지, avatarDataUrl) 사용.
   * - undefined: 기존 동작(구글 사진 있으면 그것, 없으면 이니셜).
   */
  avatarKind?: "google" | "upload" | "preset";
  /** avatarKind === "upload" | "preset" 일 때의 96x96 JPEG base64 data URL (~10KB 이하). */
  avatarDataUrl?: string;
  /** 생년월일 (선택) */
  birthYear?: number;
  /** 생년월일 YYYY-MM-DD (선택) — AI 분석에 나이 반영용 */
  birthDate?: string;
  /** 성별 (선택) */
  gender?: "male" | "female" | "other";
  /** 키 cm (선택) */
  heightCm?: number;
  /** 현재 체중 kg (선택) */
  weightKg?: number;
  /** 목표 체중 kg (선택) */
  targetWeightKg?: number;
  /**
   * 사용자가 중점적으로 관리하고 싶은 건강 컨디션 라벨 (예: "혈당", "요산", "혈압").
   * 민감 정보이므로 AI 분석 응답엔 병명을 직접 언급하지 않고,
   * 식품/영양소 관점의 조언을 유도하는 용도로만 쓴다.
   */
  focusConditions?: string[];
  createdAt: number;
  /** 클라우드 병합용 (없으면 createdAt 으로 간주) */
  updatedAt?: number;
}

/**
 * 끼니(Meal)의 개별 음식 항목.
 *
 * 한 끼니에 여러 번 먹는 경우(리필/추가 주문/코스 등) 를 자연스럽게 담기 위해
 * Meal 은 items 배열을 가진다. 각 item 이 자기만의 사진·분석·수동 수정을
 * 갖는다.
 */
export interface MealItem {
  id: string;
  photo?: Blob;
  thumbnail?: Blob;
  /**
   * Storage 객체 경로만 있고 아직 Blob 을 안 받은 경우(피드 등 지연 로드).
   * Firebase `getBlob` 호출 수를 줄이기 위해 씀.
   */
  photoStoragePath?: string;
  thumbStoragePath?: string;
  menuText?: string;
  rating?: number;
  aiComment?: string;
  nutrition?: {
    calories?: number;
    carbs?: number;
    protein?: number;
    fat?: number;
    /** 당류·가당 추정 (g) */
    sugar?: number;
    healthTags?: string[];
  };
  analysisStatus: "pending" | "analyzing" | "done" | "error" | "skipped";
  /**
   * AI 가 사진에 식사·먹을거리가 분명히 보인다고 판단한 경우 true.
   * false 면 피드·친구 공유 동기화에서 제외(편집으로 수동 저장하면 다시 포함 가능).
   */
  isMealPhoto?: boolean;
  analysisError?: string;
  /** 사용자가 분석 결과를 수동으로 수정했는지 — UI 에 '수정됨' 배지 표시용. */
  manuallyEdited?: boolean;
  /**
   * true 인 항목은 «사진 없이 직접 기록»으로 열었지만 아직 저장하지 않은 초안.
   * 피드·클라우드·달력 요약에는 넣지 않는다.
   */
  draft?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Meal {
  id: string;
  userId: string;
  /** YYYY-MM-DD */
  date: string;
  slot: MealSlot;
  /** 한 끼니의 여러 음식 항목 (최소 0개). 신규 버전에서는 항상 이 필드를 사용. */
  items: MealItem[];
  createdAt: number;
  updatedAt: number;
}

export interface HealthRecord {
  id: string;
  userId: string;
  type: HealthRecordType;
  /** YYYY-MM-DD - 검진/측정 일자 */
  recordDate: string;
  photo?: Blob;
  thumbnail?: Blob;
  /** OCR/AI 가 추출한 원문 */
  extractedText?: string;
  /** 구조화된 측정값 */
  metrics?: Record<string, string | number>;
  /** 100점 만점 건강 점수 */
  healthScore?: number;
  /** AI 의 종합 코멘트 */
  summary?: string;
  /** 강점 / 주의 항목 */
  strengths?: string[];
  concerns?: string[];
  recommendations?: string[];
  analysisStatus: "pending" | "analyzing" | "done" | "error" | "skipped";
  analysisError?: string;
  createdAt: number;
  updatedAt: number;
}

/** UI 강조색 테마 — :root[data-theme="..."] 와 매핑됨. */
export type ThemeId = "green" | "blue" | "pink" | "yellow";

/** 설정 페이지 노출 순서 — 사용자가 바라는 정렬 (그린→블루→핑크→옐로). */
export const THEME_IDS: ThemeId[] = ["green", "blue", "pink", "yellow"];

export const THEME_LABELS: Record<ThemeId, string> = {
  green: "그린",
  blue: "블루",
  pink: "핑크",
  yellow: "옐로",
};

/** 미지정·알 수 없는 값에 대한 폴백 테마. 첫 사용자는 그린을 보게 됩니다. */
export const DEFAULT_THEME: ThemeId = "green";

export interface AppSettings {
  id: "settings";
  geminiApiKey?: string;
  /** 활성 프로필 id — Dexie users 에서 이 기기에 로그인해 쓰는 내 프로필 행 식별 */
  activeUserId?: string;
  /** 온보딩 완료 여부 */
  onboarded?: boolean;
  /** UI 테마 (브랜드 강조색). 미지정이면 default(블랙). */
  theme?: ThemeId;
  /** 공개 설정(activeUserId·onboarded·theme) 충돌 해결용 타임스탬프 */
  appSettingsUpdatedAt?: number;
  /** Gemini 키 충돌 해결용 — 계정별 Firestore config/private 동기화 */
  geminiSettingsUpdatedAt?: number;
  /** 마지막 클라우드 동기화 완료 시각 (로컬 전용) */
  lastCloudSyncAt?: number;
  /**
   * 피드에서 마지막으로 확인한 시점의 카드 목록 최대 meal.updatedAt (로컬 전용 — 새 피드 배지 비교값)
   */
  feedLastSeenMaxUpdatedAt?: number;
  /**
   * 로컬에서 삭제 후 Firestore 반영 전·병합 시 원격 부활 방지용 ID (로컬만, 동기화 후 정리)
   */
  cloudPendingDeletes?: {
    meals?: string[];
    health?: string[];
  };
}

/** /users/{uid}/activityInbox — 좋아요·댓글 등 알림(수신함) */
export type ActivityInboxKind = "meal_like" | "meal_comment" | "comment_like" | "comment_reply";

export interface ActivityInboxDoc {
  id: string;
  /** 경로 문서 소유자와 동일해야 함 (규칙 검증용) */
  recipientUid: string;
  kind: ActivityInboxKind;
  actorUid: string;
  actorName: string;
  actorPhotoURL?: string;
  /** 식단 경로 분해용 — 본문 식단이 속한 사용자(Firebase uid) */
  mealOwnerUid: string;
  mealId: string;
  mealDate: string;
  mealSlot: MealSlot;
  commentId?: string;
  /** 선택 — UI 요약 문자열 */
  snippet?: string;
  createdAt: number;
  read: boolean;
  /** 수신자가 목록에서 숨김 */
  deleted?: boolean;
  deletedAt?: number;
}

/** /dmThreads/{threadId} — 1:1 채팅 스레드 */
export interface DmThreadDoc {
  id: string;
  /** 문자열 순서 오름차순 [a,b], threadId === a+'_'+b 이어야 한다 */
  participantUids: [string, string];
  lastText: string;
  lastSenderUid: string;
  updatedAt: number;
  createdAt: number;
}

/** /dmThreads/{tid}/messages */
export interface DmMessageDoc {
  id: string;
  senderUid: string;
  text: string;
  createdAt: number;
}

/** /users/{uid}/dmReadState/{threadId} */
export interface DmReadStateDoc {
  threadId: string;
  lastReadAt: number;
}

/** 친구 공유 기능 — Firestore 전용 타입 (로컬 IndexedDB 에는 저장하지 않음) */

export interface ShareScope {
  /** 식사·달력 기록 공개 */
  calendar: boolean;
  /**
   * 건강 기록 공개 (deprecated — 민감 정보 보호를 위해 앱에서는 항상 false 로 강제).
   * 기존 사용자 데이터 호환을 위해 필드 자체는 유지하되, UI 에서 선택할 수 없고
   * Firestore 규칙에서도 viewer 가 /health 를 읽을 수 없도록 막는다.
   */
  health: boolean;
}

/** /publicProfiles/{uid} — 로그인 사용자 전체가 읽을 수 있는 최소한의 공개 정보 */
export interface PublicProfile {
  uid: string;
  /** 소문자 정규화된 이메일 */
  email: string;
  displayName: string;
  photoURL?: string;
  updatedAt: number;
}

export type FollowRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

/**
 * /followRequests/{id}
 *
 * 인스타그램 follow 신청과 동일한 의미입니다.
 * 신청자(fromUid)가 수신자(toEmail/toUid)에게 "당신의 기록을 보고 싶어요"라고 요청합니다.
 * 수락되면 수신자가 owner, 신청자가 viewer 인 단방향 share 문서가 만들어집니다.
 */
export interface FollowRequest {
  id: string;
  /** 신청자(viewer 후보) */
  fromUid: string;
  fromEmail: string;
  fromName: string;
  fromPhotoURL?: string;
  /** 수신자(owner 후보) — 소문자 정규화 */
  toEmail: string;
  /** 수락 시 채워짐 */
  toUid?: string;
  /** 신청자가 보고 싶은 범위 (수신자에게 공개를 요청하는 범위) */
  requestedScope: ShareScope;
  status: FollowRequestStatus;
  createdAt: number;
  updatedAt: number;
}

/** /friendInviteCodes/{codeId} — 링크 초대용 1회(또는 만료까지) 가능한 토큰 */
export type FriendInviteStatus = "pending" | "used" | "revoked";

export interface FriendInviteCode {
  /** 문서 id 와 동일한 비밀 토큰(추측 어렵게 충분히 길게) */
  id: string;
  fromUid: string;
  /** 소문자 정규화 Gmail */
  fromEmail: string;
  fromName: string;
  fromPhotoURL?: string;
  requestedScope: ShareScope;
  status: FriendInviteStatus;
  createdAt: number;
  expiresAt: number;
  /** 수락 시 채워짐 */
  usedByUid?: string;
  usedByEmail?: string;
  usedAt?: number;
  revokedAt?: number;
}

/**
 * /users/{ownerUid}/meals/{mealId}/comments/{commentId}
 *
 * 식단 댓글. 작성자(authorUid) 가 수정·삭제 가능, 식단 소유자(ownerUid) 도 삭제 가능.
 */
export interface MealComment {
  id: string;
  ownerUid: string;
  mealId: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string;
  text: string;
  /** 대댓글인 경우 부모 댓글 id. 최상위 댓글이면 undefined. */
  parentCommentId?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * /shares/{ownerUid}_{viewerUid}
 *
 * 한 방향당 한 문서. owner 의 데이터 중 scope 에 해당하는 부분이 viewer 에게 보입니다.
 * 맞팔이면 두 개의 share 문서(서로 owner/viewer 가 뒤집힌)가 존재합니다.
 */
export interface Share {
  id: string;
  ownerUid: string;
  viewerUid: string;
  scope: ShareScope;
  ownerEmail: string;
  ownerName: string;
  ownerPhotoURL?: string;
  viewerEmail: string;
  viewerName: string;
  viewerPhotoURL?: string;
  createdAt: number;
  updatedAt: number;
}
