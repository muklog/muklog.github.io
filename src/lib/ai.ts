/**
 * Google Gemini API 래퍼.
 * - 사용자가 본인 API 키를 설정에 입력 → 클라이언트에서 직접 호출 (서버 불필요)
 * - 식단 사진 분석, 건강검진/인바디 OCR + 점수화에 사용
 *
 * Gemini Free Tier:
 *   모델/일별·분당 한도는 Google 정책에 따라 변동됩니다. 429면 한도 초과입니다.
 *   기본 모델은 무료 티어에서 상대적으로 여유 있는 flash-lite 계열을 씁니다.
 */
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { blobToBase64, compressImage } from "./image";
import type { MealSlot } from "../types";

/** AI Studio 무료 한도 표가 보통 2.5 Flash Lite 기준이므로, 2.0 계열과 쿼터 풀이 다를 수 있음 */
export const DEFAULT_MODEL = "gemini-2.5-flash-lite";

/** 429 등 Google 쿼터/속도 제한 시 사용자 안내 */
function formatGeminiFailure(prefix: string, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const quota =
    /\b429\b/.test(raw) ||
    /quota|rate limit|exceeded your current quota/i.test(raw);
  if (quota) {
    return `${prefix}: Google API 무료(또는 현재 요금제) 한도를 넘었습니다(429). 한도는 사진 파일 크기보다 하루·분당 요청 횟수와 토큰으로 정해지는 경우가 많습니다. 몇 분~몇 시간 뒤 다시 시도해 주세요. 사용량: https://ai.dev/rate-limit · 한도 안내: https://ai.google.dev/gemini-api/docs/rate-limits`;
  }
  return `${prefix}: ${raw}`;
}

export class AIError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AIError";
  }
}

/** Gemini `generateContent` 가 무기한 대기하지 않도록 (느린 네트워크·API 지연) */
const GEMINI_GENERATE_TIMEOUT_MS = 120_000;

const GEMINI_TIMEOUT_MESSAGE =
  "AI 응답이 너무 오래 걸렸습니다(약 2분). 네트워크 상태를 확인한 뒤 아래 「다시 시도」를 눌러 주세요.";

function withGenerativeTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AIError(GEMINI_TIMEOUT_MESSAGE));
    }, GEMINI_GENERATE_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function getModel(apiKey: string, modelName?: string): GenerativeModel {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName || DEFAULT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });
}

/** JSON 응답 안전 파싱 (모델이 마크다운으로 감싸도 처리) */
function safeParseJson<T>(text: string): T {
  let t = text.trim();
  // ```json ... ``` 형태 제거
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  // 앞뒤로 붙은 잡문 제거
  const start = t.indexOf("{");
  const startArr = t.indexOf("[");
  const realStart =
    start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (realStart > 0) t = t.slice(realStart);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end !== -1) t = t.slice(0, end + 1);
  try {
    return JSON.parse(t) as T;
  } catch (e) {
    throw new AIError("AI 응답을 해석하지 못했습니다.", e);
  }
}

// ---------- 식단 분석 ----------

export interface MealAnalysis {
  menuText: string;
  rating: number; // 1~5
  aiComment: string;
  /** 사진 속에 분명히 식사·먹거리·음료(식단 맥락) 가 보일 때만 true. false면 사용자 일기에서는 남지만 친구 피드·동기화에선 제외된다. */
  isMealPhoto: boolean;
  nutrition?: {
    calories?: number;
    carbs?: number;
    protein?: number;
    fat?: number;
    /** 당류·가당 추정 (g) */
    sugar?: number;
    healthTags?: string[];
  };
}

/**
 * AI 분석에 반영할 사용자 프로필/관심 컨디션.
 *
 * 민감정보(구체 병명)는 AI 응답에 직접 등장하지 않도록 시스템 프롬프트에서
 * 강제하고, 대신 라벨을 "영양소 기준의 조심 포인트"로 해석하게 한다.
 */
