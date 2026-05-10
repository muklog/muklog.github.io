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
import { db, getSettings, normalizeMeal, patchSettings, runDexie } from "../lib/db";
import {
  subscribeFriendLatestMeals,
  subscribeOutgoingShares,
  getPublicProfile,
} from "../lib/friends";
import { removePullRefreshSplash } from "../lib/pullRefreshSplash";
import { friendFeedShareableMealItems, publicMealItems } from "../lib/mealItems";
import type { Meal, PublicProfile, Share } from "../types";
import { useAuth } from "./AuthContext";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { resolveDisplayName, resolveDisplayPhotoURL } from "../lib/identity";

const MAX_PER_FRIEND = 16;
const MAX_MINE = 24;

/**
 * 기기 A/B 가 Dexie 상태가 달라도, Firestore `myRemoteMeals` 를 기준으로 맞춘 뒤
 * 로컬이 더 최신(`updatedAt`)인 항목만 덮어써서 동일한 «내» 카드가 보이게 한다.
 */
function mergeOwnMealsForFeed(local: Meal[] | undefined, remote: Meal[] | null): Meal[] {
  const loc = local ?? [];
  if (remote === null) {
    return loc
      .map(normalizeMeal)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_MINE);
  }
  const map = new Map<string, Meal>();
  for (const r of remote) {
    map.set(r.id, normalizeMeal(r));
  }
  for (const m of loc) {
    const nm = normalizeMeal(m);
    const prev = map.get(m.id);
    if (!prev || nm.updatedAt > prev.updatedAt) {
      map.set(m.id, nm);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_MINE);
}

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

/** 피드 정렬·「새 글」점은 초안(draft) 편집으로 meal.updatedAt 만 바뀐 경우 올라가지 않게, 공개 항목의 최신 시각만 씁니다. */
function feedEntryActivityTs(e: FeedEntry): number {
  const items = e.meal.items;
  if (!items.length) return e.meal.updatedAt;
  let m = 0;
  for (const it of items) m = Math.max(m, it.updatedAt);
  return m;
}

type Ctx = {
  entries: FeedEntry[];
  loading: boolean;
  /** 빈 상태 문구를 보여도 되는지(초기 스냅샷 안정화 완료) */
  settled: boolean;
  entriesMaxUpdatedAt: number;
  markFeedWatermark: () => void;
};

const FeedStreamContext = createContext<Ctx | null>(null);

