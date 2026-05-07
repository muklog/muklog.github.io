import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { HeartPulse, Pencil, Plus, Ruler, Save, Scale, X } from "lucide-react";
import {
  afterUserDataMutation,
  db,
  getAnalysisProfileForUser,
  getSettings,
  registerCloudDelete,
  runDexie,
  uid,
} from "../lib/db";
import { analyzeHealthImage } from "../lib/ai";
import { userFacingStorageErrorMessage } from "../lib/idbRetry";
import {
  HEALTH_TYPE_LABELS,
  type HealthRecord,
  type HealthRecordType,
  type User,
} from "../types";
import HealthScoreRing from "../components/HealthScoreRing";
import HealthRecordCard from "../components/HealthRecordCard";
import PhotoUpload from "../components/PhotoUpload";
import { usePrimaryUserId } from "../hooks/usePrimaryUserId";
import { dateKey, formatKoDate, cls } from "../lib/utils";

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function HealthPage() {
  const settings = useLiveQuery(() => getSettings(), []);
  const userId = usePrimaryUserId();
  const profile = useLiveQuery(
    async () => (userId ? await runDexie(() => db.users.get(userId)) : undefined),
    [userId],
  );
  const [pickedType, setPickedType] = useState<HealthRecordType>("checkup");

  const records = useLiveQuery(
    async () =>
      userId
        ? (
            await runDexie(() =>
              db.health.where("userId").equals(userId).toArray(),
            )
          ).sort((a, b) => {
            const d = b.recordDate.localeCompare(a.recordDate);
            if (d !== 0) return d;
            return (b.createdAt ?? 0) - (a.createdAt ?? 0);
          })
        : [],
    [userId],
  );

  const latest = records?.[0];

  async function addRecord(photo: Blob, thumbnail: Blob) {
    if (!userId) return;
    const now = Date.now();
    const id = uid();
    const rec: HealthRecord = {
      id,
      userId,
      type: pickedType,
      recordDate: dateKey(),
      photo,
      thumbnail,
      analysisStatus: settings?.geminiApiKey ? "analyzing" : "skipped",
      createdAt: now,
      updatedAt: now,
    };
    await runDexie(() => db.health.put(rec));
    afterUserDataMutation();
    if (settings?.geminiApiKey) {
      runAnalysis(id, photo, pickedType, settings.geminiApiKey);
    }
  }

  async function runAnalysis(
    id: string,
    photo: Blob,
    type: HealthRecordType,
    key: string,
  ) {
    try {
      const prof = await getAnalysisProfileForUser(userId);
      const result = await analyzeHealthImage(
        key,
        photo,
        HEALTH_TYPE_LABELS[type],
        undefined,
        prof,
      );
      const cur = await runDexie(() => db.health.get(id));
      if (!cur) return;
      await runDexie(() =>
        db.health.put({
          ...cur,
          extractedText: result.extractedText,
          metrics: result.metrics,
          healthScore: result.healthScore,
          summary: result.summary,
          strengths: result.strengths,
          concerns: result.concerns,
          recommendations: result.recommendations,
          analysisStatus: "done",
          analysisError: undefined,
          updatedAt: Date.now(),
        }),
      );
      afterUserDataMutation();
    } catch (e) {
      const cur = await runDexie(() => db.health.get(id));
      if (!cur) return;
      await runDexie(() =>
        db.health.put({
          ...cur,
          analysisStatus: "error",
          analysisError: e instanceof Error ? e.message : String(e),
          updatedAt: Date.now(),
        }),
      );
      afterUserDataMutation();
    }
  }

  async function reAnalyze(rec: HealthRecord) {
    if (!rec.photo || !settings?.geminiApiKey) return;
    await runDexie(() =>
      db.health.put({
        ...rec,
        analysisStatus: "analyzing",
        analysisError: undefined,
        updatedAt: Date.now(),
      }),
    );
    afterUserDataMutation();
    runAnalysis(rec.id, rec.photo, rec.type, settings.geminiApiKey);
  }

  async function removeRecord(rec: HealthRecord) {
    if (!confirm("이 건강 기록을 삭제할까요?")) return;
    await runDexie(() => db.health.delete(rec.id));
    await registerCloudDelete("health", rec.id);
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5">
      <header>
        <p className="text-xs text-slate-400">
          건강 프로필 <span className="ml-1 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">비공개</span>
        </p>
        <h1 className="text-xl font-bold">
          <HeartPulse size={18} className="mb-0.5 mr-1 inline text-rose-400" />
          내 건강 점수
        </h1>
        <p className="mt-1 text-[11px] text-slate-500">
          이 탭의 정보는 친구와 공유되지 않아요.
        </p>
      </header>

      {profile && <ProfileCard user={profile} />}

      {profile && <FocusConditionsCard user={profile} />}

      <section className="card flex items-center gap-4 p-5">
        <HealthScoreRing score={latest?.healthScore} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">최근 건강 평가</p>
          <h2 className="mt-0.5 break-words text-base font-semibold leading-snug text-slate-100">
            {latest?.summary ?? "검진·인바디 사진을 올려 보세요."}
          </h2>
          {latest && (
            <p className="mt-1 text-xs text-slate-500">
              {HEALTH_TYPE_LABELS[latest.type]} · {formatKoDate(latest.recordDate)}
            </p>
          )}
        </div>
      </section>

      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">새 건강기록 추가</h3>

        <div className="mb-3 flex flex-wrap gap-2">
          {(Object.keys(HEALTH_TYPE_LABELS) as HealthRecordType[]).map((t) => (
            <button
              key={t}
              onClick={() => setPickedType(t)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                (pickedType === t
                  ? "border-brand-500 bg-brand-500/15 text-brand-200"
                  : "border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200")
              }
            >
              {HEALTH_TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <PhotoUpload
          label={`${HEALTH_TYPE_LABELS[pickedType]} 사진 찍기`}
          onPicked={addRecord}
          disabled={!userId}
          compressOptions={{ maxDimension: 2400, quality: 0.92 }}
        />
        {!settings?.geminiApiKey && (
          <Link
            to="/settings"
            className="mt-3 block rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400"
          >
            AI 분석은 설정에 Gemini 키가 필요합니다.
          </Link>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="px-1 text-sm font-semibold text-slate-300">
          기록 ({records?.length ?? 0})
        </h3>
        {records && records.length === 0 && (
          <p className="card p-4 text-center text-sm text-slate-500">
            아직 등록된 건강기록이 없어요.
          </p>
        )}
        {records?.map((r) => (
          <HealthRecordCard
            key={r.id}
            record={r}
            onReanalyze={() => reAnalyze(r)}
            onRemove={() => removeRecord(r)}
            canAnalyze={!!settings?.geminiApiKey}
          />
        ))}
      </section>
    </div>
  );
}

// ---------------- 프로필 카드 (키/몸무게/생년월일/성별) ----------------

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function splitBirthParts(iso?: string): { y: string; m: string; d: string } {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { y: "", m: "", d: "" };
  const [ys, ms, ds] = iso.split("-");
  return { y: ys, m: String(parseInt(ms, 10)), d: String(parseInt(ds, 10)) };
}

function composeBirthIso(y: string, m: string, d: string): string | undefined {
  const yt = y.trim();
  const mt = m.trim();
  const dt = d.trim();
  if (!yt || !mt || !dt) return undefined;
  const yi = Number(yt);
  const mi = Number(mt);
  const di = Number(dt);
  if (!Number.isFinite(yi) || !Number.isFinite(mi) || !Number.isFinite(di)) return undefined;
  const dim = daysInMonth(yi, mi);
  const dc = Math.min(di, dim);
  return `${yi}-${String(mi).padStart(2, "0")}-${String(dc).padStart(2, "0")}`;
}

function birthYearOptions(): number[] {
  const cy = new Date().getFullYear();
  const minY = cy - 100;
  const list: number[] = [];
  for (let yy = cy; yy >= minY; yy--) list.push(yy);
  return list;
}

function ProfileCard({ user }: { user: User }) {
  const [editing, setEditing] = useState(false);
  const [height, setHeight] = useState<string>(numToStr(user.heightCm));
  const [weight, setWeight] = useState<string>(numToStr(user.weightKg));
  const [birthY, setBirthY] = useState<string>(() => splitBirthParts(user.birthDate).y);
  const [birthM, setBirthM] = useState<string>(() => splitBirthParts(user.birthDate).m);
  const [birthD, setBirthD] = useState<string>(() => splitBirthParts(user.birthDate).d);
  const [gender, setGender] = useState<User["gender"]>(user.gender);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHeight(numToStr(user.heightCm));
    setWeight(numToStr(user.weightKg));
    const p = splitBirthParts(user.birthDate);
    setBirthY(p.y);
    setBirthM(p.m);
    setBirthD(p.d);
    setGender(user.gender);
  }, [user.id, user.heightCm, user.weightKg, user.birthDate, user.gender]);

  const maxDayForPick =
    birthY && birthM ? daysInMonth(Number(birthY), Number(birthM)) : 31;

  useEffect(() => {
    if (!birthY || !birthM || !birthD) return;
    const d = Number(birthD);
    if (d > maxDayForPick) setBirthD(String(maxDayForPick));
  }, [birthY, birthM, maxDayForPick, birthD]);

  async function save() {
    setBusy(true);
    try {
      const composedBirth = composeBirthIso(birthY, birthM, birthD);
      const next: User = {
        ...user,
        heightCm: strToNum(height),
        weightKg: strToNum(weight),
        birthDate: composedBirth,
        gender,
        updatedAt: Date.now(),
      };
      await runDexie(() => db.users.put(next));
      afterUserDataMutation();
      setEditing(false);
    } catch (e) {
      alert(userFacingStorageErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const age = useMemo(() => calcAge(user.birthDate), [user.birthDate]);

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">신체 프로필</h3>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-300 hover:text-slate-100"
          >
            <Pencil size={11} /> 편집
          </button>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <ProfileRow icon={<Ruler size={12} />} label="키" value={user.heightCm ? `${user.heightCm} cm` : "—"} />
          <ProfileRow icon={<Scale size={12} />} label="체중" value={user.weightKg ? `${user.weightKg} kg` : "—"} />
          <ProfileRow label="생년월일" value={user.birthDate ? `${user.birthDate}${age !== undefined ? ` (${age}세)` : ""}` : "—"} />
          <ProfileRow
            label="성별"
            value={
              user.gender === "male"
                ? "남성"
                : user.gender === "female"
                  ? "여성"
                  : user.gender === "other"
                    ? "기타"
                    : "—"
            }
          />
          <p className="col-span-2 mt-1 text-[11px] text-slate-500">
            이 정보는 AI 가 내 식단·건강 점수를 더 정확히 평가하는 데 쓰여요.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <Field label="키 (cm)">
              <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} className="input" placeholder="예: 172" />
            </Field>
            <Field label="체중 (kg)">
              <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className="input" placeholder="예: 65" />
            </Field>
            <div className="col-span-2 space-y-1">
              <span className="text-[11px] font-medium text-slate-300">생년월일</span>
              <div className="flex gap-2">
                <select
                  value={birthY}
                  onChange={(e) => setBirthY(e.target.value)}
                  className="input min-w-0 flex-[1.15] text-xs"
                  aria-label="출생 연도"
                >
                  <option value="">연도</option>
                  {birthYearOptions().map((y) => (
                    <option key={y} value={String(y)}>
                      {y}년
                    </option>
                  ))}
                </select>
                <select
                  value={birthM}
                  onChange={(e) => setBirthM(e.target.value)}
                  className="input min-w-0 flex-1 text-xs"
                  aria-label="출생 월"
                >
                  <option value="">월</option>
                  {MONTH_OPTIONS.map((mo) => (
                    <option key={mo} value={String(mo)}>
                      {mo}월
                    </option>
                  ))}
                </select>
                <select
                  value={birthD}
                  onChange={(e) => setBirthD(e.target.value)}
                  className="input min-w-0 flex-1 text-xs"
                  aria-label="출생 일"
                >
                  <option value="">일</option>
                  {Array.from({ length: maxDayForPick }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={String(day)}>
                      {day}일
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] leading-snug text-slate-500">달력 대신 목록에서 고르면 됩니다. 입력 안 하면 비워 둬요.</p>
            </div>
            <Field label="성별" className="col-span-2">
              <select
                value={gender ?? ""}
                onChange={(e) => setGender((e.target.value || undefined) as User["gender"])}
                className="input"
              >
                <option value="">선택 안 함</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
                <option value="other">기타</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setEditing(false)} className="btn-secondary flex-1 py-1.5 text-xs">
              취소
            </button>
            <button onClick={() => void save()} disabled={busy} className="btn-primary flex-1 py-1.5 text-xs disabled:opacity-60">
              <Save size={12} /> 저장
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cls("block space-y-1", className)}>
      <span className="text-[11px] font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function numToStr(n: number | undefined): string {
  return n === undefined || Number.isNaN(n) ? "" : String(n);
}

function strToNum(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function calcAge(birthDate?: string): number | undefined {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return undefined;
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const passed =
    now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!passed) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

// ---------------- 관심 조건 카드 ----------------

function FocusConditionsCard({ user }: { user: User }) {
  const current = user.focusConditions ?? [];
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const t = input.trim();
    if (!t) return;
    if (current.includes(t)) {
      setInput("");
      return;
    }
    setBusy(true);
    try {
      await runDexie(() =>
        db.users.put({
          ...user,
          focusConditions: [...current, t],
          updatedAt: Date.now(),
        }),
      );
      afterUserDataMutation();
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: string) {
    setBusy(true);
    try {
      const next = current.filter((x) => x !== t);
      await runDexie(() =>
        db.users.put({
          ...user,
          focusConditions: next.length > 0 ? next : undefined,
          updatedAt: Date.now(),
        }),
      );
      afterUserDataMutation();
    } finally {
      setBusy(false);
    }
  }

  // 자주 쓰는 추천 라벨 — 탭으로 빠르게 추가.
  const SUGGESTED = ["혈당", "요산", "혈압", "콜레스테롤", "체중", "근육"];

  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold text-slate-200">중점 관리 영역</h3>
      <p className="mt-1 text-[11px] text-slate-500">
        관심 영역을 추가하면 식단·건강 분석이 해당 영양소를 더 세심히 평가해요.{" "}
        <span className="text-slate-400">
          민감 정보라, 친구가 보는 식단 분석에는 구체 병명이 절대 나타나지 않아요.
        </span>
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {current.length === 0 && (
          <span className="text-[11px] text-slate-500">아직 추가된 항목이 없어요.</span>
        )}
        {current.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-1 text-xs text-rose-200"
          >
            {t}
            <button
              type="button"
              onClick={() => void remove(t)}
              disabled={busy}
              className="text-rose-200/70 hover:text-rose-100 disabled:opacity-50"
              aria-label={`${t} 제거`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="예: 혈당, 요산, 혈압"
          className="input text-xs"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !input.trim()}
          className="btn-secondary px-3 py-2 text-xs"
        >
          <Plus size={12} /> 추가
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTED.filter((s) => !current.includes(s)).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setInput(s);
            }}
            className="rounded-full border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
          >
            + {s}
          </button>
        ))}
      </div>
    </section>
  );
}
