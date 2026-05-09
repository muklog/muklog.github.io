import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, runDexie } from "../lib/db";

export interface PrimaryUserIdState {
  /** 활성 프로필 id — 아직 결정되지 않았으면 undefined */
  id: string | undefined;
  /** Dexie 에서 첫 응답이 오기 전이면 true. id 가 undefined 이더라도 "사용자가 없음"과 구분해 로딩 표시에 쓴다. */
  loading: boolean;
  /** 첫 응답이 도착한 뒤 사용자가 정말 0명인 상태 — 페이지 측에서 "비어있음" UI 분기에 사용. */
  hasUsers: boolean;
}

/**
 * 저장된 활성 프로필 ID가 있으면 사용, 없거나 무효하면 가장 먼저 만든 로컬 프로필.
 * Dexie 가 아직 첫 응답 전인 짧은 순간에는 `loading: true` 로 알린다.
 */
export function usePrimaryUserIdState(): PrimaryUserIdState {
  const users = useLiveQuery(
    () => runDexie(() => db.users.orderBy("createdAt").toArray()),
    [],
  );
  const settings = useLiveQuery(() => getSettings(), []);
  const loading = users === undefined || settings === undefined;
  if (loading) return { id: undefined, loading: true, hasUsers: false };
  if (!users.length) return { id: undefined, loading: false, hasUsers: false };
  const active = settings.activeUserId;
  if (active && users.some((u) => u.id === active)) {
    return { id: active, loading: false, hasUsers: true };
  }
  return { id: users[0]?.id, loading: false, hasUsers: true };
}

/** 호환 API — id 만 필요한 호출자용. 로딩/빈 상태가 필요하면 `usePrimaryUserIdState` 를 쓰세요. */
export function usePrimaryUserId(): string | undefined {
  return usePrimaryUserIdState().id;
}
