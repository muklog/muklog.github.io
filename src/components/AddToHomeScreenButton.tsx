import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Home, Plus, X } from "lucide-react";
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

/** 집+플러스 아이콘 — 피드 상단에서 홈 화면(PWA) 추가 유도 */
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
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
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

  async function onAddClick() {
    const ev = deferredRef.current;
    if (ev) {
      deferredRef.current = null;
      try {
        await ev.prompt();
        void ev.userChoice.catch(() => {});
      } catch {
        setModalOpen(true);
      }
      return;
    }
    setModalOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void onAddClick()}
        className={cls(
          "btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2 pl-2.5 pr-2.5 text-sm sm:pl-3 sm:pr-3",
          className,
        )}
        title="휴대폰 홈 화면에 밀로그 추가"
        aria-label="홈 화면에 앱 추가"
      >
        <HomePlusGlyph />
        <span className="max-[359px]:sr-only">홈에 추가</span>
      </button>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-4 backdrop-blur-[2px] sm:items-center"
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-home-title"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="add-home-title" className="text-base font-semibold text-slate-100">
                홈 화면에 추가
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
            <div className="space-y-3 text-sm leading-relaxed text-slate-300">
              <p>
                <strong className="text-slate-100">자동 설치:</strong> 구글·삼성 인터넷처럼{" "}
                <strong className="text-slate-100">크로미움 계열</strong> 브라우저는 PWA 조건(HTTPS, 매니페스트
                등)이 맞으면 이 버튼을 눌렀을 때 <strong className="text-slate-100">브라우저 설치 창</strong>이 바로
                뜰 수 있어요. 우리가 스토어에 올린 앱을 까는 것과는 다르고, 브라우저가 제공하는 설치입니다.
              </p>
              <p>
                <strong className="text-slate-100">사파리(아이폰·아이패드):</strong> 애플 정책상 웹사이트가 그
                설치 창을 대신 열 수 <strong className="text-slate-100">없습니다</strong>. 아래{" "}
                <strong className="text-slate-100">3. 사파리</strong> 순서대로 직접 추가해 주세요. (아이폰의
                크롬도 엔진은 사파리와 같아서 보통 같은 방식입니다.)
              </p>
              {samsungInternetLikely() ? (
                <p className="rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-xs text-brand-100/95">
                  지금 브라우저가 삼성 인터넷이면 아래 <strong>2. 삼성 인터넷</strong>을 보면 됩니다.
                </p>
              ) : null}
              {iosLikely() ? (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/95">
                  iPhone·iPad에서는 <strong>3. 사파리</strong> 안내가 해당돼요.
                </p>
              ) : null}
              <p className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                <strong className="text-slate-200">크롬에서만 주소창이 보일 때:</strong> 메뉴의{" "}
                <strong className="text-slate-200">홈 화면에 추가</strong>만 쓰면 보통{" "}
                <strong className="text-slate-200">일반 탭 바로가기</strong>라 주소창이 남습니다. 반드시{" "}
                <strong className="text-slate-200">앱 설치</strong>(또는 주소창 옆{" "}
                <strong className="text-slate-200">설치</strong>)로 깔아야{" "}
                <strong className="text-slate-200">주소창 없는 앱 화면</strong>으로 열리는 경우가 많아요.
              </p>
            </div>

            <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-100">1. 크롬 (Android·Windows 등)</h3>
                <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-300">
                  <li>
                    주소창 오른쪽 <strong className="text-slate-100">설치</strong> 아이콘이 있으면 그걸 누르고, 없으면{" "}
                    <strong className="text-slate-100">⋮</strong> 메뉴를 엽니다.
                  </li>
                  <li>
                    <strong className="text-slate-100">앱 설치</strong>를 고릅니다. (
                    <strong className="text-slate-100">홈 화면에 추가</strong>만 있으면 바로가기라 주소창이 보일 수
                    있어요.)
                  </li>
                  <li>
                    뜨는 창에서 <strong className="text-slate-100">설치</strong>·
                    <strong className="text-slate-100">추가</strong>로 마칩니다. 홈 화면에서{" "}
                    <strong className="text-slate-100">새로 생긴 앱 아이콘</strong>을 열어 보세요.
                  </li>
                </ol>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-100">2. 삼성 인터넷</h3>
                <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-300">
                  <li>
                    <strong className="text-slate-100">메뉴</strong>(보통 하단의 <strong className="text-slate-100">⋮</strong> 또는
                    ≡)를 누릅니다.
                  </li>
                  <li>
                    <strong className="text-slate-100">페이지 추가</strong>,{" "}
                    <strong className="text-slate-100">홈 화면에 바로가기 추가</strong>,{" "}
                    <strong className="text-slate-100">홈 화면에 추가</strong> 중 보이는 항목을 누릅니다. (버전에
                    따라 이름이 다릅니다.)
                  </li>
                  <li>
                    <strong className="text-slate-100">추가</strong>를 눌러 완료합니다.
                  </li>
                </ol>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-100">3. 사파리 (iPhone·iPad)</h3>
                <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-300">
                  <li>
                    하단의 <strong className="text-slate-100">공유</strong>{" "}
                    <span className="text-slate-500">(□ 위로 화살표)</span>를 누릅니다.
                  </li>
                  <li>
                    목록에서 <strong className="text-slate-100">홈 화면에 추가</strong>를 누릅니다. (안 보이면
                    아래로 스크롤합니다.)
                  </li>
                  <li>
                    오른쪽 위 <strong className="text-slate-100">추가</strong>를 눌러 마칩니다.
                  </li>
                </ol>
              </section>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              홈에 넣으면 주소창 없이 앱처럼 켤 수 있어요. 설치 항목이 안 보이면 이미 추가됐거나, 브라우저가 PWA
              설치를 막은 상태일 수 있어요. 바로가기 없이도 하단 내비의 <strong className="text-slate-400">식단</strong>에서
              달력을 열 수 있어요.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