export interface AnalysisProfile {
  heightCm?: number;
  weightKg?: number;
  /** 연 단위 나이 */
  ageYears?: number;
  gender?: "male" | "female" | "other";
  focusConditions?: string[];
}

/**
 * 끼니(슬롯)별 맥락 — AI 가 그 시간대에 맞는 기준으로 평가하도록 가이드합니다.
 *
 * 각 슬롯의 핵심 컨셉:
 * - 정찬(아침/점심/저녁): 영양 균형·적정 양이 우선.
 * - 간식(오전/오후/야식): 양·당·지방이 과하면 감점, 가볍고 단백질·식이섬유 위주면 가점.
 * - 야식: 수면에 부담 주는 고지방·고탄수·매운 자극은 강하게 감점.
 */
const MEAL_SLOT_CONTEXT: Record<MealSlot, { label: string; guide: string }> = {
  breakfast: {
    label: "아침 식사",
    guide:
      "기상 후 첫 끼니. 혈당이 급격히 튀지 않도록 복합 탄수 + 단백질 + 식이섬유의 균형을 가장 높이 평가하세요. 단당류·튀김류·과한 가공식품은 감점. 너무 가벼워서 오전 집중에 영향을 줄 정도면 적정량 부족으로 평가.",
  },
  morningSnack: {
    label: "오전 간식",
    guide:
      "가벼운 보충용 간식(권장 100~200kcal 내외). 과일·견과류·요거트·소량의 단백질 등은 가점, 과자·디저트·고당 음료는 감점. 정찬급 양이면 '간식으로는 과함' 으로 감점하고 aiComment 에 그 이유를 적으세요.",
  },
  lunch: {
    label: "점심 식사",
    guide:
      "하루의 메인 끼니. 단백질·채소·복합 탄수가 골고루 갖춰졌는지가 핵심. 너무 가벼우면 오후 폭식·집중력 저하 위험으로 감점, 과식·튀김 위주면 식곤증·소화 부담으로 감점.",
  },
  afternoonSnack: {
    label: "오후 간식",
    guide:
      "에너지 보충용 가벼운 간식(권장 100~200kcal). 카페인 음료는 양에 따라 평가. 과한 당·지방, 정찬 분량은 감점. 단백질·과일·견과류·요거트 등은 가점.",
  },
  dinner: {
    label: "저녁 식사",
    guide:
      "수면까지 시간이 가까울수록 가볍게. 단백질 + 채소 위주가 이상적. 기름진 음식·과한 탄수·자극적인 매운 음식은 수면 질을 해칠 수 있어 감점. 적정량 초과(과식)는 강하게 감점.",
  },
  eveningSnack: {
    label: "야식",
    guide:
      "취침에 가까운 시점이라 영양 균형보다 부담을 줄이는 것이 우선. 고지방·튀김·라면류·고당 디저트·매운 자극은 강하게 감점(rating 1~2). 따뜻한 우유·소량의 과일·삶은 계란 같은 가벼운 단백질은 가점. aiComment 에 다음 끼니까지의 영향(수면/소화)을 짧게 언급하세요.",
  },
};

