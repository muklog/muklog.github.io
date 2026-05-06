import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import AvatarBubble from "../components/AvatarBubble";
import AvatarPicker, { type AvatarPick } from "../components/AvatarPicker";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import { afterUserDataMutation, db, getSettings, patchSettings, uid } from "../lib/db";
import { nextColor } from "../lib/utils";
import { useAuth } from "../contexts/AuthContext";
import type { User } from "../types";

export default function OnboardingPage() {
  const { user: authUser } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState(() => nextColor([]));
  const [apiKey, setApiKey] = useState("");
  const [useGoogleAvatar, setUseGoogleAvatar] = useState(true);
  const [avatarKind, setAvatarKind] = useState<"upload" | "preset" | undefined>(undefined);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 사용자가 입력란을 만지기 시작했는지 — 일단 만지면 자동 prefill 이 더 이상
  // 덮어쓰지 않게 한다(클라우드/구글 값이 늦게 도착해도 사용자 입력 보존).
  const [touchedName, setTouchedName] = useState(false);
  /** 아바타·체크박스·색을 건드리면 클라우드에서 늦게 온 프로필이 덮어쓰지 않게 */
  const [profileTouched, setProfileTouched] = useState(false);

  // 클라우드 동기화나 1인 모드 보정으로 이미 Dexie 에 user 가 들어있으면
  // 그 정보를 가져와 입력란에 미리 채워준다 — "이미 쓰던 계정으로 재진입" 시
  // 사용자가 굳이 다시 입력하지 않도록.
  const existingUser = useLiveQuery(async () => {
    const s = await getSettings();
    if (s?.activeUserId) {
      const u = await db.users.get(s.activeUserId);
      if (u) return u;
    }
    return await db.users.orderBy("createdAt").first();
  }, []);

  useEffect(() => {
    if (touchedName || profileTouched) return;
    if (existingUser?.name) {
      setDisplayName(existingUser.name);
      if (existingUser.color) setColor(existingUser.color);
      const k = existingUser.avatarKind;
      if (k === "google") {
        setUseGoogleAvatar(true);
        setAvatarKind(undefined);
        setAvatarDataUrl(undefined);
      } else if (k === "preset" || k === "upload") {
        setUseGoogleAvatar(false);
        setAvatarKind(k);
        setAvatarDataUrl(existingUser.avatarDataUrl);
      } else {
        setAvatarKind(undefined);
        setAvatarDataUrl(undefined);
        if (k === undefined && !authUser?.photoURL) {
          setUseGoogleAvatar(false);
        }
      }
      return;
    }
    if (authUser?.displayName) {
      setDisplayName(authUser.displayName);
    }
  }, [
    profileTouched,
    touchedName,
    existingUser?.id,
    existingUser?.name,
    existingUser?.color,
    existingUser?.avatarKind,
    existingUser?.avatarDataUrl,
    authUser?.uid,
    authUser?.photoURL,
    authUser?.displayName,
  ]);

  function computeAvatarFields(): Pick<User, "avatarKind" | "avatarDataUrl"> {
    const googleAvatarAvailable = !!authUser?.photoURL;
    if (googleAvatarAvailable && useGoogleAvatar) {
      return { avatarKind: "google", avatarDataUrl: undefined };
    }
    if (avatarKind === "preset" || avatarKind === "upload") {
      return { avatarKind, avatarDataUrl: avatarDataUrl };
    }
    return { avatarKind: undefined, avatarDataUrl: undefined };
  }

  async function finish() {
    const name = displayName.trim();
    if (!name) {
      alert("이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const now = Date.now();
      const { avatarKind: nextKind, avatarDataUrl: nextDataUrl } = computeAvatarFields();
      const settings = await getSettings();
      const baseUserId = settings?.activeUserId || existingUser?.id;
      const baseUser = baseUserId ? await db.users.get(baseUserId) : undefined;

      if (baseUser) {
        const next: User = {
          ...baseUser,
          name,
          color,
          avatarKind: nextKind,
          avatarDataUrl: nextDataUrl,
          updatedAt: now,
        };
        await db.users.put(next);
        afterUserDataMutation();
        await patchSettings({
          onboarded: true,
          activeUserId: next.id,
          geminiApiKey: apiKey.trim() || settings?.geminiApiKey,
        });
      } else {
        const id = uid();
        const newUser: User = {
          id,
          name,
          color,
          avatarKind: nextKind,
          avatarDataUrl: nextDataUrl,
          createdAt: now,
          updatedAt: now,
        };
        await db.users.bulkPut([newUser]);
        afterUserDataMutation();
        await patchSettings({
          onboarded: true,
          activeUserId: id,
          geminiApiKey: apiKey.trim() || undefined,
        });
      }
      window.location.replace(`${window.location.origin}${import.meta.env.BASE_URL}#/`);
    } catch (e) {
      console.error("[onboarding] finish 저장 실패", e);
      alert(
        e instanceof Error
          ? `저장에 실패했습니다: ${e.message}`
          : "저장에 실패했습니다. 사이트 데이터(IndexedDB) 저장이 막혀 있지 않은지 확인해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  const previewPhoto =
    useGoogleAvatar && authUser?.photoURL
      ? authUser.photoURL
      : avatarKind === "preset" || avatarKind === "upload"
        ? avatarDataUrl
        : undefined;

  async function applyAvatarPick(pick: AvatarPick) {
    setProfileTouched(true);
    if (pick.kind === "google") {
      setUseGoogleAvatar(true);
      setAvatarKind(undefined);
      setAvatarDataUrl(undefined);
      return;
    }
    setUseGoogleAvatar(false);
    if (pick.kind === "preset") {
      setAvatarKind("preset");
      setAvatarDataUrl(pick.dataUrl);
      return;
    }
    setAvatarKind("upload");
    setAvatarDataUrl(pick.dataUrl);
  }

  return (
    <div className="flex min-h-full flex-col px-5 pb-10 pt-8">
      <header className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-300">
          ✨ 시작하기
        </div>
        <h1 className="text-3xl font-bold leading-tight">
          헬스헬스에
          <br />
          오신 것을 환영해요
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          프로필을 만들고 식단·건강 기록을 사진으로 남기면 AI가 분석합니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          기존 클라우드 데이터는 아래 <strong className="text-slate-400">Google 로그인</strong> 후 이어집니다. 계정 바꾸기는{" "}
          <Link to="/settings" className="text-brand-400 underline">
            설정
          </Link>
          .
        </p>
      </header>

      <div className="mb-6">
        <FirebaseLoginCard />
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">프로필</h2>
        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="shrink-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            aria-label="프로필 사진·아이콘 선택"
          >
            {useGoogleAvatar && authUser?.photoURL ? (
              <img
                src={authUser.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="h-11 w-11 rounded-xl border border-slate-800 object-cover"
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <AvatarBubble
                  photoURL={previewPhoto}
                  name={displayName.trim() || "?"}
                  color={color}
                  size={44}
                />
              </div>
            )}
          </button>
          <label
            className="relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80"
            title="이니셜·강조 색"
          >
            <span
              className="h-7 w-7 rounded-lg border border-slate-600"
              style={{ backgroundColor: color }}
            />
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setProfileTouched(true);
                setColor(e.target.value);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setTouchedName(true);
            }}
            placeholder="표시 이름"
            className="input border-transparent bg-transparent flex-1 px-2"
            maxLength={16}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          왼쪽을 누르면{" "}
          <span className="text-slate-400">기본 아이콘 · 사진 업로드 · 구글 사진</span> 을 고를 수 있어요.
        </p>
        {authUser?.photoURL && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={useGoogleAvatar}
              onChange={(e) => {
                setProfileTouched(true);
                setUseGoogleAvatar(e.target.checked);
                if (e.target.checked) {
                  setAvatarKind(undefined);
                  setAvatarDataUrl(undefined);
                }
              }}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-brand-500"
            />
            <span>구글 계정 프로필 사진을 사용할래요</span>
          </label>
        )}
        <p className="mt-1 text-[11px] text-slate-500">
          닉네임과 프로필 사진은 나중에{" "}
          <span className="text-slate-400">건강 탭</span> 에서 언제든 바꿀 수 있어요.
        </p>
      </section>

      {pickerOpen && (
        <AvatarPicker
          authUser={authUser ?? null}
          currentKind={
            useGoogleAvatar && authUser?.photoURL
              ? "google"
              : avatarKind === "preset"
                ? "preset"
                : avatarKind === "upload"
                  ? "upload"
                  : undefined
          }
          onClose={() => setPickerOpen(false)}
          onSave={async (pick) => {
            await applyAvatarPick(pick);
          }}
        />
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">
          Google Gemini 키 <span className="text-slate-500">(선택)</span>
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-brand-400 underline">
            AI Studio
          </a>
          에서 발급 · 나중에 설정에서도 가능
        </p>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="AIzaSy..."
          className="input"
          autoComplete="off"
        />
      </section>

      <button
        type="button"
        onClick={() => void finish()}
        disabled={busy}
        className="btn-primary mt-auto w-full py-4 text-base"
      >
        {busy ? "준비 중…" : "시작하기"}
      </button>
    </div>
  );
}
