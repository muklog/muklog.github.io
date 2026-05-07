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
            {iosLikely() ? (
              <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-slate-300">
                <li>
                  Safari 하단의 <strong className="text-slate-100">공유</strong> 버튼(위로 향한 화살표가
                  있는 네모)을 누릅니다.
                </li>
                <li>
                  <strong className="text-slate-100">홈 화면에 추가</strong>를 찾아 누릅니다.
                </li>
                <li>
                  우측 상단 <strong className="text-slate-100">추가</strong>를 누르면 끝이에요.
                </li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-slate-300">
                <li>
                  <strong className="text-slate-100">Chrome</strong>이면 주소창 오른쪽의{" "}
                  <strong className="text-slate-100">설치</strong> 또는 메뉴(⋮)의{" "}
                  <strong className="text-slate-100">홈 화면에 추가</strong> /{" "}
                  <strong className="text-slate-100">앱 설치</strong>를 눌러 보세요.
                </li>
                <li>
                  <strong className="text-slate-100">삼성 인터넷</strong>은 메뉴에서{" "}
                  <strong className="text-slate-100">페이지 추가</strong> 또는{" "}
                  <strong className="text-slate-100">홈 화면에 추가</strong> 경로를 쓰는 경우가 많아요.
                </li>
                <li>
                  버튼이 안 보이면 아래 <strong className="text-slate-100">식단</strong> 탭은 하단 내비에서
                  그대로 열 수 있어요.
                </li>
              </ol>
            )}
            <p className="mt-3 text-xs text-slate-500">
              추가하면 주소창 없이 앱처럼 전체 화면으로 쓸 수 있어요.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
