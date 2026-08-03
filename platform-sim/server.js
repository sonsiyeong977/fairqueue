const express = require("express");

const path = require("path");

const app = express();
app.use(express.json());
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));

const PORT = Number(process.env.PORT || 3001);
const TURN_INTERVAL_MS = Number(process.env.TURN_INTERVAL_MS || 8000);
const HOLD_TTL_MS = Number(process.env.HOLD_TTL_MS || 60_000);
const SETTLE_SERVER_URL = process.env.SETTLE_SERVER_URL || "http://localhost:4000";
const SETTLE_API_KEY = process.env.SETTLE_API_KEY;

const defaultEventName = "IU Concert";

const state = {
  events: {
    [defaultEventName]: {
      event: defaultEventName,
      venue: "KSPO Dome",
      sale_status: "OPEN",
      turn_index: 0,
      queue: [],
      seats: [
        { grade: "VIP", price_krw: 250000, count: 1 },
        { grade: "R", price_krw: 190000, count: 3 },
        { grade: "S", price_krw: 120000, count: 4 },
      ],
      holds: [],
      orders: [],
      refunds: [],
    },
  },
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateEvent(eventName) {
  const event = eventName || defaultEventName;
  if (!state.events[event]) {
    state.events[event] = {
      event,
      venue: "Demo Venue",
      sale_status: "OPEN",
      turn_index: 0,
      queue: [],
      seats: [],
      holds: [],
      orders: [],
      refunds: [],
    };
  }
  return state.events[event];
}

function publicSeatRows(eventState) {
  expireHolds(eventState);

  return eventState.seats.map((seat) => {
    const held = eventState.holds
      .filter((hold) => hold.grade === seat.grade)
      .reduce((sum, hold) => sum + hold.count, 0);

    return {
      ...seat,
      held_count: held,
      sold_count: soldCountForGrade(eventState, seat.grade),
      available_count: Math.max(seat.count - held, 0),
    };
  });
}

function soldCountForGrade(eventState, grade) {
  return eventState.orders
    .filter((order) => order.grade === grade)
    .reduce((sum, order) => sum + order.count, 0);
}

function seatStatusRows(eventState) {
  return publicSeatRows(eventState).flatMap((seat) => [
    {
      grade: seat.grade,
      status: "AVAILABLE",
      count: seat.available_count,
      price_krw: seat.price_krw,
    },
    {
      grade: seat.grade,
      status: "HELD",
      count: seat.held_count,
      price_krw: seat.price_krw,
    },
    {
      grade: seat.grade,
      status: "SOLD",
      count: seat.sold_count,
      price_krw: seat.price_krw,
    },
  ]);
}

function findQueueEntry(eventState, query) {
  if (query.queue_id) {
    return eventState.queue.find((entry) => entry.queue_id === query.queue_id);
  }

  if (query.user_id) {
    return eventState.queue.find((entry) => entry.user_id === query.user_id);
  }

  return null;
}

function queueSnapshot(eventState, entry) {
  const index = eventState.queue.findIndex((item) => item.queue_id === entry.queue_id);
  const isTurn = index >= 0 && index < eventState.turn_index;
  const waitingAhead = Math.max(index - eventState.turn_index, 0);
  const turnsUntilEntry = Math.max(index - eventState.turn_index + 1, 0);

  return {
    queue_id: entry.queue_id,
    user_id: entry.user_id,
    event: eventState.event,
    status: entry.status,
    position: index + 1,
    current_turn: eventState.turn_index,
    waiting_ahead: waitingAhead,
    turns_until_entry: turnsUntilEntry,
    is_my_turn: isTurn && entry.status === "WAITING",
    joined_at: entry.joined_at,
    estimated_wait_ms: turnsUntilEntry * TURN_INTERVAL_MS,
  };
}

function pickSeat(eventState, conditions = {}) {
  const primary = conditions.primary;
  const fallbackRules = conditions.fallback_rules || [];
  const seatCount = Number(conditions.seat_count || 1);
  const orderedRules = [
    primary,
    ...fallbackRules,
  ].filter(Boolean);
  if (orderedRules.length === 0) {
    orderedRules.push({});
  }
  const availableRows = publicSeatRows(eventState);

  for (let index = 0; index < orderedRules.length; index += 1) {
    const rule = orderedRules[index];
    const seat = availableRows.find((row) => {
      const gradeMatches = !rule.grade || row.grade === rule.grade;
      const priceMatches = !rule.max_price_krw || row.price_krw <= rule.max_price_krw;
      return gradeMatches && priceMatches && row.available_count >= seatCount;
    });

    if (seat) {
      return {
        grade: seat.grade,
        price_krw: seat.price_krw,
        count: seatCount,
        match_type: index === 0 ? "PRIMARY" : "FALLBACK",
        matched_rule_index: index,
      };
    }
  }

  return null;
}

function explainNoOffer(eventState, conditions = {}) {
  const primary = conditions.primary;
  const fallbackRules = conditions.fallback_rules || [];
  const seatCount = Number(conditions.seat_count || 1);
  const rules = [primary, ...fallbackRules].filter(Boolean);
  const availableRows = publicSeatRows(eventState);

  if (rules.length === 0) {
    return "援щℓ 議곌굔??鍮꾩뼱 ?덇퀬, ?쒖븞 媛?ν븳 醫뚯꽍???놁뒿?덈떎.";
  }

  const details = rules.map((rule, index) => {
    const label = index === 0 ? "1?쒖쐞" : `???${index}`;
    const seat = availableRows.find((row) => row.grade === rule.grade);

    if (!seat) {
      return `${label} ${rule.grade}?앹? ?먮ℓ 紐⑸줉???놁뒿?덈떎.`;
    }

    if (seat.available_count < seatCount) {
      return `${label} ${rule.grade}?앹? ?붿껌 ?섎웾 ${seatCount}留ㅻ낫???ш퀬 ${seat.available_count}留ㅺ? ?곸뒿?덈떎.`;
    }

    if (rule.max_price_krw && seat.price_krw > rule.max_price_krw) {
      return `${label} ${rule.grade}??媛寃?${seat.price_krw}?먯씠 理쒕? ?덉슜 湲덉븸 ${rule.max_price_krw}?먯쓣 珥덇낵?⑸땲??`;
    }

    return `${label} ${rule.grade}??議곌굔??留뚯”?섏? 紐삵뻽?듬땲??`;
  });

  return details.join(" ");
}

function expireHolds(eventState) {
  const now = Date.now();
  eventState.holds = eventState.holds.filter((hold) => hold.expires_at_ms > now);
}

function createHold(eventState, queueEntry, seat) {
  const hold = {
    hold_id: makeId("hold"),
    queue_id: queueEntry.queue_id,
    user_id: queueEntry.user_id,
    event: eventState.event,
    grade: seat.grade,
    price_krw: seat.price_krw,
    count: seat.count,
    match_type: seat.match_type,
    matched_rule_index: seat.matched_rule_index,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + HOLD_TTL_MS).toISOString(),
    expires_at_ms: Date.now() + HOLD_TTL_MS,
  };

  eventState.holds.push(hold);
  queueEntry.status = "OFFERED";
  queueEntry.offer = hold;
  return hold;
}

