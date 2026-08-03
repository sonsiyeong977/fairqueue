const PROGRAM_ID = "618w9LmnDRNpmrTboeYfWgfgSDaDzghRzA577ciwjJuj";
const EVENT_NAME = "IU Concert";

const state = {
  mode: "idle",
  event: null,
  result: null,
};

const scenarios = {
  success: [
    { grade: "VIP", price_krw: 220000, count: 1 },
    { grade: "R", price_krw: 198000, count: 3 },
    { grade: "S", price_krw: 176000, count: 4 },
  ],
  refund: [
    { grade: "VIP", price_krw: 220000, count: 0 },
    { grade: "R", price_krw: 198000, count: 0 },
    { grade: "S", price_krw: 176000, count: 0 },
  ],
};

const steps = [
  "조건 입력 완료",
  "온체인 예치",
  "공식 대기열",
  "좌석 Offer",
  "Gemini+Verify",
  "Release/Refund",
];

const $ = (id) => document.getElementById(id);

function formatKrw(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
}

function shortTx(tx) {
  if (!tx) return "";
  return `${tx.slice(0, 8)}...${tx.slice(-8)}`;
}

function explorerTx(tx) {
  return `https://explorer.solana.com/tx/${tx}?cluster=devnet`;
}

function conditionsFromForm() {
  const fallbackGrade = $("fallbackGrade").value;
  const fallbackPrice = Number($("fallbackPrice").value);

  return {
    primary: {
      grade: $("primaryGrade").value,
      max_price_krw: Number($("maxPrice").value),
    },
    fallback_rules: fallbackGrade
      ? [
          {
            grade: fallbackGrade,
            max_price_krw: fallbackPrice,
          },
        ]
      : [],
    seat_count: Number($("seatCount").value),
  };
}

