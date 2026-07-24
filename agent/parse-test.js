require("dotenv").config({ path: "../.env" });
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function parseCondition(userInput) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `
다음 사용자 요청을 아래 JSON 형식으로만 변환해. 다른 설명 없이 JSON만 출력해.

형식:
{
  "event": "",
  "date_constraint": "",
  "seat_grades_allowed": [],
  "seat_grades_excluded": [],
  "max_price_krw": 0,
  "seat_count": 0,
  "adjacency_required": true
}

사용자 요청: "${userInput}"
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  console.log("Gemini 응답 원문:\n", text);

  // JSON 부분만 추출 (혹시 코드블록으로 감싸져 나올 경우 대비)
  const cleaned = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  console.log("\n파싱된 JSON:\n", parsed);
}

parseCondition("다음 주 토요일 아이유 콘서트, VIP 말고 R석이나 S석으로, 20만원 안에서, 2연석으로 구해줘");