const MEAL_PROMPT_BASE = `당신은 친절한 한국인 영양사입니다. 사용자가 보낸 식사 사진을 분석해 다음 JSON을 한국어로 반환하세요.

공통 규칙:
- 메뉴 이름은 한국식 명칭 우선, 보이는 모든 음식을 콤마로 나열.
- 별점(rating)은 1~5 정수. **반드시 아래 "이번 끼니 맥락" 의 기준에 맞춰** 영양 균형/건강도/적정 양을 평가하세요. 같은 음식이라도 끼니가 달라지면 점수가 달라질 수 있습니다(예: 라면 1그릇은 점심에 3점이라도 야식이면 1~2점).
- 간단한 한 줄평(aiComment, 30자 내외, 다정한 말투). 끼니 맥락(아침인데 너무 가볍다, 야식치고 무겁다 등)을 자연스럽게 반영하세요.
- **isMealPhoto**: 사용자가 「식단 기록」으로 올리기에 적절한 사진이면 true. 분명히 아니면 false — 예: 사람·풍경·문서·책·화면 캡처만, 운동/반려동물만, 그릇은 있으나 음식이 거의 없음. 애매하면 true.
- 영양(nutrition)은 1인분 기준 추정치. 모르면 생략 가능.
- nutrition 숫자 필드는 항상 이 순서로만 넣으세요: calories → carbs → protein → fat → sugar (sugar 는 당류·가당 추정 g).
- healthTags 예: ["고단백","탄수과다","채소부족","가공식품","균형잡힘","간식과다","야식부담"] 등 1~4개.

개인정보·프라이버시 규칙(아주 중요):
- aiComment · healthTags · menuText · 그 어디에도 **구체적 질환/질병/병명**(예: "당뇨", "당뇨병", "통풍", "고혈압", "고지혈증", "지방간", "암", "신장병" 등) 이나 의학적 진단·치료·약물명을 **절대 언급하지 마세요**.
- 대신 영양소 관점의 일반 가이드로만 표현하세요. 예) "당분·정제 탄수화물 줄이기 좋은 선택이에요", "나트륨과 퓨린이 낮은 편이에요".
- 사용자의 관심 영역이 주어져도 병명으로 바꿔 되묻지 말고, 해당 영양소를 자연스럽게 강조·감점 포인트로만 반영하세요.

반드시 다음 JSON 스키마만 반환:
{
  "menuText": string,
  "rating": number(1~5),
  "aiComment": string,
  "isMealPhoto": boolean,
  "nutrition": {
    "calories": number?,
    "carbs": number?,
    "protein": number?,
    "fat": number?,
    "sugar": number?,
    "healthTags": string[]?
  }
}`;

/**
 * 관심 컨디션 라벨(예: "당뇨", "통풍")을 AI 에 직접 병명으로 넘기지 않고,
 * 영양소 관점의 체크리스트로 변환한 뒤 프롬프트에 포함한다.
 *
 * 이런 식으로 한 번 가공하면:
 *   1) AI 응답에 병명이 그대로 들어가 친구에게 노출될 위험이 낮아진다.
 *   2) 사용자가 일반 라벨을 적어도 적절한 영양 기준을 끌어낼 수 있다.
 */
const FOCUS_HINTS: { match: RegExp; hint: string }[] = [
  { match: /당뇨|혈당|glucose|diabet/i, hint: "정제 탄수화물/단당류/가당 음료는 감점, 복합 탄수·식이섬유·단백질 균형은 가점." },
  { match: /통풍|요산|gout|uric/i, hint: "퓨린이 많은 내장·맥주·진한 육수는 감점, 저지방 단백질·채소 위주는 가점." },
  { match: /고혈압|혈압|salt|sodium|hyperten/i, hint: "짠 국물/가공식품/염장식품은 감점, 칼륨이 많은 채소·과일은 가점." },
  { match: /고지혈|콜레스테롤|지방간|심혈관|cholesterol|liver/i, hint: "포화지방/튀김/가공육은 감점, 불포화지방·식이섬유는 가점." },
  { match: /신장|콩팥|kidney/i, hint: "짠 음식·과도한 단백질·가공식품은 감점, 적정량·신선 식재료는 가점." },
  { match: /체중|감량|다이어트|weight|diet/i, hint: "고칼로리·당분·기름진 음식은 감점, 적정 칼로리·고단백·채소 위주는 가점." },
  { match: /근육|벌크업|muscle|protein|gain/i, hint: "단백질 비중이 낮으면 감점, 양질의 단백질·복합 탄수 조합은 가점." },
  { match: /소화|장|gut|ibs/i, hint: "매운·기름진·자극적인 음식은 감점, 섬유질·발효식품·저자극은 가점." },
];