export function FeedStreamProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  /** HashRouter 포함 — 피드만 실시간 구독 활성화(리스너·읽기 절약). pathname 은 브라우저마다 edge case 적음. */
  const feedStreamActive = !!matchPath({ path: "/", end: true }, pathname);

  /**
   * 피드 탭에서만 구독 — 경로 밖에서는 리스너 끔.
   * (탭 가시성으로 끄면 백그라운드에서 스냅샷이 안 받아져 다른 기기와 목록이 어긋날 수 있음)
   */
  const feedFirestoreLive = feedStreamActive;

  const { user, firebaseReady, loading: authLoading } = useAuth();
  const myUid = firebaseReady ? user?.uid : undefined;
  const myUserId = usePrimaryUserId();

  const myProfile = useLiveQuery(
    async () => (myUserId ? await runDexie(() => db.users.get(myUserId)) : undefined),
    [myUserId],
  );

  const myMeals = useLiveQuery(async () => {
    const ownerIds = [myUserId, myUid].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    if (ownerIds.length === 0) return [] as Meal[];

    // 마이그레이션/프로필 통합 과도기에는 meals.userId 가 local profile id 혹은 firebase uid 일 수 있어 둘 다 본다.
    const lists = await Promise.all(
      ownerIds.map((uid) => runDexie(() => db.meals.where("userId").equals(uid).toArray())),
    );
    const merged = lists.flat();
    const byId = new Map(merged.map((m) => [m.id, m]));
    return [...byId.values()]
      .map(normalizeMeal)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_MINE);
  }, [myUserId, myUid]);

  /** null 은 «아직 첫 스냅샷 전» — 전역 loading 에 묶으면 모바일에서 스냅샷 지연 시 내 피드까지 막힌다. */
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
        /** 명시적으로 calendar:false 만 제외 — 레거시 shares(scope 없음)도 피드·구독에 포함 */
        const filtered = rows.filter((s) => s.scope?.calendar !== false);
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

  /** 모바일에서 Dexie pull 동기화가 늦는 동안에도 내 피드를 바로 보이게 하는 Firestore 폴백 */
  const [myRemoteMeals, setMyRemoteMeals] = useState<Meal[] | null>(null);
  useEffect(() => {
    if (!myUid || !feedFirestoreLive) {
      setMyRemoteMeals(null);
      return;
    }
    const unsub = subscribeFriendLatestMeals(
      myUid,
      MAX_MINE,
      (rows) => setMyRemoteMeals(rows),
      () => setMyRemoteMeals([]),
    );
    return () => unsub();
  }, [myUid, feedFirestoreLive]);

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
    const ownRows = mergeOwnMealsForFeed(myMeals, myRemoteMeals);
    for (const m of ownRows) {
      /** 본인 피드에는 초안 제외 전 항목(`isMealPhoto:false` 포함) — 친구 쪽만 shareable 필터 */
      const pubItems = publicMealItems(m.items);
      if (pubItems.length === 0) continue;
      out.push({ author: myAuthor, meal: { ...m, items: pubItems }, isMine: true });
    }
    for (const share of friendShares ?? []) {
      const rows = friendMealsByOwner.get(share.ownerUid) ?? [];
      const pub = friendPublicByUid.get(share.ownerUid);
      const pubName = pub?.displayName?.trim();
      const pubPhoto = pub?.photoURL?.trim();
      const sharePhoto = share.ownerPhotoURL?.trim();
      for (const m of rows) {
        const pubItems = friendFeedShareableMealItems(m.items);
        if (pubItems.length === 0) continue;
        out.push({
          author: {
            uid: share.ownerUid,
            name: pubName || share.ownerName,
            photoURL: pubPhoto || sharePhoto || undefined,
          },
          meal: { ...m, items: pubItems },
          isMine: false,
        });
      }
    }
    out.sort((a, b) => feedEntryActivityTs(b) - feedEntryActivityTs(a));
    return out;
  }, [
    myMeals,
    myRemoteMeals,
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
    for (const e of entries) m = Math.max(m, feedEntryActivityTs(e));
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

  /** 로그인 피드는 공유 목록 첫 스냅샷 전에 내 글만 그려져 순서가 뒤틀리므로 잠깐 대기 */
  const loading =
    authLoading ||
    myMeals === undefined ||
    (!!myUid && feedFirestoreLive && friendShares === null);
  const ownSettled =
    !myUid ||
    !feedFirestoreLive ||
    (myMeals !== undefined && myMeals.length > 0) ||
    myRemoteMeals !== null;
  const friendSettled =
    !myUid ||
    !feedFirestoreLive ||
    friendShares !== null;
  const settled = !loading && ownSettled && friendSettled;

  useEffect(() => {
    if (loading) return;
    removePullRefreshSplash();
  }, [loading]);

  const value = useMemo<Ctx>(
    () => ({
      entries,
      loading,
      settled,
      entriesMaxUpdatedAt,
      markFeedWatermark,
    }),
    [entries, loading, settled, entriesMaxUpdatedAt, markFeedWatermark],
  );

  return <FeedStreamContext.Provider value={value}>{children}</FeedStreamContext.Provider>;
}

export function useFeedStream(): Ctx | null {
  return useContext(FeedStreamContext);
}

/** 피드를 벗어나면 피드 전용 Firestore 구독이 꺼진다. 피드 탭으로 돌아오면 최신 스냅샷으로 맞춰진다. */
export function useFeedDotVisible(): boolean {
  const fs = useFeedStream();
  const settings = useLiveQuery(() => getSettings(), []);
  if (!fs || fs.entriesMaxUpdatedAt <= 0) return false;
  const seen = settings?.feedLastSeenMaxUpdatedAt ?? 0;
  return fs.entriesMaxUpdatedAt > seen;
}
