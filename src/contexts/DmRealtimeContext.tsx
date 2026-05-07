import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { getFirebaseAuth, isFirestoreMobileUa } from "../lib/firebaseApp";
import {
  dmErrorMessageForUi,
  isFirestorePermissionDenied,
  prefetchMyDmThreadsSnapshot,
  subscribeDmDeletedThreadIds,
  subscribeDmReadMap,
  subscribeMyDmThreads,
} from "../lib/dm";
import type { DmThreadDoc } from "../types";

type Ctx = {
  threads: DmThreadDoc[];
  readMap: Map<string, number>;
  /** 내가 목록에서 삭제로 표시한 DM 스레드 id */
  dmDeletedThreadIds: Set<string>;
  threadsListReady: boolean;
  threadsListError: string | null;
  retryDmList: () => void;
};

const DmRealtimeContext = createContext<Ctx | null>(null);

/**
 * 피드(/)·친구(/friends*)·DM(/messages*) 에서 Firestore DM 목록 리스너 활성화.
 * `/` → `/messages` 처럼 shouldListen 이 계속 true 인 동안에는 구독을 유지해
 * 피드에서 곧바로 목록으로 들어와도 캐시된 목록이 비는 레이스를 줄인다.
 * `/messages` 진입 시 prefetch 로 서버 스냅샷을 한 번 더 받는다.
 * 탭이 백그라운드면 shouldListen 가 꺼지며 리스너 정리됨.
 */
export function DmRealtimeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user, firebaseReady, loading: authLoading } = useAuth();
  const myUid = user?.uid;

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const routeWantsDm =
    pathname === "/" ||
    pathname.startsWith("/messages") ||
    pathname.startsWith("/friends");

  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const shouldListen =
    firebaseReady &&
    !!myUid &&
    !authLoading &&
    routeWantsDm &&
    tabVisible;

  const [retryNonce, setRetryNonce] = useState(0);
  const retryDmList = useCallback(() => setRetryNonce((n) => n + 1), []);

  const [threads, setThreads] = useState<DmThreadDoc[]>([]);
  const [readMap, setReadMap] = useState<Map<string, number>>(new Map());
  const [dmDeletedThreadIds, setDmDeletedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadsListReady, setThreadsListReady] = useState(false);
  const [threadsListError, setThreadsListError] = useState<string | null>(null);

  /**
   * `/messages` 목록 화면 — 구독은 그대로 두고 서버 일회 스냅샷으로 먼저 채워 로딩이 길어지지 않게 함.
   * `retryNonce` 가 바뀌면(사용자 재시도) 다시 한 번 받아 목록을 맞춤.
   */
  useEffect(() => {
    if (!firebaseReady || !myUid || authLoading || !shouldListen) return;
    if (pathname !== "/messages") return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await prefetchMyDmThreadsSnapshot(myUid);
        if (cancelled) return;
        setThreadsListError(null);
        /** 구독 웜업이 빈 결과를 줄 수 있는 타이밍에 프리페치가 진짜 목록만 덮도록 */
        setThreads((prev) => {
          if (rows.length > 0) return rows;
          if (prev.length > 0) return prev;
          return rows;
        });
        setThreadsListReady(true);
      } catch (e) {
        if (!cancelled && !isFirestorePermissionDenied(e)) setThreadsListReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, firebaseReady, myUid, authLoading, shouldListen, retryNonce]);

  /** 피드·친구 화면에서 목록이 아직 비었을 때만 서버 스냅샷으로 한 번 채움 → DM 목록으로 곧바로 들어와도 비어 보이지 않게 */
  useEffect(() => {
    if (!firebaseReady || !myUid || authLoading || !shouldListen) return;
    if (!(pathname === "/" || pathname.startsWith("/friends"))) return;
    if (threads.length > 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await prefetchMyDmThreadsSnapshot(myUid);
        if (cancelled || rows.length === 0) return;
        setThreads((prev) => (prev.length > 0 ? prev : rows));
      } catch {
        /* 구독·목록 진입 프리페치로 이어짐 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, firebaseReady, myUid, authLoading, shouldListen, threads.length]);

  useEffect(() => {
    if (!firebaseReady || !myUid || authLoading) {
      setThreads([]);
      setReadMap(new Map());
      setDmDeletedThreadIds(new Set());
      setThreadsListReady(false);
      setThreadsListError(null);
      return;
    }

    if (!shouldListen) {
      return;
    }

    let ua: (() => void) | undefined;
    let ub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const auth = getFirebaseAuth();
      await auth.authStateReady();
      try {
        await getFirebaseAuth().currentUser?.getIdToken(true);
      } catch {
        /* 오프라인 등 */
      }
      await new Promise((r) => setTimeout(r, isFirestoreMobileUa() ? 120 : 60));
      if (cancelled) return;
      const live = getFirebaseAuth().currentUser?.uid;
      if (!live || live !== myUid) {
        if (!cancelled) {
          setThreadsListReady(true);
          setThreadsListError(
            "로그인 세션을 확인할 수 없어요. 새로고침하거나 로그아웃 후 다시 로그인해 주세요.",
          );
        }
        return;
      }

      setThreadsListError(null);
      if (pathnameRef.current !== "/messages") {
        setThreadsListReady(false);
      }
      ua = subscribeMyDmThreads(
        myUid,
        (rows) => {
          setThreads(rows);
          setThreadsListReady(true);
          setThreadsListError(null);
        },
        (e) => {
          setThreadsListReady(true);
          setThreadsListError(dmErrorMessageForUi(e, "threadList"));
        },
      );
      ub = subscribeDmReadMap(myUid, setReadMap, (e) =>
        console.warn("[dmRealtime] read map", e),
      );
    })();

    return () => {
      cancelled = true;
      ua?.();
      ub?.();
    };
  }, [firebaseReady, myUid, authLoading, shouldListen, retryNonce]);

  useEffect(() => {
    if (!firebaseReady || !myUid || authLoading) {
      setDmDeletedThreadIds(new Set());
      return;
    }

    const u = subscribeDmDeletedThreadIds(myUid, setDmDeletedThreadIds, (e) =>
      console.warn("[dmRealtime] dmThreadPrefs", e),
    );
    return () => {
      u();
      setDmDeletedThreadIds(new Set());
    };
  }, [firebaseReady, myUid, authLoading]);

  const value = useMemo<Ctx>(
    () => ({
      threads,
      readMap,
      dmDeletedThreadIds,
      threadsListReady,
      threadsListError,
      retryDmList,
    }),
    [threads, readMap, dmDeletedThreadIds, threadsListReady, threadsListError, retryDmList],
  );

  return (
    <DmRealtimeContext.Provider value={value}>{children}</DmRealtimeContext.Provider>
  );
}

export function useDmRealtime(): Ctx {
  const ctx = useContext(DmRealtimeContext);
  if (!ctx) throw new Error("useDmRealtime는 DmRealtimeProvider 안에서만 사용할 수 있습니다.");
  return ctx;
}
