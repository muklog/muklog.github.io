import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings, runDexie } from "../lib/db";

/** 1인 모드: 저장된 활성 ID가 있으면 사용, 없거나 무효하면 가장 먼저 만든 프로필 */
export function usePrimaryUserId(): string | undefined {
  const users = useLiveQuery(
    () => runDexie(() => db.users.orderBy("createdAt").toArray()),
    [],
  );
  const settings = useLiveQuery(() => getSettings(), []);
  if (!users?.length) return undefined;
  const active = settings?.activeUserId;
  if (active && users.some((u) => u.id === active)) return active;
  return users[0]?.id;
}