function buildFocusBlock(focus: string[] | undefined): string {
  if (!focus || focus.length === 0) return "";
  const bullets = focus
    .map((label) => {
      const hint = FOCUS_HINTS.find((h) => h.match.test(label))?.hint;
      return hint
        ? `- "${label}" → ${hint}`
        : `- "${label}" → 해당 라벨과 연관된 영양소(예: 당분·지방·나트륨 등)를 평가에 자연스럽게 반영.`;
    })
    .join("\n");
  return `

사용자의 관심 영역(민감정보 — 응답에 라벨/병명 그대로 옮겨 적지 말 것):
${bullets}

위 항목은 **영양소 기준의 체크 포인트**로만 사용하세요. aiComment·healthTags 어디에도 위 라벨이나 그에 해당하는 구체 병명을 직접 쓰지 말고, 영양소 관점의 일반적 표현만 쓰세요.`;
}

function buildProfileBlock(p?: AnalysisProfile): string {
  if (!p) return "";
  const parts: string[] = [];
  if (typeof p.ageYears === "number") parts.push(`${p.ageYears}세`);
  if (p.gender) {
    parts.push(p.gender === "male" ? "남성" : p.gender === "female" ? "여성" : "기타");
  }
  if (typeof p.heightCm === "number") parts.push(`키 ${p.heightCm}cm`);
  if (typeof p.weightKg === "number") parts.push(`체중 ${p.weightKg}kg`);
  if (parts.length === 0) return "";
  return `

사용자 기본 정보: ${parts.join(" · ")}. 1인분 칼로리/영양 추정은 이 정보를 고려해 현실적인 수치로 산정하세요.`;
}

function buildMealPrompt(slot?: MealSlot, profile?: AnalysisProfile): string {
  const slotCtx = slot
    ? `\n\n이번 끼니 맥락 — "${MEAL_SLOT_CONTEXT[slot].label}":\n${MEAL_SLOT_CONTEXT[slot].guide}`
    : "";
  return `${MEAL_PROMPT_BASE}${slotCtx}${buildProfileBlock(profile)}${buildFocusBlock(profile?.focusConditions)}`;
}

/**
 * AI 응답에서 혹시 포함된 구체 병명을 한 번 더 거른다.
 * 프롬프트에서 금지했지만 모델이 무시할 가능성에 대비한 최종 안전망.
 */
const DIAGNOSIS_TERMS = [
  "당뇨병", "당뇨", "통풍", "고혈압", "저혈압", "고지혈증", "이상지질혈증",
  "지방간", "간경변", "심근경색", "협심증", "뇌졸중", "뇌경색",
  "암", "종양", "천식", "아토피", "갑상선항진", "갑상선저하",
  "신장병", "신부전", "관절염", "류마티스", "루푸스", "대사증후군",
];