function createRefund(eventState, queueEntry, reason) {
  const existing = eventState.refunds.find(
    (refund) => refund.queue_id === queueEntry.queue_id && refund.status === "REFUND_PENDING"
  );
  if (existing) return existing;

  const refund = {
    refund_id: makeId("refund"),
    queue_id: queueEntry.queue_id,
    user_id: queueEntry.user_id,
    event: eventState.event,
    status: "REFUND_PENDING",
    reason,
    requested_at: nowIso(),
    refunded_at: null,
    refund_tx_hash: null,
  };

  eventState.refunds.push(refund);
  queueEntry.status = "REFUND_PENDING";
  queueEntry.refund = refund;
  return refund;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function confirmHold(eventState, hold, txHash) {
  const seat = eventState.seats.find((row) => row.grade === hold.grade);
  if (!seat || seat.count < hold.count) {
    throw httpError(409, "seat is no longer available");
  }

  seat.count -= hold.count;
  eventState.holds = eventState.holds.filter((item) => item.hold_id !== hold.hold_id);

  const entry = eventState.queue.find((item) => item.queue_id === hold.queue_id);
  if (entry) entry.status = txHash ? "SETTLED" : "PURCHASED";

  const order = {
    order_id: makeId("order"),
    event: eventState.event,
    user_id: hold.user_id,
    queue_id: hold.queue_id,
    grade: hold.grade,
    price_krw: hold.price_krw,
    count: hold.count,
    status: txHash ? "SETTLED" : "PURCHASED",
    settlement_tx_hash: txHash || null,
    purchased_at: nowIso(),
    settled_at: txHash ? nowIso() : null,
  };
  eventState.orders.push(order);
  return order;
}

function markRefundCompleted(eventState, queueEntry, reason, txHash) {
  if (queueEntry.offer) {
    eventState.holds = eventState.holds.filter(
      (hold) => hold.hold_id !== queueEntry.offer.hold_id
    );
    queueEntry.offer = null;
  }

  const refund = createRefund(eventState, queueEntry, reason);
  refund.status = "REFUNDED";
  refund.refund_tx_hash = txHash || null;
  refund.refunded_at = nowIso();
  queueEntry.status = "REFUNDED";
  return refund;
}

async function callSettleServer(eventState, queueEntry, offeredSeat) {
  const headers = { "Content-Type": "application/json" };
  if (SETTLE_API_KEY) headers["x-api-key"] = SETTLE_API_KEY;

  const response = await fetch(`${SETTLE_SERVER_URL}/settle`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: queueEntry.user_id,
      event: eventState.event,
      user_conditions: queueEntry.conditions || {},
      offered_seat: offeredSeat,
    }),
  });

  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (error) {
    body = { raw: bodyText };
  }

  if (!response.ok) {
    const message = body.error || `settle-server returned ${response.status}`;
    throw httpError(502, message);
  }

  return body;
}

