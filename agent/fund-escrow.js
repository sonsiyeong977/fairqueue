const fs = require("fs");
const os = require("os");
const path = require("path");
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

(async () => {
  // 기존 에이전트 지갑 (Solana CLI가 만든 것)
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const agentSecret = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const agentWallet = Keypair.fromSecretKey(Uint8Array.from(agentSecret));

  // 에스크로 지갑 (방금 만든 것)
  const escrowSecret = JSON.parse(fs.readFileSync("escrow-wallet.json", "utf8"));
  const escrowWallet = Keypair.fromSecretKey(Uint8Array.from(escrowSecret));

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  console.log("에이전트 지갑 →", agentWallet.publicKey.toBase58());
  console.log("에스크로 지갑 →", escrowWallet.publicKey.toBase58());

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: agentWallet.publicKey,
      toPubkey: escrowWallet.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL, // 테스트용 1 SOL 전송
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [agentWallet]);
  console.log("\n에스크로 지갑에 1 SOL 입금 완료!");
  console.log("Signature:", sig);
  console.log("Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
})();