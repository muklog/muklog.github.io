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
import { useLocation, matchPath } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, normalizeMeal, patchSettings } from "../lib/db";
import {
  subscribeFriendLatestMeals,
  subscribeOutgoingShares,
  getPublicProfile,
} from "../lib/friends";
import { removePullRefreshSplash } from "../lib/pullRefreshSplash";
import type { Meal, PublicProfile, Share } from "../types";
import { useAuth } from "./AuthContext";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { resolveDisplayName, resolveDisplayPhotoURL } from "../lib/identity";

const MAX_PER_FRIEND = 10;
const MAX_MINE = 24;

export interface FeedAuthor {
  uid: string;
  name: string;
  photoURL?: string;
  color?: string;
}

export interface FeedEntry {
  author: FeedAuthor;
  meal: Meal;
  isMine: boolean;
}

type Ctx = {
  entries: FeedEntry[];
  loading: boolean;
  entriesMaxUpdatedAt: number;
  markFeedWatermark: () => void;
};

const FeedStreamContext = createContext<Ctx | null>(null);

export function FeedStreamProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  /** HashRouter 포함 — 피드만 실시간 구독 활성화(리스너·읽기 절약). pathname 은 브라우저마다 edge case 적음. */
  const feedStreamActive = !!matchPath({ path: "/", end: true }, pathname);

  /** 탭이 보이지 않을 때는 Firestore 피드 리스너를 끄고 읽기·연결 비용을 줄임 (DM 쪽과 동일 패턴). */
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const feedFirestoreLive = feedStreamActive && tabVisible;

  const { user, firebaseReady } = useAuth();
  const myUid = firebaseReady ? user?.uid : undefined;
  const myUserId = usePrimaryUserId();

  const myProfile = useLiveQuery(
    async () => (myUserId ? await db.users.get(myUserId) : undefined),
    [myUserId],
  );

  const myMeals = useLiveQuery(async () => {
    if (!myUserId) return [] as Meal[];
    const arr = await db.meals.where("userId").equals(myUserId).toArray();
    return arr
      .map(normalizeMeal)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_MINE);
  }, [myUserId]);

  const [friendShares, setFriendShares] = useState<Share[] | null>(null);
  /** 빈 목록이 캐시(fromCache)에서 온 경우 서버 확인 전까지 피드를 잠깐 열었다가 로딩으로 덮는 깜빡임 방지 */
  const [outgoingSharesFromCache, setOutgoingSharesFromCache] = useState<boolean | null>(null);
  useEffect(() => {
    if (!myUid) {
      setFriendShares(null);
      setOutgoingSharesFromCache(null);
      return;
    }
    if (!feedFirestoreLive) {
      setFriendShares(null);
      setOutgoingSharesFromCache(null);
      return;
    }
    const unsub = subscribeOutgoingShares(
      (rows, meta) => {
        const filtered = rows.filter((s) => s.scope?.calendar === true);
        setFriendShares(filtered);
        setOutgoingSharesFromCache(rows.length === 0 ? meta.fromCache : false);
      },
      (e) => console.warn("[feedStream] outgoing shares", e),
    );
    return () => unsub();
  }, [myUid, feedFirestoreLive]);

  const [friendPublicByUid, setFriendPublicByUid] = useState<Map<string, PublicProfile>>(
    new Map(),
  );
  useEffect(() => {
    if (!friendShares?.length) {
      setFriendPublicByUid(new Map());
      return;
    }
    let cancelled = false;
    const uids = [...new Set(friendShares.map((s) => s.ownerUid))];
    void (async () => {
      const pairs = await Promise.all(
        uids.map(async (uid) => {
          try {
            const p = await getPublicProfile(uid);
            return [uid, p] as const;
          } catch {
            return [uid, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const next = new Map<string, PublicProfile>();
      for (const [uid, p] of pairs) {
        if (p) next.set(uid, p);
      }
      setFriendPublicByUid(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [friendShares]);

  const [friendMealsByOwner, setFriendMealsByOwner] = useState<Map<string, Meal[]>>(
    new Map(),
  );
  useEffect(() => {
    if (!friendShares || friendShares.length === 0) {
      setFriendMealsByOwner(new Map());
      return;
    }
    const unsubs: (() => void)[] = [];
    const current = new Set<string>();
    for (const s of friendShares) {
      current.add(s.ownerUid);
      const unsub = subscribeFriendLatestMeals(
        s.ownerUid,
        MAX_PER_FRIEND,
        (rows) => {
          setFriendMealsByOwner((prev) => {
            const next = new Map(prev);
            next.set(s.ownerUid, rows);
            return next;
          });
        },
        () => {
          setFriendMealsByOwner((prev) => {
            const next = new Map(prev);
            next.set(s.ownerUid, []);
            return next;
          });
        },
      );
      unsubs.push(unsub);
    }
    setFriendMealsByOwner((prev) => {
      const next = new Map<string, Meal[]>();
      for (const [k, v] of prev) if (current.has(k)) next.set(k, v);
      return next;
    });
    return () => {
      for (const u of unsubs) u();
    };
  }, [friendShares]);

  const entries = useMemo<FeedEntry[]>(() => {
    const out: FeedEntry[] = [];
    const myAuthor: FeedAuthor = {
      uid: myUid ?? "local-me",
      name:
        myUserId && myProfile === undefined
          ? "나"
          : resolveDisplayName(myProfile, user),
      photoURL: resolveDisplayPhotoURL(myProfile, user?.photoURL),
      color: myProfile?.color,
    };
    for (const m of myMeals ?? []) {
      if ((m.items ?? []).length === 0) continue;
      out.push({ author: myAuthor, meal: m, isMine: true });
    }
    for (const share of friendShares ?? []) {
      const rows = friendMealsByOwner.get(share.ownerUid) ?? [];
      const pub = friendPublicByUid.get(share.ownerUid);
      const pubName = pub?.displayName?.trim();
      const pubPhoto = pub?.photoURL?.trim();
      const sharePhoto = share.ownerPhotoURL?.trim();
      for (const m of rows) {
        if ((m.items ?? []).length === 0) continue;
        out.push({
          author: {
            uid: share.ownerUid,
            name: pubName || share.ownerName,
            photoURL: pubPhoto || sharePhoto || undefined,
          },
          meal: m,
          isMine: false,
        });
      }
    }
    out.sort((a, b) => b.meal.updatedAt - a.meal.updatedAt);
    return out;
  }, [
    myMeals,
    friendShares,
    friendMealsByOwner,
    friendPublicByUid,
    myProfile,
    user,
    myUid,
    myUserId,
  ]);

  const entriesMaxUpdatedAt = useMemo(() => {
    let m = 0;
    for (const e of entries) m = Math.max(m, e.meal.updatedAt);
    return m;
  }, [entries]);

  const maxRef = useRef(entriesMaxUpdatedAt);
  useEffect(() => {
    maxRef.current = entriesMaxUpdatedAt;
  }, [entriesMaxUpdatedAt]);

  const markFeedWatermark = useCallback(() => {
    const v = maxRef.current;
    if (v <= 0) return;
    void patchSettings({ feedLastSeenMaxUpdatedAt: v });
  }, []);

  /** 친구 공유 목록은 왔는데 각 owner 의 meals 스냅샷 전이면 빈 피드 카드가 깜빡임 → 키가 들어올 때까지 로딩 */
  const awaitingFriendMealSnapshots =
    feedFirestoreLive &&
    firebaseReady &&
    myUid !== undefined &&
    (friendShares?.length ?? 0) > 0 &&
    (friendShares ?? []).some((s) => !friendMealsByOwner.has(s.ownerUid));

  const emptyOutgoingAwaitingServer =
    feedFirestoreLive &&
    firebaseReady &&
    myUid !== undefined &&
    friendShares !== null &&
    friendShares.length === 0 &&
    outgoingSharesFromCache === true;

  useEffect(() => {
    if (!emptyOutgoingAwaitingServer) return;
    const t = window.setTimeout(() => setOutgoingSharesFromCache(false), 3200);
    return () => window.clearTimeout(t);
  }, [emptyOutgoingAwaitingServer]);

  const loading =
    myMeals === undefined ||
    (feedFirestoreLive &&
      firebaseReady &&
      myUid !== undefined &&
      friendShares === null) ||
    awaitingFriendMealSnapshots ||
    emptyOutgoingAwaitingServer;

  useEffect(() => {
    if (loading) return;
    removePullRefreshSplash();
  }, [loading]);

  const value = useMemo<Ctx>(
    () => ({
      entries,
      loading,
      entriesMaxUpdatedAt,
      markFeedWatermark,
    }),
    [entries, loading, entriesMaxUpdatedAt, markFeedWatermark],
  );

  return <FeedStreamContext.Provider value={value}>{children}</FeedStreamContext.Provider>;
}

export function useFeedStream(): Ctx | null {
  return useContext(FeedStreamContext);
}

/** 피드를 벗어나거나 탭이 숨겨져 있으면 피드 Firestore 구독이 꺼져 친구 글 배지는 피드 탭 활성 후에 반영될 수 있다. */
export function useFeedDotVisible(): boolean {
  const fs = useFeedStream();
  const settings = useLiveQuery(() => getSettings(), []);
  if (!fs || fs.entriesMaxUpdatedAt <= 0) return false;
  const seen = settings?.feedLastSeenMaxUpdatedAt ?? 0;
  return fs.entriesMaxUpdatedAt > seen;
}