function advanceTurns() {
  const now = Date.now();

  for (const eventState of Object.values(state.events)) {
    if (eventState.sale_status !== "OPEN") continue;

    if (!eventState.last_turn_advance_ms) {
      eventState.last_turn_advance_ms = now;
    }

    const elapsed = now - eventState.last_turn_advance_ms;
    const steps = Math.floor(elapsed / TURN_INTERVAL_MS);
    if (steps <= 0) continue;

    eventState.turn_index = Math.min(
      eventState.turn_index + steps,
      eventState.queue.length
    );
    eventState.last_turn_advance_ms += steps * TURN_INTERVAL_MS;
  }
}

setInterval(advanceTurns, 1000).unref();

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "fairqueue-platform-sim", time: nowIso() });
});

app.get("/events", (req, res) => {
  advanceTurns();
  res.json({
    events: Object.values(state.events).map((eventState) => ({
      event: eventState.event,
      venue: eventState.venue,
      sale_status: eventState.sale_status,
      queue_size: eventState.queue.length,
      current_turn: eventState.turn_index,
      order_count: eventState.orders.length,
      refund_pending_count: eventState.refunds.filter((refund) => refund.status === "REFUND_PENDING").length,
      refunded_count: eventState.refunds.filter((refund) => refund.status === "REFUNDED").length,
      seats: publicSeatRows(eventState),
      seat_statuses: seatStatusRows(eventState),
    })),
  });
});

