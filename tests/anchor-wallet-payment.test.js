const test = require("node:test");
const assert = require("node:assert/strict");
const { Keypair, Transaction, TransactionInstruction, SystemProgram } = require("@solana/web3.js");
const { createAnchorPaymentAdapter } = require("../agent/anchor-payment-adapter");
const { DEVNET_GENESIS } = require("../shared/escrow-payment-policy");

test("buyer-funded deposits require Devnet and enough SOL for principal, rent and fee", async () => {
  const buyer = Keypair.generate(), authority = Keypair.generate(), seller = Keypair.generate();
  let genesis = DEVNET_GENESIS, balance = 2000000, preparedAccounts;
  const connection = {
    getGenesisHash: async () => genesis,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getMinimumBalanceForRentExemption: async (size) => { assert.equal(size, 122); return 1740000; },
    getFeeForMessage: async () => ({ value: 5000 }),
    getBalance: async (address) => { assert.ok(address.equals(buyer.publicKey)); return balance; },
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
  assert.ok(preparedAccounts.user.equals(buyer.publicKey));
  assert.ok(preparedAccounts.authority.equals(authority.publicKey));
  assert.equal(prepared.amountLamports, "31000");
  assert.equal(prepared.extra.rent_lamports, 1740000);
  assert.equal(prepared.extra.fee_lamports, 5000);
  balance = 1775999;
  await assert.rejects(adapter.prepare(body), /insufficient/);
  genesis = "mainnet-genesis";
  await assert.rejects(adapter.prepare(body), /must be Solana Devnet/);
});
