const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
async function request(base, path, data) {
  const response = await fetch(base + path, data === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function waitTurn(base, event, queueId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const query = new URLSearchParams({ event, queue_id: queueId });
    const response = await request(base, `/queue/my-turn?${query}`);
    if (response.body.is_my_turn) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Queue turn did not arrive for ${event}`);
}

test("catalog performances keep queue, inventory, and settlement separate", async () => {
  let base;
  let heldDuringSettlement = false;
  const settleServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.offered_seat?.event === "orbit-1120" && !heldDuringSettlement) {
      await new Promise((resolve) => setTimeout(resolve, 35));
      const snapshot = await request(base, "/catalog/events");
      const orbit = snapshot.body.events.find((event) => event.id === "orbit-afterimage");
      assert.equal(orbit.sessions[0].zones.find((zone) => zone.id === "vip-b").remaining, 10);
      heldDuringSettlement = true;
    }
    const decision = body.offered_seat
      ? `SETTLE_${body.offered_seat.match_type}` : "REFUND";
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      final_decision: decision,
      fund_tx: "STUBDEPOSIT",
      settle_tx: "STUBSETTLEMENT",
      explorer_urls: {},
    }));
  });
  const settlePort = await listen(settleServer);
  process.env.SETTLE_SERVER_URL = `http://127.0.0.1:${settlePort}`;
  process.env.TURN_INTERVAL_MS = "20";
  process.env.HOLD_TTL_MS = "10";
  process.env.GEMINI_API_KEY = "";
  const { app, sessionIsOnSale, catalogCondition, catalogBySession, pickCatalogSeat, createHold, expireHolds } = require("../platform-sim/server");
  const platformServer = http.createServer(app);
  const port = await listen(platformServer);
  base = `http://127.0.0.1:${port}`;
  const realNow = Date.now;
  let counter = 0;

  async function book(sessionId, conditions) {
    counter += 1;
    const joined = await request(base, "/queue/join", {
      event: sessionId,
      user_id: `test-user-${counter}`,
      conditions,
    });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));
    await waitTurn(base, sessionId, joined.body.queue_id);
    const settled = await request(base, "/demo/settle-offer", {
      event: sessionId,
      queue_id: joined.body.queue_id,
    });
    assert.equal(settled.status, 201, JSON.stringify(settled.body));
    return settled.body;
  }

  try {
    const catalog = await request(base, "/catalog/events");
    assert.equal(catalog.body.events.length, 3);
    assert.equal(catalog.body.events.find((event) => event.id === "garden-of-time").status, "OPENING_SOON");
    assert.equal(sessionIsOnSale("garden-1105", Date.parse("2026-10-09T13:59:59+09:00")), false);
    assert.equal(sessionIsOnSale("garden-1105", Date.parse("2026-10-09T14:00:00+09:00")), true);
    assert.equal(sessionIsOnSale("orbit-1122", Date.parse("2026-11-25T00:00:00+09:00")), false);

    const koreanBudget = await request(base, "/parse-condition", {
      mode: "controls",
      session_id: "orbit-1120",
      text: "VIP 2연석, 총 35만원까지. 안 되면 R석 30만원까지.",
      defaults: { primary: { grade: "VIP", max_price_krw: 176000 }, seat_count: 2 },
    });
    assert.equal(koreanBudget.status, 200);
    assert.equal(koreanBudget.body.parsed.primary.max_price_krw, 175000);
    assert.equal(koreanBudget.body.parsed.fallback_rules[0].max_price_krw, 150000);
    assert.equal(koreanBudget.body.parsed.seat_count, 2);

    const zoneRequest = await request(base, "/parse-condition", {
      mode: "controls",
      session_id: "orbit-1120",
      text: "VIP A 2 adjacent seats. If unavailable, try VIP B.",
    });
    assert.equal(zoneRequest.status, 200);
    assert.equal(zoneRequest.body.parsed.primary.zone_id, "vip-a");
    assert.equal(zoneRequest.body.parsed.fallback_rules[0].zone_id, "vip-b");

    const gradeThenZone = await request(base, "/parse-condition", {
      mode: "controls",
      session_id: "orbit-1120",
      text: "VIP ticket, if unavailable R 1.",
      defaults: { seat_count: 1, adjacency_required: true },
    });
    assert.equal(gradeThenZone.body.parsed.primary.grade, "VIP");
    assert.equal(gradeThenZone.body.parsed.primary.zone_id, null);
    assert.equal(gradeThenZone.body.parsed.fallback_rules[0].zone_id, "r-1");
    assert.equal(gradeThenZone.body.parsed.adjacency_required, false);

    const unavailable = await request(base, "/parse-condition", {
      session_id: "orbit-1120", text: "Book 2 adjacent VIP seats only. No alternatives.",
    });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.parsed, undefined);

    const explicitPolicy = catalogCondition(
      "Book 2 adjacent VIP seats only. No R seats or other alternatives.",
      catalogBySession.get("orbit-1120"),
      {
        primary: { grade: "VIP", zone_id: null, max_price_krw: null, adjacency_required: true, allow_split_seats: false },
        fallback_rules: [], seat_count: 2,
      },
      { primary: { grade: "VIP", zone_id: "vip-b", max_price_krw: 200000 }, fallback_rules: [{ grade: "R", zone_id: "r-1" }] }
    );
    assert.equal(explicitPolicy.primary.zone_id, null);
    assert.equal(explicitPolicy.primary.max_price_krw, 176000);
    assert.deepEqual(explicitPolicy.fallback_rules, []);

    const inherited = catalogCondition("Find 2 adjecent R seats.", catalogBySession.get("orbit-1120"), {
      primary: { grade: "R", zone_id: null, max_price_krw: 154000, adjacency_required: true },
      fallback_rules: [], fallback_policy: "inherit_controls", seat_count: 2,
    }, { primary: { grade: "R", max_price_krw: 154000 },
      fallback_rules: [{ grade: "S", zone_id: null, max_price_krw: 132000 }], adjacency_required: true });
    assert.equal(inherited.fallback_rules.length, 1);
    assert.equal(inherited.fallback_rules[0].grade, "S");
    assert.equal(inherited.fallback_rules[0].max_price_krw, 132000);
    assert.equal(inherited.fallback_rules[0].adjacency_required, true);
    const rejectedAlternative = catalogCondition("Find 2 adjacent R seats only. No alternatives.", catalogBySession.get("orbit-1120"), {
      primary: { grade: "R", zone_id: null, max_price_krw: 154000, adjacency_required: true },
      fallback_rules: [], fallback_policy: "explicit", seat_count: 2,
    }, { fallback_rules: [{ grade: "S", max_price_krw: 132000 }] });
    assert.deepEqual(rejectedAlternative.fallback_rules, []);

    const naturalLanguagePlan = catalogCondition(
      "Avoid restricted-view seats. Book 2 adjacent VIP seats; otherwise accept 2 separate VIP seats, then 2 adjacent R seats.",
      catalogBySession.get("orbit-1120"),
      {
        primary: {
          grade: "VIP", zone_id: null, max_price_krw: null,
          adjacency_required: true, allow_split_seats: false, avoid_restricted_view: true,
        },
        fallback_rules: [
          {
            grade: "VIP", zone_id: null, max_price_krw: null,
            adjacency_required: false, allow_split_seats: true, avoid_restricted_view: true,
          },
          {
            grade: "R", zone_id: null, max_price_krw: null,
            adjacency_required: true, allow_split_seats: false, avoid_restricted_view: true,
          },
        ],
        seat_count: 2,
      }
    );
    assert.equal(naturalLanguagePlan.primary.adjacency_required, true);
    assert.equal(naturalLanguagePlan.primary.avoid_restricted_view, true);
    assert.equal(naturalLanguagePlan.fallback_rules.length, 2);
    assert.equal(naturalLanguagePlan.fallback_rules[0].grade, "VIP");
    assert.equal(naturalLanguagePlan.fallback_rules[0].allow_split_seats, true);
    assert.equal(naturalLanguagePlan.fallback_rules[1].grade, "R");
    assert.equal(naturalLanguagePlan.fallback_rules[1].adjacency_required, true);

    const isolated = {
      event: "orbit-1120", holds: [], queue: [],
      seats: [{ zone_id: "vip-b", label: "VIP B", grade: "VIP", price_krw: 176000,
        count: 4, available_numbers: [1, 3, 5, 7], restricted_view: false }],
    };
    const splitOffer = pickCatalogSeat(isolated, naturalLanguagePlan);
    assert.equal(splitOffer.matched_rule_index, 1);
    assert.deepEqual(splitOffer.seat_numbers, [1, 3]);
    const entry = { queue_id: "first", user_id: "first", processing: true };
    isolated.queue.push(entry);
    const hold = createHold(isolated, entry, splitOffer);
    assert.equal(hold.restricted_view, false);
    hold.expires_at_ms = Date.now() - 1;
    expireHolds(isolated);
    assert.equal(isolated.holds.length, 1, "Processing protects a hold even beyond its TTL");
    const nextOffer = pickCatalogSeat(isolated, naturalLanguagePlan);
    assert.deepEqual(nextOffer.seat_numbers, [5, 7], "Another buyer cannot receive the held seats");
    entry.processing = false;
    expireHolds(isolated);
    assert.equal(isolated.holds.length, 0);
    assert.deepEqual(pickCatalogSeat(isolated, naturalLanguagePlan).seat_numbers, [1, 3]);

    const gardenEarly = await request(base, "/queue/join", {
      event: "garden-1105", user_id: "early", conditions: {
        primary: { grade: "R", zone_id: "garden-r", max_price_krw: 140000 },
        fallback_rules: [], seat_count: 1,
      },
    });
    assert.equal(gardenEarly.status, 409);

    const mismatchedZone = await request(base, "/queue/join", {
      event: "orbit-1120", user_id: "bad-zone", conditions: {
        primary: { grade: "VIP", zone_id: "r-1", max_price_krw: 176000 },
        fallback_rules: [], seat_count: 1,
      },
    });
    assert.equal(mismatchedZone.status, 400);

    const orbit = await book("orbit-1120", {
      primary: { grade: "VIP", max_price_krw: 176000 }, fallback_rules: [],
      seat_count: 2, preferred_zone_id: "vip-b", adjacency_required: true,
    });
    assert.equal(orbit.order.zone_id, "vip-b");
    assert.equal(orbit.order.count, 2);
    assert.equal(orbit.order.seat_numbers[1] - orbit.order.seat_numbers[0], 1);
    assert.equal(orbit.order.price_krw * orbit.order.count, 352000);

    const fallback = await book("orbit-1120", {
      primary: { grade: "VIP", zone_id: "vip-a", max_price_krw: 176000 },
      fallback_rules: [{ grade: "R", zone_id: "r-2", max_price_krw: 154000 }],
      seat_count: 2, adjacency_required: true,
    });
    assert.equal(fallback.settle_result.final_decision, "SETTLE_FALLBACK");
    assert.equal(fallback.order.zone_id, "r-2");

    const sameGradeFallback = await book("orbit-1121", {
      primary: { grade: "VIP", zone_id: "vip-a", max_price_krw: 176000 },
      fallback_rules: [{ grade: "VIP", zone_id: "vip-b", max_price_krw: 176000 }],
      seat_count: 1,
    });
    assert.equal(sameGradeFallback.settle_result.final_decision, "SETTLE_FALLBACK");
    assert.equal(sameGradeFallback.order.zone_id, "vip-b");

    const orderedFallback = await book("orbit-1120", {
      primary: {
        grade: "VIP", zone_id: "vip-a", max_price_krw: 176000,
        adjacency_required: true, allow_split_seats: false,
      },
      fallback_rules: [
        {
          grade: "VIP", zone_id: "vip-b", max_price_krw: 100000,
          adjacency_required: false, allow_split_seats: true,
        },
        {
          grade: "R", zone_id: "r-1", max_price_krw: 154000,
          adjacency_required: true, allow_split_seats: false,
        },
      ],
      seat_count: 2,
    });
    assert.equal(orderedFallback.settle_result.final_decision, "SETTLE_FALLBACK");
    assert.equal(orderedFallback.offered_seat.zone_id, "r-1");
    assert.equal(orderedFallback.offered_seat.matched_rule_index, 2);

    const festival = await book("field-1024", {
      primary: { grade: "1DAY", max_price_krw: 109000 }, fallback_rules: [],
      seat_count: 3,
    });
    assert.equal(festival.order.count, 3);
    assert.equal(festival.order.seat_numbers.length, 0);

    const refund = await book("orbit-1121", {
      primary: { grade: "VIP", max_price_krw: 100000 }, fallback_rules: [], seat_count: 1,
    });
    assert.equal(refund.settle_result.final_decision, "REFUND");
    assert.equal(refund.refund.status, "REFUNDED");

    const clockStart = realNow();
    const afterGardenSale = Date.parse("2026-10-10T00:00:00+09:00");
    Date.now = () => afterGardenSale + (realNow() - clockStart);
    const garden = await book("garden-1105", {
      primary: { grade: "R", max_price_krw: 140000 }, fallback_rules: [], seat_count: 1,
    });
    assert.equal(garden.order.grade, "R");
    assert.equal(garden.order.price_krw, 140000);
    Date.now = realNow;

    const updated = await request(base, "/catalog/events");
    const orbitSessions = updated.body.events.find((event) => event.id === "orbit-afterimage").sessions;
    assert.equal(orbitSessions.find((session) => session.id === "orbit-1120").zones.find((zone) => zone.id === "vip-b").remaining, 10);
    assert.equal(orbitSessions.find((session) => session.id === "orbit-1121").zones.find((zone) => zone.id === "vip-b").remaining, 3);
    assert.equal(updated.body.events.find((event) => event.id === "field-note").sessions[0].zones[0].remaining, 681);
  } finally {
    Date.now = realNow;
    await close(platformServer);
    await close(settleServer);
  }
});