app.get("/seats/status", (req, res) => {
  const eventState = getOrCreateEvent(req.query.event);
  res.json({
    event: eventState.event,
    sale_status: eventState.sale_status,
    availableSeats: publicSeatRows(eventState),
    seats: publicSeatRows(eventState),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.get("/seats/:event", (req, res) => {
  const eventState = getOrCreateEvent(decodeURIComponent(req.params.event));
  res.json({
    event: eventState.event,
    availableSeats: publicSeatRows(eventState).map(({ grade, price_krw, available_count }) => ({
      grade,
      price_krw,
      count: available_count,
    })),
  });
});

app.post("/seats/:event", (req, res) => {
  const eventState = getOrCreateEvent(decodeURIComponent(req.params.event));
  eventState.seats = (req.body.availableSeats || []).map((seat) => ({
    grade: seat.grade,
    price_krw: Number(seat.price_krw),
    count: Number(seat.count || seat.available_count || 0),
  }));
  eventState.holds = [];
  res.json({
    event: eventState.event,
    availableSeats: publicSeatRows(eventState),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.post("/queue/join", (req, res) => {
  advanceTurns();

  const { user_id, event, conditions } = req.body;
  if (!user_id || !event) {
    return res.status(400).json({ error: "user_id and event are required" });
  }

  const eventState = getOrCreateEvent(event);
  const existing = eventState.queue.find(
    (entry) => entry.user_id === user_id && ["WAITING", "OFFERED", "REFUND_PENDING"].includes(entry.status)
  );

  if (existing) {
    return res.json({ already_joined: true, ...queueSnapshot(eventState, existing) });
  }

  const entry = {
    queue_id: makeId("queue"),
    user_id,
    conditions: conditions || {},
    status: "WAITING",
    joined_at: nowIso(),
    offer: null,
  };

  eventState.queue.push(entry);
  res.status(201).json(queueSnapshot(eventState, entry));
});

app.get("/queue/my-turn", (req, res) => {
  advanceTurns();

  const eventState = getOrCreateEvent(req.query.event);
  const entry = findQueueEntry(eventState, req.query);
  if (!entry) {
    return res.status(404).json({ error: "queue entry not found" });
  }

  res.json(queueSnapshot(eventState, entry));
});

app.post("/queue/advance", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  const count = Number(req.body.count || 1);
  eventState.turn_index = Math.min(eventState.turn_index + count, eventState.queue.length);
  eventState.last_turn_advance_ms = Date.now();

  res.json({
    event: eventState.event,
    current_turn: eventState.turn_index,
    queue_size: eventState.queue.length,
  });
});

app.post("/queue/offer", (req, res) => {
  advanceTurns();

  const eventState = getOrCreateEvent(req.body.event);
  const entry = findQueueEntry(eventState, req.body);
  if (!entry) {
    return res.status(404).json({ error: "queue entry not found" });
  }

  const snapshot = queueSnapshot(eventState, entry);
  if (!snapshot.is_my_turn && entry.status !== "OFFERED") {
    return res.status(409).json({ error: "not your turn yet", queue: snapshot });
  }

  if (entry.offer) {
    return res.json({ event: eventState.event, offered_seat: entry.offer, queue: snapshot });
  }

  const offeredSeat = pickSeat(eventState, entry.conditions);
  if (!offeredSeat) {
    const reason = explainNoOffer(eventState, entry.conditions);
    const refund = createRefund(
      eventState,
      entry,
      reason
    );
    return res.json({
      event: eventState.event,
      offered_seat: null,
      refund,
      reason: refund.reason,
      queue: queueSnapshot(eventState, entry),
    });
  }

  const hold = createHold(eventState, entry, offeredSeat);
  res.status(201).json({
    event: eventState.event,
    offered_seat: hold,
    queue: queueSnapshot(eventState, entry),
  });
});

app.post("/purchase/confirm", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  expireHolds(eventState);

  const hold = eventState.holds.find((item) => item.hold_id === req.body.hold_id);
  if (!hold) {
    return res.status(404).json({ error: "hold not found or expired" });
  }

  try {
    const order = confirmHold(eventState, hold, req.body.tx_hash);
    res.status(201).json({
      order,
      remainingSeats: publicSeatRows(eventState),
      seat_statuses: seatStatusRows(eventState),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/settlement/mark-paid", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  const order = eventState.orders.find(
    (item) => item.order_id === req.body.order_id || item.queue_id === req.body.queue_id
  );

  if (!order) {
    return res.status(404).json({ error: "order not found" });
  }

  order.status = "SETTLED";
  order.settlement_tx_hash = req.body.tx_hash || order.settlement_tx_hash;
  order.settled_at = nowIso();

  res.json({ order });
});

app.post("/refund/request", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  const entry = findQueueEntry(eventState, req.body);
  if (!entry) {
    return res.status(404).json({ error: "queue entry not found" });
  }

  if (entry.offer) {
    eventState.holds = eventState.holds.filter(
      (hold) => hold.hold_id !== entry.offer.hold_id
    );
    entry.offer = null;
  }

  const refund = createRefund(
    eventState,
    entry,
    req.body.reason || "Payment failed or user conditions were not satisfied"
  );

  res.status(201).json({
    refund,
    queue: queueSnapshot(eventState, entry),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.post("/refund/mark-refunded", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  const refund = eventState.refunds.find(
    (item) => item.refund_id === req.body.refund_id || item.queue_id === req.body.queue_id
  );

  if (!refund) {
    return res.status(404).json({ error: "refund not found" });
  }

  refund.status = "REFUNDED";
  refund.refund_tx_hash = req.body.tx_hash || null;
  refund.refunded_at = nowIso();

  const entry = eventState.queue.find((item) => item.queue_id === refund.queue_id);
  if (entry) entry.status = "REFUNDED";

  res.json({
    refund,
    queue: entry ? queueSnapshot(eventState, entry) : null,
  });
});

app.post("/demo/settle-offer", async (req, res) => {
  try {
    advanceTurns();

    const eventState = getOrCreateEvent(req.body.event);
    expireHolds(eventState);

    const entry = findQueueEntry(eventState, req.body);
    if (!entry) {
      return res.status(404).json({ error: "queue entry not found" });
    }

    if (["PURCHASED", "SETTLED", "REFUNDED"].includes(entry.status)) {
      return res.status(409).json({
        error: "queue entry already finalized",
        queue: queueSnapshot(eventState, entry),
      });
    }

    if (entry.offer) {
      const activeHold = eventState.holds.find((hold) => hold.hold_id === entry.offer.hold_id);
      if (!activeHold) {
        entry.offer = null;
        entry.status = "WAITING";
      }
    }

    let snapshot = queueSnapshot(eventState, entry);
    if (!snapshot.is_my_turn && entry.status !== "OFFERED") {
      return res.status(409).json({ error: "not your turn yet", queue: snapshot });
    }

    let hold = entry.offer;
    if (!hold) {
      const offeredSeat = pickSeat(eventState, entry.conditions);
      if (offeredSeat) {
        hold = createHold(eventState, entry, offeredSeat);
      } else {
        const reason = explainNoOffer(eventState, entry.conditions);
        createRefund(eventState, entry, reason);
        const settleResult = await callSettleServer(eventState, entry, null);
        const refund = markRefundCompleted(
          eventState,
          entry,
          reason,
          settleResult.settle_tx
        );

        return res.status(201).json({
          event: eventState.event,
          queue: queueSnapshot(eventState, entry),
          offered_seat: null,
          refund,
          settle_result: settleResult,
          seat_statuses: seatStatusRows(eventState),
        });
      }
    }

    const settleResult = await callSettleServer(eventState, entry, hold);

    if (settleResult.final_decision === "REFUND") {
      const refund = markRefundCompleted(
        eventState,
        entry,
        settleResult.verify_note || "Settle server decided to refund",
        settleResult.settle_tx
      );

      return res.status(201).json({
        event: eventState.event,
        queue: queueSnapshot(eventState, entry),
        offered_seat: null,
        refund,
        settle_result: settleResult,
        seat_statuses: seatStatusRows(eventState),
      });
    }

    const order = confirmHold(eventState, hold, settleResult.settle_tx);
    res.status(201).json({
      event: eventState.event,
      queue: queueSnapshot(eventState, entry),
      offered_seat: hold,
      order,
      settle_result: settleResult,
      remainingSeats: publicSeatRows(eventState),
      seat_statuses: seatStatusRows(eventState),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/admin/scenario", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event || defaultEventName);
  eventState.sale_status = req.body.sale_status || "OPEN";
  eventState.turn_index = Number(req.body.turn_index || 0);
  eventState.last_turn_advance_ms = Date.now();
  eventState.queue = [];
  eventState.holds = [];
  eventState.orders = [];
  eventState.refunds = [];
  eventState.seats = (req.body.seats || eventState.seats).map((seat) => ({
    grade: seat.grade,
    price_krw: Number(seat.price_krw),
    count: Number(seat.count || 0),
  }));

  res.json({
    event: eventState.event,
    sale_status: eventState.sale_status,
    seats: publicSeatRows(eventState),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.listen(PORT, () => {
  console.log(`FairQueue platform simulator running on http://localhost:${PORT}`);
  console.log("GET  /health");
  console.log("GET  /events");
  console.log("GET  /seats/status?event=IU%20Concert");
  console.log("POST /queue/join");
  console.log("GET  /queue/my-turn?event=IU%20Concert&queue_id=...");
  console.log("POST /queue/offer");
  console.log("POST /purchase/confirm");
  console.log("POST /settlement/mark-paid");
  console.log("POST /demo/settle-offer");
  console.log("POST /refund/request");
  console.log("POST /refund/mark-refunded");
});
