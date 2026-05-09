import { useCallback, useEffect, useRef, useState } from "react";
import { browserPrefersDataUrlForBlobImages } from "../lib/filePickerCapabilities";
import { blobToDataUrl, blobUrl, isRenderableImageBlob } from "../lib/image";

/**
 * IndexedDB Blob 을 `<img src>` 로 쓸 때,
 * 삼성 인터넷 등에서 `blob:` 디코드 실패를 피하기 위해 data URL 을 쓰거나 onError 시 한 번 폴백한다.
 */
export function useBlobImgSrc(blob: Blob | undefined): {
  src: string | undefined;
  /** 삼성 등에서 data URL 비동기 변환 중 */
  pending: boolean;
  onImgError: () => void;
} {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const dataFallbackTried = useRef(false);

  useEffect(() => {
    dataFallbackTried.current = false;
    let cancelled = false;

    if (!isRenderableImageBlob(blob)) {
      setSrc(undefined);
      setPending(false);
      return;
    }

    if (browserPrefersDataUrlForBlobImages()) {
      setPending(true);
      void blobToDataUrl(blob)
        .then((d) => {
          if (!cancelled) {
            setSrc(d);
            setPending(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSrc(blobUrl(blob));
            setPending(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setPending(false);
    setSrc(blobUrl(blob));
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const onImgError = useCallback(() => {
    if (!blob || !isRenderableImageBlob(blob) || dataFallbackTried.current) return;
    dataFallbackTried.current = true;
    void blobToDataUrl(blob)
      .then((d) => setSrc(d))
      .catch(() => setSrc(undefined));
  }, [blob]);

  return { src, pending, onImgError };
}
