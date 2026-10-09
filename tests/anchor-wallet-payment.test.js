const test = require("node:test");
const assert = require("node:assert/strict");
const { Keypair, Transaction, TransactionInstruction, SystemProgram, SendTransactionError } = require("@solana/web3.js");
const { createAnchorPaymentAdapter } = require("../agent/anchor-payment-adapter");
const { DEVNET_GENESIS, depositComputeBudget } = require("../shared/escrow-payment-policy");

test("buyer-funded deposits require Devnet and enough SOL for principal, rent and fee", async () => {
  const buyer = Keypair.generate(), authority = Keypair.generate(), seller = Keypair.generate();
  let genesis = DEVNET_GENESIS, balance = 2000000, preparedAccounts;
  let blockhashValid = true, sendError = null, sendCalls = 0;
  const connection = {
    getGenesisHash: async () => genesis,
    getLatestBlockhashAndContext: async () => ({ context: { slot: 42 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 } }),
    getMinimumBalanceForRentExemption: async (size) => { assert.equal(size, 122); return 1740000; },
    getFeeForMessage: async () => ({ value: 5000 }),
    getBalance: async (address) => { assert.ok(address.equals(buyer.publicKey)); return balance; },
    isBlockhashValid: async (_, options) => { assert.equal(options.minContextSlot, 42); return { value: blockhashValid }; },
    sendRawTransaction: async (_, options) => {
      assert.equal(options.preflightCommitment, "confirmed"); assert.equal(options.minContextSlot, 42);
      sendCalls += 1;
      if (sendError) throw sendError;
      return "TEST_DEPOSIT";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const program = { programId: Keypair.generate().publicKey, account: { escrowState: { size: 122 } },
    methods: { deposit: () => ({ accounts: (accounts) => {
      preparedAccounts = accounts;
      return { transaction: async () => new Transaction().add(new TransactionInstruction({ programId: SystemProgram.programId, keys: [], data: Buffer.alloc(0) })) };
    } }) } };
  const adapter = createAnchorPaymentAdapter({ program, connection, authority, seller: seller.publicKey, decide: () => "SETTLE_PRIMARY" });
  const body = { payer: buyer.publicKey.toBase58(), queue_id: "q", user_conditions: { primary: { max_price_krw: 154000 }, seat_count: 2 },
    offered_seat: { queue_id: "q", hold_id: "h", expires_at: new Date(Date.now() + 60000).toISOString(), price_krw: 154000, count: 2 } };
  const prepared = await adapter.prepare(body);
  assert.equal(prepared.transaction.instructions.length, 3);
  depositComputeBudget().forEach((instruction, index) => {
    assert.ok(prepared.transaction.instructions[index].programId.equals(instruction.programId));
    assert.ok(prepared.transaction.instructions[index].data.equals(instruction.data));
  });
  assert.ok(preparedAccounts.user.equals(buyer.publicKey));
  assert.ok(preparedAccounts.authority.equals(authority.publicKey));
  assert.equal(prepared.amountLamports, "31000");
  assert.equal(prepared.extra.rent_lamports, 1740000);
  assert.equal(prepared.extra.fee_lamports, 5000);
  assert.equal(prepared.minContextSlot, 42);
  assert.ok(prepared.quoteExpiresAt > Date.now() && prepared.quoteExpiresAt <= Date.now() + 30000);
  assert.equal(await adapter.deposit(Buffer.alloc(0), prepared), "TEST_DEPOSIT");
  blockhashValid = false;
  await assert.rejects(adapter.deposit(Buffer.alloc(0), prepared), error => error.depositNotSubmitted === true);
  assert.equal(sendCalls, 1, "Expired blockhash is never submitted");
  blockhashValid = true;
  sendError = new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed: Blockhash not found", logs: [] });
  await assert.rejects(adapter.deposit(Buffer.alloc(0), prepared), error => error.depositNotSubmitted === true);
  sendError = new Error("RPC disconnected after send");
  await assert.rejects(adapter.deposit(Buffer.alloc(0), prepared), error => !error.depositNotSubmitted);
  balance = 1775999;
  await assert.rejects(adapter.prepare(body), /insufficient/);
  genesis = "mainnet-genesis";
  await assert.rejects(adapter.prepare(body), /must be Solana Devnet/);
});
