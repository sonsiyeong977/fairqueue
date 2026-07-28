require("dotenv").config({ path: "../.env" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  PublicKey,
} = require("@solana/web3.js");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// ── 지갑 로드 ──────────────────────────────
const agentKeypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
const agentSecret = JSON.parse(fs.readFileSync(agentKeypairPath, "utf8"));
const agentWallet = Keypair.fromSecretKey(Uint8Array.from(agentSecret));

const escrowSecret = JSON.parse(fs.readFileSync("escrow-wallet.json", "utf8"));
const escrowWallet = Keypair.fromSecretKey(Uint8Array.from(escrowSecret));

// 가상 판매자 지갑 (데모용, 매 실행마다 새로 생성 — 실제론 고정 주소로 관리)
const sellerWallet = Keypair.generate();

// ── STEP 1: 자연어 → 조건 파싱 (fallback_rules 포함) ──────────────────────────────
async function parseCondition(userInput) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  const prompt = `
다음 사용자 요청을 아래 JSON 형식으로만 변환해. 다른 설명 없이 JSON만 출력해.
1차 희망 조건(primary)과, 매진 시 허용 가능한 대안 규칙(fallback_rules)을 자연스럽게 추론해서 채워.

형식:
{
  "event": "",
  "primary": { "grade": "", "max_price_krw": 0 },
  "fallback_rules": [
    { "grade": "", "max_price_krw": 0 }
  ],
  "seat_count": 0
}

사용자 요청: "${userInput}"
`;
  const result = await model.generateContent(prompt);
  const cleaned = result.response.text().replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── STEP 2: 다단계 판단 (1차 → 대안 → 환불) ──────────────────────────────
async function decideMultiStage(conditions, availableSeats) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  const prompt = `
너는 티켓팅 에이전트의 판단 로직이다.
유저의 1차 희망 조건(primary), 매진 시 허용 가능한 대안 규칙(fallback_rules), 그리고 현재 실제로 구매 가능한 좌석 목록(availableSeats)을 비교해서 최종 행동을 결정해라.

판단 순서:
1. primary 조건에 맞는 좌석이 availableSeats에 있으면 → "SETTLE_PRIMARY"
2. 없으면 fallback_rules 중 조건에 맞는 좌석이 availableSeats에 있으면 → "SETTLE_FALLBACK"
3. 그것도 없으면 → "REFUND"

출력은 아래 JSON 형식으로만 해라. 다른 설명 없이 JSON만 출력해.
{
  "decision": "SETTLE_PRIMARY" 또는 "SETTLE_FALLBACK" 또는 "REFUND",
  "selected_grade": "",
  "selected_price_krw": 0,
  "reasoning": ""
}

유저 조건:
${JSON.stringify(conditions, null, 2)}

현재 구매 가능한 좌석 목록:
${JSON.stringify(availableSeats, null, 2)}
`;
  const result = await model.generateContent(prompt);
  const cleaned = result.response.text().replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── STEP 3: 에스크로 예치 ──────────────────────────────
async function fundEscrow(amountSol) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agentWallet.publicKey,
      toPubkey: escrowWallet.publicKey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [agentWallet]);
  console.log(`   에스크로 예치 완료 (${amountSol} SOL)`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

// ── STEP 4: 에스크로 해제 (결제 or 환불) ──────────────────────────────
async function releaseEscrow(decision, recipientPubkey, amountSol) {
  const recipient = new PublicKey(recipientPubkey);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrowWallet.publicKey,
      toPubkey: recipient,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [escrowWallet]);
  console.log(`   ${decision} 완료 (${amountSol} SOL → ${recipientPubkey})`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

// KRW → SOL 데모용 환산 (실제로는 실시간 시세 API 연동 필요, 여기선 고정 비율 사용)
function krwToSol(krw) {
  return Number((krw / 10000000).toFixed(4)) || 0.01;
}

// ── 시나리오 러너 ──────────────────────────────
async function runFairQueue(scenarioName, userInput, availableSeats) {
  console.log(`\n\n🎟️  ${scenarioName}\n`);

  console.log("========================================");
  console.log("STEP 1. 유저 조건 파싱 (primary + fallback_rules)");
  console.log("========================================");
  const conditions = await parseCondition(userInput);
  console.log(conditions);

  console.log("\n========================================");
  console.log("STEP 2. 에스크로에 예상 최대 금액 예치");
  console.log("========================================");
  const maxAmount = krwToSol(conditions.primary.max_price_krw);
  await fundEscrow(maxAmount);

  console.log("\n========================================");
  console.log("STEP 3. 실제 판매 가능 좌석과 비교하여 다단계 판단");
  console.log("========================================");
  console.log("구매 가능 좌석:", availableSeats);
  const decisionResult = await decideMultiStage(conditions, availableSeats);
  console.log(decisionResult);

  console.log("\n========================================");
  console.log(`STEP 4. 판단 결과(${decisionResult.decision})에 따라 에스크로 해제`);
  console.log("========================================");

  let recipient, finalAmount;
  if (decisionResult.decision === "REFUND") {
    recipient = agentWallet.publicKey.toBase58();
    finalAmount = maxAmount; // 예치한 전액 환불
  } else {
    recipient = sellerWallet.publicKey.toBase58();
    finalAmount = krwToSol(decisionResult.selected_price_krw); // 실제 낙찰 금액만큼만 결제
  }

  await releaseEscrow(decisionResult.decision, recipient, finalAmount);

  // SETTLE인데 결제 금액이 예치 금액보다 적으면, 차액은 유저에게 반환 (거스름돈 개념)
  const change = maxAmount - finalAmount;
  if (decisionResult.decision !== "REFUND" && change > 0.0001) {
    console.log(`\n   차액 ${change.toFixed(4)} SOL 유저에게 반환...`);
    await releaseEscrow("CHANGE_RETURN", agentWallet.publicKey.toBase58(), change);
  }

  console.log("\n 시나리오 종료\n");
}

// ── 세 시나리오 순서대로 실행 ──────────────────────────────
async function main() {
  await runFairQueue(
    "시나리오 1: 1차 희망(R석) 그대로 확보 성공",
    "아이유 콘서트 R석, 20만원 이하로 1석 구해줘. 매진이면 S석도 15만원 이하로 괜찮아.",
    [{ grade: "R석", price_krw: 190000, count: 3 }]
  );

  console.log("\n 다음 시나리오까지 15초 대기 (API 레이트리밋 방지)...\n");
  await sleep(15000);

  await runFairQueue(
    "시나리오 2: 1차(R석) 매진, 대안(S석)으로 확보 성공",
    "아이유 콘서트 R석, 20만원 이하로 1석 구해줘. 매진이면 S석도 15만원 이하로 괜찮아.",
    [{ grade: "S석", price_krw: 120000, count: 2 }]
  );

  console.log("\n 다음 시나리오까지 15초 대기 (API 레이트리밋 방지)...\n");
  await sleep(15000);

  await runFairQueue(
    "시나리오 3: 1차, 대안 모두 매진 → 환불",
    "아이유 콘서트 R석, 20만원 이하로 1석 구해줘. 매진이면 S석도 15만원 이하로 괜찮아.",
    []
  );
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();