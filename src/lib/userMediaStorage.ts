/**
 * 사용자 식단·건강 사진 파일 — Firebase Storage.
 * 객체 경로는 `users/{firebaseUid}/media/...` 로 통일한다.
 * Firestore에 `{uid}/media/...`(users 접두사 없음)만 있는 레거시 문서는 읽기 시 `users/` 를 붙여 재시도한다.
 */
import { deleteObject, getBlob, getDownloadURL, listAll, ref, uploadBytes } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";
import { ensureAuthTokenForFirestore, getFirebaseAuth, getFirebaseStorage } from "./firebaseApp";

const META = {
  photo: { contentType: "image/jpeg" },
  thumb: { contentType: "image/jpeg" },
} as const;

async function storageWithAuth(): Promise<FirebaseStorage> {
  await ensureAuthTokenForFirestore();
  return getFirebaseStorage();
}

/** 권한 오류가 아닌 일시적 실패(네트워크 깜빡임 등)는 짧게 재시도. 빈 blob 은 즉시 거부. */
const UPLOAD_RETRY_DELAYS_MS = [0, 400, 1200];

async function uploadBytesResilient(
  storageRef: ReturnType<typeof ref>,
  blob: Blob,
  meta: { contentType: string },
): Promise<void> {
  if (!blob || blob.size === 0) {
    throw new Error("업로드할 이미지 데이터가 비어 있습니다.");
  }
  let lastErr: unknown;
  for (let i = 0; i < UPLOAD_RETRY_DELAYS_MS.length; i++) {
    const wait = UPLOAD_RETRY_DELAYS_MS[i]!;
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    try {
      await uploadBytes(storageRef, blob, meta);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string })?.code;
      // 권한·인증 오류는 재시도해도 풀리지 않으므로 즉시 중단(상위에서 안내·재인증).
      if (code === "storage/unauthorized" || code === "storage/unauthenticated") break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "이미지 업로드 실패"));
}

export function mealItemPhotoRef(uid: string, mealId: string, itemId: string): string {
  return `users/${uid}/media/meals/${mealId}/items/${itemId}/photo.jpg`;
}

export function mealItemThumbRef(uid: string, mealId: string, itemId: string): string {
  return `users/${uid}/media/meals/${mealId}/items/${itemId}/thumb.jpg`;
}

export function healthPhotoRef(uid: string, recordId: string): string {
  return `users/${uid}/media/health/${recordId}/photo.jpg`;
}

export function healthThumbRef(uid: string, recordId: string): string {
  return `users/${uid}/media/health/${recordId}/thumb.jpg`;
}

export async function uploadMealItemImages(
  uid: string,
  mealId: string,
  itemId: string,
  photoJpeg: Blob,
  thumbJpeg: Blob,
): Promise<{ photoStoragePath: string; thumbStoragePath: string }> {
  const st = await storageWithAuth();
  const photoStoragePath = mealItemPhotoRef(uid, mealId, itemId);
  const thumbStoragePath = mealItemThumbRef(uid, mealId, itemId);
  await Promise.all([
    uploadBytesResilient(ref(st, photoStoragePath), photoJpeg, META.photo),
    uploadBytesResilient(ref(st, thumbStoragePath), thumbJpeg, META.thumb),
  ]);
  return { photoStoragePath, thumbStoragePath };
}

export async function uploadHealthImages(
  uid: string,
  recordId: string,
  photoJpeg: Blob,
  thumbJpeg: Blob,
): Promise<{ photoStoragePath: string; thumbStoragePath: string }> {
  const st = await storageWithAuth();
  const photoStoragePath = healthPhotoRef(uid, recordId);
  const thumbStoragePath = healthThumbRef(uid, recordId);
  await Promise.all([
    uploadBytesResilient(ref(st, photoStoragePath), photoJpeg, META.photo),
    uploadBytesResilient(ref(st, thumbStoragePath), thumbJpeg, META.thumb),
  ]);
  return { photoStoragePath, thumbStoragePath };
}

/**
 * Storage ref 문자열(gs://..., https://firebasestorage...) 또는 순수 객체 경로를
 * `ref(bucket, "...")` 에 넣기 위한 객체 경로로 바꿉니다.
 */
export function normalizeStorageObjectPath(raw: string): string {
  const s = raw.trim();
  if (!s) return s;

  if (s.startsWith("gs://")) {
    const rest = s.slice("gs://".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return s;
    return rest.slice(slash + 1);
  }

  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const u = new URL(s);
      if (u.hostname === "firebasestorage.googleapis.com") {
        const mark = "/o/";
        const idx = u.pathname.indexOf(mark);
        if (idx >= 0) {
          return decodeURIComponent(u.pathname.slice(idx + mark.length));
        }
      }
    } catch {
      /* 그대로 ref 시도 */
    }
  }

  return s;
}

/**
 * Storage 규칙은 `users/{uid}/media/**` 만 허용한다.
 * Firestore/Dexie 에 `{uid}/media/**` 만 남아 있으면 규칙 미매칭으로 첫 요청이 403 이 되므로,
 * 읽기 전에 항상 `users/` 접두를 붙인다.
 */
