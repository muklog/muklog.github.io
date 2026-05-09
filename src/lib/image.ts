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

export type DecodedImage = {
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

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, 140 * attempt));
      }
      const viaBitmap = await decodeWithImageBitmap(blob);
      if (viaBitmap) return viaBitmap;
      return await decodeWithHtmlImage(blob);
    } catch (e) {
      lastErr = e;
      console.warn("[image] decodeImage 실패 후 재시도", attempt + 1, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "이미지 디코드에 실패했습니다."));
}

/**
 * 일부 모바일·WebView 에서 `toBlob` 이 null 을 돌려주는 경우가 있어 toDataURL 로 폴백한다.
 */
function canvasToBlobWithFallback(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b && b.size > 0) {
          resolve(b);
          return;
        }
        try {
          const dataUrl = canvas.toDataURL(mimeType, quality);
          const comma = dataUrl.indexOf(",");
          if (comma < 0) {
            reject(new Error("이미지를 JPEG 로 저장하지 못했습니다."));
            return;
          }
          const base64 = dataUrl.slice(comma + 1);
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const out = new Blob([bytes], { type: mimeType });
          if (out.size > 0) resolve(out);
          else reject(new Error("이미지를 JPEG 로 저장하지 못했습니다."));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
      mimeType,
      quality,
    );
  });
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
    if (!Number.isFinite(img.width) || !Number.isFinite(img.height) || img.width < 1 || img.height < 1) {
      throw new Error("사진 크기를 읽지 못했습니다. 다시 촬영하거나 갤러리에서 선택해 보세요.");
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("이 브라우저에서 이미지 처리를 할 수 없습니다.");
    }

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

    return await canvasToBlobWithFallback(canvas, mimeType, quality);
  } finally {
    img.dispose();
  }
}

export type PhotoSquareCropOpts = {
  quarterTurns: 0 | 1 | 2 | 3;
  /** 1 이상 · cover 스케일에 곱해 확대 */
  zoom: number;
  /** 미리보기 정사각 변 길이(px) 기준 패닝. 출력 시 비율로 환산 */
  panX: number;
  panY: number;
  previewSidePx: number;
  /** 최종 출력 한 변(px) JPEG */
  outputSidePx: number;
  jpegQuality?: number;
};

/** cover + 줌 상태에서 패닝이 빈 영역을 드러내지 않도록 제한 */
export function clampPanForSquareCover(
  Rw: number,
  Rh: number,
  scaleK: number,
  viewportSidePx: number,
  panX: number,
  panY: number,
): { panX: number; panY: number } {
  const halfIw = (Rw * scaleK) / 2;
  const halfIh = (Rh * scaleK) / 2;
  let px = panX;
  let py = panY;
  if (Rw * scaleK > viewportSidePx) {
    const minPx = viewportSidePx / 2 - halfIw;
    const maxPx = halfIw - viewportSidePx / 2;
    px = Math.min(maxPx, Math.max(minPx, px));
  } else {
    px = 0;
  }
  if (Rh * scaleK > viewportSidePx) {
    const minPy = viewportSidePx / 2 - halfIh;
    const maxPy = halfIh - viewportSidePx / 2;
    py = Math.min(maxPy, Math.max(minPy, py));
  } else {
    py = 0;
  }
  return { panX: px, panY: py };
}

export function squareCoverScaleK(Rw: number, Rh: number, viewportSidePx: number, zoom: number): number {
  const z = Math.max(1, zoom);
  const k0 = Math.max(viewportSidePx / Rw, viewportSidePx / Rh);
  return k0 * z;
}

/** 정사각 뷰포트에 cover + 패닝·줌으로 그립니다. pan 은 sidePx 좌표계. */
export function drawSquareCoverCrop(
  ctx: CanvasRenderingContext2D,
  rot: CanvasImageSource,
  Rw: number,
  Rh: number,
  sidePx: number,
  panX: number,
  panY: number,
  zoom: number,
): void {
  const K = squareCoverScaleK(Rw, Rh, sidePx, zoom);
  const { panX: cpx, panY: cpy } = clampPanForSquareCover(Rw, Rh, K, sidePx, panX, panY);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, sidePx, sidePx);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, sidePx, sidePx);
  ctx.clip();
  ctx.translate(sidePx / 2 + cpx, sidePx / 2 + cpy);
  ctx.scale(K, K);
  ctx.drawImage(rot, -Rw / 2, -Rh / 2, Rw, Rh);
  ctx.restore();
}

