/**
 * 이미지 압축 / 썸네일 생성 유틸.
 * - IndexedDB 저장 용량 절감 + AI 업로드 속도 개선
 */

export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
  mimeType?: "image/jpeg" | "image/webp";
  /** true 면 짧은 쪽 기준 가운데 정사각형으로 잘라낸 뒤 압축. (식사 사진용) */
  square?: boolean;
}

type DecodedImage = {
  width: number;
  height: number;
  /** canvas 에 그릴 때 drawImage 의 1번째 인자로 넘길 수 있는 객체 */
  source: CanvasImageSource;
  /** 디코딩에 사용한 리소스를 정리 (ImageBitmap.close / objectURL revoke) */
  dispose: () => void;
};

const DECODE_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 시간 초과(${ms / 1000}s)`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function decodeWithImageBitmap(blob: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    // 대부분의 모바일 Safari/크롬에서 HEIC·대용량도 여기서 성공한다.
    const bitmap = await withTimeout(
      createImageBitmap(blob),
      DECODE_TIMEOUT_MS,
      "이미지 디코딩",
    );
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      dispose: () => {
        try {
          bitmap.close();
        } catch {
          /* noop */
        }
      },
    };
  } catch (e) {
    console.warn("[image] createImageBitmap 실패, HTMLImageElement 로 폴백", e);
    return null;
  }
}

async function decodeWithHtmlImage(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    // img.decode() 에만 의존하면 일부 iOS 버전에서 영구 pending 상태가 될 수 있어
    // onload/onerror 와 레이스 + 타임아웃으로 감싼다.
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 로드에 실패했습니다."));
    });
    img.src = url;
    const decoded = img.decode
      ? img
          .decode()
          .then(() => img)
          .catch((e) => {
            console.warn("[image] img.decode 실패, onload 로 폴백", e);
            return loaded;
          })
      : loaded;
    const ready = await withTimeout(
      Promise.race([decoded, loaded]),
      DECODE_TIMEOUT_MS,
      "이미지 디코딩",
    );
    return {
      width: ready.naturalWidth || ready.width,
      height: ready.naturalHeight || ready.height,
      source: ready,
      dispose: () => {
        // decode 후엔 브라우저 캐시에 올라가 있어 즉시 revoke 해도 drawImage 는 문제 없음
        URL.revokeObjectURL(url);
      },
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  const viaBitmap = await decodeWithImageBitmap(blob);
  if (viaBitmap) return viaBitmap;
  return decodeWithHtmlImage(blob);
}

export async function compressImage(
  file: Blob,
  opts: CompressOptions = {},
): Promise<Blob> {
  const {
    maxDimension = 1280,
    quality = 0.85,
    mimeType = "image/jpeg",
    square = false,
  } = opts;
  const img = await decodeImage(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    if (square) {
      const side = Math.min(img.width, img.height);
      const sx = Math.round((img.width - side) / 2);
      const sy = Math.round((img.height - side) / 2);
      const target = Math.min(maxDimension, side);
      canvas.width = target;
      canvas.height = target;
      ctx.drawImage(img.source, sx, sy, side, side, 0, 0, target, target);
    } else {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img.source, 0, 0, w, h);
    }

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b ?? file),
        mimeType,
        quality,
      );
    });
  } finally {
    img.dispose();
  }
}

export async function makeThumbnail(file: Blob): Promise<Blob> {
  return compressImage(file, { maxDimension: 320, quality: 0.7 });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl.split(",")[1] ?? "";
}

/** Firestore 동기화 등 — Base64 → Blob */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** 안전한 object URL 캐시 - 컴포넌트 unmount 시 revoke 필요 */
const urlCache = new WeakMap<Blob, string>();
export function blobUrl(blob: Blob | undefined): string | undefined {
  if (!blob) return undefined;
  if (!(blob instanceof Blob)) {
    console.warn("[image] blobUrl: Blob 이 아닌 값은 무시합니다.");
    return undefined;
  }
  let url = urlCache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(blob, url);
  }
  return url;
}
