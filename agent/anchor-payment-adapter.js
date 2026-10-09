const crypto = require("node:crypto");
const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, SendTransactionError } = require("@solana/web3.js");
const { demoDepositLamports, depositComputeBudget, DEVNET_GENESIS } = require("../shared/escrow-payment-policy");

function createAnchorPaymentAdapter({ program, connection, authority, seller, decide }) {
  return {
    async prepare(body) {
      if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error("The escrow RPC must be Solana Devnet");
      const user = new PublicKey(body.payer);
      const offer = body.offered_seat;
      if (offer && (offer.queue_id !== body.queue_id || !offer.hold_id ||
          !Number.isFinite(Date.parse(offer.expires_at)) || Date.parse(offer.expires_at) <= Date.now())) {
        throw new Error("A live platform hold for this queue entry is required");
      }
      const decision = decide(body.user_conditions, offer, body.event, body.user_id);
      const count = Number(body.user_conditions.seat_count);
      const cap = Number(body.user_conditions.primary?.max_price_krw);
      if (!Number.isInteger(count) || count < 1 || count > 6 || !Number.isFinite(cap) || cap <= 0) throw new Error("Invalid buyer conditions");
      const amountKrw = decision === "REFUND" ? cap * count : Number(offer.price_krw) * count;
      // Keep the existing Devnet demonstration conversion; this is not a KRW exchange rate.
      const amountLamports = demoDepositLamports(amountKrw);
      if (!Number.isSafeInteger(amountLamports) || amountLamports > 10000000) throw new Error("Demo payment exceeds 0.01 SOL cap");
      const orderId = crypto.randomBytes(8).readBigUInt64LE();
      const seed = Buffer.alloc(8);
      seed.writeBigUInt64LE(orderId);
      const escrow = PublicKey.findProgramAddressSync([Buffer.from("escrow"), user.toBuffer(), seed], program.programId)[0];
      const transaction = await program.methods.deposit(new anchor.BN(orderId.toString()), new anchor.BN(amountLamports), seller)
        .accounts({ user, authority: authority.publicKey, escrowState: escrow, systemProgram: SystemProgram.programId }).transaction();
      // Keep wallet-added priority fees from changing the already approved message.
      transaction.instructions = [...depositComputeBudget(), ...transaction.instructions];
      transaction.feePayer = user;
      const [rentLamports, balance] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(program.account.escrowState.size),
        connection.getBalance(user, "confirmed"),
      ]);
      const { context, value: latest } = await connection.getLatestBlockhashAndContext("confirmed");
      const quoteExpiresAt = Date.now() + 30000;
      transaction.recentBlockhash = latest.blockhash;
      const feeLamports = (await connection.getFeeForMessage(transaction.compileMessage(), "confirmed")).value;
      if (feeLamports === null) throw new Error("The deposit blockhash expired; obtain a new offer");
      if (balance < amountLamports + rentLamports + feeLamports) {
        throw new Error("Buyer Devnet SOL is insufficient for deposit, escrow rent, and the network fee");
      }
      return {
        transaction, latest, minContextSlot: context.slot, quoteExpiresAt, orderId: orderId.toString(), user: user.toBase58(), seller: seller.toBase58(),
        escrowState: escrow.toBase58(), amountLamports: String(amountLamports), decision,
        extra: { program_id: program.programId.toBase58(), authority: authority.publicKey.toBase58(),
          seller: seller.toBase58(), order_id: orderId.toString(), queue_id: body.queue_id,
          user_conditions: body.user_conditions, offered_seat: offer || null,
          rent_lamports: rentLamports, fee_lamports: feeLamports, final_decision: decision },
      };
    },
    async deposit(bytes, prepared) {
      const validity = await connection.isBlockhashValid(prepared.latest.blockhash, { commitment: "confirmed", minContextSlot: prepared.minContextSlot });
      if (!validity.value) throw Object.assign(new Error("The deposit authorization expired before submission. Cancel this booking and request a fresh quote."), { depositNotSubmitted: true });
      let sig;
      try {
        sig = await connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: "confirmed", minContextSlot: prepared.minContextSlot, maxRetries: 2 });
      } catch (error) {
        if (error instanceof SendTransactionError && error.transactionError.message.includes("Transaction simulation failed: Blockhash not found")) {
          throw Object.assign(new Error("The RPC rejected the deposit before submission because its blockhash was unavailable. Cancel this booking and request a fresh quote."), { depositNotSubmitted: true });
        }
        throw error;
      }
      const confirmed = await connection.confirmTransaction({ ...prepared.latest, signature: sig }, "confirmed");
      if (confirmed.value.err) throw new Error(`Escrow deposit failed: ${JSON.stringify(confirmed.value.err)}`);
      return sig;
    },
    async finalize(prepared, fundTx) {
      const escrowState = new PublicKey(prepared.escrowState);
      const instruction = prepared.decision === "REFUND"
        ? program.methods.refund().accounts({ authority: authority.publicKey, user: new PublicKey(prepared.user), escrowState })
        : program.methods.release().accounts({ authority: authority.publicKey, seller, escrowState });
      const settled = await instruction.signers([authority]).rpc();
      return {
        final_decision: prepared.decision, verify_note: "The code-based verifier checked the buyer's authorized conditions.",
        escrow_user: prepared.user, escrow_state: prepared.escrowState, escrow_order_id: prepared.orderId,
        escrow_amount_lamports: prepared.amountLamports, fund_tx: fundTx, settle_tx: settled,
        explorer_urls: { fund: `https://explorer.solana.com/tx/${fundTx}?cluster=devnet`, settle: `https://explorer.solana.com/tx/${settled}?cluster=devnet` },
      };
    },
  };
}

module.exports = { createAnchorPaymentAdapter };
