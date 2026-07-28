require("dotenv").config({ path: "../.env" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
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

const app = express();
app.use(express.json());

const PORT = 4000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// ── 지갑 로드 ──────────────────────────────
const agentKeypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
const agentSecret = JSON.parse(fs.readFileSync(agentKeypairPath, "utf8"));
const agentWallet = Keypair.fromSecretKey(Uint8Array.from(agentSecret));

const escrowSecret = JSON.parse(fs.readFileSync("escrow-wallet.json", "utf8"));
const escrowWallet = Keypair.fromSecretKey(Uint8Array.from(escrowSecret));

const sellerWallet = Keypair.generate(); // 데모용 고정값으로 바꿔도 됨

// ── 유틸 ──────────────────────────────
function krwToSol(krw) {
  return Number((krw / 10000000).toFixed(4)) || 0.01;
}

async function fundEscrow(amountSol) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agentWallet.publicKey,
      toPubkey: escrowWallet.publicKey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [agentWallet]);
  return sig;
}

async function releaseEscrow(recipientPubkey, amountSol) {
  const recipient = new PublicKey(recipientPubkey);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrowWallet.publicKey,
      toPubkey: recipient,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [escrowWallet]);
  return sig;
}

// ── Gemini: 제안된 좌석이 유저 조건에 맞는지 판단 ──────────────────────────────
async function decideOffer(userConditions, offeredSeat) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  const prompt = `
너는 티켓팅 에이전트의 판단 로직이다.
유저의 1차 희망 조건(primary)과 대안 규칙(fallback_rules), 그리고 플랫폼이 실제로 제안한 좌석(offeredSeat)을 비교해서 결정해라.

판단 순서:
1. offeredSeat이 primary 조건(등급, 최대가격)을 만족하면 → "SETTLE_PRIMARY"
2. offeredSeat이 fallback_rules 중 하나를 만족하면 → "SETTLE_FALLBACK"
3. 둘 다 만족하지 않으면 → "REFUND"

출력은 아래 JSON 형식으로만 해라. 다른 설명 없이 JSON만 출력해.
{
  "decision": "SETTLE_PRIMARY" 또는 "SETTLE_FALLBACK" 또는 "REFUND",
  "reasoning": ""
}

유저 조건:
${JSON.stringify(userConditions, null, 2)}

제안된 좌석:
${JSON.stringify(offeredSeat, null, 2)}
`;
  const result = await model.generateContent(prompt);
  const cleaned = result.response.text().replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── 핵심 엔드포인트: POST /settle ──────────────────────────────
/**
 * Request body:
 * {
 *   "user_id": "user_123",
 *   "event": "아이유 콘서트",
 *   "user_conditions": {
 *     "primary": { "grade": "R석", "max_price_krw": 200000 },
 *     "fallback_rules": [{ "grade": "S석", "max_price_krw": 150000 }]
 *   },
 *   "offered_seat": { "grade": "R석", "price_krw": 190000 }  // null이면 바로 환불
 * }
 */
app.post("/settle", async (req, res) => {
  try {
    const { user_id, event, user_conditions, offered_seat } = req.body;

    if (!user_id || !user_conditions) {
      return res.status(400).json({ error: "user_id와 user_conditions는 필수입니다." });
    }

    console.log(`\n[/settle] user_id=${user_id}, event=${event}`);
    console.log("   user_conditions:", user_conditions);
    console.log("   offered_seat:", offered_seat);

    const maxAmount = krwToSol(user_conditions.primary.max_price_krw);

    // STEP 1. 에스크로 예치
    const fundSig = await fundEscrow(maxAmount);
    console.log(`   에스크로 예치 완료: ${fundSig}`);

    // STEP 2. 판단
    let decisionResult;
    if (!offered_seat) {
      decisionResult = { decision: "REFUND", reasoning: "플랫폼이 제안한 좌석이 없음 (매진)" };
    } else {
      decisionResult = await decideOffer(user_conditions, offered_seat);
    }
    console.log("   판단 결과:", decisionResult);

    // STEP 3. 해제 (결제 or 환불)
    let recipient, finalAmount;
    if (decisionResult.decision === "REFUND") {
      recipient = agentWallet.publicKey.toBase58();
      finalAmount = maxAmount;
    } else {
      recipient = sellerWallet.publicKey.toBase58();
      finalAmount = krwToSol(offered_seat.price_krw);
    }

    const releaseSig = await releaseEscrow(recipient, finalAmount);
    console.log(`   ${decisionResult.decision} 완료: ${releaseSig}`);

    // STEP 4. 거스름돈 반환 (있으면)
    let changeSig = null;
    const change = maxAmount - finalAmount;
    if (decisionResult.decision !== "REFUND" && change > 0.0001) {
      changeSig = await releaseEscrow(agentWallet.publicKey.toBase58(), change);
      console.log(`   거스름돈 반환 완료: ${changeSig}`);
    }

    // 팀원 서버가 받을 최종 응답
    res.json({
      user_id,
      decision: decisionResult.decision,
      reasoning: decisionResult.reasoning,
      fund_tx: fundSig,
      settle_tx: releaseSig,
      change_tx: changeSig,
      explorer_urls: {
        fund: `https://explorer.solana.com/tx/${fundSig}?cluster=devnet`,
        settle: `https://explorer.solana.com/tx/${releaseSig}?cluster=devnet`,
        change: changeSig ? `https://explorer.solana.com/tx/${changeSig}?cluster=devnet` : null,
      },
    });
  } catch (err) {
    console.error("에러 발생:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`💳 Settle server running on http://localhost:${PORT}`);
  console.log(`   POST /settle - 좌석 제안 기반 결제/환불 처리`);
});