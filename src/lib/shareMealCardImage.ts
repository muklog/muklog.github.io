import { toPng } from "html-to-image";
import { blobToDataUrl } from "./image";

/** 모바일 GPU 한계 — 캡처 단계 픽셀 상한 */
const MAX_CAPTURE_AREA_PX = 12_000_000;
/**
 * 공유 PNG 긴 변 상한.
 * 너무 작으면 다운스케일 한 번에만 줄여서 사진·텍스트가 흐려지기 쉬움 — 1280 정도가 SNS·메신저에서 무난함.
 */
const MAX_SHARE_LONG_EDGE_PX = 1280;

const MAX_WATERMARK_LINES = 10;

async function ensureImagesDecoded(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll("img")];
  await Promise.all(
    imgs.map(async (img) => {
      if (img.complete && img.naturalWidth === 0) {
        throw new Error("사진을 불러오지 못했습니다.");
      }
      if (!img.complete) {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
        });
      }
      try {
        await img.decode();
      } catch {
        /* noop */
      }
    }),
  );
}

async function inlineBlobImagesForCapture(root: HTMLElement): Promise<() => void> {
  const imgs = [...root.querySelectorAll("img")];
  const revert: Array<{ img: HTMLImageElement; src: string | null; srcset: string | null }> = [];

  const rollback = (): void => {
    for (const r of revert) {
      if (r.src !== null) r.img.setAttribute("src", r.src);
      else r.img.removeAttribute("src");
      if (r.srcset !== null) r.img.setAttribute("srcset", r.srcset);
      else r.img.removeAttribute("srcset");
    }
    revert.length = 0;
  };

  try {
    for (const img of imgs) {
      const srcAttr = img.getAttribute("src");
      if (!srcAttr?.startsWith("blob:")) continue;

      revert.push({
        img,
        src: img.getAttribute("src"),
        srcset: img.getAttribute("srcset"),
      });
      img.removeAttribute("srcset");

      const blob = await fetch(srcAttr).then((r) => {
        if (!r.ok) throw new Error("blob 이미지를 읽지 못했습니다.");
        return r.blob();
      });
      const dataUrl = await blobToDataUrl(blob);
      img.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve();
          return;
        }
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("인라인 이미지 표시 실패"));
      });
      try {
        await img.decode();
      } catch {
        /* noop */
      }
    }
  } catch (e) {
    rollback();
    throw e;
  }

  return rollback;
}

function choosePixelRatio(cssW: number, cssH: number): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 2;
  const maxCss = Math.max(cssW, cssH, 1);
  /** dpr 3 기기에서 2로만 캡처하면 카드·사진이 다소 흐려질 수 있어 상한 3 */
  let pr = Math.min(3, Math.max(1, dpr), MAX_SHARE_LONG_EDGE_PX / maxCss);
  const area = cssW * cssH;
  if (area <= 0) return 1;
  while (pr > 1 && area * pr * pr > MAX_CAPTURE_AREA_PX) {
    pr -= 0.25;
  }
  return Math.max(1, Math.round(pr * 4) / 4);
}

function greedyWrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    let lo = 1;
    let hi = rest.length;
    let best = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const slice = rest.slice(0, mid);
      if (ctx.measureText(slice).width <= maxWidth) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 1) best = 1;
    lines.push(rest.slice(0, best));
    rest = rest.slice(best);
  }
  return lines;
}

function truncateWithEllipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  for (let i = text.length - 1; i > 0; i--) {
    const t = text.slice(0, i) + ellipsis;
    if (ctx.measureText(t).width <= maxWidth) return t;
  }
  return ellipsis;
}

/** 캡처 PNG 하단에만 쓰임 — 웹 주소 대신 고정 카피 */
export const SHARE_CARD_WATERMARK_TAGLINE = "먹로그 — 사진만 찍으면 AI가 식단 기록";

