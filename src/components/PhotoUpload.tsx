import { Fragment, useId, useRef, useState, type RefObject } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { compressImage, type CompressOptions } from "../lib/image";
import { shouldOmitCaptureOnFileInputs } from "../lib/filePickerCapabilities";
import { cls } from "../lib/utils";
import PhotoEditDialog from "./PhotoEditDialog";

const GALLERY_FILE_ACCEPT = "image/*";

interface Props {
  /** 처리 후 호출 - photo / thumbnail 둘 다 압축된 Blob */
  onPicked: (photo: Blob, thumbnail: Blob) => void | Promise<void>;
  /** 갤러리에서 여러 장 선택 허용(순서대로 onPicked 호출) */
  multipleGallery?: boolean;
  label?: string;
  className?: string;
  /** 기본 촬영 의도 (`capture`). 삼성 인터넷만 오류 회피로 생략(갤러리 버튼 사용 권장). */
  preferCamera?: boolean;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  compressOptions?: CompressOptions;
  /** true 면 가운데 정사각 자동 크롭(편집기 끌 때만 사용). */
  square?: boolean;
  /**
   * true(기본)면 촬영·선택 후 정사각 맞춤 화면을 거친 뒤 업로드합니다.
   * false면 예전처럼 바로 압축합니다(건강 기록 등 원본 비율 유지).
   */
  squareCropEditor?: boolean;
  /** 편집 후 정사각 JPEG 한 변(px). 기본은 compressOptions.maxDimension 기준(960~2048). */
  squareCropExportSidePx?: number;
}

function clearInputs(refs: Array<RefObject<HTMLInputElement | null>>) {
  for (const r of refs) {
    if (r.current) r.current.value = "";
  }
}

function clearInput(el: HTMLInputElement | null) {
  if (el) el.value = "";
}

/** 카메라 앱에서 돌아온 직후 `document.hidden` 인 동안은 파일 버퍼가 비어 있는 경우가 많다. */
function waitUntilDocumentVisible(timeoutMs = 12_000): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(timer);
      resolve();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    document.addEventListener("visibilitychange", onVis);
  });
}