function stripDiagnoses(s: string): string {
  let out = s;
  for (const t of DIAGNOSIS_TERMS) {
    out = out.split(t).join("");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function sanitizeMealAnalysis(a: MealAnalysis): MealAnalysis {
  return {
    menuText: stripDiagnoses(a.menuText),
    rating: a.rating,
    aiComment: stripDiagnoses(a.aiComment),
    isMealPhoto: a.isMealPhoto !== false,
    nutrition: a.nutrition
      ? {
          ...a.nutrition,
          healthTags: a.nutrition.healthTags?.map(stripDiagnoses).filter(Boolean),
        }
      : undefined,
  };
}

async function analyzeMealImageOnce(
  apiKey: string,
  forApi: Blob,
  slot?: MealSlot,
  modelName?: string,
  profile?: AnalysisProfile,
): Promise<MealAnalysis> {
  const model = getModel(apiKey, modelName);
  const base64 = await blobToBase64(forApi);
  try {
    const res = await withGenerativeTimeout(
      model.generateContent([
        { text: buildMealPrompt(slot, profile) },
        {
          inlineData: {
            mimeType: forApi.type || "image/jpeg",
            data: base64,
          },
        },
      ]),
    );
    const text = res.response.text();
    const parsed = safeParseJson<MealAnalysis>(text);
    parsed.rating = Math.max(1, Math.min(5, Math.round(Number(parsed.rating) || 3)));
    parsed.menuText = String(parsed.menuText ?? "분석 결과 없음");
    parsed.aiComment = String(parsed.aiComment ?? "");
    parsed.isMealPhoto = (parsed as { isMealPhoto?: boolean }).isMealPhoto !== false;
    return sanitizeMealAnalysis(parsed as MealAnalysis);
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError(formatGeminiFailure("식단 분석 실패", e), e);
  }
}

export async function analyzeMealImage(
  apiKey: string,
  image: Blob,
  slot?: MealSlot,
  modelName?: string,
  profile?: AnalysisProfile,
): Promise<MealAnalysis> {
  if (!apiKey.trim()) {
    throw new AIError("Gemini API 키가 설정되지 않았습니다. 설정 화면에서 입력해주세요.");
  }
  const forApi = await compressImage(image, {
    maxDimension: 768,
    quality: 0.78,
    mimeType: "image/jpeg",
  });
  return await analyzeMealImageOnce(apiKey.trim(), forApi, slot, modelName, profile);
}

// ---------- 텍스트 기반 재분석 ----------
// 사용자가 AI 결과(메뉴·영양)를 직접 고친 뒤 별점·한줄평·영양 추정·태그를
// 다시 받을 때 사용한다. 이미지가 없어도 동작한다.

export interface ReanalyzeInput {
  menuText: string;
  nutrition?: MealAnalysis["nutrition"];
}

const REANALYZE_PROMPT_BASE = `당신은 친절한 한국인 영양사입니다. 사용자가 **메뉴 이름**(및 필요하면 직접 적어 둔 영양 수치)을 수정했고, 그 내용을 바탕으로 식사를 **처음부터 다시 평가**해 달라고 합니다.

중요한 규칙:
- menuText: 사용자가 입력한 문자열을 **그대로** JSON 의 menuText 에 넣어 되돌려 주세요. (요약·번역·삭제 금지.)
- nutrition.calories, carbs, protein, fat, sugar: 사용자가 적어 둔 값이 있으면 **참고용 힌트**로만 쓰고, 메뉴 설명에 맞는 **일반적인 1인분 추정치**를 당신이 다시 산출해 채워 주세요. 사용자가 비워 둔 항목도 가능하면 합리적으로 추정합니다.
- rating(1~5), aiComment(30자 내외 다정한 말투), healthTags(1~4개) 역시 위 메뉴·추정 영양을 반영해 **새로** 매깁니다.
- 영양 밸런스가 한쪽으로 치우치면 별점·한줄평·태그에 그 점이 드러나게 하세요.
- 끼니 맥락이 함께 주어지면 그 기준에 맞춰 평가하세요.

개인정보·프라이버시 규칙:
- 응답 어디에도 구체 질환/병명(당뇨·통풍·고혈압·고지혈증 등)이나 진단·약물명을 넣지 마세요. 영양소 관점 가이드만 쓰세요.

반드시 다음 JSON 스키마만 반환:
{
  "menuText": string,
  "rating": number(1~5),
  "aiComment": string,
  "nutrition": {
    "calories": number?,
    "carbs": number?,
    "protein": number?,
    "fat": number?,
    "sugar": number?,
    "healthTags": string[]?
  }
}`;

function buildReanalyzePrompt(
  input: ReanalyzeInput,
  slot?: MealSlot,
  profile?: AnalysisProfile,
): string {
  const slotCtx = slot
    ? `\n\n이번 끼니 맥락 — "${MEAL_SLOT_CONTEXT[slot].label}":\n${MEAL_SLOT_CONTEXT[slot].guide}`
    : "";
  const userBlock = `\n\n사용자가 직접 입력·수정한 값:\n${JSON.stringify(
    {
      menuText: input.menuText,
      nutrition: input.nutrition ?? {},
    },
    null,
    2,
  )}`;
  return `${REANALYZE_PROMPT_BASE}${slotCtx}${buildProfileBlock(profile)}${buildFocusBlock(
    profile?.focusConditions,
  )}${userBlock}`;
}

export async function reanalyzeMealFromText(
  apiKey: string,
  input: ReanalyzeInput,
  slot?: MealSlot,
  modelName?: string,
  profile?: AnalysisProfile,
): Promise<MealAnalysis> {
  if (!apiKey.trim()) {
    throw new AIError("Gemini API 키가 설정되지 않았습니다. 설정 화면에서 입력해주세요.");
  }
  const menuText = (input.menuText ?? "").trim();
  if (!menuText) {
    throw new AIError("메뉴 이름을 먼저 입력해 주세요.");
  }
  const model = getModel(apiKey.trim(), modelName);
  try {
    const res = await withGenerativeTimeout(
      model.generateContent(
        buildReanalyzePrompt(input, slot, profile),
      ),
    );
    const text = res.response.text();
    const parsed = safeParseJson<MealAnalysis>(text);
    parsed.rating = Math.max(1, Math.min(5, Math.round(Number(parsed.rating) || 3)));
    parsed.menuText = menuText;
    parsed.aiComment = String(parsed.aiComment ?? "");
    const userN = input.nutrition ?? {};
    const modelN = parsed.nutrition ?? {};
    const pickMacro = (m: unknown, u: unknown): number | undefined => {
      if (typeof m === "number" && Number.isFinite(m)) return m;
      if (typeof u === "number" && Number.isFinite(u)) return u;
      return undefined;
    };
    parsed.nutrition = {
      calories: pickMacro(modelN.calories, userN.calories),
      carbs: pickMacro(modelN.carbs, userN.carbs),
      protein: pickMacro(modelN.protein, userN.protein),
      fat: pickMacro(modelN.fat, userN.fat),
      sugar: pickMacro(modelN.sugar, userN.sugar),
      healthTags: Array.isArray(modelN.healthTags) && modelN.healthTags.length > 0
        ? modelN.healthTags
        : userN.healthTags,
    };
    (parsed as MealAnalysis).isMealPhoto = true;
    return sanitizeMealAnalysis(parsed as MealAnalysis);
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError(formatGeminiFailure("재분석 실패", e), e);
  }
}

// ---------- 건강기록 분석 ----------

export interface HealthAnalysis {
  extractedText: string;
  metrics: Record<string, string | number>;
  healthScore: number; // 0~100
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendations: string[];
}

const HEALTH_PROMPT = `당신은 한국 가정의학과 전문의입니다. 사용자가 보낸 건강검진표 또는 인바디 결과지 사진을 분석하세요.
모든 텍스트를 OCR로 정확히 추출하고, 핵심 측정값(metrics)을 구조화하며, 100점 만점 종합 건강 점수를 매기고, 한국어로 친절하게 코멘트하세요.

규칙:
- extractedText: 사진의 모든 글자를 그대로 (줄바꿈 포함) 옮겨 적기.
- metrics: 키-값 객체. 예: {"체중":"68kg","체지방률":"22%","골격근량":"30kg","BMI":24.1,"공복혈당":"98mg/dL","총콜레스테롤":190,...}
- healthScore: 0~100 정수. 정상범위/경계/위험 항목 고려해 종합 평가.
- summary: 80자 내외 한 줄 종합.
- strengths: 잘하고 있는 점 1~3개 (간결).
- concerns: 주의가 필요한 점 1~3개 (간결).
- recommendations: 실천 가능한 조언 1~3개 (간결, 구체적).
- 의학적 진단은 피하고, 일반 건강 가이드 톤으로.

반드시 다음 JSON 스키마만 반환:
{
  "extractedText": string,
  "metrics": object,
  "healthScore": number(0~100),
  "summary": string,
  "strengths": string[],
  "concerns": string[],
  "recommendations": string[]
}`;

function buildHealthPrompt(
  recordType: string,
  profile?: AnalysisProfile,
): string {
  const parts = [
    HEALTH_PROMPT,
    `\n\n참고: 이 사진의 종류는 "${recordType}" 입니다.`,
  ];
  const profileBlock = buildProfileBlock(profile);
  if (profileBlock) parts.push(profileBlock);
  if (profile?.focusConditions && profile.focusConditions.length > 0) {
    parts.push(
      `\n\n사용자가 중점 관리하고 싶은 영역(라벨만): ${profile.focusConditions.map((s) => `"${s}"`).join(", ")}. 응답의 strengths/concerns/recommendations 는 이 영역과 연관된 수치에 더 많이 주목하되, 진단/처방 뉘앙스는 피하고 생활 가이드 톤으로 작성하세요.`,
    );
  }
  return parts.join("");
}

async function analyzeHealthImageOnce(
  apiKey: string,
  forApi: Blob,
  recordType: string,
  modelName?: string,
  profile?: AnalysisProfile,
): Promise<HealthAnalysis> {
  const model = getModel(apiKey, modelName);
  const base64 = await blobToBase64(forApi);
  const prompt = buildHealthPrompt(recordType, profile);
  try {
    const res = await withGenerativeTimeout(
      model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType: forApi.type || "image/jpeg",
            data: base64,
          },
        },
      ]),
    );
    const text = res.response.text();
    const parsed = safeParseJson<HealthAnalysis>(text);
    parsed.healthScore = Math.max(
      0,
      Math.min(100, Math.round(Number(parsed.healthScore) || 70)),
    );
    parsed.extractedText = String(parsed.extractedText ?? "");
    parsed.summary = String(parsed.summary ?? "");
    parsed.strengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
    parsed.concerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
    parsed.recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : [];
    parsed.metrics =
      parsed.metrics && typeof parsed.metrics === "object" ? parsed.metrics : {};
    return parsed;
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError(formatGeminiFailure("건강기록 분석 실패", e), e);
  }
}

