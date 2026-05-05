import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import {
  getInAppBrowserKind,
  openKakaoTalkExternalBrowser,
  urlWithLineOpenExternalParam,
} from "../lib/inAppBrowser";

/**
 * 인앱 브라우저로 링크가 열린 경우 — 기본 브라우저로 넘길 안내와 버튼만 표시.
 */
export default function EmbeddedGoogleLoginNotice() {
  const [copied, setCopied] = useState(false);
  const kind = typeof navigator !== "undefined" ? getInAppBrowserKind() : null;

  if (!kind) return null;

  const lineOrGenericCopyUrl =
    kind === "line"
      ? urlWithLineOpenExternalParam()
      : typeof window !== "undefined"
        ? window.location.href
        : "";

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(lineOrGenericCopyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("기본 브라우저 주소창에 붙여 넣으세요", lineOrGenericCopyUrl);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-100/95">
      <p className="text-amber-100/90">
        {kind === "kakao" ? (
          <>
            링크가 <span className="text-amber-50">인앱 브라우저</span>로 열렸어요.{" "}
            아래 버튼을 누르면 기본 브라우저에서 같은 페이지가 열립니다.
          </>
        ) : (
          <>
            링크가 <span className="text-amber-50">인앱 브라우저</span>로 열렸어요.{" "}
            아래에서 주소를 복사한 뒤 기본 브라우저 주소창에 붙여 넣어 주세요.
          </>
        )}
      </p>
      <div className="mt-2">
        {kind === "kakao" ? (
          <button
            type="button"
            onClick={() => openKakaoTalkExternalBrowser()}
            className="btn-primary inline-flex w-full items-center justify-center gap-1.5 py-2.5 text-sm"
          >
            <ExternalLink size={15} /> 기본 브라우저로 열기
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void copyUrl()}
            className="btn-primary inline-flex w-full items-center justify-center gap-1.5 py-2.5 text-sm"
          >
            <Copy size={15} /> {copied ? "복사됨" : "주소 복사하기"}
          </button>
        )}
      </div>
    </div>
  );
}