function computeWatermarkLayout(
  canvasWidth: number,
  cssWidthRef: number,
  /** 하단 한 덩어리 문구 (줄바꿈만 허용) */
  footTagline: string,
): {
  barPx: number;
  fontPx: number;
  padX: number;
  padY: number;
  lineGap: number;
  lineHeight: number;
  lines: string[];
} {
  const scaleRef = canvasWidth / Math.max(cssWidthRef, 280);
  const padX = Math.round(12 * scaleRef);
  const padY = Math.round(10 * scaleRef);
  const maxW = Math.max(40, canvasWidth - padX * 2);
  const lineGap = Math.round(4 * scaleRef);

  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, canvasWidth);
  scratch.height = 10;
  const ctx = scratch.getContext("2d")!;
  const fontPxStart = Math.max(10, Math.round(11 * scaleRef));
  const minFont = Math.max(8, Math.round(8 * scaleRef));
  const fullSingle = footTagline.trim() || "먹로그";

  let chosenFont = minFont;
  let lines: string[] = [fullSingle];

  for (let fp = fontPxStart; fp >= minFont; fp--) {
    ctx.font = `${fp}px ui-sans-serif, system-ui, sans-serif`;
    let candidate: string[];
    if (ctx.measureText(fullSingle).width <= maxW) {
      candidate = [fullSingle];
    } else {
      candidate = greedyWrapLine(ctx, fullSingle, maxW);
    }

    if (candidate.length <= MAX_WATERMARK_LINES) {
      chosenFont = fp;
      lines = candidate;
      break;
    }

    if (fp === minFont) {
      chosenFont = minFont;
      ctx.font = `${minFont}px ui-sans-serif, system-ui, sans-serif`;
      const head = candidate.slice(0, MAX_WATERMARK_LINES - 1);
      const tailMerged = candidate.slice(MAX_WATERMARK_LINES - 1).join("");
      head.push(truncateWithEllipsis(ctx, tailMerged, maxW));
      lines = head;
    }
  }

  ctx.font = `${chosenFont}px ui-sans-serif, system-ui, sans-serif`;
  const lineHeight = Math.ceil(chosenFont * 1.35);
  const barPx =
    padY * 2 + lines.length * lineHeight + Math.max(0, lines.length - 1) * lineGap;

  return { barPx, fontPx: chosenFont, padX, padY, lineGap, lineHeight, lines };
}

