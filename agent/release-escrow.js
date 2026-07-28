const fs = require("fs");
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

// 에스크로 지갑 불러오기
const escrowSecret = JSON.parse(fs.readFileSync("escrow-wallet.json", "utf8"));
const escrowWallet = Keypair.fromSecretKey(Uint8Array.from(escrowSecret));

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

/**
 * decision: "SETTLE" (판매자에게 결제) 또는 "REFUND" (유저에게 환불)
 * recipientPubkey: 최종 수령자 주소 (판매자 or 유저)
 * amountSol: 보낼 금액
 */
async function releaseEscrow(decision, recipientPubkey, amountSol) {
  const recipient = new PublicKey(recipientPubkey);

  console.log(`\n[판정 결과: ${decision}] 에스크로에서 ${amountSol} SOL을 ${recipientPubkey}로 전송합니다...`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrowWallet.publicKey,
      toPubkey: recipient,
      lamports: amountSol * LAMPORTS_PER_SOL,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [escrowWallet]);

  console.log(`${decision} 완료!`);
  console.log("Signature:", sig);
  console.log("Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

// 테스트: 랜덤 수령자에게 0.1 SOL "환불" 시뮬레이션
const { Keypair: TestKeypair } = require("@solana/web3.js");
const testRecipient = TestKeypair.generate();

releaseEscrow("REFUND", testRecipient.publicKey.toBase58(), 0.1);