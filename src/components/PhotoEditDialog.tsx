import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, RotateCw, X } from "lucide-react";
import {
  clampPanForSquareCover,
  decodeToRotatedCanvas,
  drawSquareCoverCrop,
  exportSquareCropJpeg,
  squareCoverScaleK,
} from "../lib/image";
import { cls } from "../lib/utils";

export type PhotoEditDialogProps = {
  file: File;
  onClose: () => void;
  onConfirm: (squareJpegBlob: Blob) => Promise<void> | void;
  /** 정사각 내보내기 한 변(px) — 서버 업로드 전 품질 */
  exportSidePx: number;
  /** 예: 선택한 장 수 안내 */
  queueHint?: string | null;
};

/**
 * 정사각 프레임 미리보기·드래그 패닝·줌·90° 회전 후 JPEG 한 장 확정.
 */
export default function PhotoEditDialog({
  file,
  onClose,
  onConfirm,
  exportSidePx,
  queueHint,
}: PhotoEditDialogProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewPx, setPreviewPx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [decodeErr, setDecodeErr] = useState<string | null>(null);
  const [rotCanvas, setRotCanvas] = useState<HTMLCanvasElement | null>(null);
  const [Rw, setRw] = useState(0);
  const [Rh, setRh] = useState(0);

  const [quarterTurns, setQuarterTurns] = useState<0 | 1 | 2 | 3>(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busyConfirm, setBusyConfirm] = useState(false);

  const dragRef = useRef<{ id: number; lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      setPreviewPx(Math.max(64, Math.floor(w)));
    });
    ro.observe(el);
    setPreviewPx(Math.max(64, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDecodeErr(null);
    void decodeToRotatedCanvas(file, quarterTurns)
      .then((r) => {
        if (cancelled) return;
        setRotCanvas(r.canvas);
        setRw(r.Rw);
        setRh(r.Rh);
        setPan({ x: 0, y: 0 });
      })
      .catch((e) => {
        if (cancelled) return;
        setDecodeErr(e instanceof Error ? e.message : String(e));
        setRotCanvas(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, quarterTurns]);

  useEffect(() => {
    if (!rotCanvas || previewPx < 16 || Rw < 1) return;
    setPan((prev) => {
      const K = squareCoverScaleK(Rw, Rh, previewPx, zoom);
      const c = clampPanForSquareCover(Rw, Rh, K, previewPx, prev.x, prev.y);
      if (c.panX === prev.x && c.panY === prev.y) return prev;
      return { x: c.panX, y: c.panY };
    });
  }, [zoom, rotCanvas, Rw, Rh, previewPx]);

  const redrawPreview = useCallback(() => {
    const canvasEl = canvasRef.current;
    if (!rotCanvas || previewPx < 16 || !canvasEl || Rw < 1 || Rh < 1) return;

    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const side = previewPx;

    canvasEl.style.width = `${side}px`;
    canvasEl.style.height = `${side}px`;
    canvasEl.width = Math.max(1, Math.round(side * dpr));
    canvasEl.height = Math.max(1, Math.round(side * dpr));

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const K = squareCoverScaleK(Rw, Rh, side, zoom);
    const c = clampPanForSquareCover(Rw, Rh, K, side, pan.x, pan.y);
    drawSquareCoverCrop(ctx, rotCanvas, Rw, Rh, side, c.panX, c.panY, zoom);
    if (c.panX !== pan.x || c.panY !== pan.y) {
      queueMicrotask(() => setPan({ x: c.panX, y: c.panY }));
    }
  }, [rotCanvas, previewPx, Rw, Rh, zoom, pan.x, pan.y]);

  useEffect(() => {
    redrawPreview();
  }, [redrawPreview]);

  function bumpRotate() {
    setQuarterTurns((q) => ((q + 1) % 4) as 0 | 1 | 2 | 3);
    setPan({ x: 0, y: 0 });
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (loading || decodeErr || !rotCanvas) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const dr = dragRef.current;
    if (!dr || e.pointerId !== dr.id || !rotCanvas || previewPx < 16 || Rw < 1) return;
    const dx = e.clientX - dr.lastX;
    const dy = e.clientY - dr.lastY;
    dragRef.current = { ...dr, lastX: e.clientX, lastY: e.clientY };
    setPan((prev) => {
      const nx = prev.x + dx;
      const ny = prev.y + dy;
      const K = squareCoverScaleK(Rw, Rh, previewPx, zoom);
      const c = clampPanForSquareCover(Rw, Rh, K, previewPx, nx, ny);
      return { x: c.panX, y: c.panY };
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  async function confirm() {
    if (!rotCanvas || previewPx < 16 || Rw < 1 || busyConfirm) return;
    const K = squareCoverScaleK(Rw, Rh, previewPx, zoom);
    const clamped = clampPanForSquareCover(Rw, Rh, K, previewPx, pan.x, pan.y);
    setBusyConfirm(true);
    try {
      const blobFile = await exportSquareCropJpeg(file, {
        quarterTurns,
        zoom,
        panX: clamped.panX,
        panY: clamped.panY,
        previewSidePx: previewPx,
        outputSidePx: exportSidePx,
        jpegQuality: 0.92,
      });
      await onConfirm(blobFile);
    } catch (err) {
      console.error("[PhotoEditDialog] 확인 처리 실패", err);
      alert(err instanceof Error ? err.message : "사진을 저장하지 못했습니다.");
    } finally {
      setBusyConfirm(false);
    }
  }

  const overlay = (
    <div className="fixed inset-0 z-[210] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={busyConfirm ? undefined : onClose}
        disabled={busyConfirm}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-edit-title"
        className="relative z-[1] flex max-h-[min(94dvh,920px)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl sm:max-h-[min(88vh,860px)] sm:rounded-2xl"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header
          className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-800 px-4 py-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))" }}
        >
          <div className="min-w-0 flex-1">
            <h2 id="photo-edit-title" className="text-base font-bold text-slate-100">
              사진 맞추기
            </h2>
            {queueHint ? (
              <p id="photo-edit-queue-hint" className="mt-1 text-[11px] leading-snug text-slate-500">
                {queueHint}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-100 disabled:opacity-40"
            aria-label="취소"
            disabled={busyConfirm}
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-3 px-4 pb-4 pt-3">
          <p className="text-xs leading-relaxed text-slate-400">
            아래 정사각 프레임 안에 들어가는 장면이{" "}
            <span className="text-slate-200">최종 저장·업로드</span>됩니다. 드래그로 위치, 슬라이더로 확대를
            맞춘 뒤 회전 버튼으로 방향을 바꿀 수 있어요.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            확인 후에는 이 화면에서 만든 JPG를 한 번 더 압축·썸네일까지 만든 다음, 평소처럼 앱 저장소와 클라우드에
            올려요.
          </p>

          <div
            ref={wrapRef}
            className="relative mx-auto aspect-square w-full max-w-[min(100vw-2rem,360px)] select-none rounded-xl bg-slate-900 ring-1 ring-slate-800"
          >
            {decodeErr ? (
              <div className="flex h-full min-h-[200px] items-center justify-center p-4 text-center text-xs text-rose-200">
                {decodeErr}
              </div>
            ) : loading ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
                사진 불러오는 중…
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                aria-hidden
                className={cls(
                  "block h-full w-full touch-none rounded-xl",
                  !busyConfirm ? "cursor-grab active:cursor-grabbing" : "opacity-60",
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span>확대</span>
              <span className="tabular-nums text-slate-500">{zoom.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.02}
              value={zoom}
              disabled={busyConfirm || loading || !!decodeErr}
              onChange={(ev) => {
                const nz = Number(ev.target.value);
                if (!Number.isFinite(nz)) return;
                setZoom(Math.min(3, Math.max(1, nz)));
              }}
              className="w-full accent-brand-500 disabled:opacity-40"
              aria-valuemin={1}
              aria-valuemax={3}
              aria-valuenow={zoom}
              aria-label="확대"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyConfirm || loading || !!decodeErr}
              onClick={bumpRotate}
              className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 py-3 disabled:opacity-40"
              aria-label="90도 회전"
            >
              <RotateCw size={18} aria-hidden />
              회전 90°
            </button>
          </div>
        </div>

        <div
          className="shrink-0 border-t border-slate-800 px-4 py-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <button
            type="button"
            disabled={busyConfirm || loading || !!decodeErr}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-40"
            onClick={() => void confirm()}
          >
            {busyConfirm ? (
              <>
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> 저장 중…
              </>
            ) : (
              <>
                <Check size={18} aria-hidden />
                확인 · 저장
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