function drawWatermarkBar(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  topY: number,
  layout: ReturnType<typeof computeWatermarkLayout>,
): void {
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, topY, canvasWidth, layout.barPx);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `${layout.fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  let y = topY + layout.padY;
  for (let i = 0; i < layout.lines.length; i++) {
    ctx.fillText(layout.lines[i]!, layout.padX, y);
    y += layout.lineHeight + (i < layout.lines.length - 1 ? layout.lineGap : 0);
  }
}

async function captureElementToDataUrl(element: HTMLElement, pixelRatio: number): Promise<string> {
  return toPng(element, {
    pixelRatio,
    cacheBust: false,
    backgroundColor: "#0f172a",
    // Pretendard 등 웹폰트를 SVG에 포함해야 칩·태그 등 소형 텍스트가 화면과 동일한 크기·메트릭으로 그려짐
    skipFonts: false,
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true;
      if (node.closest(".exclude-from-share-capture")) return false;
      const cls = typeof node.className === "string" ? node.className : "";
      if (cls.includes("backdrop-blur")) return false;
      if (cls.includes("backdrop-saturate")) return false;
      return true;
    },
  });
}

function scaleBitmapToMaxEdge(
  source: CanvasImageSource,
  sw: number,
  sh: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const m = Math.max(sw, sh);
  if (m <= MAX_SHARE_LONG_EDGE_PX) {
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const x = c.getContext("2d");
    if (!x) throw new Error("canvas 2d 를 사용할 수 없습니다.");
    x.drawImage(source, 0, 0);
    return { canvas: c, width: sw, height: sh };
  }
  const s = MAX_SHARE_LONG_EDGE_PX / m;
  const tw = Math.max(1, Math.round(sw * s));
  const th = Math.max(1, Math.round(sh * s));
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const x = c.getContext("2d");
  if (!x) throw new Error("canvas 2d 를 사용할 수 없습니다.");
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(source, 0, 0, tw, th);
  return { canvas: c, width: tw, height: th };
}

export async function shareMealCardFromElement(
  element: HTMLElement,
  opts: {
    filename: string;
    promoUrl: string;
    shareTitle?: string;
    shareText?: string;
    /** 캡처 이미지 하단 문구 — 기본은 URL 없이 고정 카피 */
    watermarkTagline?: string;
  },
): Promise<void> {
  const w = element.offsetWidth;
  const h = element.offsetHeight;
  if (w < 12 || h < 12) {
    throw new Error("캡처할 카드 영역이 비어 있어요. 보이는 카드에서 다시 시도해 주세요.");
  }

  const revertDom = await inlineBlobImagesForCapture(element);
  let dataUrl: string;
  try {
    await ensureImagesDecoded(element);

    const cssW = Math.max(element.clientWidth, w);
    const cssH = Math.max(element.clientHeight, h);
    const pr = choosePixelRatio(cssW, cssH);

    try {
      dataUrl = await captureElementToDataUrl(element, pr);
    } catch (first) {
      console.warn("[shareMealCardImage] toPng 실패, pixelRatio 1 재시도", first);
      if (pr <= 1) throw first;
      dataUrl = await captureElementToDataUrl(element, 1);
    }

    if (!dataUrl || dataUrl.length < 64) {
      throw new Error("PNG 데이터가 비어 있습니다.");
    }
  } catch (e) {
    console.error("[shareMealCardImage] 캡처 단계", e);
    throw new Error(
      e instanceof Error
        ? `이미지 변환 실패: ${e.message}`
        : "이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  } finally {
    revertDom();
  }

  const img = new Image();
  img.decoding = "async";
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("워터마크 처리 중 이미지를 불러오지 못했습니다."));
  });

  const cssWRef = Math.max(element.clientWidth, 280);
  const { canvas: cardCanvas, width: rw, height: rh } = scaleBitmapToMaxEdge(img, img.width, img.height);

  const wmTagline = (opts.watermarkTagline ?? SHARE_CARD_WATERMARK_TAGLINE).trim();
  const wmLayout = computeWatermarkLayout(rw, cssWRef, wmTagline);

  const canvas = document.createElement("canvas");
  canvas.width = rw;
  canvas.height = rh + wmLayout.barPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 를 사용할 수 없습니다.");

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cardCanvas, 0, 0);
  drawWatermarkBar(ctx, rw, rh, wmLayout);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 생성 실패"))), "image/png");
  });

  const file = new File([blob], opts.filename, {
    type: "image/png",
    lastModified: Date.now(),
  });

  const title = opts.shareTitle ?? "먹로그 식단";
  const text = opts.shareText ?? `먹로그에서 기록한 식단이에요 — ${opts.promoUrl}`;

  if (typeof navigator.share === "function") {
    const withFiles: ShareData = { files: [file], title, text };
    const canTryFiles =
      typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] });

    if (canTryFiles) {
      try {
        await navigator.share(withFiles);
        return;
      } catch (e) {
        const err = e as { name?: string };
        if (err?.name === "AbortError") return;
        console.warn("[shareMealCardImage] share(files)", e);
      }
    }

    try {
      await navigator.share({
        title,
        text: `${text}\n${opts.promoUrl}`,
        url: opts.promoUrl,
      });
      return;
    } catch (e) {
      const err = e as { name?: string };
      if (err?.name === "AbortError") return;
      console.warn("[shareMealCardImage] share(url)", e);
    }
  }

  alert(
    "이 브라우저나 기기에서는 이미지를 바로 공유할 수 없어요. 갤러리에 저장하지는 않았어요. Chrome 등 최신 브라우저에서 다시 시도하거나, 화면을 캡처해 공유해 주세요.",
  );
}
