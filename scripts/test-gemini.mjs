/**
 * Gemini API 키 연결 테스트 (서버/터미널에서 실행).
 *
 * PowerShell:
 *   $env:GEMINI_API_KEY="여기에_키"; npm run test:gemini
 *
 * 선택: 모델 바꾸기
 *   $env:GEMINI_MODEL="gemini-1.5-flash"; npm run test:gemini
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const modelName = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();

if (!apiKey) {
  console.error("GEMINI_API_KEY 환경 변수를 설정하세요.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: modelName });

try {
  const res = await model.generateContent('Reply with exactly: {"ok":true}');
  const text = res.response.text();
  console.log("모델:", modelName);
  console.log("응답:", text);
  console.log("성공: 키와 API 호출이 정상입니다.");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("실패:", msg);
  process.exit(1);
}
