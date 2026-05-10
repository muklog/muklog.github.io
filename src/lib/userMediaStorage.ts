/**
 * 사용자 식단·건강 사진 파일 — Firebase Storage.
 * 객체 경로는 `{firebaseUid}/media/...` (Firestore `users/{uid}/meals` 와 이름만 비슷할 뿐 별개).
 * 예전 `users/{uid}/media/...` 문서는 읽기 시 폴백한다.
 */
import { deleteObject, getBlob, listAll, ref, uploadBytes } from "firebase/storage";
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

export function mealItemPhotoRef(uid: string, mealId: string, itemId: string): string {
  return `${uid}/media/meals/${mealId}/items/${itemId}/photo.jpg`;
}

export function mealItemThumbRef(uid: string, mealId: string, itemId: string): string {
  return `${uid}/media/meals/${mealId}/items/${itemId}/thumb.jpg`;
}

export function healthPhotoRef(uid: string, recordId: string): string {
  return `${uid}/media/health/${recordId}/photo.jpg`;
}

export function healthThumbRef(uid: string, recordId: string): string {
  return `${uid}/media/health/${recordId}/thumb.jpg`;
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
    uploadBytes(ref(st, photoStoragePath), photoJpeg, META.photo),
    uploadBytes(ref(st, thumbStoragePath), thumbJpeg, META.thumb),
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
    uploadBytes(ref(st, photoStoragePath), photoJpeg, META.photo),
    uploadBytes(ref(st, thumbStoragePath), thumbJpeg, META.thumb),
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

export async function blobFromStoragePath(storagePathOrUrl: string): Promise<Blob> {
  const st = await storageWithAuth();
  const path = normalizeStorageObjectPath(storagePathOrUrl);

  async function fetchPath(p: string): Promise<Blob> {
    return getBlob(ref(st, p));
  }

  try {
    return await fetchPath(path);
  } catch (e) {
    /** 레거시: `users/{uid}/media/...` */
    if (!path.startsWith("users/")) {
      try {
        const m = /^([^/]+)\/(media\/.+)$/.exec(path);
        if (m) return await fetchPath(`users/${m[1]}/${m[2]}`);
      } catch {
        /* 다음 폴백 */
      }
    }
    const stripUsers = /^users\/([^/]+)\/(media\/.+)$/.exec(path);
    if (stripUsers) {
      try {
        return await fetchPath(`${stripUsers[1]}/${stripUsers[2]}`);
      } catch {
        /* 다음 폴백 */
      }
    }
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
  await deleteStoragePrefixRecursive(st, `${uid}/media/meals/${mealId}`);
  try {
    await deleteStoragePrefixRecursive(st, `users/${uid}/media/meals/${mealId}`);
  } catch {
    /* 레거시 경로 없음 */
  }
}

export async function deleteHealthMediaFolder(uid: string, recordId: string): Promise<void> {
  const st = await storageWithAuth();
  await deleteStoragePrefixRecursive(st, `${uid}/media/health/${recordId}`);
  try {
    await deleteStoragePrefixRecursive(st, `users/${uid}/media/health/${recordId}`);
  } catch {
    /* 레거시 경로 없음 */
  }
}

export async function deleteUserMediaTree(uid: string): Promise<void> {
  try {
    const st = await storageWithAuth();
    await deleteStoragePrefixRecursive(st, `${uid}/media`);
    try {
      await deleteStoragePrefixRecursive(st, `users/${uid}/media`);
    } catch {
      /* 레거시 없음 */
    }
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
