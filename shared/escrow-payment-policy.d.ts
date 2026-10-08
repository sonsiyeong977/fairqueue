import type { Transaction } from '@solana/web3.js';
export const NETWORK: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const SCHEME: string;
export const ASSET: string;
export function demoDepositLamports(krw: number): number;
export class EscrowPaymentPolicy {
  constructor(options: { payer: string; authority: string; seller: string; queueId: string; maxLamports: string; conditions?: unknown });
  validate(version: number, requirement: { scheme: string; network: string; asset: string; amount: string; payTo: string; extra?: Record<string, unknown> }): Transaction;
  consume(amount: string): void;
}
