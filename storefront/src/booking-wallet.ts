import { Buffer } from 'buffer';
import { Transaction } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents, type StandardConnectFeature, type StandardDisconnectFeature, type StandardEventsFeature } from '@wallet-standard/features';
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import type { PaymentRequirements } from '@x402/core/types';
import { EscrowPaymentPolicy, demoDepositLamports, NETWORK, SCHEME, ASSET } from '../../shared/escrow-payment-policy';

globalThis.Buffer = Buffer;
type Conditions = { primary: { max_price_krw: number }; fallback_rules: { max_price_krw: number }[]; seat_count: number };
type Config = { enabled: boolean; authority: string; seller: string; network: string; program_id: string; max_lamports: string };
type Quote = { amount: string; rent: number; fee: number; total: number; escrow: string; payer: string; decision: string; expiresAt: number };
const registry = getWallets();
let wallet: Wallet | null = null;
let account: WalletAccount | null = null;
let lamports: number | null = null;
let configuration: Config | null = null;
let offEvents: (() => void) | null = null;

const availableWallets = () => registry.get().filter((item) => item.features[StandardConnect] && item.features[SolanaSignTransaction] && item.chains.includes('solana:devnet'));
const state = () => ({ name: wallet?.name || null, address: account?.address || null, lamports, configuration,
  wallets: availableWallets().map((item) => item.name) });
const notify = () => window.dispatchEvent(new CustomEvent('fairqueue-wallet-change', { detail: state() }));
registry.on('register', notify);
registry.on('unregister', notify);
async function json(path: string) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Wallet service unavailable');
  return data;
}
async function refreshBalance() {
  if (!account) throw new Error('Connect a buyer wallet first');
  const address = account.address;
  const result = await json('/wallet/balance?address=' + encodeURIComponent(address));
  if (result.cluster !== 'devnet' || result.address !== address) throw new Error('Unexpected wallet balance response');
  if (account?.address === address) { lamports = result.lamports; notify(); }
  return result.lamports as number;
}
async function connect(name?: string) {
  const chosen = availableWallets().find((item) => item.name === name) || availableWallets()[0];
  if (!chosen) throw new Error('No Solana wallet found. Install Phantom or another Wallet Standard wallet and reload.');
  const config: Config = await json('/wallet/config');
  if (config.network !== NETWORK) throw new Error('This booking requires Solana Devnet');
  const connected = await (chosen.features as unknown as StandardConnectFeature)[StandardConnect].connect();
  const selected = connected.accounts.find((item) => item.chains.includes('solana:devnet') && item.features.includes(SolanaSignTransaction));
  if (!selected) throw new Error('Enable Solana Devnet in your wallet and connect a signing account');
  if (selected.address === config.authority) throw new Error('Connect a buyer wallet separate from the server authority');
  offEvents?.();
  wallet = chosen; account = selected; configuration = config;
  if (chosen.features[StandardEvents]) {
    offEvents = (chosen.features as unknown as StandardEventsFeature)[StandardEvents].on('change', () => {
      if (!chosen.accounts.some((item) => item.address === selected.address)) { account = null; lamports = null; notify(); }
    });
  }
  notify();
  await refreshBalance();
  return state();
}
async function disconnect() {
  offEvents?.(); offEvents = null;
  const previous = wallet;
  wallet = null; account = null; lamports = null; configuration = null; notify();
  if (previous?.features[StandardDisconnect]) await (previous.features as unknown as StandardDisconnectFeature)[StandardDisconnect].disconnect();
}
function budget(conditions: Conditions) {
  return Math.max(...[conditions.primary, ...conditions.fallback_rules].map((rule) => demoDepositLamports(rule.max_price_krw * conditions.seat_count)));
}
async function settle(options: { event: string; queueId: string; conditions: Conditions; payer: string; onQuote: (quote: Quote) => Promise<void>; onSubmitting: () => void }) {
  const signerWallet = wallet;
  const signerAccount = account;
  if (!signerWallet || !signerAccount || signerAccount.address !== options.payer) throw new Error('Reconnect the buyer wallet used for this booking');
  const config = configuration;
  if (!config?.enabled) throw new Error('The x402 escrow service is not enabled');
  const policy = new EscrowPaymentPolicy({ payer: signerAccount.address, authority: config.authority, seller: config.seller,
    queueId: options.queueId, maxLamports: String(budget(options.conditions)), conditions: options.conditions });
  const client = new x402Client();
  client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: ASSET, maxAmountPerPayment: String(budget(options.conditions)) }] });
  client.register(NETWORK, {
    scheme: SCHEME,
    async createPaymentPayload(version: number, requirement: PaymentRequirements) {
      const transaction = policy.validate(version, requirement);
      const extra = requirement.extra || {};
      const rent = Number(extra.rent_lamports), fee = Number(extra.fee_lamports);
      if (![rent, fee].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('The escrow fee estimate is missing');
      const total = Number(requirement.amount) + rent + fee;
      if (await refreshBalance() < total) throw new Error('Add Devnet SOL to cover the deposit, account rent, and network fee');
      await options.onQuote({ amount: requirement.amount, rent, fee, total, escrow: requirement.payTo, payer: signerAccount.address, decision: String(extra.final_decision), expiresAt: Number(extra.expires_at) });
      if (account?.address !== signerAccount.address) throw new Error('The connected wallet changed');
      policy.validate(version, requirement);
      const unsignedMessage = transaction.serializeMessage();
      const [signed] = await (signerWallet.features as unknown as SolanaSignTransactionFeature)[SolanaSignTransaction].signTransaction({
        account: signerAccount, chain: 'solana:devnet', transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      const verified = Transaction.from(signed.signedTransaction);
      if (!verified.serializeMessage().equals(unsignedMessage)) throw new Error('The wallet changed the quoted transaction (including its fee settings). Nothing was submitted; cancel this unpaid booking.');
      if (!verified.verifySignatures()) throw new Error('The wallet returned an invalid deposit signature. Nothing was submitted.');
      policy.validate(version, requirement);
      policy.consume(requirement.amount);
      options.onSubmitting();
      return { x402Version: 2, payload: { transaction: Buffer.from(signed.signedTransaction).toString('base64') } };
    },
  });
  const response = await wrapFetchWithPayment(fetch, client)('/demo/settle-offer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: options.event, queue_id: options.queueId, payer: options.payer, payment_mode: 'x402' }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `Payment could not be confirmed (${response.status})`);
    if (result.payment_rejected_unfunded === true) error.name = 'DepositNotSubmittedError';
    throw error;
  }
  await refreshBalance().catch(() => undefined);
  return result;
}

const api = { state, connect, disconnect, refreshBalance, budget, settle };
declare global { interface Window { FairQueueWallet: typeof api } }
window.FairQueueWallet = api;
notify();
