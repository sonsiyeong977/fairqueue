const crypto = require("node:crypto");
const { Transaction, PublicKey } = require("@solana/web3.js");
const { encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader } = require("@x402/core/http");

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const SCHEME = "fairqueue-escrow";
const ASSET = "native-sol";
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// Each quote binds one buyer-signed deposit to an immutable, server-verified offer.
function createEscrowPaymentHandler({ prepare, deposit, finalize, now = Date.now, ttlMs = 45000 }) {
  const records = new Map();
  const byRequest = new Map();
  const resource = { url: "http://127.0.0.1:4000/x402/settle", description: "FairQueue ticket escrow deposit", mimeType: "application/json" };
  const fail = (res, status, error, record) => res.status(status).json({ error, payment_id: record?.id, payment_status: record?.status, fund_tx: record?.fundTx });
  const receipt = (res, record) => {
    res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader({ success: true, network: NETWORK, payer: record.requirement.extra.payer, transaction: record.fundTx }));
    return res.json(record.result);
  };
  const challenge = (res, record) => {
    const required = { x402Version: 2, resource, accepts: [record.requirement] };
    res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(required));
    return res.status(402).json(required);
  };
  const handler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let record;
    try {
      const body = req.body;
      if (!body?.payer || !body.user_id || !body.event || !body.queue_id || !body.user_conditions) {
        return fail(res, 400, "payer, user_id, event, queue_id and user_conditions are required");
      }
      new PublicKey(body.payer);
      const requestKey = digest({ event: body.event, queue_id: body.queue_id });
      const requestDigest = digest(body);
      record = records.get(byRequest.get(requestKey));
      if (record && record.requestDigest !== requestDigest) return fail(res, 409, "This queue entry already has different payment conditions", record);
      if (record?.status === "COMPLETE") return receipt(res, record);
      if (record && record.status !== "READY") return fail(res, 409, "Payment is processing or requires reconciliation; do not pay again", record);
      if (record && record.expiresAt <= now()) return fail(res, 410, "Payment authorization expired; obtain a fresh offer", record);
      if (!record) {
        // Reserve before await so simultaneous requests cannot create different deposits.
        record = { id: crypto.randomUUID(), requestDigest, status: "PREPARING" };
        records.set(record.id, record);
        byRequest.set(requestKey, record.id);
        try {
          const prepared = await prepare(body);
          record.message = prepared.transaction.serializeMessage();
          record.prepared = prepared;
          record.expiresAt = Math.min(now() + ttlMs, prepared.quoteExpiresAt || Infinity);
          if (record.expiresAt <= now()) throw new Error("Quote preparation took too long. Request a fresh offer.");
          record.requirement = {
            scheme: SCHEME, network: NETWORK, asset: ASSET, amount: prepared.amountLamports,
            payTo: prepared.escrowState, maxTimeoutSeconds: Math.max(1, Math.floor((record.expiresAt - now()) / 1000)),
            extra: { ...prepared.extra, payer: body.payer, payment_id: record.id,
              request_digest: requestDigest, expires_at: record.expiresAt,
              transaction: prepared.transaction.serialize({ requireAllSignatures: false }).toString("base64") },
          };
          record.status = "READY";
        } catch (error) {
          records.delete(record.id);
          byRequest.delete(requestKey);
          throw error;
        }
      }
      const header = req.get("PAYMENT-SIGNATURE");
      if (!header) return challenge(res, record);
      let payload;
      try { payload = decodePaymentSignatureHeader(header); } catch { return fail(res, 402, "Invalid payment payload", record); }
      if (payload.x402Version !== 2 || digest(payload.accepted) !== digest(record.requirement) ||
          digest(payload.resource) !== digest(resource)) return fail(res, 402, "Payment does not match this escrow requirement", record);
      let transaction;
      try {
        transaction = Transaction.from(Buffer.from(payload.payload.transaction, "base64"));
        if (!transaction.serializeMessage().equals(record.message) || !transaction.verifySignatures()) throw new Error("Invalid transaction");
      } catch { return fail(res, 402, "Deposit transaction or buyer signature is invalid", record); }
      record.status = "DEPOSIT_SUBMITTING";
      // Store the signed transaction before submission; ambiguous errors never trigger a new deposit.
      record.signedTransaction = transaction.serialize();
      record.fundTx = await deposit(record.signedTransaction, record.prepared);
      record.status = "FUNDED";
      record.result = await finalize(record.prepared, record.fundTx);
      record.status = "COMPLETE";
      return receipt(res, record);
    } catch (error) {
      if (record?.status === "DEPOSIT_SUBMITTING" && error.depositNotSubmitted === true) {
        record.status = "REJECTED_UNFUNDED";
        return fail(res, 422, error.message, record);
      }
      if (record && ["DEPOSIT_SUBMITTING", "FUNDED"].includes(record.status)) record.status = "RECONCILIATION_REQUIRED";
      return fail(res, 503, error.message, record);
    }
  };
  handler.status = (req, res) => {
    const record = records.get(req.params.paymentId);
    if (!record) return fail(res, 404, "Payment not found");
    res.json({ payment_id: record.id, status: record.status, fund_tx: record.fundTx || null, result: record.result || null });
  };
  handler.cancel = (req, res) => {
    const id = byRequest.get(digest({ event: req.body.event, queue_id: req.body.queue_id }));
    const record = records.get(id);
    if (!record) return res.json({ cancelled: true });
    if (record.requirement?.extra.payer !== req.body.payer) return fail(res, 403, "The payer does not match this payment", record);
    if (!["READY", "REJECTED_UNFUNDED", "CANCELLED"].includes(record.status)) return fail(res, 409, "This payment cannot be cancelled before reconciliation", record);
    record.status = "CANCELLED";
    res.json({ cancelled: true });
  };
  return handler;
}

module.exports = { createEscrowPaymentHandler, NETWORK, SCHEME, ASSET, digest };
