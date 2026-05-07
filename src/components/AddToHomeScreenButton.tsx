import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Home, Loader2, Plus, X } from "lucide-react";
import { cls } from "../lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

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

function samsungInternetLikely(): boolean {
  if (typeof navigator === "undefined") return false;
  return /SamsungBrowser/i.test(navigator.userAgent);
}

/** beforeinstallprompt 가 deferredRef 에 잡힐 때까지 폴링 (크롬 첫 로드·SW 등록 직후 이벤트 지연 대응) */
async function waitForDeferredInstallPrompt(
  getDeferred: () => BeforeInstallPromptEvent | null,
  maxMs: number,
  stepMs: number,
): Promise<BeforeInstallPromptEvent | null> {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const ev = getDeferred();
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return getDeferred();
}

/** 집+플러스 아이콘 — 피드 상단에서 홈 화면 설치 유도 */
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

export default function AddToHomeScreenButton({ className }: { className?: string }) {
  const [modalOpen, setModalOpen] = useState(false);
  /** true: 버튼으로 자동 설치 불가 → 수동으로 홈에 추가 안내 */
  const [modalManualOnly, setModalManualOnly] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    void navigator.serviceWorker?.ready.catch(() => {});
    const onBip = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

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

  function openManualModal(manualOnly: boolean) {
    setModalManualOnly(manualOnly);
    setModalOpen(true);
  }

  async function onAddClick() {
    if (iosLikely()) {
      openManualModal(false);
      return;
    }

    let ev = deferredRef.current;
    if (!ev) {
      setInstallBusy(true);
      try {
        await navigator.serviceWorker?.ready.catch(() => {});
        ev =
          deferredRef.current ??
          (await waitForDeferredInstallPrompt(() => deferredRef.current, 3_000, 100));
      } finally {
        setInstallBusy(false);
      }
    }

    if (ev) {
      deferredRef.current = null;
      try {
        await ev.prompt();
        void ev.userChoice.catch(() => {});
      } catch {
        openManualModal(true);
      }
      return;
    }
    openManualModal(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void onAddClick()}
        disabled={installBusy}
        aria-busy={installBusy}
        className={cls(
          "btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2 pl-2.5 pr-2.5 text-sm sm:pl-3 sm:pr-3 disabled:opacity-70",
          className,
        )}
        title="휴대폰 홈 화면에 밀로그 설치"
        aria-label="홈 화면에 앱 설치"
      >
        {installBusy ? <Loader2 size={18} className="h-[18px] w-[18px] shrink-0 animate-spin" /> : <HomePlusGlyph />}
        <span className="max-[359px]:sr-only">{installBusy ? "로딩 중…" : "홈에 설치"}</span>
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
                홈 화면에 설치
              </h2>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                aria-label="닫기"
                onClick={() => {
                  setModalOpen(false);
                  setModalManualOnly(false);
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
              <div className="space-y-3 text-sm leading-relaxed text-slate-300">
                {modalManualOnly ? (
                  <p>
                    <strong className="text-slate-100">지금 브라우저에서는</strong> 자동 설치(이 버튼으로 바로 띄우는
                    방식)가 막혀 있거나 지원되지 않는 상태예요.{" "}
                    <strong className="text-slate-100">아래 순서대로 직접 홈 화면에 추가</strong>해 주세요.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong className="text-slate-100">Android·PC (크롬·웨일·삼성 인터넷 등):</strong> 브라우저가{" "}
                      <strong className="text-slate-100">홈 화면에 설치</strong>를 지원하면 이 버튼으로{" "}
                      <strong className="text-slate-100">설치·추가</strong> 안내 화면이 뜰 수 있어요. 플레이 스토어처럼
                      앱 마켓에서 받는 것과는 달라요.
                    </p>
                    <p>
                      <strong className="text-slate-100">iPhone·iPad (사파리):</strong> 웹에서 설치 창을 대신 띄울 수
                      없어, 아래 <strong className="text-slate-100">3. 사파리</strong> 대로 추가해 주세요. 아이폰
                      크롬도 보통 같은 순서입니다.
                    </p>
                  </>
                )}
                {samsungInternetLikely() ? (
                  <p className="rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-xs text-brand-100/95">
                    지금 브라우저: <strong>2. 삼성 인터넷</strong>
                  </p>
                ) : null}
                {iosLikely() ? (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/95">
                    지금 기기: <strong>3. 사파리</strong>
                  </p>
                ) : null}
              </div>

              <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-100">1. 크롬 (Android·Windows 등)</h3>
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
                      안내에 따라 마친 뒤, 홈 화면의 <strong className="text-slate-100">새 아이콘</strong>으로
                      실행해 보세요.
                    </li>
                  </ol>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-100">2. 삼성 인터넷</h3>
                  <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-300">
                    <li>
                      <strong className="text-slate-100">메뉴</strong>(하단 <strong className="text-slate-100">⋮</strong>·
                      ≡)를 누릅니다.
                    </li>
                    <li>
                      <strong className="text-slate-100">페이지 추가</strong> /{" "}
                      <strong className="text-slate-100">홈 화면에 바로가기</strong> /{" "}
                      <strong className="text-slate-100">홈 화면에 추가</strong> 중 표시되는 항목을 누릅니다.
                    </li>
                    <li>
                      <strong className="text-slate-100">추가</strong>로 완료합니다.
                    </li>
                  </ol>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-100">3. 사파리 (iPhone·iPad)</h3>
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
