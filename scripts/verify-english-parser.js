const assert = require("node:assert/strict");
const http = require("node:http");
const { app } = require("../platform-sim/server");

async function main() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    {
      text: "Avoid restricted-view seats. Book 2 adjacent VIP seats, up to KRW 176,000 per ticket. If unavailable, accept 2 separate VIP seats; if that also fails, try 2 adjacent R seats, up to KRW 154,000 per ticket.",
      check: (parsed) => {
        assert.equal(parsed.primary.grade, "VIP");
        assert.equal(parsed.primary.adjacency_required, true);
        assert.equal(parsed.primary.allow_split_seats, false);
        assert.equal(parsed.fallback_rules.length, 2);
        assert.equal(parsed.fallback_rules[0].grade, "VIP");
        assert.equal(parsed.fallback_rules[0].allow_split_seats, true);
        assert.equal(parsed.fallback_rules[1].grade, "R");
        assert.equal(parsed.fallback_rules[1].adjacency_required, true);
        assert.ok([parsed.primary, ...parsed.fallback_rules].every((rule) => rule.avoid_restricted_view));
      },
    },
    {
      text: "Book 2 adjacent VIP seats only, up to KRW 176,000 per ticket. No alternatives. Do not split the seats.",
      check: (parsed) => {
        assert.equal(parsed.primary.grade, "VIP");
        assert.equal(parsed.primary.allow_split_seats, false);
        assert.deepEqual(parsed.fallback_rules, []);
      },
    },
    {
      text: "Book 2 adjacent R 1 seats, up to KRW 154,000 per ticket. If unavailable, try 2 adjacent S 1 seats, up to KRW 132,000 per ticket. Do not split the seats.",
      check: (parsed) => {
        assert.equal(parsed.primary.zone_id, "r-1");
        assert.equal(parsed.primary.grade, "R");
        assert.equal(parsed.fallback_rules.length, 1);
        assert.equal(parsed.fallback_rules[0].zone_id, "s-1");
        assert.equal(parsed.fallback_rules[0].allow_split_seats, false);
      },
    },
  ];
  const defaults = {
    primary: { grade: "R", zone_id: null, max_price_krw: 154000 },
    fallback_rules: [{ grade: "S", zone_id: null, max_price_krw: 132000 }],
    seat_count: 2, adjacency_required: true,
  };
  cases.push({ text: "Find 2 adjecent R seats.", defaults, check: (parsed) => {
    assert.equal(parsed.primary.grade, "R");
    assert.equal(parsed.primary.adjacency_required, true);
    assert.equal(parsed.fallback_rules.length, 1);
    assert.equal(parsed.fallback_rules[0].grade, "S");
    assert.equal(parsed.fallback_rules[0].max_price_krw, 132000);
    assert.equal(parsed.fallback_rules[0].adjacency_required, true);
  } });
  cases.push({ text: "Find 2 adjacent R seats only. No alternatives.", defaults, check: (parsed) => {
    assert.equal(parsed.primary.grade, "R");
    assert.deepEqual(parsed.fallback_rules, []);
  } });
  try {
    for (const [index, example] of cases.entries()) {
      if (process.argv.includes("--controls") && index < 3) continue;
      const response = await fetch(`${base}/parse-condition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: "orbit-1120", text: example.text, defaults: example.defaults }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      assert.equal(response.status, 200, result.error);
      assert.equal(result.source, "gemini");
      assert.equal(result.parsed.seat_count, 2);
      example.check(result.parsed);
      console.log(JSON.stringify({ example: index + 1, source: result.source, parsed: result.parsed }));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