export function canonicalStorageReadPath(normalizedObjectPath: string): string {
  const p = normalizedObjectPath.trim();
  if (!p || p.startsWith("users/")) return p;
  const m = /^([^/]+)\/(media\/.+)$/.exec(p);
  if (m) return `users/${m[1]}/${m[2]}`;
  return p;
}

/** 동일 경로 동시 요청 합치기 — 피드에서 같은 썸네일을 여러 번 받지 않음 */
const downloadUrlInflight = new Map<string, Promise<string>>();
/** 세션 내 재사용 — 스크롤·재마운트 시 getDownloadURL 반복 호출 방지 */
const downloadUrlCache = new Map<string, string>();
const MAX_DOWNLOAD_URL_CACHE = 480;

function rememberDownloadUrl(canonicalPath: string, url: string) {
  downloadUrlCache.set(canonicalPath, url);
  while (downloadUrlCache.size > MAX_DOWNLOAD_URL_CACHE) {
    const k = downloadUrlCache.keys().next().value;
    if (k === undefined) break;
    downloadUrlCache.delete(k);
  }
}

/**
 * 피드 등 `<img src>` 용 — getBlob+XHR+프리플라이트 대신 짧은 메타 요청 후 브라우저가 이미지를 직접 받는다.
 */
export async function getDownloadUrlForStoragePath(storagePathOrUrl: string): Promise<string> {
  const path = canonicalStorageReadPath(normalizeStorageObjectPath(storagePathOrUrl.trim()));
  if (!path) throw new Error("empty storage path");

  const cached = downloadUrlCache.get(path);
  if (cached) return cached;

  let inflight = downloadUrlInflight.get(path);
  if (inflight) return inflight;

  inflight = (async () => {
    const st = await storageWithAuth();

    async function urlFor(p: string): Promise<string> {
      return getDownloadURL(ref(st, p));
    }

    try {
      const url = await urlFor(path);
      rememberDownloadUrl(path, url);
      return url;
    } catch (e) {
      const authUid = getFirebaseAuth().currentUser?.uid;
      const match = /^users\/([^/]+)\/(.+)$/.exec(path);
      if (authUid && match && match[1] !== authUid) {
        try {
          const url = await urlFor(`users/${authUid}/${match[2]}`);
          rememberDownloadUrl(path, url);
          return url;
        } catch {
          /* 원 오류 */
        }
      }
      throw e;
    }
  })().finally(() => {
    downloadUrlInflight.delete(path);
  });

  downloadUrlInflight.set(path, inflight);
  return inflight;
}

/** 피드 진입 시 상단 카드 썸네일 URL 을 미리 채워 로딩 체감을 줄임 */
export function prefetchDownloadUrlsForStoragePaths(paths: string[], max = 48): void {
  const seen = new Set<string>();
  let n = 0;
  for (const raw of paths) {
    const p = canonicalStorageReadPath(normalizeStorageObjectPath(raw.trim()));
    if (!p || seen.has(p) || n >= max) continue;
    seen.add(p);
    n++;
    void getDownloadUrlForStoragePath(p).catch(() => {});
  }
}

export async function blobFromStoragePath(storagePathOrUrl: string): Promise<Blob> {
  const st = await storageWithAuth();
  const path = canonicalStorageReadPath(normalizeStorageObjectPath(storagePathOrUrl));

  async function fetchPath(p: string): Promise<Blob> {
    return getBlob(ref(st, p));
  }

  try {
    return await fetchPath(path);
  } catch (e) {
    const authUid = getFirebaseAuth().currentUser?.uid;
    const match = /^users\/([^/]+)\/(.+)$/.exec(path);
    /**
     * 예전에는 Dexie 프로필 id 로 Storage 경로를 쓴 문서가 있을 수 있습니다.
     * 동일 파일을 현재 Firebase UID 경로 아래에도 올려 둔(또는 경로만 어긋난) 경우를 대비한 폴백입니다.
     */
    if (authUid && match && match[1] !== authUid) {
      const alt = `users/${authUid}/${match[2]}`;
      try {
        return await fetchPath(alt);
      } catch {
        /* fall through — 원본 오류를 던짐 */
      }
    }
    throw e;
  }
}

export async function deleteMealMediaFolder(uid: string, mealId: string): Promise<void> {
  const st = await storageWithAuth();
  await deleteStoragePrefixRecursive(st, `users/${uid}/media/meals/${mealId}`);
}

export async function deleteHealthMediaFolder(uid: string, recordId: string): Promise<void> {
  const st = await storageWithAuth();
  await deleteStoragePrefixRecursive(st, `users/${uid}/media/health/${recordId}`);
}

export async function deleteUserMediaTree(uid: string): Promise<void> {
  try {
    const st = await storageWithAuth();
    await deleteStoragePrefixRecursive(st, `users/${uid}/media`);
  } catch (e) {
    console.warn("[userMediaStorage] 사용자 미디어 트리 삭제 실패", e);
  }
}

async function deleteStoragePrefixRecursive(
  storage: FirebaseStorage,
  path: string,
): Promise<void> {
  const r = ref(storage, path);
  const page = await listAll(r);
  await Promise.all(page.items.map((it) => deleteObject(it)));
  await Promise.all(
    page.prefixes.map((p) => deleteStoragePrefixRecursive(storage, p.fullPath)),
  );
}
