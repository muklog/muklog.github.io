import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { compressImage, type CompressOptions } from "../lib/image";
import { cls } from "../lib/utils";

interface Props {
  /** 처리 후 호출 - photo / thumbnail 둘 다 압축된 Blob */
  onPicked: (photo: Blob, thumbnail: Blob) => void | Promise<void>;
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
  label = "사진 업로드",
  className,
  preferCamera = true,
  variant = "primary",
  disabled,
  compressOptions,
  square = false,
}: Props) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setBusy(true);
    try {
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
    } catch (e) {
      console.error("[PhotoUpload] 사진 처리 실패", e, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
      const detail = e instanceof Error ? e.message : String(e);
      alert(`이미지를 처리하지 못했습니다.\n${detail}\n\n다시 시도하거나 갤러리에서 JPG/PNG 로 저장한 사진을 선택해 보세요.`);
    } finally {
      setBusy(false);
      if (camRef.current) camRef.current.value = "";
      if (galRef.current) galRef.current.value = "";
    }
  }

  // 같은 사진을 연속으로 선택하면 onChange 가 안 뜨는 iOS 버그 방지 —
  // 클릭 직전에도 value 를 비워 둔다.
  function openPicker(ref: React.RefObject<HTMLInputElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.value = "";
    el.click();
  }

  const btnClass =
    variant === "primary"
      ? "btn-primary"
      : "btn-secondary";

  return (
    <div className={cls("flex gap-2", className)}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => openPicker(camRef)}
        className={cls(btnClass, "flex-1")}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        {busy ? "처리 중…" : label}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => openPicker(galRef)}
        className="btn-secondary"
        aria-label="갤러리에서 선택"
      >
        <ImagePlus size={18} />
      </button>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture={preferCamera ? "environment" : undefined}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={galRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
