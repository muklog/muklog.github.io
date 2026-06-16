import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, Home, Info, Plus, X } from "lucide-react";
import { cls } from "../lib/utils";

/** 구글 플레이 스토어 — 먹로그 안드로이드(TWA) 앱 */
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=io.github.muklog.app";

function standaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
}

function iosLikely(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** 안드로이드 — 플레이 스토어 앱 설치 유도가 의미 있는 환경 */
function androidLikely(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/** 집+플러스 아이콘 — 피드 상단에서 웹 이용 안내(수동 추가) 유도 */
function HomePlusGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cls("relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center", className)}
      aria-hidden
    >
      <Home size={16} className="text-slate-200" strokeWidth={2} />
      <span className="absolute -bottom-px -right-px flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand-600 ring-2 ring-slate-950">
        <Plus size={10} className="text-white" strokeWidth={3} />
      </span>
    </span>
  );
}

/**
 * 피드 상단 — 자동 설치(beforeinstallprompt·prompt)는 호출하지 않음.
 * 정식 앱은 플레이 스토어 유도 예정이며, 웹은 아래 안내대로 사용자가 직접 홈에 추가.
 */
export default function AddToHomeScreenButton({ className }: { className?: string }) {
  const [modalOpen, setModalOpen] = useState(false);

  if (standaloneDisplay()) {
    return (
      <Link
        to="/home"
        className={cls(
          "btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2 pl-3 pr-3 text-sm",
          className,
        )}
      >
        <Home size={14} className="shrink-0" /> 식단
      </Link>
    );
  }

  // 안드로이드 웹: 플레이 스토어 앱 설치로 바로 유도(아이폰·데스크톱은 네이티브 앱이 없어 아래 안내 유지).
  if (androidLikely()) {
    return (
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cls(
          "btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2 pl-2.5 pr-2.5 text-sm sm:pl-3 sm:pr-3",
          className,
        )}
        title="구글 플레이에서 앱 설치"
        aria-label="앱 설치"
      >
        <Download size={16} className="shrink-0" />
        <span className="max-[359px]:sr-only">앱 설치</span>
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={cls(
          "btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2 pl-2.5 pr-2.5 text-sm sm:pl-3 sm:pr-3",
          className,
        )}
        title="웹에서 먹로그 쓰는 방법"
        aria-label="앱 이용 안내"
      >
        <HomePlusGlyph />
        <span className="max-[359px]:sr-only">앱 안내</span>
      </button>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-3 backdrop-blur-[2px] sm:items-center sm:p-4"
          style={{
            paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-home-title"
        >
          <div className="flex max-h-[min(88dvh,calc(100dvh-1.5rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl sm:max-h-[min(85vh,36rem)]">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <h2 id="add-home-title" className="text-base font-semibold text-slate-100">
                앱 이용 안내
              </h2>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                aria-label="닫기"
                onClick={() => setModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
              <div className="space-y-3 text-sm leading-relaxed text-slate-300">
                <p className="flex gap-2 rounded-lg border border-brand-500/25 bg-brand-500/8 px-3 py-2.5 text-xs text-brand-100/95">
                  <Info size={16} className="mt-0.5 shrink-0 text-brand-400" aria-hidden />
                  <span>
                    <strong className="text-slate-100">안드로이드</strong>는 구글 플레이에서{" "}
                    <strong className="text-slate-100">먹로그</strong> 앱을 바로 설치할 수 있어요. 아이폰·PC에서 웹으로
                    쓰고 계시면, 아래 순서대로 <strong className="text-slate-100">브라우저에서 직접</strong> 홈 화면에
                    추가해 주세요.
                  </span>
                </p>
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-flex w-full items-center justify-center gap-1.5 py-2.5 text-sm"
                >
                  <Download size={16} className="shrink-0" /> 구글 플레이에서 앱 설치 (안드로이드)
                </a>
                <p>
                  <strong className="text-slate-100">PC (크롬·엣지·웨일 등):</strong> 아래{" "}
                  <strong className="text-slate-100">1. 크롬·엣지</strong> 순서대로 진행해 주세요.
                </p>
                <p>
                  <strong className="text-slate-100">iPhone·iPad (사파리):</strong> 아래{" "}
                  <strong className="text-slate-100">2. 사파리</strong> 순서대로 추가해 주세요. 아이폰 크롬도 보통
                  비슷합니다.
                </p>
                {iosLikely() ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/95">
                    지금 기기: <strong>2. 사파리</strong>
                  </p>
                ) : null}
              </div>

              <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-100">1. 크롬·엣지 (PC)</h3>
                  <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-300">
                    <li>
                      주소창 오른쪽 <strong className="text-slate-100">설치</strong> 아이콘이 있으면 누르고, 없으면{" "}
                      <strong className="text-slate-100">⋮</strong> 메뉴를 누릅니다.
                    </li>
                    <li>
                      <strong className="text-slate-100">앱 설치</strong>를 선택합니다. 메뉴에{" "}
                      <strong className="text-slate-100">「홈 화면에 추가」</strong>만 있다면 탭 바로가기일 수 있어
                      주소창이 남는 경우가 많습니다 — <strong className="text-slate-100">앱 설치</strong> 흐름을 찾아
                      보세요.
                    </li>
                    <li>
                      안내에 따라 마친 뒤, <strong className="text-slate-100">새 아이콘</strong>으로 실행해 보세요.
                    </li>
                  </ol>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-100">2. 사파리 (iPhone·iPad)</h3>
                  <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-300">
                    <li>
                      하단 <strong className="text-slate-100">공유</strong>
                      <span className="text-slate-500"> (□↑)</span>를 누릅니다.
                    </li>
                    <li>
                      <strong className="text-slate-100">홈 화면에 추가</strong>를 누릅니다. (목록에 없으면 아래로
                      스크롤)
                    </li>
                    <li>
                      오른쪽 위 <strong className="text-slate-100">추가</strong>로 마칩니다.
                    </li>
                  </ol>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
