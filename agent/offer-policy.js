function offerMatchesRule(offeredSeat, rule) {
  return Boolean(offeredSeat && rule) &&
    offeredSeat.grade === rule.grade &&
    (!rule.zone_id || offeredSeat.zone_id === rule.zone_id) &&
    Number(offeredSeat.price_krw) > 0 &&
    Number(offeredSeat.price_krw) <= Number(rule.max_price_krw || offeredSeat.price_krw);
}

module.exports = { offerMatchesRule };
