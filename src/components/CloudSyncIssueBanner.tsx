import { useEffect, useState } from "react";
import { Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import {
  getLastCloudSyncIssueState,
  subscribeCloudSyncIssues,
  type CloudSyncFailedItem,
  type CloudSyncIssueState,
} from "../lib/cloudSync";
import { runCloudSyncNow } from "../lib/autoCloudSync";
import { MEAL_SLOT_LABELS } from "../types";
import { formatKoDate } from "../lib/utils";

/**
 * 클라우드 동기화에서 한 끼니라도 Storage 업로드에 실패했거나
 * sync 자체가 throw 한 경우, 사용자가 침묵 속에 모르는 상태로 두지 않도록
 * 피드 상단에 노출되는 경고 배너.
 *
 * 한 번 «다시 시도» 가 성공하면 자동으로 사라진다.
 */
export default function CloudSyncIssueBanner() {
  const [state, setState] = useState<CloudSyncIssueState | null>(() =>
    getLastCloudSyncIssueState(),
  );
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    return subscribeCloudSyncIssues((next) => {
      setState(next);
      if (next.failedItems.length === 0 && !next.lastError) {
        setDismissed(false);
      }
    });
  }, []);

  const hasIssue =
    !!state && (state.failedItems.length > 0 || !!state.lastError);
  if (!hasIssue || dismissed) return null;

  const items = state!.failedItems;
  const topLevel = state!.lastError;

  async function onRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await runCloudSyncNow();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="alert"
      className="card flex flex-col gap-2 border-amber-500/40 bg-amber-900/20 p-3 text-amber-100"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert
          size={16}
          aria-hidden
          className="mt-0.5 shrink-0 text-amber-300"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[13px] font-medium">
            클라우드 동기화 중 일부 항목이 실패했어요
          </p>
          {topLevel && (
            <p className="text-[11px] leading-snug text-amber-200/85">
              {topLevel}
            </p>
          )}
          {items.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-amber-200/85">
              {items.slice(0, 3).map((it) => (
                <li key={failedItemKey(it)}>• {describeFailedItem(it)}</li>
              ))}
              {items.length > 3 && (
                <li className="text-amber-300/70">
                  외 {items.length - 3}개 항목 더…
                </li>
              )}
            </ul>
          )}
          <p className="text-[11px] leading-snug text-amber-200/70">
            친구가 내 새 식단을 못 볼 수 있어요. 인터넷 상태를 확인 후 다시
            시도해 주세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="알림 닫기"
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-amber-200/70 hover:bg-amber-900/40 hover:text-amber-100"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="flex justify-end gap-2 pl-6">
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-[12px] font-medium text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 size={12} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          {retrying ? "재시도 중…" : "다시 시도"}
        </button>
      </div>
    </div>
  );
}

function failedItemKey(it: CloudSyncFailedItem): string {
  if (it.kind === "meal") return `meal:${it.mealId}`;
  return `health:${it.recordId}`;
}

function describeFailedItem(it: CloudSyncFailedItem): string {
  if (it.kind === "meal") {
    const slot = MEAL_SLOT_LABELS[it.slot] ?? it.slot;
    return `${formatKoDate(it.date)} ${slot} 사진 — ${it.error}`;
  }
  return `${formatKoDate(it.recordDate)} 건강 기록 — ${it.error}`;
}
