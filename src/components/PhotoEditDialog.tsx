import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Proportions, RotateCcw, RotateCw, X } from "lucide-react";
import {
  clampPanForSquareCover,
  decodeImage,
  drawSquareCoverCrop,
  exportSquareCropJpeg,
  rotatedSourceCanvas,
  squareCoverScaleK,
  type DecodedImage,
} from "../lib/image";
import { cls } from "../lib/utils";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3.75;
/** 미리보기 캔버스 백킹스토어 — 선명도(용량·GPU 부담과 타협) */
const PREVIEW_DPR_CAP = 3;

export type PhotoEditDialogProps = {
  file: File;
  onClose: () => void;
  onConfirm: (squareJpegBlob: Blob) => Promise<void> | void;
  /** 정사각 내보내기 한 변(px) — 서버 업로드 전 품질 */
  exportSidePx: number;
  /** 예: 선택한 장 수 안내 */
  queueHint?: string | null;
};

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function touchMidLocal(a: Touch, b: Touch, el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const mx = (a.clientX + b.clientX) / 2 - r.left;
  const my = (a.clientY + b.clientY) / 2 - r.top;
  const sx = r.width > 0 ? el.clientWidth / r.width : 1;
  const sy = r.height > 0 ? el.clientHeight / r.height : 1;
  return { x: mx * sx, y: my * sy };
}

function touchLocal(t: Touch, el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const x = t.clientX - r.left;
  const y = t.clientY - r.top;
  const sx = r.width > 0 ? el.clientWidth / r.width : 1;
  const sy = r.height > 0 ? el.clientHeight / r.height : 1;
  return { x: x * sx, y: y * sy };
}

