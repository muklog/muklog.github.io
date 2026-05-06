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
import { getFirebaseAuth } from "../lib/firebaseApp";
import {
  dmErrorMessageForUi,
  prefetchMyDmThreadsSnapshot,
  subscribeDmReadMap,
  subscribeMyDmThreads,
} from "../lib/dm";
import type { DmThreadDoc } from "../types";

type Ctx = {
  threads: DmThreadDoc[];
  readMap: Map<string, number>;
  threadsListReady: boolean;
  threadsListError: string | null;
  retryDmList: () => void;
};

const DmRealtimeContext = createContext<Ctx | null>(null);

/**
 * 피드(/)·DM(/messages*) 에서만 Firestore 리스너 활성화.
 * `/` ↔ `/messages` 는 shouldListen 이 동일해서 pathname 이 바뀌어도 구독은 유지해야 함 —
 * 매번 해제했다 붙이면 모바일·새로고침 직후 웜업이 끊겨 목록 실패하기 쉬움.
 * 대화 목록 화면(/messages 단독)에 들어올 때는 prefetch 로 일회 스냅샷으로 먼저 채운다.
 * 탭이 백그라운드면 shouldListen 가 꺼지며 리스너 정리됨.
 */
export function DmRealtimeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user, firebaseReady, loading: authLoading } = useAuth();
  const myUid = user?.uid;

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  /**
   * `/` 과 `/messages` 모두에서 shouldListen 이 true 라면 DM 구독 effect 의 deps 가 그대로라
   * 리스너가 재부착되지 않음. 친구 탭 등에서는 route 가 꺼졌다 켜지면서 구독이 새로 웜업되어 목록이 잘 뜸.
   * 피드에서 DM 목록만 곧바로 들어올 때는 동일해야 하므로, `/` → `/messages` 진입 시 한 번 재연결한다.
   */
  const prevPathForDmResubscribeRef = useRef<string | null>(null);

  const routeWantsDm = pathname === "/" || pathname.startsWith("/messages");

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

  useEffect(() => {
    const prev = prevPathForDmResubscribeRef.current;
    prevPathForDmResubscribeRef.current = pathname;
    if (prev === null) return;
    if (pathname !== "/messages" || prev !== "/") return;
    if (!firebaseReady || !myUid || authLoading || !tabVisible) return;
    retryDmList();
  }, [pathname, firebaseReady, myUid, authLoading, tabVisible, retryDmList]);

  const [threads, setThreads] = useState<DmThreadDoc[]>([]);
  const [readMap, setReadMap] = useState<Map<string, number>>(new Map());
  const [threadsListReady, setThreadsListReady] = useState(false);
  const [threadsListError, setThreadsListError] = useState<string | null>(null);

  /** `/messages` 목록 화면에 올 때만 — 구독은 그대로 두고 서버 일회로 먼저 채움 */
  useEffect(() => {
    if (!firebaseReady || !myUid || authLoading || !shouldListen) return;
    if (pathname !== "/messages") return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await prefetchMyDmThreadsSnapshot(myUid);
        if (cancelled) return;
        setThreadsListError(null);
        setThreads((prev) => (prev.length > 0 ? prev : rows));
        setThreadsListReady(true);
      } catch {
        /* 실시간 구독·재시도로 복구 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, firebaseReady, myUid, authLoading, shouldListen]);

  useEffect(() => {
    if (!firebaseReady || !myUid || authLoading) {
      setThreads([]);
      setReadMap(new Map());
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
        await getFirebaseAuth().currentUser?.getIdToken();
      } catch {
        /* 오프라인 등 */
      }
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
          setThreads([]);
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

  const value = useMemo<Ctx>(
    () => ({
      threads,
      readMap,
      threadsListReady,
      threadsListError,
      retryDmList,
    }),
    [threads, readMap, threadsListReady, threadsListError, retryDmList],
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