async function readFileAsNonEmptyBuffer(file: File): Promise<ArrayBuffer | null> {
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength > 0) return buf;
  } catch {
    /* 일부 WebView 에서 첫 arrayBuffer 만 실패하는 경우 */
  }
  return await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      const r = fr.result;
      resolve(r instanceof ArrayBuffer && r.byteLength > 0 ? r : null);
    };
    fr.onerror = () => resolve(null);
    try {
      fr.readAsArrayBuffer(file);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 카메라(WebView·모바일 크롬)에서는 촬영 직후 `size`만 갱신되고 `arrayBuffer()`가 비었다가
 * 늦게 채워지는 경우가 있다. 원본 File 핸들을 그대로 넘기지 않고, 읽기에 성공한 바이트로만 File을 만든다.
 */
async function coerceFileToReadableImage(file: File): Promise<File | null> {
  const steps = [0, 50, 120, 280, 500, 800, 1200, 1800, 2600, 3500, 5000, 7000];
  const mime = file.type && file.type.length > 0 ? file.type : "image/jpeg";
  const name = file.name || "photo.jpg";

  for (let i = 0; i < steps.length; i++) {
    const ms = steps[i]!;
    if (ms > 0) {
      await new Promise<void>((r) => setTimeout(r, ms));
    }
    try {
      const buf = await readFileAsNonEmptyBuffer(file);
      if (buf && buf.byteLength > 0) {
        return new File([buf], name, { type: mime });
      }
    } catch (e) {
      if (i === steps.length - 1) {
        console.warn("[PhotoUpload] 카메라·앨범 파일 읽기 실패", e);
      }
    }
  }
  return null;
}

/** 편집 큐용: 메모리에 고정된 한 벌의 바이트 (카메라 핸들 타이밍 이슈 완화) */
function snapshotFilePixels(file: File): Promise<File | null> {
  return coerceFileToReadableImage(file);
}

function emptyPhotoMessage(): string {
  const samsung = shouldOmitCaptureOnFileInputs();
  const tail = samsung
    ? "삼성 인터넷 등에서는 가끔 카메라 직후 파일이 비어 보일 수 있어요.\n\n• 오른쪽 앨범 버튼에서 방금 찍은 사진을 고르거나\n• 다시 촬영해 보세요."
    : "일부 브라우저에서 카메라·앨범 연결 직후 파일이 비어 있을 수 있어요.\n\n• 앨범에서 같은 사진을 다시 선택하거나\n• 한 번 더 촬영해 보세요.";
  return `사진을 불러오지 못했습니다.\n\n${tail}`;
}

/** 숨김은 display:none 대신 sr-only + label htmlFor 로 직연결 */
export default function PhotoUpload({
  onPicked,
  multipleGallery = false,
  label = "사진 업로드",
  className,
  preferCamera = true,
  variant = "primary",
  disabled,
  compressOptions,
  square = false,
  squareCropEditor = true,
  squareCropExportSidePx: squareCropExportSidePxProp,
}: Props) {
  const omitCapture = shouldOmitCaptureOnFileInputs();
  const camInputId = useId();
  const galInputId = useId();
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [editorQueue, setEditorQueue] = useState<File[]>([]);

  const useEditor = squareCropEditor === true;
  const maxDim = compressOptions?.maxDimension ?? 1280;
  const squareCropExportSidePx = Math.min(
    2048,
    Math.max(960, squareCropExportSidePxProp ?? Math.min(Math.max(maxDim, 960), 2048)),
  );

  /** 빈 capture(카메라 의도) — environment 는 일부 브라우저에서 갤러리만 뜸. 삼성 인터넷만 속성 생략. */
  const captureProp = !preferCamera || omitCapture ? undefined : true;

  /** 편집 후 압축·DB 반영이 간헐적으로 실패하는 기기용 짧은 재시도 */
  async function finishEditedSquare(squareJpegBlob: Blob) {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise<void>((r) => setTimeout(r, 160 * attempt));
        }
        const compressed = await compressImage(squareJpegBlob, {
          maxDimension: 1280,
          quality: 0.85,
          square: false,
          ...compressOptions,
        });
        const thumb = await compressImage(compressed, {
          maxDimension: 320,
          quality: 0.7,
          square: false,
        });
        await onPicked(compressed, thumb);
        return;
      } catch (e) {
        last = e;
        console.warn("[PhotoUpload] finishEditedSquare 재시도", attempt + 1, e);
      }
    }
    throw last instanceof Error ? last : new Error(String(last ?? "저장 실패"));
  }

  async function processOne(file: File) {
    const usable = await coerceFileToReadableImage(file);
    if (!usable || !usable.size) {
      throw new Error("사진이 아직 준비되지 않았거나 빈 파일입니다. 잠시 후 다시 선택해 주세요.");
    }
    const compressed = await compressImage(usable, {
      maxDimension: 1280,
      quality: 0.85,
      square: useEditor ? false : square,
      ...compressOptions,
    });
    const thumb = await compressImage(compressed, {
      maxDimension: 320,
      quality: 0.7,
      square: useEditor ? false : square,
    });
    await onPicked(compressed, thumb);
  }

  async function handleFiles(
    fileList: FileList | File[] | null | undefined,
    clearRefs: Array<RefObject<HTMLInputElement | null>>,
  ) {
    const raw = Array.from(fileList ?? []).filter(Boolean) as File[];
    if (raw.length === 0) return;

    // 카메라 앱 복귀 직후 change 이벤트가 빈 상태로 도는 브라우저용 추가 틱
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    await waitUntilDocumentVisible();

    setBusy(true);
    try {
      const prepared: File[] = [];
      for (const f of raw) {
        if (useEditor) {
          const s = await snapshotFilePixels(f);
          if (s && s.size > 0) prepared.push(s);
        } else {
          const c = await coerceFileToReadableImage(f);
          if (c && c.size > 0) prepared.push(c);
        }
      }

      if (prepared.length === 0) {
        if (raw.length > 0) {
          alert(emptyPhotoMessage());
        }
        return;
      }

      if (useEditor) {
        setEditorQueue(prepared);
      } else {
        for (let i = 0; i < prepared.length; i++) {
          const file = prepared[i]!;
          if (prepared.length > 1) setBusyLabel(`${i + 1}/${prepared.length}`);
          try {
            await processOne(file);
          } catch (e) {
            console.error("[PhotoUpload] 사진 처리 실패", e, {
              name: file.name,
              size: file.size,
              type: file.type,
              omitCapture,
            });
            const detail = e instanceof Error ? e.message : String(e);
            alert(
              `이미지를 처리하지 못했습니다.\n${detail}\n\n다른 방법으로 같은 사진을 다시 선택하거나 JPG/PNG 로 저장된 뒤 시도해 보세요.`,
            );
          }
        }
      }
    } catch (e) {
      console.error("[PhotoUpload] handleFiles 예외", e);
      const detail = e instanceof Error ? e.message : String(e);
      alert(`사진을 불러오는 중 오류가 났습니다.\n${detail}\n\n앨범에서 같은 사진을 다시 고르거나 잠시 후 촬영을 다시 시도해 주세요.`);
    } finally {
      setBusy(false);
      setBusyLabel(null);
      clearInputs(clearRefs);
    }
  }

  const btnClass = variant === "primary" ? "btn-primary" : "btn-secondary";
  const galleryAria =
    multipleGallery === true ? "갤러리에서 선택 (여러 장 가능)" : "사진 선택·앨범에서 가져오기";

  const blocked = !!(disabled || busy);
  const editorFile = editorQueue[0];
  const editorOpen = useEditor && editorQueue.length > 0;

  return (
    <Fragment>
      {editorOpen && editorFile ? (
        <PhotoEditDialog
          key={`${editorFile.name}-${editorFile.size}-${editorFile.lastModified}-${editorQueue.length}`}
          file={editorFile}
          exportSidePx={squareCropExportSidePx}
          onClose={() => {
            setEditorQueue([]);
          }}
          onConfirm={async (blob) => {
            try {
              await finishEditedSquare(blob);
              setEditorQueue((q) => q.slice(1));
            } catch (e) {
              console.error("[PhotoUpload] 편집 후 처리 실패", e);
              const detail = e instanceof Error ? e.message : String(e);
              alert(`이미지를 저장하지 못했습니다.\n${detail}\n\n잠시 후 확인을 다시 눌러 주세요.`);
            }
          }}
        />
      ) : null}
      <div className={cls("flex gap-2", className)}>
      <label
        htmlFor={camInputId}
        onPointerDown={() => clearInput(camRef.current)}
        className={cls(
          btnClass,
          "flex flex-1 cursor-pointer items-center justify-center gap-2 py-3",
          blocked && "pointer-events-none opacity-55",
        )}
        aria-label={omitCapture ? `${label}(카메라 포함 기기 선택)` : `${label}(촬영)`}
      >
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Camera size={18} aria-hidden />}
        {busy ? (busyLabel ? `처리 중… ${busyLabel}` : "처리 중…") : label}
      </label>
      <label
        htmlFor={galInputId}
        className={cls(
          "btn-secondary inline-flex shrink-0 cursor-pointer items-center justify-center px-3 py-3",
          blocked && "pointer-events-none opacity-55",
        )}
        aria-label={galleryAria}
        title={galleryAria}
        onPointerDown={() => clearInput(galRef.current)}
      >
        <ImagePlus size={18} aria-hidden />
      </label>
      <input
        ref={camRef}
        id={camInputId}
        type="file"
        accept={GALLERY_FILE_ACCEPT}
        {...(captureProp !== undefined ? { capture: captureProp } : {})}
        disabled={blocked}
        className="sr-only"
        onPointerDown={() => clearInput(camRef.current)}
        onChange={(e) => void handleFiles(e.target.files, [camRef])}
      />
      <input
        ref={galRef}
        id={galInputId}
        type="file"
        accept={GALLERY_FILE_ACCEPT}
        multiple={multipleGallery}
        disabled={blocked}
        className="sr-only"
        onPointerDown={() => clearInput(galRef.current)}
        onChange={(e) => void handleFiles(e.target.files, [galRef])}
      />
    </div>
    </Fragment>
  );
}
