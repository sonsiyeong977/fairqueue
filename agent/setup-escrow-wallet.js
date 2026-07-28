const { Keypair } = require("@solana/web3.js");
const fs = require("fs");

const escrowWallet = Keypair.generate();

console.log("Escrow Wallet Public Key:", escrowWallet.publicKey.toBase58());

// 개인키를 파일로 저장 (나중에 escrow.js에서 불러다 씀)
fs.writeFileSync(
  "escrow-wallet.json",
  JSON.stringify(Array.from(escrowWallet.secretKey))
);

console.log("escrow-wallet.json 파일로 저장 완료");