require("dotenv").config({ path: "../.env" });
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const anchor = require("@coral-xyz/anchor");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, clusterApiUrl, PublicKey } = require("@solana/web3.js");

const app = express();
app.use(express.json());

const PORT = 4000;
const CLUSTER = process.env.SOLANA_CLUSTER || "devnet";
const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl(CLUSTER);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const connection = new Connection(RPC_URL, "confirmed");

// ── 지갑 로드 ──────────────────────────────
const agentKeypairPath = process.env.AGENT_KEYPAIR_PATH || path.join(os.homedir(), ".config", "solana", "id.json");
const agentSecret = JSON.parse(fs.readFileSync(agentKeypairPath, "utf8"));
const agentWallet = Keypair.fromSecretKey(Uint8Array.from(agentSecret));

const sellerWallet = process.env.SELLER_PUBKEY
  ? { publicKey: new PublicKey(process.env.SELLER_PUBKEY) }
  : Keypair.generate();

// ── Anchor client ──────────────────────────────
const idl = require("../anchor-escrow/idl/anchor_escrow.json");
const programId = new PublicKey(idl.address);
const provider = new anchor.AnchorProvider(
  connection,
  new anchor.Wallet(agentWallet),
  { commitment: "confirmed", preflightCommitment: "confirmed" }
);
const program = new anchor.Program(idl, provider);

function nextOrderId() {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

function toLamports(amountSol) {
  return new anchor.BN(Math.round(amountSol * LAMPORTS_PER_SOL));
}

function orderIdToBn(orderId) {
  return new anchor.BN(orderId.toString());
}

function orderIdSeed(orderId) {
  const seed = Buffer.alloc(8);
  seed.writeBigUInt64LE(BigInt(orderId));
  return seed;
}

function deriveEscrowState(userPubkey, orderId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), userPubkey.toBuffer(), orderIdSeed(orderId)],
    programId
  )[0];
}

