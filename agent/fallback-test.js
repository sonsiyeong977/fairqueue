require("dotenv").config({ path: "../.env" });
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function decideFallback(userConditions, situationDescription) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `
너는 티켓팅 에이전트의 판단 로직이다. 아래 유저의 원래 조건(primary)과 대안 규칙(fallback_rules), 그리고 현재 상황을 보고, 다음 행동을 JSON으로만 출력해라. 다른 설명 없이 JSON만 출력해.

출력 형식:
{
  "situation": "",
  "decision": "PROCEED_WITH_ALTERNATIVE" 또는 "REFUND_AND_WAITLIST" 또는 "PROCEED_WITH_PRIMARY",
  "selected_option": "",
  "reasoning": ""
}

유저 조건:
${JSON.stringify(userConditions, null, 2)}

현재 상황: "${situationDescription}"
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  console.log("Gemini 응답 원문:\n", text);

  const cleaned = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  console.log("\n판단 결과:\n", parsed);
  return parsed;
}

// 테스트 케이스
const conditions = {
  primary: { grade: "R", max_price: 200000 },
  fallback_rules: [
    { if_unavailable: "primary", then: "S석도 허용, 단 15만원 이하" },
    { if_unavailable: "fallback_1", then: "환불 후 취소표 대기 등록" }
  ]
};

decideFallback(conditions, "R석 전 좌석 매진 확정. S석은 12만원에 잔여 2석 있음.");