import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { HEALTH_TYPE_LABELS, type HealthRecord } from "../types";
import HealthPhotoViewport from "./HealthPhotoViewport";
import { useBlobImgSrc } from "../hooks/useBlobImgSrc";
import { isRenderableImageBlob } from "../lib/image";
import { formatKoDate } from "../lib/utils";

interface Props {
  record: HealthRecord;
  /** 기본 false. true 면 편집·삭제·재분석 액션이 모두 숨겨집니다(친구 프로필 등 읽기 전용). */
  readOnly?: boolean;
  /** 재분석 버튼 활성화 여부 — 본인 화면에서만 의미 있음. */
  canAnalyze?: boolean;
  onReanalyze?: () => void;
  onRemove?: () => void;
}

export default function HealthRecordCard({
  record,
  readOnly = false,
  canAnalyze = false,
  onReanalyze,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const photoBlob = record.photo ?? record.thumbnail;
  const hasPhoto = isRenderableImageBlob(photoBlob);
  const { src: photoSrc, pending: photoSrcPending, onImgError: onPhotoImgError } =
    useBlobImgSrc(photoBlob);

  return (
    <div className="card overflow-hidden">
      <div className="flex w-full items-stretch gap-3 p-3">
        {hasPhoto ? (
          photoSrcPending && !photoSrc ? (
            <div
              className="h-14 w-14 shrink-0 animate-pulse self-start rounded-xl bg-slate-700"
              aria-hidden
            />
          ) : photoSrc ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="shrink-0 self-start rounded-xl border border-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              aria-label={open ? "기록 접기" : "기록 펼치기"}
            >
              <img
                src={photoSrc}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-14 w-14 rounded-xl object-cover"
                onError={onPhotoImgError}
              />
            </button>
          ) : (
            <div className="h-14 w-14 shrink-0 rounded-xl bg-slate-800" />
          )
        ) : (
          <div className="h-14 w-14 shrink-0 rounded-xl bg-slate-800" />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-xs text-slate-400">
            {HEALTH_TYPE_LABELS[record.type]} · {formatKoDate(record.recordDate)}
          </p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-slate-100 break-words whitespace-pre-wrap">
            {record.summary ?? statusLabel(record)}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex shrink-0 flex-col items-end justify-center gap-1 self-stretch text-slate-400"
          aria-expanded={open}
        >
          {record.healthScore !== undefined && (
            <span className="rounded-full bg-brand-500/15 px-2 py-1 text-sm font-bold text-brand-300">
              {record.healthScore}
            </span>
          )}
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-slate-800 p-4">
          {hasPhoto &&
            (photoSrcPending && !photoSrc ? (
              <div className="flex h-[260px] items-center justify-center rounded-xl bg-slate-800/50">
                <Loader2 size={28} className="animate-spin text-brand-400" aria-hidden />
              </div>
            ) : photoSrc ? (
              <HealthPhotoViewport src={photoSrc} />
            ) : null)}
          {record.analysisStatus === "analyzing" && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-800/50 px-3 py-2 text-sm text-slate-300">
              <Loader2 size={16} className="animate-spin text-brand-400" />
              AI 분석 중…
            </div>
          )}
          {record.analysisStatus === "error" && (
            <div className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">
              <div className="flex items-start gap-2">
                <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                <span className="break-all">{record.analysisError}</span>
              </div>
              {!readOnly && canAnalyze && onReanalyze && (
                <button onClick={onReanalyze} className="btn-secondary w-full py-2 text-xs">
                  <RefreshCw size={12} /> 다시 시도
                </button>
              )}
            </div>
          )}

          {record.analysisStatus === "done" && (
            <>
              {record.metrics && Object.keys(record.metrics).length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-slate-400">측정값</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(record.metrics).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded-lg bg-slate-800/50 px-3 py-2 text-xs"
                      >
                        <p className="text-slate-500">{k}</p>
                        <p className="mt-0.5 font-semibold text-slate-100">{String(v)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {record.strengths && record.strengths.length > 0 && (
                <Section title="✅ 강점" items={record.strengths} color="emerald" />
              )}
              {record.concerns && record.concerns.length > 0 && (
                <Section title="⚠ 주의" items={record.concerns} color="amber" />
              )}
              {record.recommendations && record.recommendations.length > 0 && (
                <Section title="💡 권장" items={record.recommendations} color="sky" />
              )}

              {record.extractedText && (
                <details className="text-xs text-slate-400">
                  <summary className="cursor-pointer text-slate-300">원문 보기</summary>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-800/50 p-3 font-mono text-[11px] leading-relaxed">
                    {record.extractedText}
                  </pre>
                </details>
              )}
            </>
          )}

          {!readOnly && (onReanalyze || onRemove) && (
            <div className="flex gap-2 border-t border-slate-800 pt-3">
              {canAnalyze && record.photo && onReanalyze && (
                <button onClick={onReanalyze} className="btn-secondary flex-1 py-2 text-xs">
                  <Sparkles size={12} /> 다시 분석
                </button>
              )}
              {onRemove && (
                <button
                  onClick={onRemove}
                  className="btn-secondary flex-1 py-2 text-xs text-rose-300"
                >
                  <Trash2 size={12} /> 삭제
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusLabel(r: HealthRecord) {
  switch (r.analysisStatus) {
    case "analyzing":
      return "AI 분석 중…";
    case "error":
      return "분석 실패";
    case "skipped":
      return "사진 저장됨 (분석 안 함)";
    default:
      return "분석 대기";
  }
}

function Section({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: "emerald" | "amber" | "sky";
}) {
  const colorMap = {
    emerald: "bg-emerald-500/10 text-emerald-200 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-200 border-amber-500/20",
    sky: "bg-sky-500/10 text-sky-200 border-sky-500/20",
  } as const;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold text-slate-300">{title}</h4>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${colorMap[color]}`}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
