import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import AvatarBubble from "../components/AvatarBubble";
import AvatarPicker, { type AvatarPick } from "../components/AvatarPicker";
import GeminiApiKeyGuide from "../components/GeminiApiKeyGuide";
import FirebaseLoginCard from "../components/FirebaseLoginCard";
import {
  db,
  finishOnboardingSave,
  getSettings,
  migrateLocalProfileAndRecordsToUserId,
  patchSettings,
  runDexie,
} from "../lib/db";
import { pingGemini } from "../lib/ai";
import { nextColor } from "../lib/utils";
import { userFacingStorageErrorMessage } from "../lib/idbRetry";
import { useAuth } from "../contexts/AuthContext";
import { requestAutoCloudSync } from "../lib/autoCloudSync";
import type { User } from "../types";

export default function OnboardingPage() {
  const {
    user: authUser,
    firebaseReady,
    loading: authLoading,
  } = useAuth();

  const cloudSettings = useLiveQuery(() => getSettings(), []);
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState(() => nextColor([]));
  const [apiKey, setApiKey] = useState("");
  /** 입력란을 직접 건드리기 전에는 클라우드 동기화로 들어온 키를 반영 */
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [useGoogleAvatar, setUseGoogleAvatar] = useState(true);
  const [avatarKind, setAvatarKind] = useState<"upload" | "preset" | undefined>(undefined);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [pingState, setPingState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok"; model: string }
    | { kind: "fail"; msg: string }
  >({ kind: "idle" });
  const [keySavedFlash, setKeySavedFlash] = useState(false);
  // 사용자가 입력란을 만지기 시작했는지 — 일단 만지면 자동 prefill 이 더 이상
  // 덮어쓰지 않게 한다(클라우드/구글 값이 늦게 도착해도 사용자 입력 보존).
  const [touchedName, setTouchedName] = useState(false);
  /** 아바타·체크박스를 건드리면 클라우드에서 늦게 온 프로필이 덮어쓰지 않게 */
  const [profileTouched, setProfileTouched] = useState(false);

  // 클라우드 동기화나 로컬 단일 프로필 보정으로 이미 Dexie 에 user 가 들어있으면
  // 그 정보를 가져와 입력란에 미리 채워준다 — "이미 쓰던 계정으로 재진입" 시
  // 사용자가 굳이 다시 입력하지 않도록.
  const existingUser = useLiveQuery(async () => {
    const s = await getSettings();
    if (s?.activeUserId) {
      const u = await runDexie(() => db.users.get(s.activeUserId!));
      if (u) return u;
    }
    return await runDexie(() => db.users.orderBy("createdAt").first());
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

  useEffect(() => {
    if (apiKeyTouched) return;
    const k = cloudSettings?.geminiApiKey?.trim();
    if (k) setApiKey(k);
  }, [cloudSettings?.geminiApiKey, apiKeyTouched]);

  /** 온보딩 중 로그인 직후 비공개 설정(키)을 최대한 빨리 끌어옴 */
  useEffect(() => {
    if (!firebaseReady || !authUser) return;
    requestAutoCloudSync({ immediate: true });
  }, [firebaseReady, authUser?.uid]);

  const canContinueProfile = firebaseReady && !!authUser;
  const stepBlockedReason = !firebaseReady
    ? "firebase"
    : authLoading
      ? "loading"
      : !authUser
        ? "login"
        : null;

  async function saveGeminiKeyDuringOnboarding() {
    if (!canContinueProfile) return;
    await patchSettings({
      geminiApiKey: apiKey.trim() || undefined,
    });
    setPingState({ kind: "idle" });
    setKeySavedFlash(true);
    window.setTimeout(() => setKeySavedFlash(false), 2500);
  }

  async function testGeminiKeyDuringOnboarding() {
    if (!canContinueProfile || !apiKey.trim()) return;
    setPingState({ kind: "busy" });
    try {
      const result = await pingGemini(apiKey.trim());
      setPingState({ kind: "ok", model: result.model });
    } catch (e) {
      setPingState({
        kind: "fail",
        msg: e instanceof Error ? e.message : "연결 실패",
      });
    }
  }

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
    if (!firebaseReady || !authUser?.uid) {
      alert("먼저 Google로 로그인해 주세요.");
      return;
    }
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
      const baseUser = baseUserId
        ? await runDexie(() => db.users.get(baseUserId))
        : undefined;
      /** 온보딩은 Google 로그인 필수 — 프로필 id 는 항상 Firebase UID */
      const profileId = authUser.uid;

      if (baseUser) {
        if (profileId !== baseUser.id) {
          await migrateLocalProfileAndRecordsToUserId(baseUser.id, profileId);
        }
        const next: User = {
          ...baseUser,
          id: profileId,
          name,
          color,
          avatarKind: nextKind,
          avatarDataUrl: nextDataUrl,
          updatedAt: now,
        };
        await finishOnboardingSave({
          userRow: next,
          settingsPatch: {
            onboarded: true,
            activeUserId: profileId,
            geminiApiKey: apiKey.trim() || settings?.geminiApiKey,
          },
        });
      } else {
        const newUser: User = {
          id: profileId,
          name,
          color,
          avatarKind: nextKind,
          avatarDataUrl: nextDataUrl,
          createdAt: now,
          updatedAt: now,
        };
        await finishOnboardingSave({
          userRow: newUser,
          settingsPatch: {
            onboarded: true,
            activeUserId: profileId,
            geminiApiKey: apiKey.trim() || undefined,
          },
        });
      }
      window.location.replace(`${window.location.origin}${import.meta.env.BASE_URL}#/`);
    } catch (e) {
      console.error("[onboarding] finish 저장 실패", e);
      alert(userFacingStorageErrorMessage(e));
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
          먹로그에
          <br />
          오신 것을 환영해요
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          프로필을 만들고 식단·건강 기록을 사진으로 남기면 AI가 분석합니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          <strong className="text-slate-400">1단계</strong>에서 Google로 로그인한 뒤{" "}
          <strong className="text-slate-400">2단계</strong>에서 닉네임을 정할 수 있어요. 계정 전환은 추후 설정
          메뉴에서 할 수 있어요.
        </p>
      </header>

      <section className="mb-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/25 text-xs font-bold text-brand-200">
            1
          </span>
          Google로 로그인 <span className="text-emerald-400">(필수)</span>
        </h2>
        {authLoading && firebaseReady ? (
          <div className="card flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 size={18} className="animate-spin text-brand-400" />
            로그인 상태 확인 중…
          </div>
        ) : (
          <FirebaseLoginCard />
        )}
        {stepBlockedReason === "login" && !authLoading ? (
          <p className="mt-2 text-xs text-slate-500">
            위에서 로그인을 마치면 다음 단계(닉네임·프로필)가 열려요.
          </p>
        ) : null}
      </section>

      <section
        className={`mb-6 transition-opacity ${canContinueProfile ? "opacity-100" : "pointer-events-none opacity-40"}`}
        aria-hidden={!canContinueProfile}
      >
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-slate-200">
            2
          </span>
          프로필
        </h2>
        {!canContinueProfile && firebaseReady && !authLoading ? (
          <p className="mb-3 text-xs text-amber-200/90">Google 로그인 후 이용할 수 있어요.</p>
        ) : null}
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

      {pickerOpen && canContinueProfile && (
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

      <section
        className={`card mb-8 p-4 transition-opacity ${canContinueProfile ? "opacity-100" : "pointer-events-none opacity-40"}`}
        aria-hidden={!canContinueProfile}
      >
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
          <KeyRound size={16} className="text-brand-400" /> Google Gemini 키
        </h2>
        <p className="mb-2 text-xs leading-snug text-slate-400">
          식단·건강 AI 분석에는{" "}
          <strong className="font-semibold text-slate-200">Google API 키</strong>가 필요합니다. 무료 등급의 키를
          사용하시면 됩니다. 아래 사진을 확인한 후{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 underline"
          >
            Google AI Studio 키 페이지
          </a>
          로 이동해 키를 복사하고 돌아와주세요.
        </p>
        <div className="mb-2">
          <GeminiApiKeyGuide />
        </div>

        <div className="space-y-2">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKeyTouched(true);
                setApiKey(e.target.value);
              }}
              placeholder="AIzaSy..."
              className="input pr-12"
              autoComplete="off"
              spellCheck={false}
              disabled={!canContinueProfile}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400"
              disabled={!canContinueProfile}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveGeminiKeyDuringOnboarding()}
              disabled={!canContinueProfile}
              className="btn-primary flex-1 py-2 text-sm"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => void testGeminiKeyDuringOnboarding()}
              disabled={!canContinueProfile || !apiKey || pingState.kind === "busy"}
              className="btn-secondary flex-1 py-2 text-sm"
            >
              {pingState.kind === "busy" ? (
                <Loader2 size={14} className="mx-auto animate-spin" />
              ) : (
                "연결 테스트"
              )}
            </button>
          </div>

          {pingState.kind === "ok" && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-400">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} /> 연결됨
              </span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-200">
                {pingState.model}
              </span>
            </p>
          )}
          {pingState.kind === "fail" && (
            <p className="flex items-start gap-1.5 text-xs text-rose-400">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{pingState.msg}</span>
            </p>
          )}
          {keySavedFlash && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={14} /> 저장됨
            </p>
          )}
        </div>
      </section>

      <p className="text-center text-[11px] text-slate-600">
        <Link to="/privacy" className="text-brand-400 underline">
          개인정보 처리방침 · 서비스 안내
        </Link>
      </p>

      <button
        type="button"
        onClick={() => void finish()}
        disabled={busy || !canContinueProfile}
        className="btn-primary mt-auto w-full py-4 text-base disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "준비 중…" : canContinueProfile ? "시작하기" : "먼저 Google로 로그인"}
      </button>
    </div>
  );
}