// ── 간단한 API 키 인증 미들웨어 ──────────────────────────────
function requireApiKey(req, res, next) {
  const providedKey = req.header("x-api-key");
  const expectedKey = process.env.SETTLE_API_KEY;

  if (!expectedKey) {
    console.warn("경고: SETTLE_API_KEY가 .env에 설정되지 않았습니다. 인증 없이 열려 있습니다.");
    return next();
  }

  if (!providedKey || providedKey !== expectedKey) {
    console.warn(`[인증 실패] 잘못된 API 키로 접근 시도: ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized: 유효한 x-api-key 헤더가 필요합니다." });
  }

  next();
}

// ── 유틸 ──────────────────────────────
function krwToSol(krw) {
  return Number((krw / 10000000).toFixed(4)) || 0.01;
}

async function fundEscrow(amountSol, sellerPubkey = sellerWallet.publicKey) {
  const orderId = nextOrderId();
  const escrowState = deriveEscrowState(agentWallet.publicKey, orderId);
  const lamports = toLamports(amountSol);

  const sig = await program.methods
    .deposit(orderIdToBn(orderId), lamports, new PublicKey(sellerPubkey))
    .accounts({
      user: agentWallet.publicKey,
      authority: agentWallet.publicKey,
      escrowState,
      systemProgram: SystemProgram.programId,
    })
    .signers([agentWallet])
    .rpc();

  return {
    sig,
    orderId: orderId.toString(),
    escrowState: escrowState.toBase58(),
    user: agentWallet.publicKey.toBase58(),
    seller: new PublicKey(sellerPubkey).toBase58(),
    amountSol,
    amountLamports: lamports.toString(),
  };
}

async function releaseEscrow(orderId, userPubkey, sellerPubkey) {
  const user = new PublicKey(userPubkey);
  const seller = new PublicKey(sellerPubkey);
  const escrowState = deriveEscrowState(user, orderId);

  return program.methods
    .release()
    .accounts({
      authority: agentWallet.publicKey,
      seller,
      escrowState,
    })
    .signers([agentWallet])
    .rpc();
}

async function refundEscrow(orderId, userPubkey) {
  const user = new PublicKey(userPubkey);
  const escrowState = deriveEscrowState(user, orderId);

  return program.methods
    .refund()
    .accounts({
      authority: agentWallet.publicKey,
      user,
      escrowState,
    })
    .signers([agentWallet])
    .rpc();
}

// ── Gemini: 제안된 좌석이 유저 조건에 맞는지 1차 판단 ──────────────────────────────
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

// ── 결정론적 검증 레이어 ──────────────────────────────
function verifyDecisionDeterministically(userConditions, offeredSeat, geminiDecision) {
  if (!offeredSeat) {
    return {
      finalDecision: "REFUND",
      overridden: geminiDecision.decision !== "REFUND",
      verifyNote: "제안된 좌석 없음 → 강제 REFUND",
    };
  }

  const { primary, fallback_rules = [] } = userConditions;

  const matchesPrimary =
    offeredSeat.grade === primary.grade &&
    offeredSeat.price_krw <= primary.max_price_krw;

  const matchesFallback = fallback_rules.some(
    (rule) => offeredSeat.grade === rule.grade && offeredSeat.price_krw <= rule.max_price_krw
  );

  let correctDecision;
  if (matchesPrimary) correctDecision = "SETTLE_PRIMARY";
  else if (matchesFallback) correctDecision = "SETTLE_FALLBACK";
  else correctDecision = "REFUND";

  const overridden = correctDecision !== geminiDecision.decision;

  return {
    finalDecision: correctDecision,
    overridden,
    verifyNote: overridden
      ? `Gemini 판단(${geminiDecision.decision})이 실제 조건과 불일치하여 ${correctDecision}로 강제 수정됨`
      : "Gemini 판단이 결정론적 검증을 통과함",
  };
}

// ── 핵심 엔드포인트: POST /settle (인증 필요) ──────────────────────────────
app.post("/settle", requireApiKey, async (req, res) => {
  try {
    const { user_id, event, user_conditions, offered_seat } = req.body;

    if (!user_id || !user_conditions) {
      return res.status(400).json({ error: "user_id와 user_conditions는 필수입니다." });
    }

    console.log(`\n[/settle] user_id=${user_id}, event=${event}`);
    console.log("   user_conditions:", user_conditions);
    console.log("   offered_seat:", offered_seat);

    const maxAmount = krwToSol(user_conditions.primary.max_price_krw);

    let geminiDecision;
    if (!offered_seat) {
      geminiDecision = { decision: "REFUND", reasoning: "플랫폼이 제안한 좌석이 없음 (매진)" };
    } else {
      geminiDecision = await decideOffer(user_conditions, offered_seat);
    }
    console.log("   Gemini 판단:", geminiDecision);

    const verification = verifyDecisionDeterministically(
      user_conditions,
      offered_seat,
      geminiDecision
    );
    console.log("   결정론적 검증:", verification);

    if (verification.overridden) {
      console.warn(`   Gemini 판단이 재검증에서 수정됨: ${verification.verifyNote}`);
    }

    const finalDecision = verification.finalDecision;
    const finalAmount = finalDecision === "REFUND" ? maxAmount : krwToSol(offered_seat.price_krw);
    const sellerPubkey = sellerWallet.publicKey.toBase58();

    const fundResult = await fundEscrow(finalAmount, sellerPubkey);
    console.log(`   Anchor 에스크로 예치 완료: ${fundResult.sig}`);

    let settleSig;
    if (finalDecision === "REFUND") {
      settleSig = await refundEscrow(fundResult.orderId, fundResult.user);
    } else {
      settleSig = await releaseEscrow(fundResult.orderId, fundResult.user, sellerPubkey);
    }
    console.log(`   ${finalDecision} 완료: ${settleSig}`);

    res.json({
      user_id,
      gemini_decision: geminiDecision.decision,
      gemini_reasoning: geminiDecision.reasoning,
      final_decision: finalDecision,
      overridden_by_verification: verification.overridden,
      verify_note: verification.verifyNote,
      escrow_order_id: fundResult.orderId,
      escrow_state: fundResult.escrowState,
      escrow_user: fundResult.user,
      escrow_seller: fundResult.seller,
      escrow_amount_sol: fundResult.amountSol,
      escrow_amount_lamports: fundResult.amountLamports,
      fund_tx: fundResult.sig,
      settle_tx: settleSig,
      explorer_urls: {
        fund: `https://explorer.solana.com/tx/${fundResult.sig}?cluster=${CLUSTER}`,
        settle: `https://explorer.solana.com/tx/${settleSig}?cluster=${CLUSTER}`,
      },
    });
  } catch (err) {
    console.error("에러 발생:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Settle server running on http://localhost:${PORT}`);
  console.log(`   cluster=${CLUSTER}`);
  console.log("   POST /settle - 좌석 제안 기반 결제/환불 처리 (Gemini 판단 + Anchor escrow + API Key 인증)");
});
