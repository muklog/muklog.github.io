import { format, parse } from "date-fns";
import { ko } from "date-fns/locale";
import type { MealSlot } from "../types";

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const DATE_KEY_FMT = "yyyy-MM-dd";

export function dateKey(date: Date = new Date()): string {
  return format(date, DATE_KEY_FMT);
}

/**
 * 현재 시각(로컬) 기준으로 오늘 기록 넣기에 맞는 끼니 슬롯.
 * 버튼·링크는 매 렌더마다 호출되어 탭을 켜 둔 동안 시간이 바뀌면 다음 이동에 반영된다.
 */
export function suggestMealSlotForNow(now: Date = new Date()): MealSlot {
  const m = now.getHours() * 60 + now.getMinutes();
  // 새벽 ~ 이른 아침: 야식/간식
  if (m < 5 * 60) return "eveningSnack";
  // 아침 05:00–09:59
  if (m < 10 * 60) return "breakfast";
  // 오전 간식 10:00–10:59
  if (m < 11 * 60) return "morningSnack";
  // 점심 11:00–14:29
  if (m < 14 * 60 + 30) return "lunch";
  // 오후 간식 14:30–16:59
  if (m < 17 * 60) return "afternoonSnack";
  // 저녁 17:00–21:29
  if (m < 21 * 60 + 30) return "dinner";
  // 밤 이후 야식
  return "eveningSnack";
}

export function parseDateKey(key: string): Date {
  return parse(key, DATE_KEY_FMT, new Date());
}

export function formatKoDate(date: Date | string, fmt = "yyyy년 M월 d일 (E)") {
  const d = typeof date === "string" ? parseDateKey(date) : date;
  return format(d, fmt, { locale: ko });
}

export function formatKoMonth(date: Date) {
  return format(date, "yyyy년 M월", { locale: ko });
}

/** 색상 팔레트 - 사용자 추가시 자동 할당 */
export const USER_COLOR_PALETTE = [
  "#10b981", // emerald
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#a855f7", // purple
];

export function nextColor(usedColors: string[]): string {
  return (
    USER_COLOR_PALETTE.find((c) => !usedColors.includes(c)) ??
    USER_COLOR_PALETTE[usedColors.length % USER_COLOR_PALETTE.length]
  );
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function scoreColor(score: number | undefined): string {
  if (score == null) return "#64748b";
  if (score >= 85) return "#10b981";
  if (score >= 70) return "#84cc16";
  if (score >= 55) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

export function scoreLabel(score: number | undefined): string {
  if (score == null) return "—";
  if (score >= 85) return "매우 좋음";
  if (score >= 70) return "양호";
  if (score >= 55) return "보통";
  if (score >= 40) return "주의";
  return "위험";
}
