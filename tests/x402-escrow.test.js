const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const anchor = require("@coral-xyz/anchor");
const { Transaction, TransactionInstruction, PublicKey, Keypair, SystemProgram, ComputeBudgetProgram } = require("@solana/web3.js");
const { x402Client, wrapFetchWithPayment } = require("@x402/fetch");
const { decodePaymentRequiredHeader, encodePaymentSignatureHeader } = require("@x402/core/http");
const { createEscrowPaymentHandler, NETWORK } = require("../agent/x402-escrow");
const { EscrowSchemeClient } = require("../agent/x402-escrow-client");
const { EscrowPaymentPolicy, depositComputeBudget } = require("../shared/escrow-payment-policy");
const idl = require("../anchor-escrow/idl/anchor_escrow.json");

test("x402 escrow binds buyer signatures, caches payment, and blocks ambiguous retries", async () => {
  const buyer = Keypair.generate();
  const authority = Keypair.generate();
  const seller = Keypair.generate();
  let deposits = 0;
  let finalizations = 0;
  let failDeposit = false;
  let failFinalize = false;
  let rejectedUnfunded = false;
  const adapter = {
    prepare: async (body) => {
      const orderId = "123";
      const seed = Buffer.alloc(8); seed.writeBigUInt64LE(123n);
      const programId = new PublicKey(idl.address);
      const escrow = PublicKey.findProgramAddressSync([Buffer.from("escrow"), buyer.publicKey.toBuffer(), seed], programId)[0];
      const coder = new anchor.BorshInstructionCoder(idl);
      const transaction = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() })
        .add(new TransactionInstruction({ programId,
          keys: [{ pubkey: buyer.publicKey, isSigner: true, isWritable: true },
            { pubkey: authority.publicKey, isSigner: false, isWritable: false },
            { pubkey: escrow, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
          data: coder.encode("deposit", { order_id: new anchor.BN(orderId), amount: new anchor.BN(15000), seller: seller.publicKey }),
        }));
      return { transaction, escrowState: escrow.toBase58(), amountLamports: "15000", decision: body.refund ? "REFUND" : "SETTLE_PRIMARY",
        extra: { authority: authority.publicKey.toBase58(), seller: seller.publicKey.toBase58(), program_id: idl.address, order_id: orderId, queue_id: body.queue_id } };
    },
    deposit: async (bytes) => {
      assert.ok(Transaction.from(bytes).verifySignatures());
      if (rejectedUnfunded) throw Object.assign(new Error("Blockhash expired before broadcast"), { depositNotSubmitted: true });
      deposits += 1;
      if (failDeposit) throw new Error("RPC disconnected after submission");
      return "TEST_DEPOSIT";
    },
    finalize: async (prepared, fundTx) => {
      finalizations += 1;
      if (failFinalize) throw new Error("Refund RPC unavailable");
      return { final_decision: prepared.decision, fund_tx: fundTx, settle_tx: "TEST_FINALIZATION" };
    },
  };
  const app = express(); app.use(express.json());
  const handler = createEscrowPaymentHandler(adapter);
  app.post("/pay", handler);
  app.post("/cancel", handler.cancel);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/pay`;
  const body = { payer: buyer.publicKey.toBase58(), user_id: "buyer", event: "orbit-1120", queue_id: "one", user_conditions: {} };
  const options = (data = body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const clientFor = (queueId) => {
    const client = new x402Client();
    client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: "native-sol", maxAmountPerPayment: "50000" }] });
    client.register(NETWORK, new EscrowSchemeClient({ wallet: buyer, authority: authority.publicKey, seller: seller.publicKey, queueId, maxLamports: "50000" }));
    return wrapFetchWithPayment(fetch, client);
  };
  try {
    const unpaid = await fetch(url, options());
    assert.equal(unpaid.status, 402, await unpaid.text());
    const required = decodePaymentRequiredHeader(unpaid.headers.get("PAYMENT-REQUIRED"));
    assert.equal(required.accepts[0].scheme, "fairqueue-escrow");
    assert.equal(required.accepts[0].extra.payer, buyer.publicKey.toBase58());
    const quotePolicy = new EscrowPaymentPolicy({ payer: buyer.publicKey, authority: authority.publicKey, seller: seller.publicKey,
      queueId: "one", maxLamports: "50000" });
    const requirement = required.accepts[0];
    const quotedTransaction = Transaction.from(Buffer.from(requirement.extra.transaction, "base64"));
    quotedTransaction.instructions = [...depositComputeBudget(), ...quotedTransaction.instructions];
    const withTransaction = () => ({ ...requirement, extra: { ...requirement.extra,
      transaction: quotedTransaction.serialize({ requireAllSignatures: false }).toString("base64") } });
    assert.ok(quotePolicy.validate(2, withTransaction()));
    quotedTransaction.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
    assert.throws(() => quotePolicy.validate(2, withTransaction()), /fixed compute budget/);
    quotedTransaction.instructions[1] = depositComputeBudget()[1];
    quotedTransaction.instructions.push(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: seller.publicKey, lamports: 1 }));
    assert.throws(() => quotePolicy.validate(2, withTransaction()), /fixed compute budget/);
    assert.throws(() => quotePolicy.validate(2, { ...requirement, amount: "50001" }), /requested 50001 lamports, authorized 50000/);
    assert.throws(() => quotePolicy.validate(2, { ...requirement, extra: { ...requirement.extra, expires_at: 0 } }), /quote expired/);
    assert.throws(() => quotePolicy.validate(2, { ...requirement, extra: { ...requirement.extra, payer: seller.publicKey.toBase58() } }), /payment payer differs/);
    assert.throws(() => quotePolicy.validate(2, { ...requirement, network: "solana:mainnet" }), /network or asset differs/);
    assert.equal(deposits, 0);
    const wrongSigner = Transaction.from(Buffer.from(required.accepts[0].extra.transaction, "base64"));
    wrongSigner.recentBlockhash = Keypair.generate().publicKey.toBase58();
    wrongSigner.sign(buyer);
    const bad = await fetch(url, { ...options(), headers: { ...options().headers, "PAYMENT-SIGNATURE": encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { transaction: wrongSigner.serialize().toString("base64") } }) } });
    assert.equal(bad.status, 402);
    assert.equal(deposits, 0);
    const changed = await fetch(url, options({ ...body, user_conditions: { seat_count: 99 } }));
    assert.equal(changed.status, 409);
    const paid = await clientFor("one")(url, options());
    assert.equal(paid.status, 200, await paid.text());
    assert.ok(paid.headers.get("PAYMENT-RESPONSE"));
    assert.equal(deposits, 1);
    const replay = await fetch(url, options());
    assert.equal(replay.status, 200);
    assert.equal(deposits, 1);
    assert.equal(finalizations, 1);
    const refundBody = { ...body, queue_id: "two", refund: true };
    const refunded = await clientFor("two")(url, options(refundBody));
    assert.equal(refunded.status, 200);
    assert.equal((await refunded.json()).final_decision, "REFUND");
    failDeposit = true;
    const uncertainBody = { ...body, queue_id: "three" };
    const uncertain = await clientFor("three")(url, options(uncertainBody));
    assert.equal(uncertain.status, 503);
    assert.equal((await uncertain.json()).payment_status, "RECONCILIATION_REQUIRED");
    const retry = await clientFor("three")(url, options(uncertainBody));
    assert.equal(retry.status, 409);
    assert.equal(deposits, 3, "No second deposit is sent after an uncertain submission");
    const uncertainCancel = await fetch(url.replace(/\/pay$/, "/cancel"), options(uncertainBody));
    assert.equal(uncertainCancel.status, 409, "An uncertain payment cannot be discarded");
    failDeposit = false; failFinalize = true;
    const refundFailure = await clientFor("four")(url, options({ ...body, queue_id: "four", refund: true }));
    const failed = await refundFailure.json();
    assert.equal(failed.fund_tx, "TEST_DEPOSIT");
    assert.equal(failed.payment_status, "RECONCILIATION_REQUIRED");
    const capped = new EscrowSchemeClient({ wallet: buyer, authority: authority.publicKey, seller: seller.publicKey, queueId: "one", maxLamports: "10000" });
    await assert.rejects(capped.createPaymentPayload(2, required.accepts[0]), /authorization/);

    const cancelBody = { ...body, queue_id: "cancel-before-signing" };
    assert.equal((await fetch(url, options(cancelBody))).status, 402);
    const cancelUrl = url.replace(/\/pay$/, "/cancel");
    assert.equal((await fetch(cancelUrl, options({ ...cancelBody, payer: seller.publicKey.toBase58() }))).status, 403);
    assert.equal((await fetch(cancelUrl, options(cancelBody))).status, 200);
    const depositsBeforeCancelledRetry = deposits;
    assert.equal((await clientFor(cancelBody.queue_id)(url, options(cancelBody))).status, 409);
    assert.equal(deposits, depositsBeforeCancelledRetry, "Cancelled authorization cannot submit a deposit");

    rejectedUnfunded = true;
    const expiredBody = { ...body, queue_id: "expired-before-broadcast" };
    const preflightRejected = await clientFor(expiredBody.queue_id)(url, options(expiredBody));
    assert.equal(preflightRejected.status, 422);
    assert.equal((await preflightRejected.json()).payment_status, "REJECTED_UNFUNDED");
    assert.equal((await fetch(cancelUrl, options(expiredBody))).status, 200);
    rejectedUnfunded = false;

    failFinalize = false;
    process.env.SETTLE_SERVER_URL = url.replace(/\/pay$/, "");
    process.env.X402_ESCROW_ENABLED = "true";
    process.env.TURN_INTERVAL_MS = "1";
    process.env.HOLD_TTL_MS = "1";
    app.post("/x402/settle", handler);
    const platform = http.createServer(require("../platform-sim/server").app);
    await new Promise((resolve) => platform.listen(0, "127.0.0.1", resolve));
    const platformBase = `http://127.0.0.1:${platform.address().port}`;
    try {
      const joined = await fetch(`${platformBase}/queue/join`, options({ event: "orbit-1120", user_id: "buyer", conditions: {
        primary: { grade: "VIP", zone_id: "vip-b", max_price_krw: 176000 }, seat_count: 2, fallback_rules: [],
      } }));
      assert.equal(joined.status, 201);
      const queue = await joined.json();
      const booking = { event: "orbit-1120", queue_id: queue.queue_id, payment_mode: "x402", payer: buyer.publicKey.toBase58() };
      let result;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        result = await fetch(`${platformBase}/demo/settle-offer`, options(booking));
        if (result.status === 402) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(result.status, 402);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const inventory = await (await fetch(`${platformBase}/catalog/events`)).json();
      assert.equal(inventory.events[0].sessions[0].zones.find(zone => zone.id === "vip-b").remaining, 10, "Seats remain held while buyer signs the x402 challenge");
      const completed = await clientFor(queue.queue_id)(`${platformBase}/demo/settle-offer`, options(booking));
      assert.equal(completed.status, 201, await completed.text());
      assert.ok(completed.headers.get("PAYMENT-RESPONSE"));
    } finally {
      await new Promise((resolve) => platform.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
