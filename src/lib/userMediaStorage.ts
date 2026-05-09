/**
 * 사용자 식단·건강 사진 파일 — Firebase Storage.
 * 경로 접두부 `users/{firebaseUid}/media/...` (Firestore `users/{uid}/meals` 컬렉션 이름과 분리).
 */
import { deleteObject, getBlob, listAll, ref, uploadBytes } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";
import { ensureAuthTokenForFirestore, getFirebaseStorage } from "./firebaseApp";

const META = {
  photo: { contentType: "image/jpeg" },
  thumb: { contentType: "image/jpeg" },
} as const;

async function storageWithAuth(): Promise<FirebaseStorage> {
  await ensureAuthTokenForFirestore();
  return getFirebaseStorage();
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

export async function blobFromStoragePath(storagePath: string): Promise<Blob> {
  const st = await storageWithAuth();
  return getBlob(ref(st, storagePath));
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