/** 회전(90° 단위)된 오프스크린 캔버스 · 미리보기/내보내기 공용 */
export function rotatedSourceCanvas(img: CanvasImageSource, w: number, h: number, qw: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 사용 불가");
  const q = ((qw % 4) + 4) % 4;
  if (q === 0) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }
  if (q === 1) {
    canvas.width = h;
    canvas.height = w;
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }
  if (q === 2) {
    canvas.width = w;
    canvas.height = h;
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }
  canvas.width = h;
  canvas.height = w;
  ctx.translate(0, w);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/** 디코드한 뒤 90° 단위 회전 캔버스만 남김(원본 디코드 자원은 해제). */
export async function decodeToRotatedCanvas(
  blob: Blob,
  quarterTurns: 0 | 1 | 2 | 3,
): Promise<{ canvas: HTMLCanvasElement; Rw: number; Rh: number }> {
  const decoded = await decodeImage(blob);
  try {
    const canvas = rotatedSourceCanvas(decoded.source, decoded.width, decoded.height, quarterTurns);
    return { canvas, Rw: canvas.width, Rh: canvas.height };
  } finally {
    decoded.dispose();
  }
}

/**
 * 회전·확대·패닝한 뒤 정사각형 한 장으로 내보냅니다.
 */
export async function exportSquareCropJpeg(blob: Blob, opts: PhotoSquareCropOpts): Promise<Blob> {
  const { canvas: rot, Rw, Rh } = await decodeToRotatedCanvas(blob, opts.quarterTurns);
  const S = opts.outputSidePx;
  const ratio = S / opts.previewSidePx;
  const panXO = opts.panX * ratio;
  const panYO = opts.panY * ratio;

  const out = document.createElement("canvas");
  out.width = S;
  out.height = S;
  const ox = out.getContext("2d");
  if (!ox) throw new Error("canvas 2d 사용 불가");
  drawSquareCoverCrop(ox, rot, Rw, Rh, S, panXO, panYO, opts.zoom);
  return canvasToBlobWithFallback(out, "image/jpeg", opts.jpegQuality ?? 0.92);
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
const urlCache = new WeakMap<object, string>();

/**
 * IndexedDB 복원값이 일부 브라우저(삼성 인터넷 등)에서 `instanceof Blob` 이 false 인데
 * API 는 Blob 과 동일하게 동작하는 경우가 있음 — createObjectURL 은 그래도 성공하는 경우가 많다.
 */
function isBlobLikeForUrl(v: unknown): v is Blob {
  if (!v || typeof v !== "object") return false;
  if (v instanceof Blob) return true;
  const b = v as Blob & { stream?: unknown };
  if (typeof b.size !== "number") return false;
  return (
    typeof b.arrayBuffer === "function" ||
    typeof b.slice === "function" ||
    typeof b.stream === "function"
  );
}

/** 화면에 올릴 수 있는 크기를 가진 Blob / Blob 호환 IndexedDB 객체 */
export function isRenderableImageBlob(v: unknown): v is Blob {
  return isBlobLikeForUrl(v) && v.size > 0;
}

export function blobUrl(blob: Blob | undefined): string | undefined {
  if (!blob) return undefined;
  if (!isRenderableImageBlob(blob)) {
    if (!isBlobLikeForUrl(blob)) {
      console.warn("[image] blobUrl: Blob 이 아닌 값은 무시합니다.");
    }
    return undefined;
  }

  const key = blob as object;
  let url = urlCache.get(key);
  if (!url) {
    try {
      url = URL.createObjectURL(blob);
    } catch (e) {
      console.warn("[image] blobUrl: createObjectURL 실패", e);
      return undefined;
    }
    urlCache.set(key, url);
  }
  return url;
}
