# Storefront and booking integration

`storefront/` is a Vite + React + TypeScript ticket catalog. The platform Express service serves its built files at `/storefront/` and the booking session at `/dashboard/portal.html`. The catalog is defined once in `storefront/catalog.json`; the browser and platform API read the same event, performance, zone, and face-value data.

## Booking flow

1. A visitor chooses one of three fictional events, a performance, ticket quantity, and optionally a preferred zone. The storefront saves this intent in browser `sessionStorage`.
2. The visitor signs in with a **browser-only demo profile**. This is not real authentication. The booking page receives the event and performance IDs, quantity, and zone preference.
3. The visitor edits and confirms a natural-language request. `/parse-condition` calls Gemini when configured and falls back to a basic parser otherwise. The visitor reviews the structured grade, price limit, quantity, and adjacency rule.
4. `/queue/join` and `/queue/my-turn` use a distinct in-memory queue for each performance. At the turn, `/demo/settle-offer` selects a matching zone and seat numbers, then calls the settlement server's `/settle` endpoint.
5. The settlement server independently checks the offer and runs Anchor escrow `deposit` followed by `release` or `refund` on Solana Devnet. The browser shows the returned transaction links and records a browser-local activity entry under My bookings.

The events are ORBIT/9 LIVE 2026, THE GARDEN OF TIME, and FIELD NOTE 2026. The musical opens on October 9, 2026 at 14:00 KST; the platform rejects queue entry before then. The sold-out ORBIT/9 performance cannot be booked. Festival admission is general admission, so no seat numbers are assigned. The booking session accepts exact zones (such as VIP B or R 2), an entire grade where multiple zones exist, and an optional fallback zone.

Inventory, queues, holds, and orders are **process memory only**. They reset when the platform service restarts and are not synchronized between replicas. Use one platform instance for this prototype. A booking is not a real issued ticket, and no user card, wallet, or real-money payment is connected. The Devnet transaction uses a configured demo agent wallet.

If `SELLER_PUBKEY` is not set, the settlement server returns demo payouts to that agent wallet instead of generating an unowned destination. Set `SELLER_PUBKEY` to a funded Devnet seller address when testing a separate payout account.

## Local run

From the repository root, run `npm ci`. In `storefront/`, run `npm ci` and `npm run build`. Configure the environment as described in the root README. Start `npm run settle` and `npm run platform` in separate terminals, then open `http://localhost:3001/storefront/`. For frontend hot reload, run `npm run dev` in `storefront/` while the platform service remains on port 3001; Vite proxies catalog, booking, and dashboard requests to it.

The Dockerfile builds the storefront automatically. To check the API contract without calling Gemini or Devnet, run `npm test` at the repository root. That test uses a stub settlement service and must not be presented as a live on-chain verification.
