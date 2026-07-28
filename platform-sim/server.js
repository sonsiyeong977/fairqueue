const express = require("express");
const app = express();
app.use(express.json());

const PORT = 3001;

// 이벤트별 좌석 상태를 메모리에 저장 (데모용, 서버 재시작하면 초기화됨)
let seatState = {
  "아이유 콘서트": [{ grade: "R석", price_krw: 190000, count: 3 }],
};

// ── 좌석 상태 조회 ──────────────────────────────
// GET /seats/:event
app.get("/seats/:event", (req, res) => {
  const event = decodeURIComponent(req.params.event);
  const seats = seatState[event] || [];
  console.log(`[GET /seats] "${event}" 조회 → ${JSON.stringify(seats)}`);
  res.json({ event, availableSeats: seats });
});

// ── 좌석 상태 설정 (데모 시나리오 전환용) ──────────────────────────────
// POST /seats/:event   body: { availableSeats: [...] }
app.post("/seats/:event", (req, res) => {
  const event = decodeURIComponent(req.params.event);
  const { availableSeats } = req.body;
  seatState[event] = availableSeats || [];
  console.log(`[POST /seats] "${event}" 상태 변경 → ${JSON.stringify(seatState[event])}`);
  res.json({ event, availableSeats: seatState[event] });
});

app.listen(PORT, () => {
  console.log(`🎟️  Platform simulator running on http://localhost:${PORT}`);
  console.log(`   GET  /seats/:event   - 현재 좌석 상태 조회`);
  console.log(`   POST /seats/:event   - 좌석 상태 설정 (데모용)`);
});