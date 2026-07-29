# FairQueue Platform Simulator API

Base URL: `http://localhost:3001`

This service simulates the official ticket platform. It owns queue order, seat
inventory, temporary offers, and purchase confirmation.

## User Statuses

```txt
WAITING
OFFERED
PURCHASED
REFUND_PENDING
REFUNDED
```

`PURCHASED` means the platform has confirmed the order. `SETTLED` is used on
orders when a Solana transaction hash is attached after payment settlement.

## Seat Statuses

Seat status is returned as explicit dashboard-friendly rows:

```txt
AVAILABLE
HELD
SOLD
```

The server still stores inventory compactly:

```txt
seats  = remaining inventory
holds  = temporary offers issued to users
orders = confirmed purchases
```

The API returns `seat_statuses` so the dashboard does not need to infer it.

## Run

```bash
npm run platform
```

If npm scripts are unavailable:

```bash
node platform-sim/server.js
```

## Main Flow

### 1. Check service

```bash
curl http://localhost:3001/health
```

### 2. Set demo inventory

```bash
curl -X POST http://localhost:3001/admin/scenario \
  -H "Content-Type: application/json" \
  -d '{
    "event": "IU Concert",
    "seats": [
      { "grade": "R", "price_krw": 190000, "count": 3 },
      { "grade": "S", "price_krw": 120000, "count": 4 }
    ]
  }'
```

### 3. Join queue

```bash
curl -X POST http://localhost:3001/queue/join \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo-user-1",
    "event": "IU Concert",
    "conditions": {
      "primary": { "grade": "R", "max_price_krw": 200000 },
      "fallback_rules": [
        { "grade": "S", "max_price_krw": 150000 }
      ],
      "seat_count": 1
    }
  }'
```

Save the returned `queue_id`.

### 4. Check turn

```bash
curl "http://localhost:3001/queue/my-turn?event=IU%20Concert&queue_id=QUEUE_ID"
```

For demos, force the next turn:

```bash
curl -X POST http://localhost:3001/queue/advance \
  -H "Content-Type: application/json" \
  -d '{ "event": "IU Concert", "count": 1 }'
```

### 5. Issue platform offer

```bash
curl -X POST http://localhost:3001/queue/offer \
  -H "Content-Type: application/json" \
  -d '{ "event": "IU Concert", "queue_id": "QUEUE_ID" }'
```

Use `offered_seat` as the payload for the agent settlement server.

If no seat satisfies the saved conditions, this endpoint returns
`offered_seat: null` and creates a `REFUND_PENDING` record.

### 6. Confirm purchase after settlement

```bash
curl -X POST http://localhost:3001/purchase/confirm \
  -H "Content-Type: application/json" \
  -d '{ "event": "IU Concert", "hold_id": "HOLD_ID" }'
```

After Solana is connected, include the settlement transaction hash:

```bash
curl -X POST http://localhost:3001/purchase/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "event": "IU Concert",
    "hold_id": "HOLD_ID",
    "tx_hash": "SOLANA_TX_HASH"
  }'
```

### 7. Mark an order as settled

Use this if the platform order was created first and the Solana transaction hash
arrives later.

```bash
curl -X POST http://localhost:3001/settlement/mark-paid \
  -H "Content-Type: application/json" \
  -d '{
    "event": "IU Concert",
    "order_id": "ORDER_ID",
    "tx_hash": "SOLANA_TX_HASH"
  }'
```

### 8. Request refund

Use this for payment failure or condition mismatch after an offer was issued.

```bash
curl -X POST http://localhost:3001/refund/request \
  -H "Content-Type: application/json" \
  -d '{
    "event": "IU Concert",
    "queue_id": "QUEUE_ID",
    "reason": "Payment failed"
  }'
```

### 9. Mark refund as complete

```bash
curl -X POST http://localhost:3001/refund/mark-refunded \
  -H "Content-Type: application/json" \
  -d '{
    "event": "IU Concert",
    "refund_id": "REFUND_ID",
    "tx_hash": "SOLANA_REFUND_TX_HASH"
  }'
```

## Demo Scenarios

### Success

Set `R` inventory above zero, join the queue with primary `R`, issue an offer,
and confirm purchase. `R` inventory decreases and `SOLD` increases.

### Fallback

Set `R` inventory to zero and `S` inventory above zero. Join the queue with
primary `R` and fallback `S`. The offer should return an `S` seat.

### Refund

Set both `R` and `S` inventory to zero. Join the queue with primary `R` and
fallback `S`. `/queue/offer` should return `offered_seat: null` and a
`REFUND_PENDING` refund. Then call `/refund/mark-refunded`.

## Compatibility Endpoints

The existing agent scripts can keep using:

```bash
GET  /seats/:event
POST /seats/:event
```

`GET /seats/:event` returns `availableSeats` in the older shape:

```json
{
  "event": "IU Concert",
  "availableSeats": [
    { "grade": "R", "price_krw": 190000, "count": 3 }
  ]
}
```
