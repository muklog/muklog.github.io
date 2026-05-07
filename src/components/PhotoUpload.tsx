import { useId, useRef, useState, type RefObject } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { compressImage, type CompressOptions } from "../lib/image";
import { cls } from "../lib/utils";

/**
 * 갤러리 전용 입력의 accept.
 *
 * 삼성·크롬 조합에서 MIME 을 촘촘히 나열하면 「작업 선택 → 카메라 / 내 파일 / 사진 및 동영상」처럼
 * 문서 선택용 메뉴로 이어지는 경우가 많습니다. `image/*` 만 두면 Android 13+ 에서
 * 시스템 사진 피커(앨범 그리드)가 바로 뜨는 경우가 많습니다.
 *
 * 「개인 / 업무」는 업무 프로필이 켜져 있으면 OS 가 넣는 단계라 웹에서 제거할 수 없습니다.
 */
const GALLERY_FILE_ACCEPT = "image/*";

interface Props {
  /** 처리 후 호출 - photo / thumbnail 둘 다 압축된 Blob */
  onPicked: (photo: Blob, thumbnail: Blob) => void | Promise<void>;
  /** 갤러리에서 여러 장 선택 허용(순서대로 onPicked 호출) — 카메라 버튼은 기기마다 여전히 한 장만 */
  multipleGallery?: boolean;
  label?: string;
  className?: string;
  /** 기본 카메라 캡처 모드. 갤러리에서 선택도 가능 */
  preferCamera?: boolean;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  /** 기본값보다 크게/선명하게 (건강검진·인바디 등 문서 사진용) */
  compressOptions?: CompressOptions;
  /** 인스타그램처럼 정사각형(가운데 크롭)으로 저장 — 식사 사진에 사용 */
  square?: boolean;
}

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
}: Props) {
  const galleryInputId = useId();
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  async function processOne(file: File) {
    if (!file.size) {
      throw new Error("사진이 아직 준비되지 않았거나 빈 파일입니다. 잠시 후 다시 촬영해 주세요.");
    }
    const compressed = await compressImage(file, {
      maxDimension: 1280,
      quality: 0.85,
      square,
      ...compressOptions,
    });
    const thumb = await compressImage(compressed, {
      maxDimension: 320,
      quality: 0.7,
      square,
    });
    await onPicked(compressed, thumb);
  }

  async function handleFiles(fileList: FileList | File[] | null | undefined) {
    const files = Array.from(fileList ?? []).filter((f) => f && f.size > 0);
    if (files.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        if (files.length > 1) {
          setBusyLabel(`${i + 1}/${files.length}`);
        }
        try {
          await processOne(file);
        } catch (e) {
          console.error("[PhotoUpload] 사진 처리 실패", e, {
            name: file.name,
            size: file.size,
            type: file.type,
          });
          const detail = e instanceof Error ? e.message : String(e);
          alert(
            `이미지를 처리하지 못했습니다.\n${detail}\n\n다시 시도하거나 갤러리에서 JPG/PNG 로 저장한 사진을 선택해 보세요.`,
          );
        }
      }
    } finally {
      setBusy(false);
      setBusyLabel(null);
      if (camRef.current) camRef.current.value = "";
      if (galRef.current) galRef.current.value = "";
    }
  }

  // 같은 사진을 연속으로 선택하면 onChange 가 안 뜨는 iOS 버그 방지 —
  // 클릭 직전에도 value 를 비워 둔다.
  function openPicker(ref: RefObject<HTMLInputElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.value = "";
    el.click();
  }

  const btnClass =
    variant === "primary"
      ? "btn-primary"
      : "btn-secondary";

  const galleryAria =
    multipleGallery === true ? "갤러리에서 선택 (여러 장 가능)" : "갤러리·사진에서 선택";

  return (
    <div className={cls("flex gap-2", className)}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => openPicker(camRef)}
        className={cls(btnClass, "flex-1")}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        {busy ? (busyLabel ? `처리 중… ${busyLabel}` : "처리 중…") : label}
      </button>
      {disabled || busy ? (
        <span
          className="btn-secondary inline-flex cursor-not-allowed items-center justify-center px-3 opacity-50"
          aria-disabled
          aria-label={galleryAria}
        >
          <ImagePlus size={18} />
        </span>
      ) : (
        <label
          htmlFor={galleryInputId}
          className="btn-secondary inline-flex cursor-pointer items-center justify-center px-3"
          aria-label={galleryAria}
          onPointerDown={() => {
            const el = galRef.current;
            if (el) el.value = "";
          }}
        >
          <ImagePlus size={18} />
        </label>
      )}
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture={preferCamera ? "environment" : undefined}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <input
        id={galleryInputId}
        ref={galRef}
        type="file"
        accept={GALLERY_FILE_ACCEPT}
        multiple={multipleGallery}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  );
}
