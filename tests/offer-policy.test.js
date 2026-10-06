const assert = require("node:assert/strict");
const test = require("node:test");
const { offerMatchesRule } = require("../agent/offer-policy");

test("settlement policy checks exact zones and ticket prices", () => {
  const offer = { grade: "VIP", zone_id: "vip-b", price_krw: 176000 };
  assert.equal(offerMatchesRule(offer, {
    grade: "VIP", zone_id: "vip-a", max_price_krw: 176000,
  }), false);
  assert.equal(offerMatchesRule(offer, {
    grade: "VIP", zone_id: "vip-b", max_price_krw: 176000,
  }), true);
  assert.equal(offerMatchesRule(offer, {
    grade: "VIP", max_price_krw: 175000,
  }), false);
  assert.equal(offerMatchesRule(offer, {
    grade: "VIP", max_price_krw: 176000,
  }), true);
});
