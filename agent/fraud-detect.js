require("dotenv").config({ path: "../.env" });
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * requestLogs 예시:
 * [
 *   { account_id, ip, created_at, requested_at, event, grade, max_price_krw }
 * ]
 */
async function detectFraud(requestLogs) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const prompt = `
너는 티켓팅 플랫폼의 부정 탐지(매크로/다중 계정) 판정 로직이다.
아래 최근 요청 로그를 분석해서, 매크로 의심 패턴이 있는지 판단해라.

의심 신호 예시:
- 동일 IP에서 다수의 계정이 동시에 요청
- 계정 생성 시각이 요청 직전으로 매우 근접
- 여러 계정의 요청 조건(이벤트, 좌석, 가격)이 완전히 동일
- 정상적인 사람이라면 있을 법한 시간 간격 없이 기계적으로 반복되는 요청

각 계정에 대해 판정하고, 아래 JSON 형식으로만 출력해라. 다른 설명 없이 JSON만 출력해.

형식:
{
  "flagged_accounts": [
    { "account_id": "", "risk": "HIGH" 또는 "MEDIUM" 또는 "LOW", "reasoning": "" }
  ],
  "summary": ""
}

요청 로그:
${JSON.stringify(requestLogs, null, 2)}
`;

  const result = await model.generateContent(prompt);
  const cleaned = result.response.text().replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── 테스트 케이스 ──────────────────────────────
async function runTest() {
  console.log("========================================");
  console.log("테스트 1: 명백한 매크로 패턴 (다중 계정, 동일 조건, 계정 생성 직후 요청)");
  console.log("========================================");

  const suspiciousLogs = [
    { account_id: "user_A1", ip: "121.34.56.10", created_at: "2026-08-01T09:59:50Z", requested_at: "2026-08-01T10:00:00Z", event: "아이유 콘서트", grade: "R석", max_price_krw: 200000 },
    { account_id: "user_A2", ip: "121.34.56.10", created_at: "2026-08-01T09:59:51Z", requested_at: "2026-08-01T10:00:00Z", event: "아이유 콘서트", grade: "R석", max_price_krw: 200000 },
    { account_id: "user_A3", ip: "121.34.56.10", created_at: "2026-08-01T09:59:52Z", requested_at: "2026-08-01T10:00:01Z", event: "아이유 콘서트", grade: "R석", max_price_krw: 200000 },
    { account_id: "user_normal", ip: "203.11.22.33", created_at: "2025-03-15T00:00:00Z", requested_at: "2026-08-01T10:00:05Z", event: "아이유 콘서트", grade: "S석", max_price_krw: 150000 },
  ];

  const result1 = await detectFraud(suspiciousLogs);
  console.log(JSON.stringify(result1, null, 2));

  console.log("\n\n========================================");
  console.log("테스트 2: 정상적인 단일 유저 요청");
  console.log("========================================");

  const normalLogs = [
    { account_id: "user_real", ip: "58.234.11.90", created_at: "2024-11-02T00:00:00Z", requested_at: "2026-08-01T10:00:00Z", event: "아이유 콘서트", grade: "R석", max_price_krw: 200000 },
  ];

  const result2 = await detectFraud(normalLogs);
  console.log(JSON.stringify(result2, null, 2));
}

runTest();