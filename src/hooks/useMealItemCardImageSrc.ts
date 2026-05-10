import { useCallback, useEffect, useState, type RefCallback } from "react";
import type { MealItem } from "../types";
import {
  blobFromStoragePath,
  getDownloadUrlForStoragePath,
} from "../lib/userMediaStorage";
import { isRenderableImageBlob } from "../lib/image";
import { useBlobImgSrc } from "./useBlobImgSrc";

/** 뷰포트 밖도 넉넉히 미리 받기 — 너무 크면 동시 요청만 늘어남 */
const IO_ROOT_MARGIN = "900px 0px";

const noopRef: RefCallback<HTMLDivElement> = () => {};

export interface UseMealItemCardImageSrcOptions {
  /** true 면 IntersectionObserver 를 기다리지 않고 바로 다운로드 URL 요청 (피드 상단 카드용) */
  eagerImage?: boolean;
}

/**
 * Storage 경로만 있는 항목: getDownloadURL 로 `<img src>` 에 맞춰 빠르게 표시하고,
 * 실패 시에만 getBlob 폴백. 뷰포트 근처일 때만 요청해 네트워크 폭주는 피한다.
 */
export function useMealItemCardImageSrc(
  item: MealItem,
  options?: UseMealItemCardImageSrcOptions,
): {
  src: string | undefined;
  pending: boolean;
  onImgError: () => void;
  wrapRef: RefCallback<HTMLDivElement>;
} {
  const eagerImage = options?.eagerImage === true;
  const existing = item.photo || item.thumbnail;
  const hasRenderableBlob = isRenderableImageBlob(existing);
  const mayDefer =
    !hasRenderableBlob && !!(item.thumbStoragePath || item.photoStoragePath);

  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [shouldFetch, setShouldFetch] = useState(() => Boolean(eagerImage && mayDefer));
  const [urlSrc, setUrlSrc] = useState<string | undefined>();
  const [blobFb, setBlobFb] = useState<Blob | undefined>();
  const [storageFetchDone, setStorageFetchDone] = useState(() => !mayDefer);

  const wrapRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (mayDefer && !eagerImage) setRootEl(el);
    },
    [mayDefer, eagerImage],
  );

  const path = item.thumbStoragePath || item.photoStoragePath;

  useEffect(() => {
    setUrlSrc(undefined);
    setBlobFb(undefined);
    setStorageFetchDone(!mayDefer);
    setShouldFetch(Boolean(eagerImage && mayDefer));
  }, [mayDefer, eagerImage, item.id, item.thumbStoragePath, item.photoStoragePath]);

  useEffect(() => {
    if (!mayDefer || eagerImage || !rootEl) return;
    setShouldFetch(false);
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setShouldFetch(true);
      },
      { rootMargin: IO_ROOT_MARGIN, threshold: 0 },
    );
    obs.observe(rootEl);

    const checkVisible = () => {
      const r = rootEl.getBoundingClientRect();
      const m = 900;
      const vh = window.innerHeight;
      if (r.bottom > -m && r.top < vh + m) setShouldFetch(true);
    };
    checkVisible();
    const raf = requestAnimationFrame(() => requestAnimationFrame(checkVisible));

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [mayDefer, eagerImage, item.id, rootEl]);

  useEffect(() => {
    if (!mayDefer || !shouldFetch || !path) return;
    let cancelled = false;
    setStorageFetchDone(false);
    setUrlSrc(undefined);
    setBlobFb(undefined);

    void (async () => {
      try {
        const u = await getDownloadUrlForStoragePath(path);
        if (!cancelled) setUrlSrc(u);
      } catch {
        try {
          const b = await blobFromStoragePath(path);
          if (!cancelled && isRenderableImageBlob(b)) setBlobFb(b);
        } catch {
          /* 사진 없음 */
        }
      } finally {
        if (!cancelled) setStorageFetchDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mayDefer, shouldFetch, path, item.id]);

  const blobHook = useBlobImgSrc(hasRenderableBlob ? existing : blobFb);
  const src = hasRenderableBlob ? blobHook.src : urlSrc ?? blobHook.src;

  const pending = mayDefer
    ? !shouldFetch || !storageFetchDone || blobHook.pending
    : blobHook.pending;

  const storagePathForError = path;

  const onImgError = useCallback(() => {
    if (storagePathForError && urlSrc && !blobFb) {
      setUrlSrc(undefined);
      void blobFromStoragePath(storagePathForError)
        .then((b) => {
          if (isRenderableImageBlob(b)) setBlobFb(b);
        })
        .catch(() => {});
      return;
    }
    blobHook.onImgError();
  }, [storagePathForError, urlSrc, blobFb, blobHook]);

  const wrapRefOut = mayDefer && !eagerImage ? wrapRef : noopRef;

  return { src, pending, onImgError, wrapRef: wrapRefOut };
}
