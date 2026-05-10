import { useCallback, useEffect, useState, type RefCallback } from "react";
import type { MealItem } from "../types";
import { blobFromStoragePath } from "../lib/userMediaStorage";
import { isRenderableImageBlob } from "../lib/image";
import { useBlobImgSrc } from "./useBlobImgSrc";

/**
 * 피드 등에서 Storage 경로만 있는 항목은 뷰포트 근처일 때 썸네일 Blob 한 번만 받는다.
 * (storedToMeal 즉시 getBlob 시 항목당 2회 × 프리플라이트로 요청 폭증하는 것을 방지)
 */
export function useMealItemCardImageSrc(item: MealItem): {
  src: string | undefined;
  pending: boolean;
  onImgError: () => void;
  wrapRef: RefCallback<HTMLDivElement>;
} {
  const existing = item.photo || item.thumbnail;
  const mayDefer =
    !isRenderableImageBlob(existing) &&
    !!(item.thumbStoragePath || item.photoStoragePath);

  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [shouldFetch, setShouldFetch] = useState(false);
  const [fetchedBlob, setFetchedBlob] = useState<Blob | undefined>();
  /** 경로 지연 로드 시도 완료(IO 미통과·성공·실패 포함 최종) */
  const [deferDone, setDeferDone] = useState(() => !mayDefer);

  const wrapRef = useCallback((el: HTMLDivElement | null) => {
    setRootEl(el);
  }, []);

  useEffect(() => {
    setFetchedBlob(undefined);
    setShouldFetch(false);
    setDeferDone(!mayDefer);
  }, [mayDefer, item.id, item.thumbStoragePath, item.photoStoragePath]);

  useEffect(() => {
    if (!mayDefer || !rootEl) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setShouldFetch(true);
      },
      { rootMargin: "420px 0px", threshold: 0 },
    );
    obs.observe(rootEl);
    return () => obs.disconnect();
  }, [mayDefer, item.id, rootEl]);

  useEffect(() => {
    if (!shouldFetch || !mayDefer) return;
    const path = item.thumbStoragePath || item.photoStoragePath;
    if (!path) {
      setDeferDone(true);
      return;
    }
    let cancelled = false;
    void blobFromStoragePath(path)
      .then((b) => {
        if (!cancelled && isRenderableImageBlob(b)) setFetchedBlob(b);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDeferDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch, mayDefer, item.thumbStoragePath, item.photoStoragePath, item.id]);

  const displayBlob = isRenderableImageBlob(existing) ? existing : fetchedBlob;
  const blobHook = useBlobImgSrc(displayBlob);

  const pending = blobHook.pending || (mayDefer && !deferDone);

  return { src: blobHook.src, pending, onImgError: blobHook.onImgError, wrapRef };
}
