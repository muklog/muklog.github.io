import { useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { Pencil, Save } from "lucide-react";
import AvatarPicker, { type AvatarPick } from "./AvatarPicker";
import AvatarBubble from "./AvatarBubble";
import { afterUserDataMutation, db } from "../lib/db";
import type { User } from "../types";
import { resolveDisplayName, resolveDisplayPhotoURL, syncMyIdentityToCloud } from "../lib/identity";
import { upsertMyPublicProfile } from "../lib/friends";

interface Props {
  user: User;
  authUser: FirebaseUser | null | undefined;
}

/** 설정(또는 헬스 등) — 닉네임·프로필 사진 변경 */
export default function ProfileIdentitySection({ user, authUser }: Props) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setName(user.name);
  }, [user.id, user.name]);

  const displayName = resolveDisplayName(user, authUser ?? undefined);
  const displayPhoto = resolveDisplayPhotoURL(user, authUser?.photoURL);

  async function saveAll(next: User) {
    await db.users.put({ ...next, updatedAt: Date.now() });
    afterUserDataMutation();
    if (authUser) {
      try {
        await Promise.all([
          upsertMyPublicProfile(authUser, next),
          syncMyIdentityToCloud(authUser, next),
        ]);
      } catch (e) {
        console.warn("[identity] cloud sync 실패", e);
      }
    }
  }

  async function commitName() {
    const trimmed = name.trim();
    if (!trimmed) {
      alert("닉네임을 입력해 주세요.");
      return;
    }
    if (trimmed === user.name) {
      setEditingName(false);
      return;
    }
    setBusy(true);
    try {
      await saveAll({ ...user, name: trimmed });
      setEditingName(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyAvatarPick(pick: AvatarPick) {
    const next: User =
      pick.kind === "google"
        ? { ...user, avatarKind: "google", avatarDataUrl: undefined }
        : pick.kind === "upload"
          ? { ...user, avatarKind: "upload", avatarDataUrl: pick.dataUrl }
          : { ...user, avatarKind: "preset", avatarDataUrl: pick.dataUrl };
    await saveAll(next);
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="group relative shrink-0"
          aria-label="프로필 사진 변경"
        >
          <AvatarBubble photoURL={displayPhoto} name={displayName} color={user.color} size={56} />
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-900 bg-brand-500 text-white shadow group-hover:bg-brand-400">
            <Pencil size={12} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          {!editingName ? (
            <>
              <div className="flex items-center gap-1.5">
                <p className="truncate text-base font-semibold text-slate-100">{displayName}</p>
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="shrink-0 rounded-lg bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 hover:text-slate-100"
                >
                  <Pencil size={11} /> 닉네임
                </button>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {authUser?.email ?? "Google 로그인 후 친구와 공유돼요"}
              </p>
            </>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitName();
                  }
                  if (e.key === "Escape") {
                    setName(user.name);
                    setEditingName(false);
                  }
                }}
                autoFocus
                maxLength={16}
                placeholder="닉네임"
                className="input text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  setName(user.name);
                  setEditingName(false);
                }}
                disabled={busy}
                className="btn-secondary shrink-0 px-3 py-2 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void commitName()}
                disabled={busy || !name.trim()}
                className="btn-primary shrink-0 px-3 py-2 text-xs disabled:opacity-60"
              >
                <Save size={12} /> 저장
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        닉네임과 프로필 사진은 친구의 피드·댓글에 함께 표시돼요.
      </p>

      {pickerOpen && (
        <AvatarPicker
          authUser={authUser ?? null}
          currentKind={user.avatarKind}
          onClose={() => setPickerOpen(false)}
          onSave={applyAvatarPick}
        />
      )}
    </section>
  );
}