export async function analyzeHealthImage(
  apiKey: string,
  image: Blob,
  recordType: string,
  modelName?: string,
  profile?: AnalysisProfile,
): Promise<HealthAnalysis> {
  if (!apiKey.trim()) {
    throw new AIError("Gemini API 키가 설정되지 않았습니다. 설정 화면에서 입력해주세요.");
  }
  const forApi = await compressImage(image, {
    maxDimension: 1200,
    quality: 0.82,
    mimeType: "image/jpeg",
  });
  return await analyzeHealthImageOnce(apiKey.trim(), forApi, recordType, modelName, profile);
}

// ---------- API 키 검증 ----------

async function pingGeminiOnce(apiKey: string, modelName?: string): Promise<void> {
  const m = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: modelName || DEFAULT_MODEL,
  });
  try {
    const r = await m.generateContent("ping");
    if (!r.response.text) throw new AIError("응답이 비어있습니다.");
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError(formatGeminiFailure("API 키 확인 실패", e), e);
  }
}

export interface PingResult {
  /** 실제 호출에 사용된 Gemini 모델명 */
  model: string;
}

export async function pingGemini(
  apiKey: string,
  modelName?: string,
): Promise<PingResult> {
  if (!apiKey.trim()) {
    throw new AIError("Gemini API 키가 비어 있습니다.");
  }
  const model = modelName || DEFAULT_MODEL;
  await pingGeminiOnce(apiKey.trim(), model);
  return { model };
}
