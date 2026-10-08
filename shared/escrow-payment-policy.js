const anchor = require("@coral-xyz/anchor");
const { Transaction, PublicKey, SystemProgram } = require("@solana/web3.js");
const { offerMatchesRule } = require("../agent/offer-policy");
const idl = require("../anchor-escrow/idl/anchor_escrow.json");

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const SCHEME = "fairqueue-escrow";
const ASSET = "native-sol";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const canonicalJson = (value) => JSON.stringify(canonical(value));
function demoDepositLamports(krw) {
  return Math.round((Number((krw / 10000000000).toFixed(6)) || 0.0001) * 1000000000);
}

class EscrowPaymentPolicy {
  constructor({ payer, authority, seller, queueId, maxLamports, conditions }) {
    this.payer = new PublicKey(payer);
    this.authority = new PublicKey(authority);
    this.seller = new PublicKey(seller);
    this.queueId = queueId;
    this.conditions = conditions;
    if (this.payer.equals(this.authority)) throw new Error("Use a buyer wallet separate from the server authority wallet");
    if (!/^\d+$/.test(String(maxLamports)) || BigInt(maxLamports) < 1n || BigInt(maxLamports) > 10000000n) {
      throw new Error("Set an authorized deposit cap of 1..10000000 lamports (up to 0.01 SOL)");
    }
    this.remaining = BigInt(maxLamports);
  }
  validate(version, requirement) {
    const extra = requirement.extra;
    if (version !== 2 || requirement.scheme !== SCHEME || requirement.network !== NETWORK || requirement.asset !== ASSET ||
        !/^\d+$/.test(requirement.amount) || BigInt(requirement.amount) <= 0n || BigInt(requirement.amount) > this.remaining ||
        extra?.expires_at <= Date.now() || !Number.isFinite(extra?.expires_at) || extra.queue_id !== this.queueId ||
        extra.payer !== this.payer.toBase58() || extra.authority !== this.authority.toBase58() ||
        extra.seller !== this.seller.toBase58() || extra.program_id !== idl.address) {
      throw new Error("Escrow payment exceeds or differs from the buyer's authorization");
    }
    if (this.conditions) {
      if (canonicalJson(extra.user_conditions) !== canonicalJson(this.conditions)) throw new Error("The quoted conditions differ from your approved request");
      const offer = extra.offered_seat;
      if (offer && (Number(offer.count) !== this.conditions.seat_count ||
          ![this.conditions.primary, ...this.conditions.fallback_rules].some(rule => offerMatchesRule(offer, rule)))) {
        throw new Error("The seat offer does not satisfy your approved conditions");
      }
      const total = offer ? offer.price_krw * offer.count : this.conditions.primary.max_price_krw * this.conditions.seat_count;
      if (demoDepositLamports(total) !== Number(requirement.amount)) throw new Error("The escrow amount does not match the approved offer");
    }
    const transaction = Transaction.from(Buffer.from(extra.transaction, "base64"));
    const seed = Buffer.alloc(8);
    seed.writeBigUInt64LE(BigInt(extra.order_id));
    const programId = new PublicKey(idl.address);
    const escrow = PublicKey.findProgramAddressSync([Buffer.from("escrow"), this.payer.toBuffer(), seed], programId)[0];
    const instruction = transaction.instructions[0];
    const coder = new anchor.BorshInstructionCoder(idl);
    const expectedData = coder.encode("deposit", { order_id: new anchor.BN(extra.order_id), amount: new anchor.BN(requirement.amount), seller: this.seller });
    const expectedKeys = [this.payer, this.authority, escrow, SystemProgram.programId];
    if (!transaction.feePayer?.equals(this.payer) || transaction.instructions.length !== 1 ||
        !instruction.programId.equals(programId) || !instruction.data.equals(expectedData) ||
        requirement.payTo !== escrow.toBase58() || instruction.keys.length !== expectedKeys.length ||
        instruction.keys.some((key, index) => !key.pubkey.equals(expectedKeys[index]) || key.isSigner !== (index === 0) || key.isWritable !== (index === 0 || index === 2))) {
      throw new Error("Only the authorized Anchor escrow deposit instruction may be signed");
    }
    return transaction;
  }
  consume(amount) {
    if (BigInt(amount) > this.remaining) throw new Error("The payment budget has already been consumed");
    this.remaining -= BigInt(amount);
  }
}

module.exports = { EscrowPaymentPolicy, demoDepositLamports, NETWORK, DEVNET_GENESIS, SCHEME, ASSET };
