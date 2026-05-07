import { toPng } from "html-to-image";

function drawEllipsisText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): void {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, 0, 0);
    return;
  }
  const ellipsis = "…";
  for (let i = text.length - 1; i > 0; i--) {
    const t = text.slice(0, i) + ellipsis;
    if (ctx.measureText(t).width <= maxWidth) {
      ctx.fillText(t, 0, 0);
      return;
    }
  }
  ctx.fillText(ellipsis, 0, 0);
}

/**
 * 식단 카드 DOM 을 PNG 로 만든 뒤 하단에 앱 URL 워터마크를 붙이고 공유 시트 또는 저장으로 넘긴다.
 */
export async function shareMealCardFromElement(
  element: HTMLElement,
  opts: {
    filename: string;
    promoUrl: string;
    shareTitle?: string;
    shareText?: string;
  },
): Promise<void> {
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#0f172a",
  });

  const img = new Image();
  img.decoding = "async";
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("워터마크 처리 중 이미지를 불러오지 못했습니다."));
  });

  const cssW = Math.max(element.clientWidth, 280);
  const scale = img.width / cssW;
  const barCss = 38;
  const barPx = Math.round(barCss * scale);

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height + barPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 를 사용할 수 없습니다.");

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, img.height, canvas.width, barPx);

  const fontPx = Math.max(11, Math.round(12 * scale));
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const line = `헬스헬스 — ${opts.promoUrl}`;
  const pad = Math.round(12 * scale);
  const maxW = canvas.width - pad * 2;
  ctx.save();
  ctx.translate(pad, img.height + barPx / 2);
  drawEllipsisText(ctx, line, maxW);
  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 생성 실패"))), "image/png");
  });

  const file = new File([blob], opts.filename, { type: "image/png" });

  if (typeof navigator.share === "function") {
    try {
      const payload: ShareData = {
        files: [file],
        title: opts.shareTitle ?? "헬스헬스 식단",
        text: opts.shareText ?? `헬스헬스 식단 기록 — ${opts.promoUrl}`,
      };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return;
      }
    } catch (e) {
      const err = e as { name?: string };
      if (err?.name === "AbortError") return;
      console.warn("[shareMealCardImage] navigator.share", e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.filename;
  a.click();
  URL.revokeObjectURL(url);
  alert(
    "이미지를 저장했어요.\n카카오톡·인스타 DM 등에서 사진 첨부로 보내보세요.\n(브라우저에 따라 바로 공유 시트가 안 뜰 수 있어요.)",
  );
}
