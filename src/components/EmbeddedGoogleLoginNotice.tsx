import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import {
  getInAppBrowserKind,
  openKakaoTalkExternalBrowser,
  urlWithLineOpenExternalParam,
} from "../lib/inAppBrowser";

/**
 * 설정·초대 등 Google 로그인 직전 — 인앱 브라우저면 기본 브라우저로 열도록 안내
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
      prompt("브라우저 주소창에 붙여 넣으세요", lineOrGenericCopyUrl);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100/95">
      <p className="font-medium text-amber-50">Google 로그인 — 인앱 브라우저 안내</p>
      <p className="mt-1 text-amber-100/90">
        카카오톡·라인 등 <span className="text-amber-50">인앱 브라우저</span>에서는{" "}
        <span className="text-amber-50">Google 보안 정책으로 로그인이 차단</span>될 수 있어요.{" "}
        {kind === "kakao"
          ? "아래 버튼으로 폰에 설정된 기본 브라우저에서 이 페이지를 연 뒤 로그인해 주세요."
          : kind === "line"
            ? "주소 복사 후 기본 브라우저 주소창에 붙여 넣거나, 상단 메뉴에서 ‘다른 브라우저’로 여세요."
            : "기본 브라우저에서 같은 주소로 열어 주세요."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {kind === "kakao" && (
          <button
            type="button"
            onClick={() => openKakaoTalkExternalBrowser()}
            className="btn-primary inline-flex items-center gap-1.5 py-2 pl-3 pr-3 text-[11px]"
          >
            <ExternalLink size={13} /> 기본 브라우저로 열기
          </button>
        )}
        {(kind === "line" ||
          kind === "instagram" ||
          kind === "facebook" ||
          kind === "other") && (
          <button
            type="button"
            onClick={() => void copyUrl()}
            className="btn-secondary inline-flex items-center gap-1.5 py-2 pl-3 pr-3 text-[11px]"
          >
            <Copy size={13} /> {copied ? "복사됨" : "주소 복사하기"}
          </button>
        )}
      </div>
    </div>
  );
}
