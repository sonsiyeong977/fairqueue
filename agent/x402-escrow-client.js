const fs = require("node:fs/promises");
const path = require("node:path");
const { Keypair } = require("@solana/web3.js");
const { x402Client, wrapFetchWithPayment } = require("@x402/fetch");
const { NETWORK, SCHEME, ASSET } = require("./x402-escrow");
const { EscrowPaymentPolicy } = require("../shared/escrow-payment-policy");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

class EscrowSchemeClient {
  scheme = SCHEME;
  constructor({ wallet, authority, seller, queueId, maxLamports }) {
    this.wallet = wallet;
    this.policy = new EscrowPaymentPolicy({ payer: wallet.publicKey.toBase58(), authority, seller, queueId, maxLamports });
  }
  async createPaymentPayload(version, requirement) {
    const transaction = this.policy.validate(version, requirement);
    this.policy.consume(requirement.amount);
    transaction.sign(this.wallet);
    return { x402Version: 2, payload: { transaction: transaction.serialize().toString("base64") } };
  }
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath || !process.env.X402_AGENT_KEYPAIR_PATH || !process.env.X402_AUTHORITY || !process.env.X402_SELLER || !process.env.X402_MAX_LAMPORTS) {
    throw new Error("Provide a queue request JSON file and X402_AGENT_KEYPAIR_PATH, X402_AUTHORITY, X402_SELLER, X402_MAX_LAMPORTS");
  }
  const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await fs.readFile(process.env.X402_AGENT_KEYPAIR_PATH, "utf8"))));
  const scheme = new EscrowSchemeClient({ wallet, authority: process.env.X402_AUTHORITY, seller: process.env.X402_SELLER, queueId: request.queue_id, maxLamports: process.env.X402_MAX_LAMPORTS });
  const endpoint = new URL(process.env.X402_RESOURCE_URL || "http://127.0.0.1:3001/demo/settle-offer");
  if (!["localhost", "127.0.0.1"].includes(endpoint.hostname) || endpoint.pathname !== "/demo/settle-offer") throw new Error("Only the local platform payment experiment is allowed");
  const client = new x402Client();
  client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: ASSET, maxAmountPerPayment: process.env.X402_MAX_LAMPORTS }] });
  client.register(NETWORK, scheme);
  client.registerPolicy((_version, requirements) => requirements.filter((rule) => rule.scheme === SCHEME && rule.network === NETWORK && rule.asset === ASSET));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const response = await paidFetch(endpoint.href, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, payment_mode: "x402", payer: wallet.publicKey.toBase58() }),
  });
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) throw new Error(`Payment not confirmed (${response.status}); inspect the existing payment before retrying`);
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { EscrowSchemeClient };
