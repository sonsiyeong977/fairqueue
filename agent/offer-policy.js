function offerMatchesRule(offeredSeat, rule) {
  if (!offeredSeat || !rule) return false;
  const seatNumbers = Array.isArray(offeredSeat.seat_numbers)
    ? offeredSeat.seat_numbers.map(Number).sort((a, b) => a - b)
    : [];
  const consecutive = seatNumbers.length < 2 || seatNumbers.every(
    (number, index) => index === 0 || number === seatNumbers[index - 1] + 1
  );
  return Boolean(
    offeredSeat.grade === rule.grade &&
    (!rule.zone_id || offeredSeat.zone_id === rule.zone_id) &&
    (!rule.avoid_restricted_view || !offeredSeat.restricted_view) &&
    (!(rule.adjacency_required && !rule.allow_split_seats) || consecutive) &&
    Number(offeredSeat.price_krw) > 0 &&
    Number(offeredSeat.price_krw) <= Number(rule.max_price_krw || offeredSeat.price_krw)
  );
}

module.exports = { offerMatchesRule };
