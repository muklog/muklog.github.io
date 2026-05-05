import { useEffect, useRef, useState } from "react";
import { Camera, Check, Image as ImageIcon, Loader2, Sparkles, X } from "lucide-react";
import type { User as FirebaseUser } from "firebase/auth";
import { AVATAR_PRESETS, blobToAvatarDataUrl, renderPresetAvatarDataUrl, type AvatarPreset } from "../lib/avatar";
import { cls } from "../lib/utils";

/**
 * 아바타 선택 다이얼로그.
 *
 * 세 가지 옵션:
 *   1) 구글 계정 사진 — auth.photoURL 이 있을 때만 노출.
 *   2) 내 사진 업로드 — 정사각 96x96 JPEG base64 data URL 로 정규화.
 *   3) 기본 샘플 — 앱 제공 이모지 프리셋을 canvas 에 래스터라이즈.
 *
 * onSave 는 "어떤 종류를 골랐는지 + 필요하면 dataUrl" 을 같이 반환한다.
 * dataUrl 이 없고 kind === "google" 이면 부모는 저장된 custom avatarDataUrl 을
 * 지워야 한다.
 */
export type AvatarPick =
  | { kind: "google" }
  | { kind: "upload"; dataUrl: string }
  | { kind: "preset"; dataUrl: string; presetId: string };

interface Props {
  authUser: FirebaseUser | null;
  /** 현재 선택되어 있는 값 (표시용 하이라이트) */
  currentKind?: "google" | "upload" | "preset";
  onClose: () => void;
  onSave: (pick: AvatarPick) => Promise<void> | void;
}

export default function AvatarPicker({ authUser, currentKind, onClose, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const canUseGoogle = !!authUser?.photoURL;

  async function handleGoogle() {
    if (!canUseGoogle || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await onSave({ kind: "google" });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handlePreset(p: AvatarPreset) {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const dataUrl = await renderPresetAvatarDataUrl(p);
      await onSave({ kind: "preset", dataUrl, presetId: p.id });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openFilePicker() {
    const el = fileInputRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      const dataUrl = await blobToAvatarDataUrl(f);
      await onSave({ kind: "upload", dataUrl });
      onClose();
    } catch (err) {
      setErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      {/* min-h 와 패딩으로 상단 헤더/노치에 가려지지 않게 */}
      <div className="flex min-h-[100dvh] items-end justify-center px-4 py-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:items-center sm:py-8">
        <div
          className="max-h-[min(85dvh,640px)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl sm:max-h-[min(90vh,680px)] sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-100">프로필 사진 변경</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-100"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </header>

        {err && (
          <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {err}
          </p>
        )}

        {/* 구글 계정 사진 */}
        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-300">Google 계정 사진</h3>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={!canUseGoogle || busy}
            className={cls(
              "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
              canUseGoogle
                ? "border-slate-800 bg-slate-900/60 hover:bg-slate-900"
                : "border-slate-800/50 bg-slate-900/30 opacity-60",
              currentKind === "google" && "ring-2 ring-brand-500",
            )}
          >
            {authUser?.photoURL ? (
              <img
                src={authUser.photoURL}
                alt=""
                className="h-12 w-12 rounded-full border border-slate-800 object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-xs text-slate-500">
                없음
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">구글 계정 사진 사용</p>
              <p className="text-[11px] text-slate-400">
                {canUseGoogle
                  ? "구글에서 바꾸면 이 앱에도 반영돼요."
                  : "구글 계정에 프로필 사진이 설정되어 있지 않아요."}
              </p>
            </div>
            {currentKind === "google" && <Check size={16} className="text-brand-400" />}
          </button>
        </section>

        {/* 내 사진 업로드 */}
        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-300">내 사진 업로드</h3>
          <button
            type="button"
            onClick={openFilePicker}
            disabled={busy}
            className={cls(
              "flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:bg-slate-900",
              currentKind === "upload" && "ring-2 ring-brand-500",
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300">
              <Camera size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">사진 선택 / 촬영</p>
              <p className="text-[11px] text-slate-400">
                정사각형으로 자동 잘라요. 96x96 으로 저장돼 용량이 작아요.
              </p>
            </div>
            {currentKind === "upload" && <Check size={16} className="text-brand-400" />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => void handleUpload(ev)}
          />
        </section>

        {/* 기본 샘플 */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-slate-300">
            <Sparkles size={12} className="mb-0.5 mr-1 inline text-brand-400" />
            기본 샘플
          </h3>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {AVATAR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void handlePreset(p)}
                disabled={busy}
                aria-label={p.label}
                className="flex aspect-square items-center justify-center rounded-xl border border-slate-800 text-3xl transition-transform hover:scale-105 disabled:opacity-50"
                style={{ backgroundColor: p.bg }}
              >
                <span>{p.emoji}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            <ImageIcon size={11} className="mb-0.5 mr-1 inline" />
            선택하면 96x96 PNG 로 저장돼 친구에게도 똑같이 보여요.
          </p>
        </section>

        {busy && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" /> 저장 중…
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
