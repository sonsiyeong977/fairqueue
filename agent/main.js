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

// ── STEP 1: 자연어 → 조건 파싱 ──────────────────────────────
async function parseCondition(userInput) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  const prompt = `
다음 사용자 요청을 아래 JSON 형식으로만 변환해. 다른 설명 없이 JSON만 출력해.

형식:
{
  "event": "",
  "seat_grades_allowed": [],
  "max_price_krw": 0,
  "seat_count": 0
}

사용자 요청: "${userInput}"
`;
  const result = await model.generateContent(prompt);
  const cleaned = result.response.text().replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── STEP 2: 매진 시 대안 판단 ──────────────────────────────
async function decideFallback(conditions, situationDescription) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  const prompt = `
너는 티켓팅 에이전트의 판단 로직이다. 아래 유저 조건과 현재 상황을 보고 다음 행동을 JSON으로만 출력해라.

출력 형식:
{
  "decision": "SETTLE" 또는 "REFUND",
  "reasoning": ""
}

유저 조건:
${JSON.stringify(conditions, null, 2)}

현재 상황: "${situationDescription}"
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
      lamports: amountSol * LAMPORTS_PER_SOL,
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
      lamports: amountSol * LAMPORTS_PER_SOL,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [escrowWallet]);
  console.log(`   ${decision} 완료 (${amountSol} SOL → ${recipientPubkey})`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

// ── 전체 파이프라인 실행 ──────────────────────────────
async function runFairQueue() {
  console.log("========================================");
  console.log("STEP 1. 유저 조건 파싱");
  console.log("========================================");
  const userInput = "아이유 콘서트 R석, 20만원 이하로 1석 구해줘";
  const conditions = await parseCondition(userInput);
  console.log(conditions);

  console.log("\n========================================");
  console.log("STEP 2. 에스크로에 결제 예상 금액 예치 (0.05 SOL로 시뮬레이션)");
  console.log("========================================");
  const escrowAmount = 0.05; // 데모용 소액. 실제론 max_price_krw 환산값
  await fundEscrow(escrowAmount);


console.log("\n========================================");
  console.log("STEP 3. 판매자 판정 결과 확인");
  console.log("========================================");
  const decisionResult = await decideFallback(conditions, situation);
  console.log(decisionResult);

  console.log("\n========================================");
  console.log(`STEP 4. 판단 결과(${decisionResult.decision})에 따라 에스크로 해제`);
  console.log("========================================");

  let recipient;
  if (decisionResult.decision === "SETTLE") {
    // 결제 성공 시: 판매자(가상) 지갑으로 자금 이동
    recipient = sellerWallet.publicKey.toBase58();
  } else {
    // 환불 시: 유저(=agentWallet)에게 되돌림
    recipient = agentWallet.publicKey.toBase58();
  }

  await releaseEscrow(decisionResult.decision, recipient, escrowAmount);

  console.log("\n FairQueue 파이프라인 실행 완료\n");
}

// ── 시나리오 러너 ──────────────────────────────
async function runFairQueue(situation) {
  console.log("========================================");
  console.log("STEP 1. 유저 조건 파싱");
  console.log("========================================");
  const userInput = "아이유 콘서트 R석, 20만원 이하로 1석 구해줘";
  const conditions = await parseCondition(userInput);
  console.log(conditions);

  console.log("\n========================================");
  console.log("STEP 2. 에스크로에 결제 예상 금액 예치 (0.05 SOL로 시뮬레이션)");
  console.log("========================================");
  const escrowAmount = 0.05;
  await fundEscrow(escrowAmount);

  console.log("\n========================================");
  console.log("STEP 3. 판매자 판정 결과 확인");
  console.log("========================================");
  const decisionResult = await decideFallback(conditions, situation);
  console.log(decisionResult);

  console.log("\n========================================");
  console.log(`STEP 4. 판단 결과(${decisionResult.decision})에 따라 에스크로 해제`);
  console.log("========================================");

  let recipient;
  if (decisionResult.decision === "SETTLE") {
    recipient = sellerWallet.publicKey.toBase58();
  } else {
    recipient = agentWallet.publicKey.toBase58();
  }

  await releaseEscrow(decisionResult.decision, recipient, escrowAmount);

  console.log("\n FairQueue 파이프라인 실행 완료\n");
}

// ── 두 시나리오 순서대로 실행 ──────────────────────────────
async function main() {
  console.log("\n\n🎟️  시나리오 1: 좌석 확보 성공 (SETTLE)\n");
  await runFairQueue("R석 1석 확보 성공. 결제를 진행합니다.");

  console.log("\n\n🎟️  시나리오 2: 매진, 대안 없음 (REFUND)\n");
  await runFairQueue("R석 전 좌석 매진 확정. 대체 좌석 없음.");
}

main();