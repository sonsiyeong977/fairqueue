# Ver2 booking and escrow-backed agent payments

## Natural-language conditions

The request starts empty. Detail supplies event, session, quantity, and a section
only if the buyer selected one. Its face value is an editable initial price.
The controls remain available without Gemini. Gemini returns structured primary
and ordered alternative rules, each with grade, section, price cap, adjacency,
split-seat permission, and restricted-view exclusion. Buyers review before booking.
Gemini errors stop interpretation rather than weakening the conditions silently.

English examples verified against live Gemini:

1. `Book 2 adjacent VIP seats only, up to KRW 176,000 per ticket. No alternatives. Do not split the seats.`
2. `Avoid restricted-view seats. Book 2 adjacent VIP seats, up to KRW 176,000 per ticket. If unavailable, accept 2 separate VIP seats; if that also fails, try 2 adjacent R seats, up to KRW 154,000 per ticket.`
3. `Book 2 adjacent R 1 seats, up to KRW 154,000 per ticket. If unavailable, try 2 adjacent S 1 seats, up to KRW 132,000 per ticket. Do not split the seats.`

The VIP/split/R sequence is an example, not a default. Explicit empty alternatives
stay empty. Grade-only requests do not inherit a previously selected exact section.
Missing caps use catalog face value. Editing after review updates the controls.
Korean requests remain supported.
When the text omits alternatives, the server retains the alternatives selected
in the controls. An explicit "only" or "no alternatives" overrides those selections.

## Inventory timing

Parsing does not allocate seats. At the official queue turn, selection creates a
hold before external AI/payment work. Other buyers cannot receive held seats in
this process. Processing protects the hold beyond its TTL. The x402 path also
protects it while the buyer signs and while payment is uncertain. Success consumes
the hold; confirmed refund releases it. Placement/view metadata reach verification.

These are single-process guarantees. Multiple instances require shared transactional
inventory, durable holds, queue and payment records, and idempotency. Seats use
simplified sequential numbers, not a complete row/aisle model. Split seats remain
within one section. The current login is still demo authentication.

## x402 plus Anchor

The optional path uses x402 V2 headers and the official client SDK with a custom
`fairqueue-escrow` scheme. It uses Devnet native SOL and the current Anchor program.
It is not standard Solana `exact` USDC payment; standard facilitators and wallets
do not automatically support this custom scheme.

Existing `/settle` and the storefront demo-wallet flow remain available. The
experiment is disabled by default. The browser supports Wallet Standard wallets
with Devnet transaction signing, including compatible Phantom installations.

```text
Reviewed conditions -> official queue -> seat hold
-> HTTP 402 escrow requirement -> bounded agent signer
-> buyer-signed Anchor deposit -> release OR refund
```

The server binds the quote to buyer, event, queue, conditions, and offer. The client
checks payer, seller, authority, program, escrow PDA, queue, amount, expiry, and the
single deposit instruction before signing. The server verifies the buyer signature
and exact quoted message. Completed retries reuse the recorded result. Uncertain
deposit or finalization enters `RECONCILIATION_REQUIRED` and blocks another payment.
Authenticated status: `GET /x402/payments/:paymentId` on the settlement server.

Quote records remain in memory; crash recovery and cross-instance replay protection
are not implemented. The escrow still trusts its backend authority. x402 exchanges
payment requests and authorization; the buyer's mandate and code decide when to pay.

## Local Setup

Add to the ignored `.env` for both local services. Keep the existing backend
authority keypair; the browser buyer uses a separate wallet:

```ini
X402_ESCROW_ENABLED=true
SOLANA_CLUSTER=devnet
SETTLE_SERVER_URL=http://YOUR_SETTLEMENT_HOST:4001
SETTLE_API_KEY=YOUR_EXISTING_SHARED_SERVER_SECRET
AGENT_KEYPAIR_PATH=PATH_TO_EXISTING_BACKEND_AUTHORITY_KEYPAIR
```

