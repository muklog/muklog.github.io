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
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, normalizeMeal, patchSettings } from "../lib/db";
import {
  subscribeFriendLatestMeals,
  subscribeOutgoingShares,
} from "../lib/friends";
import type { Meal, Share } from "../types";
import { useAuth } from "./AuthContext";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { resolveDisplayName, resolveDisplayPhotoURL } from "../lib/identity";

const MAX_PER_FRIEND = 15;
const MAX_MINE = 30;

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
  useEffect(() => {
    if (!myUid) {
      setFriendShares(null);
      return;
    }
    const unsub = subscribeOutgoingShares(
      (rows) => setFriendShares(rows.filter((s) => s.scope.calendar)),
      (e) => console.warn("[feedStream] outgoing shares", e),
    );
    return () => unsub();
  }, [myUid]);

  const [friendMealsByOwner, setFriendMealsByOwner] = useState<Map<string, Meal[]>>(
    new Map(),
  );
  useEffect(() => {
    if (!friendShares) return;
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
      name: resolveDisplayName(myProfile, user),
      photoURL: resolveDisplayPhotoURL(myProfile, user?.photoURL),
      color: myProfile?.color,
    };
    for (const m of myMeals ?? []) {
      if ((m.items ?? []).length === 0) continue;
      out.push({ author: myAuthor, meal: m, isMine: true });
    }
    for (const share of friendShares ?? []) {
      const rows = friendMealsByOwner.get(share.ownerUid) ?? [];
      for (const m of rows) {
        if ((m.items ?? []).length === 0) continue;
        out.push({
          author: {
            uid: share.ownerUid,
            name: share.ownerName,
            photoURL: share.ownerPhotoURL,
          },
          meal: m,
          isMine: false,
        });
      }
    }
    out.sort((a, b) => b.meal.updatedAt - a.meal.updatedAt);
    return out;
  }, [myMeals, friendShares, friendMealsByOwner, myProfile, user?.displayName, user?.photoURL, myUid]);

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
    firebaseReady &&
    myUid !== undefined &&
    (friendShares?.length ?? 0) > 0 &&
    (friendShares ?? []).some((s) => !friendMealsByOwner.has(s.ownerUid));

  const loading =
    myMeals === undefined ||
    (firebaseReady && myUid !== undefined && friendShares === null) ||
    awaitingFriendMealSnapshots;

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

/** 피드를 벗어날 때까지 대비 안 한 배지 계산용 */
export function useFeedDotVisible(): boolean {
  const fs = useFeedStream();
  const settings = useLiveQuery(() => getSettings(), []);
  if (!fs || fs.entriesMaxUpdatedAt <= 0) return false;
  const seen = settings?.feedLastSeenMaxUpdatedAt ?? 0;
  return fs.entriesMaxUpdatedAt > seen;
}