/**
 * 정사각 프레임 미리보기·드래그·핀치 줌·좌우 90° 회전 후 확인.
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
  const decodedRef = useRef<DecodedImage | null>(null);
  const [previewPx, setPreviewPx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [decodeErr, setDecodeErr] = useState<string | null>(null);
  const [rotCanvas, setRotCanvas] = useState<HTMLCanvasElement | null>(null);
  const [Rw, setRw] = useState(0);
  const [Rh, setRh] = useState(0);

  const [quarterTurns, setQuarterTurns] = useState<0 | 1 | 2 | 3>(0);
  const [decodedGeneration, setDecodedGeneration] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busyConfirm, setBusyConfirm] = useState(false);

  const dragRef = useRef<{ id: number; lastX: number; lastY: number } | null>(null);

  const previewPxRef = useRef(previewPx);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const RwRef = useRef(Rw);
  const RhRef = useRef(Rh);
  const busyRef = useRef(busyConfirm);
  previewPxRef.current = previewPx;
  zoomRef.current = zoom;
  panRef.current = pan;
  RwRef.current = Rw;
  RhRef.current = Rh;
  busyRef.current = busyConfirm;

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

  /** 파일 바뀔 때만 디코드(회전은 아래 동기 처리). */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDecodeErr(null);
    setRotCanvas(null);
    setZoom(MIN_ZOOM);
    decodedRef.current?.dispose();
    decodedRef.current = null;

    void decodeImage(file)
      .then((d) => {
        if (cancelled) {
          d.dispose();
          return;
        }
        decodedRef.current = d;
        setQuarterTurns(0);
        setPan({ x: 0, y: 0 });
        setDecodedGeneration((g) => g + 1);
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
      decodedRef.current?.dispose();
      decodedRef.current = null;
    };
  }, [file]);

  /** 디코드 직후 + 회전 시: 페인트 전에 회전 캔버스 반영. */
  useLayoutEffect(() => {
    const d = decodedRef.current;
    if (!d) return;
    const rot = rotatedSourceCanvas(d.source, d.width, d.height, quarterTurns);
    setRotCanvas(rot);
    setRw(rot.width);
    setRh(rot.height);
  }, [decodedGeneration, quarterTurns]);

  useLayoutEffect(() => {
    if (loading || !rotCanvas) return;
    const el = wrapRef.current;
    if (!el) return;
    const w = Math.max(64, Math.floor(el.getBoundingClientRect().width));
    setPreviewPx((p) => (p === w ? p : w));
  }, [loading, rotCanvas, quarterTurns]);

  useEffect(() => {
    if (!rotCanvas || previewPx < 16 || Rw < 1) return;
    setPan((prev) => {
      const K = squareCoverScaleK(Rw, Rh, previewPx, zoom);
      const c = clampPanForSquareCover(Rw, Rh, K, previewPx, prev.x, prev.y);
      if (c.panX === prev.x && c.panY === prev.y) return prev;
      return { x: c.panX, y: c.panY };
    });
  }, [rotCanvas, Rw, Rh, previewPx, zoom]);

  const redrawPreview = useCallback(() => {
    const canvasEl = canvasRef.current;
    if (!rotCanvas || previewPx < 16 || !canvasEl || Rw < 1 || Rh < 1) return;

    const dpr =
      typeof window !== "undefined"
        ? Math.min(PREVIEW_DPR_CAP, Math.max(1, window.devicePixelRatio || 1))
        : 1;
    const side = previewPx;

    canvasEl.style.width = `${side}px`;
    canvasEl.style.height = `${side}px`;
    canvasEl.width = Math.max(1, Math.round(side * dpr));
    canvasEl.height = Math.max(1, Math.round(side * dpr));

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
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

  /** 터치: 한 손가락 이동·두 손가락 핀치(별도 슬라이더 없음). passive: false 로 스크롤·줌 간섭 방지. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading || decodeErr || !rotCanvas) return;

    type Pinch = {
      startDist: number;
      startZoom: number;
      startPan: { x: number; y: number };
      cx: number;
      cy: number;
      side: number;
    };
    let pinch: Pinch | null = null;
    let panTouchId: number | null = null;
    let lastPan = { x: 0, y: 0 };

    const sideOrMeasure = () => {
      const p = previewPxRef.current;
      if (p >= 16) return p;
      const r = canvas.getBoundingClientRect();
      return Math.max(64, Math.floor(r.width));
    };

    const onTouchStart = (e: TouchEvent) => {
      if (busyRef.current) return;
      if (e.touches.length === 2) {
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        const d = touchDistance(t0, t1);
        if (d < 8) return;
        panTouchId = null;
        const side = sideOrMeasure();
        const { x: cx, y: cy } = touchMidLocal(t0, t1, canvas);
        pinch = {
          startDist: d,
          startZoom: zoomRef.current,
          startPan: { ...panRef.current },
          cx,
          cy,
          side,
        };
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
        pinch = null;
        const t = e.touches[0]!;
        panTouchId = t.identifier;
        const loc = touchLocal(t, canvas);
        lastPan = { x: loc.x, y: loc.y };
        e.preventDefault();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (busyRef.current) return;
      const Rw0 = RwRef.current;
      const Rh0 = RhRef.current;
      if (Rw0 < 1) return;

      if (e.touches.length >= 2 && pinch) {
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        const d = touchDistance(t0, t1);
        if (d < 2) return;
        const ratio = d / pinch.startDist;
        let nextZ = pinch.startZoom * ratio;
        nextZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZ));
        const side = pinch.side;
        const K0 = squareCoverScaleK(Rw0, Rh0, side, pinch.startZoom);
        const K1 = squareCoverScaleK(Rw0, Rh0, side, nextZ);
        const { cx, cy } = pinch;
        const half = side / 2;
        const vx = (cx - half - pinch.startPan.x) / K0;
        const vy = (cy - half - pinch.startPan.y) / K0;
        let nextPanX = cx - half - vx * K1;
        let nextPanY = cy - half - vy * K1;
        const clamped = clampPanForSquareCover(Rw0, Rh0, K1, side, nextPanX, nextPanY);
        setZoom(nextZ);
        setPan({ x: clamped.panX, y: clamped.panY });
        e.preventDefault();
        return;
      }

      if (e.touches.length === 1 && panTouchId !== null && !pinch) {
        const t = Array.from(e.touches).find((x) => x.identifier === panTouchId);
        if (!t) return;
        const loc = touchLocal(t, canvas);
        const side = sideOrMeasure();
        const dx = loc.x - lastPan.x;
        const dy = loc.y - lastPan.y;
        lastPan = { x: loc.x, y: loc.y };
        setPan((prev) => {
          const K = squareCoverScaleK(Rw0, Rh0, side, zoomRef.current);
          const c = clampPanForSquareCover(Rw0, Rh0, K, side, prev.x + dx, prev.y + dy);
          return { x: c.panX, y: c.panY };
        });
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) panTouchId = null;
    };

    const opts: AddEventListenerOptions = { passive: false };
    canvas.addEventListener("touchstart", onTouchStart, opts);
    canvas.addEventListener("touchmove", onTouchMove, opts);
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [loading, decodeErr, rotCanvas]);

  function resetToOriginalView() {
    if (decodeErr || !decodedRef.current || busyConfirm || loading) return;
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }

  function rotateBy(delta: 1 | -1) {
    if (decodeErr || !decodedRef.current) return;
    setQuarterTurns((q) => ((((q + delta) % 4) + 4) % 4) as 0 | 1 | 2 | 3);
    setPan({ x: 0, y: 0 });
  }

  /** 마우스·펜: 한 손가락 드래그와 동일 */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (loading || decodeErr || !rotCanvas) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const dr = dragRef.current;
    if (!dr || e.pointerId !== dr.id || !rotCanvas || previewPx < 16 || Rw < 1) return;
    const dx = e.clientX - dr.lastX;
    const dy = e.clientY - dr.lastY;
    dragRef.current = { ...dr, lastX: e.clientX, lastY: e.clientY };
    setPan((prev) => {
      const K = squareCoverScaleK(Rw, Rh, previewPx, zoom);
      const c = clampPanForSquareCover(Rw, Rh, K, previewPx, prev.x + dx, prev.y + dy);
      return { x: c.panX, y: c.panY };
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  async function confirm() {
    if (busyConfirm) return;

    const el = wrapRef.current;
    const measured = el ? Math.max(64, Math.floor(el.getBoundingClientRect().width)) : 0;
    const side = Math.max(previewPx, measured, 64);

    if (!rotCanvas || Rw < 1 || Rh < 1) {
      alert("사진이 아직 화면에 준비되지 않았어요. 잠시 후 다시 눌러 주세요.");
      return;
    }

    const pxUsed = previewPx >= 16 ? previewPx : side;
    const panScale = side / pxUsed;
    const panForExportX = pan.x * panScale;
    const panForExportY = pan.y * panScale;

    const K = squareCoverScaleK(Rw, Rh, side, zoom);
    const clamped = clampPanForSquareCover(Rw, Rh, K, side, panForExportX, panForExportY);

    setBusyConfirm(true);
    try {
      const blobFile = await exportSquareCropJpeg(file, {
        quarterTurns,
        zoom,
        panX: clamped.panX,
        panY: clamped.panY,
        previewSidePx: side,
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-4 px-4 pb-4 pt-3">
          <p className="text-xs leading-relaxed text-slate-400">
            정사각 안에 보이는 부분이 그대로 올라가요.{" "}
            <span className="text-slate-200">한 손가락으로 밀어 위치</span>를 맞추고,{" "}
            <span className="text-slate-200">두 손가락으로 확대·축소</span>할 수 있어요.
            「원본 크기」는 처음에 맞춰 둔 기본 줌과 가운데로 되돌려요.
          </p>

          <div
            ref={wrapRef}
            className="relative mx-auto aspect-square w-full max-w-[min(100vw-2rem,360px)] overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800 shadow-inner"
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
                className={cls(
                  "block h-full w-full touch-none rounded-xl select-none",
                  !busyConfirm ? "cursor-grab active:cursor-grabbing" : "pointer-events-none opacity-60",
                )}
                aria-label="사진 미리보기. 드래그로 이동, 두 손가락으로 확대 축소"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-slate-800/90 bg-slate-900/30 p-2.5">
            <p className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              보기
            </p>
            <button
              type="button"
              disabled={busyConfirm || loading || !!decodeErr}
              onClick={resetToOriginalView}
              className="btn-secondary flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium disabled:opacity-40"
              aria-label="확대 맞춤을 처음 크기와 가운데 위치로 되돌리기"
            >
              <Proportions size={18} aria-hidden />
              원본 크기
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busyConfirm || loading || !!decodeErr}
                onClick={() => rotateBy(-1)}
                className="btn-secondary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-3 text-sm disabled:opacity-40"
                aria-label="반시계 방향으로 90도 회전"
              >
                <RotateCcw size={18} aria-hidden className="shrink-0" />
                <span>왼쪽</span>
              </button>
              <button
                type="button"
                disabled={busyConfirm || loading || !!decodeErr}
                onClick={() => rotateBy(1)}
                className="btn-secondary inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-3 text-sm disabled:opacity-40"
                aria-label="시계 방향으로 90도 회전"
              >
                <RotateCw size={18} aria-hidden className="shrink-0" />
                <span>오른쪽</span>
              </button>
            </div>
          </div>
        </div>

        <div
          className="shrink-0 border-t border-slate-800 px-4 pt-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <button
            type="button"
            disabled={busyConfirm || loading || !!decodeErr || !rotCanvas || Rw < 1 || Rh < 1}
            className="btn-primary mb-3 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-medium disabled:opacity-40 sm:py-4"
            onClick={() => void confirm()}
          >
            {busyConfirm ? (
              <>
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
                처리 중…
              </>
            ) : (
              <>
                <Check size={18} aria-hidden />
                확인
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