Build the storefront with `npm --prefix storefront run build`. Start the settlement service
and platform in separate terminals with their respective `PORT` values. Use a WSL
IP rather than `localhost` when the platform runs on Windows and settlement in WSL.

### Browser Verification

1. Open `/storefront/`, select an event/session, and review the booking conditions.
2. Select `My wallet · Devnet`, connect a Wallet Standard wallet, and check its
   address and Devnet SOL balance. The buyer must differ from the authority.
3. Join the queue. No deposit is sent merely by connecting or joining.
4. Review the requested principal, escrow account rent, and deposit transaction
   fee. Select `Approve deposit in wallet` and approve the wallet prompt.
5. Check the deposit and release transaction links on Solana Explorer (Devnet).
   Verify the deposit fee payer is the connected buyer, not the server authority.
6. For a refund rehearsal, use a price cap below face value with no alternatives.
   Confirm the refund transaction returns principal to the buyer. Rent and network
   fees are separate and do not return with principal.

Use only Devnet test SOL, preferably at least 0.01 SOL for a short rehearsal.
Escrow account rent is charged for each new order. Cancel before signing to release
an unpaid hold. After an uncertain submission, use `Check existing payment`;
do not submit another payment. Browser signing requires explicit approval, not an
unattended delegated-wallet mandate. Account login is still a browser-local demo.

### Optional CLI Agent

The CLI signer is an additional developer experiment, not required for browser
connection. Add these only when deliberately using a dedicated test keypair:

```ini
X402_ESCROW_ENABLED=true
SOLANA_CLUSTER=devnet
SETTLE_API_KEY=YOUR_EXISTING_SHARED_SERVER_SECRET
X402_AGENT_KEYPAIR_PATH=PATH_TO_DEDICATED_DEVNET_TEST_KEYPAIR
X402_AUTHORITY=EXISTING_ESCROW_AUTHORITY_PUBLIC_KEY
X402_SELLER=EXISTING_SELLER_PUBLIC_KEY
X402_MAX_LAMPORTS=100000
X402_RESOURCE_URL=http://127.0.0.1:3001/demo/settle-offer
```

Keep the existing seller, RPC, Gemini and settlement URL configuration.
Use a dedicated payer, different from the backend authority, with Devnet SOL.
Never collect customer private keys on the server. The deposit cap excludes fees
and account rent. The server limits experimental deposits to 0.01 SOL. KRW prices
use the existing Devnet demonstration conversion, not a real exchange rate.

Run `npm run platform` and `npm run settle` in separate terminals. An agent joins
`/queue/join` with reviewed conditions and polls `/queue/my-turn`. Once eligible,
its request to `/demo/settle-offer` with `payment_mode: "x402"` and `payer` returns
HTTP 402. The SDK client signs the bounded deposit and retries automatically.

Provide a JSON file with an eligible, unprocessed queue entry:

```json
{ "event": "orbit-1120", "queue_id": "YOUR_CONFIRMED_QUEUE_ID" }
```

Explicitly run `npm run x402:client -- PATH_TO_REQUEST_JSON`. This can move Devnet SOL
from the payer. Do not finalize the same entry simultaneously in the demo-wallet UI.

## Refund Limits and Verification

The existing refund instruction returns principal to `escrow_state.user`: the
buyer signer in this path. Fees are separate. Account rent remains locked because
the program does not close escrow accounts. The backend must submit and confirm
refund, so RPC/server downtime can delay it. Buyer-triggered timeout reclaim is
not implemented. Add it and durable recovery before promising instant refunds.

Tests use real Solana transaction serialization and buyer signatures with stub
chain submission/finalization. They cover tampering, caps, repeated requests, refund
decisions, ambiguous submission, failed refunds, and hold protection through the
platform HTTP 402 handshake. They do not prove live Devnet x402 settlement.
English Gemini calls and desktop/mobile UI checks were tested separately.

References:
- https://solana.com/docs/payments/agentic-payments/x402
- https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md
