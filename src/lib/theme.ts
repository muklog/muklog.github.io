import { DEFAULT_THEME, THEME_IDS, type ThemeId } from "../types";

const STORAGE_KEY = "muklog_theme";
const LEGACY_THEME_STORAGE_KEY = "mealog_theme";

/** localStorage 또는 알 수 없는 값(과거 "default" 등)을 안전하게 ThemeId 로 정규화. */
export function normalizeTheme(v: unknown): ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v)
    ? (v as ThemeId)
    : DEFAULT_THEME;
}

/**
 * DOM 에 `data-theme` 을 적용하고 localStorage 에 캐시합니다.
 * 4개 테마(green/blue/pink/yellow) 모두 attribute 로 명시 → :root[data-theme="..."] 에서
 * 색 변수를 정의하므로 분기 없이 일관됩니다.
 * main.tsx 부팅 / 설정 변경 / 클라우드 동기화 후 모두 호출됩니다.
 */
export function applyTheme(t: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(STORAGE_KEY, t);
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // private mode 등 — 무시
  }
}

/** 캐시된 테마(=직전 세션의 선택값). 초기 페인트 깜빡임 방지에 사용. */
export function getCachedTheme(): ThemeId {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  try {
    const cur = localStorage.getItem(STORAGE_KEY);
    if (cur != null && cur !== "") return normalizeTheme(cur);
    const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy != null && legacy !== "") {
      const t = normalizeTheme(legacy);
      localStorage.setItem(STORAGE_KEY, t);
      return t;
    }
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Settings 의 theme(영속) 와 localStorage(첫 페인트용) 양쪽을 일관되게 갱신. */
export function persistTheme(t: ThemeId): void {
  applyTheme(t);
}