function parsedSummary() {
  const conditions = conditionsFromForm();
  const fallback = conditions.fallback_rules[0];
  $("parsedEvent").textContent = EVENT_NAME;
  $("parsedSeats").textContent = `${conditions.primary.grade}석${fallback ? `, 대안 ${fallback.grade}석` : ""}`;
  $("parsedPrice").textContent = formatKrw(conditions.primary.max_price_krw);
  $("parsedCount").textContent = `${conditions.seat_count}매`;
  $("conditionJson").textContent = JSON.stringify(
    {
      intent: "join_queue",
      event: EVENT_NAME,
      conditions,
      user_wallet: "agent custodial keypair",
      settlement: "Anchor PDA Escrow on Solana Devnet",
    },
    null,
    2
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${options.method || "GET"} ${path} failed`);
  }
  return payload;
}

function post(path, payload) {
  return api(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function log(message) {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.innerHTML = `<time>${time}</time>${message}`;
  $("eventLog").prepend(item);
}

function renderSteps(doneCount = 0, finalLabel = "Release/Refund") {
  $("stepper").innerHTML = steps
    .map((step, index) => {
      const label = index === steps.length - 1 ? finalLabel : step;
      const done = index < doneCount ? " done" : "";
      return `<div class="step${done}"><span class="step-dot">${index < doneCount ? "✓" : index + 1}</span><span>${label}</span></div>`;
    })
    .join("");
}

function seatStatusLabel(seat) {
  const available = seat.available_count ?? seat.count ?? 0;
  if (available <= 0) return "매진";
  return `잔여 ${available}석`;
}

function renderSeats() {
  const seats = state.event?.seats || [];
  $("seatTable").innerHTML = seats
    .map((seat) => `
      <tr>
        <td>${seat.grade}석</td>
        <td>${formatKrw(seat.price_krw)}</td>
        <td>${seatStatusLabel(seat)}</td>
      </tr>
    `)
    .join("");
}

async function refreshEvents() {
  try {
    const payload = await api("/events");
    state.event = payload.events.find((event) => event.event === EVENT_NAME) || payload.events[0];
    renderSeats();
  } catch (error) {
    log(`플랫폼 API 연결 확인 필요: ${error.message}`);
  }
}

async function setScenario(name) {
  await post("/admin/scenario", {
    event: EVENT_NAME,
    seats: scenarios[name],
  });
  await refreshEvents();
}

function setTxLink(elementId, tx, pendingText) {
  const link = $(elementId);
  if (!tx) {
    link.textContent = pendingText;
    link.removeAttribute("href");
    return;
  }

  link.textContent = `${elementId}: ${shortTx(tx)}`;
  link.href = explorerTx(tx);
}

function normalizeDemoResult(payload) {
  const decision = payload.final_decision || payload.decision || payload.settlement?.final_decision || "UNKNOWN";
  const order = payload.order || payload.settlement?.order || null;
  const refund = payload.refund || payload.settlement?.refund || null;
  const offer = payload.offer || payload.offered_seat || payload.settlement?.offer || null;

  return {
    decision,
    order,
    refund,
    offer,
    queue: payload.queue || null,
    fundTx: payload.fund_tx || payload.fundTx || payload.settlement?.fund_tx,
    settleTx: payload.settle_tx || payload.refund_tx || payload.settleTx || payload.settlement?.settle_tx,
    reason: payload.reason || payload.refund_reason || refund?.reason || payload.settlement?.reason,
  };
}

function renderResult(rawPayload) {
  const result = normalizeDemoResult(rawPayload);
  const isRefund = result.decision === "REFUND" || result.refund;
  const isFallback = result.decision === "SETTLE_FALLBACK" || result.offer?.match_type === "FALLBACK";
  const grade = result.order?.grade || result.offer?.grade;
  const amount = result.order?.price_krw || result.offer?.price_krw || conditionsFromForm().primary.max_price_krw;
  const finalLabel = isRefund ? "환불 완료 (Refund)" : "정산 완료 (Release)";

  $("progressView").classList.add("visible");
  renderSteps(6, finalLabel);

  $("queueStatus").textContent = isRefund ? "REFUNDED" : "SETTLED";
  $("queueStatus").className = `status-chip ${isRefund ? "refund" : "success"}`;
  $("queueHeadline").textContent = "입장 가능";
  $("waitingAhead").textContent = "0명";
  $("progressState").textContent = "완료";

  $("matchBadge").textContent = isRefund ? "NO OFFER" : isFallback ? "MATCH: FALLBACK" : "MATCH: PRIMARY";
  $("matchBadge").className = `status-chip ${isRefund ? "warning" : "success"}`;
  $("assignedSeat").textContent = isRefund ? "조건에 맞는 좌석 없음" : `${grade}석`;
  $("settlementAmount").textContent = isRefund ? "-" : formatKrw(amount);
  $("assignmentCard").style.borderTopColor = isRefund ? "#a92a23" : "#e60012";

  if (isRefund) {
    $("reasonPanel").className = "reason-panel refund";
    $("reasonPanel").innerHTML = `<strong>환불 사유</strong><br>${result.reason || "primary/fallback 조건을 충족하는 좌석이 없습니다."}`;
    $("settleLabel").textContent = "환불 완료 (REFUND)";
  } else {
    $("reasonPanel").className = "reason-panel success";
    $("reasonPanel").textContent = isFallback
      ? `1순위 조건이 불가능해 대안 조건을 검증했고, ${grade}석 조건이 충족되어 판매자 정산을 완료했습니다.`
      : `primary 조건(${grade}석, ${formatKrw(conditionsFromForm().primary.max_price_krw)} 이하)을 충족하여 판매자 정산을 완료했습니다.`;
    $("settleLabel").textContent = "정산 완료 (RELEASE)";
  }

  $("fundAmount").textContent = formatKrw(amount);
  $("settleAmount").textContent = isRefund ? formatKrw(conditionsFromForm().primary.max_price_krw) : formatKrw(amount);
  setTxLink("fundTx", result.fundTx, "fund_tx 대기 중");
  setTxLink("settleTx", result.settleTx, "settle_tx 대기 중");
  $("explorerMain").href = result.settleTx ? explorerTx(result.settleTx) : `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;

  log(isRefund ? "조건 불충족으로 Anchor refund 트랜잭션을 확인했습니다." : "조건 충족으로 Anchor release 트랜잭션을 확인했습니다.");
}

async function runDemo(scenarioName) {
  $("progressView").classList.add("visible");
  renderSteps(1);
  state.mode = scenarioName;

  const userId = `${$("userId").value}-${Date.now().toString(36)}`;
  const conditions = conditionsFromForm();

  log(`${scenarioName === "refund" ? "환불" : "성공"} 시나리오 재고를 설정합니다.`);
  await setScenario(scenarioName);
  renderSteps(2);

  log("공식 대기열 참가와 좌석 Offer, Anchor escrow 정산을 한 번에 실행합니다.");
  const payload = await post("/demo/settle-offer", {
    event: EVENT_NAME,
    user_id: userId,
    conditions,
  });

  state.result = payload;
  renderResult(payload);
  await refreshEvents();
}

function bind() {
  $("bookingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await runDemo("success");
    } catch (error) {
      log(`실행 실패: ${error.message}`);
      renderSteps(1);
    }
  });

  $("successDemoBtn").addEventListener("click", () => runDemo("success").catch((error) => log(`성공 데모 실패: ${error.message}`)));
  $("refundDemoBtn").addEventListener("click", () => runDemo("refund").catch((error) => log(`환불 데모 실패: ${error.message}`)));
  $("refreshBtn").addEventListener("click", refreshEvents);
  $("resetBtn").addEventListener("click", () => {
    state.result = null;
    $("progressView").classList.remove("visible");
    renderSteps(0);
    log("화면을 초기 상태로 되돌렸습니다.");
  });
  $("clearLogBtn").addEventListener("click", () => {
    $("eventLog").innerHTML = "";
  });

  ["naturalRequest", "primaryGrade", "fallbackGrade", "maxPrice", "fallbackPrice", "seatCount"].forEach((id) => {
    $(id).addEventListener("input", parsedSummary);
  });
}

bind();
parsedSummary();
renderSteps(0);
refreshEvents();
