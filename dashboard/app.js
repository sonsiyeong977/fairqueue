const PROGRAM_ID = "618w9LmnDRNpmrTboeYfWgfgSDaDzghRzA577ciwjJuj";
const EVENT_NAME = "IU Concert";

const state = {
  event: null,
  running: false,
  transactions: [],
  activeSeatRows: [],
  activeView: "user",
  parseTimer: null,
  parseRequestSeq: 0,
};

const scenarios = {
  success: [
    { grade: "VIP", price_krw: 250000, count: 4 },
    { grade: "R", price_krw: 190000, count: 8 },
    { grade: "S", price_krw: 120000, count: 12 },
  ],
  fallback: [
    { grade: "VIP", price_krw: 250000, count: 0 },
    { grade: "R", price_krw: 190000, count: 0 },
    { grade: "S", price_krw: 120000, count: 12 },
  ],
  refund: [
    { grade: "VIP", price_krw: 250000, count: 0 },
    { grade: "R", price_krw: 190000, count: 0 },
    { grade: "S", price_krw: 120000, count: 0 },
  ],
};

const steps = [
  "STEP 1 조건 입력",
  "STEP 2 Gemini 조건 해석",
  "STEP 3 공식 대기열",
  "STEP 4 Offer 검증",
  "STEP 5 구매 완료",
];

const $ = (id) => document.getElementById(id);

function formatKrw(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
}

function formatCount(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}건`;
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
  return {
    primary: {
      grade: $("primaryGrade").value,
      max_price_krw: Number($("maxPrice").value),
    },
    fallback_rules: fallbackGrade
      ? [{ grade: fallbackGrade, max_price_krw: Number($("fallbackPrice").value) }]
      : [],
    seat_count: Number($("seatCount").value),
  };
}

function priceToKrw(raw, unit) {
  const value = Number(String(raw || "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return unit === "만원" ? value * 10000 : value;
}

function extractPriceForGrade(text, grade) {
  const patterns = [
    new RegExp(`${grade}\\s*석?[^0-9]{0,12}(\\d[\\d,]*)\\s*(만원|원)`),
    new RegExp(`(\\d[\\d,]*)\\s*(만원|원)[^가-힣A-Z0-9]{0,12}${grade}\\s*석?`),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1];
      const unit = match[2];
      return priceToKrw(raw, unit);
    }
  }

  return null;
}

function extractTotalBudget(text) {
  const patterns = [
    /(?:총\s*)?(?:예산|예매\s*예산)[^0-9]{0,12}(\d[\d,]*)\s*(만원|원)/,
    /(\d[\d,]*)\s*(만원|원)[^가-힣0-9]{0,12}(?:까지|이하)?[^가-힣0-9]{0,8}(?:예산)/,
    /(\d[\d,]*)\s*(만원|원)\s*까지/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return priceToKrw(match[1], match[2]);
  }

  return null;
}

function extractFallbackBudget(text) {
  const fallbackPart = fallbackTextPart(text);

  const patterns = [
    /(?:대안\s*좌석|R석|S석|VIP석)[^.!?。]{0,30}(?:경우|때)[^0-9]{0,16}(\d[\d,]*)\s*(만원|원)/,
    /(?:대안\s*좌석|R석|S석|VIP석)[^.!?。]{0,30}(?:예산|최대|상한)[^0-9]{0,16}(\d[\d,]*)\s*(만원|원)/,
    /(?:대신|다만)[^.!?。]{0,30}(\d[\d,]*)\s*(만원|원)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return priceToKrw(match[1], match[2]);
  }

  return fallbackPart ? extractTotalBudget(fallbackPart) : null;
}

function gradeMentions(text) {
  return [...text.matchAll(/\b(VIP|R|S)\s*석?/g)].map((match) => match[1]);
}

function fallbackTextPart(text) {
  const parts = text.split(/없으면|안되면|안 되면|안될 경우|안 될 경우|못잡으면|못 잡으면|불가능하면|대안|차선/);
  return parts.slice(1).join(" ");
}

function parseNaturalPrompt(text) {
  const normalized = text.replace(/\s+/g, " ").trim().toUpperCase();
  const fallbackPart = fallbackTextPart(normalized);
  const primaryPart = fallbackPart ? normalized.slice(0, normalized.indexOf(fallbackPart)).trim() : normalized;
  const grades = ["VIP", "R", "S"];
  const mentions = gradeMentions(normalized);
  const primaryGrade = grades.find((grade) => new RegExp(`${grade}\\s*석?`).test(primaryPart)) || mentions[0];
  const fallbackGrade =
    grades.find((grade) => new RegExp(`${grade}\\s*석?`).test(fallbackPart)) ||
    mentions.find((grade) => grade !== primaryGrade);
  const countMatch = normalized.match(/(\d+)\s*(연석|연속|매|장)/);
  const seatCount = countMatch ? Number(countMatch[1]) : null;
  const totalBudget = extractTotalBudget(normalized);
  const fallbackBudget = extractFallbackBudget(normalized);
  const perSeatBudget = totalBudget && seatCount ? Math.floor(totalBudget / seatCount) : totalBudget;
  const fallbackPerSeatBudget = fallbackBudget && seatCount ? Math.floor(fallbackBudget / seatCount) : fallbackBudget;
  const primaryPrice = primaryGrade ? extractPriceForGrade(normalized, primaryGrade) || perSeatBudget : perSeatBudget;
  const fallbackPrice = fallbackGrade
    ? fallbackPerSeatBudget || extractPriceForGrade(fallbackPart, fallbackGrade) || primaryPrice
    : null;

  return { primaryGrade, fallbackGrade, primaryPrice, fallbackPrice, seatCount };
}

function applyNaturalPromptToForm() {
  applyParsedCondition(parseNaturalPrompt($("naturalPrompt").value), "fallback");
}

function applyParsedCondition(parsed, source = "gemini") {
  const primary = parsed.primary || {};
  const fallback = Array.isArray(parsed.fallback_rules) ? parsed.fallback_rules[0] : null;
  const localParsed = parseNaturalPrompt($("naturalPrompt").value);
  const primaryGrade = primary.grade || parsed.primaryGrade || localParsed.primaryGrade || "";
  const fallbackGrade = fallback?.grade || parsed.fallbackGrade || localParsed.fallbackGrade || "";
  const primaryPrice = localParsed.primaryPrice || primary.max_price_krw || parsed.primaryPrice || "";
  const fallbackPrice = localParsed.fallbackPrice || fallback?.max_price_krw || parsed.fallbackPrice || primaryPrice || "";
  const seatCount = parsed.seat_count || parsed.seatCount || localParsed.seatCount || "";

  $("primaryGrade").value = primaryGrade;
  $("fallbackGrade").value = fallbackGrade;
  $("maxPrice").value = primaryPrice;
  $("fallbackPrice").value = fallbackGrade ? fallbackPrice : "";
  $("seatCount").value = seatCount ? Math.min(Math.max(Number(seatCount), 1), 5) : "";
  if (source === "gemini") {
    $("geminiMessage").textContent = "Gemini가 자연어 요청을 좌석 우선순위, 가격 상한, 수량 조건으로 구조화했습니다.";
  } else if (source === "pending") {
    $("geminiMessage").textContent = "Gemini가 요청을 해석하고 있습니다.";
  } else {
    $("geminiMessage").textContent = "요청을 좌석 우선순위, 가격 상한, 수량 조건으로 정리했습니다.";
  }

  renderConditionSummary();
}

function applyQuietParsedCondition(parsed) {
  const primary = parsed.primary || {};
  const fallback = Array.isArray(parsed.fallback_rules) ? parsed.fallback_rules[0] : null;

  $("primaryGrade").value = primary.grade || parsed.primaryGrade || "";
  $("fallbackGrade").value = fallback?.grade || parsed.fallbackGrade || "";
  $("maxPrice").value = primary.max_price_krw || parsed.primaryPrice || "";
  $("fallbackPrice").value = fallback?.max_price_krw || parsed.fallbackPrice || "";
  $("seatCount").value = parsed.seat_count || parsed.seatCount ? Math.min(Math.max(Number(parsed.seat_count || parsed.seatCount), 1), 5) : "";
  $("conditionSummary").innerHTML = "";
  $("parsedGrid").innerHTML = "";
  $("geminiInterpretation").classList.add("hidden");
  $("parsedGrid").classList.add("hidden");
  $("parsingStatus").textContent = "입력 중";
  $("parsingStatus").className = "status-chip";
}

async function parseConditionWithGemini(text, requestSeq) {
  if (!text) {
    throw new Error("예매 조건을 먼저 입력해 주세요.");
  }

  try {
    const payload = await post("/parse-condition", { text });
    if (requestSeq !== state.parseRequestSeq) return;
    applyParsedCondition(payload.parsed, payload.source);
  } catch (error) {
    if (requestSeq !== state.parseRequestSeq) return;
    applyParsedCondition(parseNaturalPrompt(text), "fallback");
  }
}

async function handleParseConditionClick() {
  const text = $("naturalPrompt").value.trim();
  state.parseRequestSeq += 1;
  const requestSeq = state.parseRequestSeq;
  clearTimeout(state.parseTimer);

  if (!text) {
    applyParsedCondition({}, "fallback");
    log("예매 조건을 먼저 입력해 주세요.");
    return;
  }

  applyParsedCondition(parseNaturalPrompt(text), "fallback");
  $("parsingStatus").textContent = "AGREED & PARSED";
  $("parsingStatus").className = "status-chip success";
  $("parseConditionBtn").disabled = true;

  window.setTimeout(() => {
    $("parseConditionBtn").disabled = false;
  }, 900);

  parseConditionWithGemini(text, requestSeq).catch(() => {
    if (requestSeq !== state.parseRequestSeq) return;
    applyParsedCondition(parseNaturalPrompt(text), "fallback");
  });
}

function renderParsedGrid() {
  const conditions = conditionsFromForm();
  const fallback = conditions.fallback_rules[0];
  const hasCondition =
    Boolean(conditions.primary.grade) &&
    conditions.primary.max_price_krw > 0 &&
    conditions.seat_count > 0;

  $("geminiInterpretation").classList.toggle("hidden", !hasCondition);
  $("parsedGrid").classList.toggle("hidden", !hasCondition);
  $("parsingStatus").textContent = hasCondition ? "AGREED & PARSED" : "입력 전";
  $("parsingStatus").className = hasCondition ? "status-chip success" : "status-chip";

  if (!hasCondition) {
    $("parsedGrid").innerHTML = "";
    return;
  }

  const primaryBudget = conditions.primary.max_price_krw * conditions.seat_count;
  const fallbackBudget = fallback ? fallback.max_price_krw * conditions.seat_count : 0;

  $("parsedGrid").innerHTML = `
    <div>
      <span>좌석 우선순위</span>
      <strong>${conditions.primary.grade}석${fallback ? ` → ${fallback.grade}석 fallback` : ""}</strong>
    </div>
    <div>
      <span>수량</span>
      <strong>${conditions.seat_count}매</strong>
    </div>
    <div>
      <span>1순위 가격 상한</span>
      <strong>${formatKrw(conditions.primary.max_price_krw)} / 장</strong>
    </div>
    <div>
      <span>최대 예산</span>
      <strong>${formatKrw(fallback ? Math.max(primaryBudget, fallbackBudget) : primaryBudget)}</strong>
    </div>
  `;
}

function renderConditionSummary() {
  const conditions = conditionsFromForm();
  const fallback = conditions.fallback_rules[0];
  const hasCondition =
    Boolean(conditions.primary.grade) &&
    conditions.primary.max_price_krw > 0 &&
    conditions.seat_count > 0;

  if (!hasCondition) {
    $("conditionSummary").innerHTML = "";
    renderParsedGrid();
    return;
  }

  const primaryBudget = conditions.primary.max_price_krw * conditions.seat_count;
  const fallbackBudget = fallback ? fallback.max_price_krw * conditions.seat_count : 0;
  $("conditionSummary").innerHTML = `
    <div>
      <span>요청 좌석</span>
      <strong>${conditions.primary.grade}석${fallback ? ` · 대안 ${fallback.grade}석` : ""}</strong>
    </div>
    <div>
      <span>최대 예산</span>
      <strong>${formatKrw(fallback ? Math.max(primaryBudget, fallbackBudget) : primaryBudget)}</strong>
    </div>
    <div>
      <span>수량</span>
      <strong>${conditions.seat_count}매</strong>
    </div>
    <div>
      <span>정책</span>
      <strong>조건 불충족 시 자동 환불</strong>
    </div>
  `;
  renderParsedGrid();
}

function setFormValues({ prompt, primaryGrade, fallbackGrade, maxPrice, fallbackPrice, seatCount }) {
  if (prompt) $("naturalPrompt").value = prompt;
  if (primaryGrade !== undefined) $("primaryGrade").value = primaryGrade;
  if (fallbackGrade !== undefined) $("fallbackGrade").value = fallbackGrade;
  if (maxPrice !== undefined) $("maxPrice").value = maxPrice;
  if (fallbackPrice !== undefined) $("fallbackPrice").value = fallbackPrice;
  if (seatCount !== undefined) $("seatCount").value = seatCount;
  renderConditionSummary();
}

function applyScenarioDefaults(name) {
  if (name === "fallback") {
    setFormValues({
      prompt: "R석 12만원 이하, 2연석 우선. 없으면 S석까지 허용해줘.",
      primaryGrade: "R",
      fallbackGrade: "S",
      maxPrice: 120000,
      fallbackPrice: 120000,
      seatCount: 2,
    });
    return;
  }

  if (name === "refund") {
    setFormValues({
      prompt: "R석 12만원 이하, 2연석 우선. 없으면 S석까지 허용해줘.",
      primaryGrade: "R",
      fallbackGrade: "S",
      maxPrice: 120000,
      fallbackPrice: 120000,
      seatCount: 2,
    });
    return;
  }

  if (name === "success") {
    setFormValues({
      prompt: "R석 19만원 이하로 1매 예매해줘. 없으면 S석 12만원 이하도 괜찮아.",
      primaryGrade: "R",
      fallbackGrade: "S",
      maxPrice: 190000,
      fallbackPrice: 120000,
      seatCount: 1,
    });
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${options.method || "GET"} ${path} failed`);
  return payload;
}

function post(path, payload) {
  return api(path, { method: "POST", body: JSON.stringify(payload) });
}

function log(message) {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  item.innerHTML = `<time>${time}</time>${message}`;
  $("eventLog").prepend(item);
}

function setButtonsDisabled(disabled) {
  state.running = disabled;
  if ($("successDemoBtn")) $("successDemoBtn").disabled = disabled;
  if ($("fallbackDemoBtn")) $("fallbackDemoBtn").disabled = disabled;
  if ($("refundDemoBtn")) $("refundDemoBtn").disabled = disabled;
  if ($("demoResetBtn")) $("demoResetBtn").disabled = disabled;
  document.querySelector(".primary-button").disabled = disabled;
}

function showProgress() {
  $("bookingView").classList.add("hidden");
  $("progressView").classList.remove("hidden");
  $("progressView").classList.add("visible");
  showUserView(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showBooking() {
  $("progressView").classList.remove("hidden");
  $("progressView").classList.remove("visible");
  $("bookingView").classList.remove("hidden");
  showUserView(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showUserView(scroll = true) {
  state.activeView = "user";
  $("bookingView").classList.toggle("hidden", $("progressView").classList.contains("visible"));
  $("progressView").classList.remove("hidden");
  $("operatorView").classList.remove("visible");
  $("logCard")?.classList?.add("hidden");
  $("userViewBtn").classList.add("active");
  $("operatorViewBtn").classList.remove("active");
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function showOperatorView() {
  state.activeView = "operator";
  $("bookingView").classList.add("hidden");
  $("progressView").classList.add("hidden");
  $("operatorView").classList.add("visible");
  $("logCard")?.classList?.remove("hidden");
  $("userViewBtn").classList.remove("active");
  $("operatorViewBtn").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSteps(doneCount = 0, finalLabel = "Release/Refund") {
  $("stepper").innerHTML = steps
    .map((step, index) => {
      const label = index === steps.length - 1 ? finalLabel : step;
      const done = index < doneCount ? " done" : "";
      return `<div class="step${done}"><span class="step-dot">${index < doneCount ? "✓" : index + 1}</span><span>${label}</span></div>`;
    })
    .join("");
  const current = Math.min(Math.max(doneCount, 0), steps.length - 1);
  $("currentStepKicker").textContent = doneCount >= steps.length ? finalLabel : steps[current];
}

function renderProgressPending(message) {
  showProgress();
  renderSteps(1);
  $("queueStatus").textContent = "RUNNING";
  $("queueStatus").className = "status-chip warning";
  $("queueHeadline").textContent = "처리 중";
  $("waitingAhead").textContent = "128명";
  $("progressState").textContent = "진행 중";
  $("matchBadge").textContent = "WAITING";
  $("matchBadge").className = "status-chip warning";
  $("assignedSeat").textContent = "좌석 확인 중";
  $("settlementAmount").textContent = "-";
  $("reasonPanel").className = "reason-panel";
  $("reasonPanel").textContent = message;
  $("fundAmount").textContent = "-";
  $("settleAmount").textContent = "-";
  setTxLink("fundTx", null, "fund_tx 대기 중");
  setTxLink("settleTx", null, "settle_tx 대기 중");
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function animateWaitingAhead(values, delayMs = 420) {
  for (const value of values) {
    if (!state.running) return;
    $("waitingAhead").textContent = `${value}명`;
    await sleep(delayMs);
  }
}

function seatStatusLabel(seat) {
  const available = seat.available_count ?? seat.count ?? 0;
  if (available <= 0) return "매진";
  return `잔여 ${available}석`;
}

function renderSeats() {
  const seats = state.event?.seats || [];
  $("seatTable").innerHTML = seats
    .map(
      (seat) => `
        <tr>
          <td>${seat.grade}석</td>
          <td>${formatKrw(seat.price_krw)}</td>
          <td>${seatStatusLabel(seat)}</td>
        </tr>
      `
    )
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
  await post("/admin/scenario", { event: EVENT_NAME, seats: scenarios[name] });
  await refreshEvents();
  state.activeSeatRows = state.event?.seats || [];
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

function scenarioLabel(name) {
  if (name === "custom") return "직접 입력";
  if (name === "refund") return "환불";
  if (name === "fallback") return "대안";
  return "성공";
}

function normalizeDemoResult(payload) {
  const settle = payload.settle_result || payload.settlement || {};
  const decision = payload.final_decision || settle.final_decision || settle.decision || "UNKNOWN";
  const order = payload.order || null;
  const refund = payload.refund || null;
  const offer = payload.offer || payload.offered_seat || null;
  return {
    decision,
    order,
    refund,
    offer,
    queue: payload.queue || null,
    seatStatuses: payload.seat_statuses || payload.remainingSeats || state.activeSeatRows || state.event?.seats || [],
    fundTx: payload.fund_tx || settle.fund_tx,
    settleTx: payload.settle_tx || settle.settle_tx || refund?.refund_tx_hash || order?.settlement_tx_hash,
    reason: payload.reason || payload.refund_reason || refund?.reason || settle.verify_note || settle.gemini_reasoning,
  };
}

function describeRuleFailure(rule, label, seatCount, seatRows) {
  if (!rule?.grade) return `${label} 조건에 좌석 등급이 지정되지 않았습니다.`;
  const seat = seatRows.find((row) => row.grade === rule.grade);
  const available = Number(seat?.available_count ?? seat?.count ?? 0);
  const shortage = Math.max(seatCount - available, 0);

  if (!seat) return `${label} ${rule.grade}석은 현재 판매 목록에 없습니다.`;
  if (available < seatCount) return `${label} ${rule.grade}석: 요청 ${seatCount}매, 현재 재고 ${available}매로 ${shortage}매 부족합니다.`;
  if (rule.max_price_krw && seat.price_krw > rule.max_price_krw) {
    return `${label} ${rule.grade}석: 가격 ${formatKrw(seat.price_krw)}이 최대 허용 금액 ${formatKrw(rule.max_price_krw)}을 초과합니다.`;
  }
  return `${label} ${rule.grade}석은 검증 조건을 통과하지 못했습니다.`;
}

function renderReasonList(title, reasons, closing) {
  return `
    <strong>${title}</strong>
    <ul>
      ${reasons.map((reason) => `<li>${reason}</li>`).join("")}
    </ul>
    <span>${closing}</span>
  `;
}

function addOperatorTransaction(result, amount, grade, quantity, isRefund) {
  const fee = isRefund ? 0 : Math.round(amount * 0.015);
  state.transactions.unshift({
    time: new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    decision: result.decision,
    grade: isRefund ? "-" : `${grade}석`,
    quantity,
    amount: isRefund ? 0 : amount,
    refundAmount: isRefund ? amount : 0,
    fee,
    tx: result.settleTx,
  });
  renderOperatorView();
}

function renderOperatorView() {
  const transactions = state.transactions;
  const settled = transactions.filter((item) => !item.decision.includes("REFUND"));
  const primarySettled = transactions.filter((item) => item.decision === "SETTLE_PRIMARY");
  const fallbackSettled = transactions.filter((item) => item.decision === "SETTLE_FALLBACK");
  const refunds = transactions.filter((item) => item.decision.includes("REFUND"));
  const settledAmount = settled.reduce((sum, item) => sum + item.amount, 0);

  $("operatorProcessedCount").textContent = formatCount(transactions.length);
  $("operatorPrimarySuccessCount").textContent = formatCount(primarySettled.length);
  $("operatorFallbackSuccessCount").textContent = formatCount(fallbackSettled.length);
  $("operatorRefundCount").textContent = formatCount(refunds.length);
  $("operatorTotalAmount").textContent = formatKrw(settledAmount);

  $("operatorLogRows").innerHTML = transactions.length
    ? transactions
        .map((item) => {
          const isRefund = item.decision.includes("REFUND");
          const txLabel = item.tx ? shortTx(item.tx) : "대기 중";
          const txCell = item.tx
            ? `<a href="${explorerTx(item.tx)}" target="_blank" rel="noreferrer">${txLabel}</a>`
            : txLabel;
          return `
            <tr>
              <td>${item.time}</td>
              <td><span class="decision-pill ${isRefund ? "refund" : "settle"}">${item.decision}</span></td>
              <td>${item.grade}</td>
              <td>${item.quantity}매</td>
              <td>${isRefund ? "환불 처리" : formatKrw(item.amount)}</td>
              <td>${txCell}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6">아직 처리된 거래가 없습니다.</td></tr>`;
}

async function resetDemoState() {
  setButtonsDisabled(true);
  try {
    state.transactions = [];
    state.activeSeatRows = [];
    $("eventLog").innerHTML = "";
    await setScenario("success");
    renderOperatorView();
    renderConditionSummary();
    renderSteps(0);
    showBooking();
    log("데모 상태를 초기 재고와 빈 거래 로그로 재설정했습니다.");
  } catch (error) {
    log(`Demo Reset 실패: ${error.message}`);
  } finally {
    setButtonsDisabled(false);
  }
}

function renderResult(rawPayload) {
  const result = normalizeDemoResult(rawPayload);
  const isRefund = result.decision === "REFUND" || Boolean(result.refund);
  const isFallback = result.decision === "SETTLE_FALLBACK" || result.offer?.match_type === "FALLBACK";
  const conditions = conditionsFromForm();
  const grade = result.order?.grade || result.offer?.grade;
  const quantity = Number(result.order?.count || result.offer?.count || conditions.seat_count || 1);
  const unitPrice = result.order?.price_krw || result.offer?.price_krw || conditions.primary.max_price_krw;
  const amount = unitPrice * quantity;
  const finalLabel = isRefund ? "환불 완료 (Refund)" : "정산 완료 (Release)";
  const seatRows = result.seatStatuses || [];
  const seatCount = quantity;
  const primaryFailure = describeRuleFailure(conditions.primary, "1순위", seatCount, seatRows);

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
  $("assignmentCard").style.borderTopColor = isRefund ? "#a92a23" : "#13b96d";

  if (isRefund) {
    $("reasonPanel").className = "reason-panel refund";
    const rules = [conditions.primary, ...conditions.fallback_rules].filter(Boolean);
    const reasons = rules.map((rule, index) =>
      describeRuleFailure(rule, index === 0 ? "1순위" : `대안 ${index}`, seatCount, seatRows)
    );
    $("reasonPanel").innerHTML = renderReasonList(
      "환불 사유",
      reasons,
      "조건을 만족하는 좌석이 없어 자동 환불로 전환했습니다."
    );
    $("settleLabel").textContent = "환불 완료 (REFUND)";
  } else {
    $("reasonPanel").className = "reason-panel success";
    if (isFallback) {
      $("reasonPanel").innerHTML = renderReasonList(
        "대안 조건 정산 사유",
        [
          primaryFailure,
          `대안 ${grade}석: 요청 ${seatCount}매와 최대 허용 금액 ${formatKrw(conditions.fallback_rules[0]?.max_price_krw)} 조건을 충족했습니다.`,
        ],
        "대안 조건으로 정산을 확정했습니다."
      );
    } else {
      $("reasonPanel").textContent = `primary 조건(${grade}석, ${formatKrw(conditions.primary.max_price_krw)} 이하)을 충족하여 판매자 정산을 완료했습니다.`;
    }
    $("settleLabel").textContent = "정산 완료 (RELEASE)";
  }

  $("fundAmount").textContent = formatKrw(amount);
  $("settleAmount").textContent = isRefund ? formatKrw(conditions.primary.max_price_krw) : formatKrw(amount);
  setTxLink("fundTx", result.fundTx, "fund_tx 대기 중");
  setTxLink("settleTx", result.settleTx, "settle_tx 대기 중");
  $("explorerMain").href = result.settleTx ? explorerTx(result.settleTx) : `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;

  addOperatorTransaction(result, amount, grade, quantity, isRefund);
  log(isRefund ? "조건 불충족 건을 자동 환불 처리하고 온체인 refund Tx를 기록했습니다." : "조건 충족 건을 매출로 확정하고 온체인 release Tx를 기록했습니다.");
}

async function runDemo(scenarioName) {
  if (state.running) return;
  setButtonsDisabled(true);
  if (scenarioName !== "custom") applyScenarioDefaults(scenarioName);
  renderProgressPending(`${scenarioLabel(scenarioName)} 케이스를 실행하고 있습니다.`);

  try {
    const userId = `${$("userId").value}-${Date.now().toString(36)}`;
    const conditions = conditionsFromForm();
    if (
      scenarioName === "custom" &&
      (!conditions.primary.grade || conditions.primary.max_price_krw <= 0 || conditions.seat_count <= 0)
    ) {
      throw new Error("예매 조건을 먼저 입력해 주세요. 좌석 등급, 최대 가격, 수량이 필요합니다.");
    }
    if (scenarioName === "custom") {
      log("현재 남은 좌석 재고를 기준으로 사용자 조건을 처리합니다.");
      await refreshEvents();
      state.activeSeatRows = state.event?.seats || [];
    } else {
      log(`${scenarioLabel(scenarioName)} 조건에 맞춰 현재 좌석 재고를 동기화했습니다.`);
      await setScenario(scenarioName);
    }
    renderSteps(2);

    log("사용자 조건을 공식 대기열에 등록하고 예치 가능 상태를 생성했습니다.");
    const queue = await post("/queue/join", { event: EVENT_NAME, user_id: userId, conditions });
    await animateWaitingAhead([112, 96, 81, 67, 54, 42], 360);
    renderSteps(3);

    log("공식 대기열 순번이 도달해 좌석 Offer 검증 단계로 전환했습니다.");
    await animateWaitingAhead([31, 23, 16, 10, 6, 3, 1], 360);
    await post("/queue/advance", { event: EVENT_NAME, count: queue.position || 1 });
    $("waitingAhead").textContent = "1명";
    renderSteps(4);

    log("좌석 Offer를 조건과 대조하고 Anchor escrow 정산을 요청했습니다.");
    const payload = await post("/demo/settle-offer", { event: EVENT_NAME, queue_id: queue.queue_id });
    renderResult(payload);
    await refreshEvents();
  } catch (error) {
    $("queueStatus").textContent = "ERROR";
    $("queueStatus").className = "status-chip warning";
    $("queueHeadline").textContent = "실행 실패";
    $("progressState").textContent = "확인 필요";
    $("reasonPanel").className = "reason-panel refund";
    $("reasonPanel").textContent = error.message;
    log(`실행 실패: ${error.message}`);
  } finally {
    setButtonsDisabled(false);
  }
}

function bind() {
  $("bookingForm").addEventListener("submit", (event) => {
    event.preventDefault();
    runDemo("custom");
  });
  $("successDemoBtn")?.addEventListener("click", () => runDemo("success"));
  $("fallbackDemoBtn")?.addEventListener("click", () => runDemo("fallback"));
  $("refundDemoBtn")?.addEventListener("click", () => runDemo("refund"));
  $("demoResetBtn")?.addEventListener("click", resetDemoState);
  $("userViewBtn").addEventListener("click", () => {
    if ($("progressView").classList.contains("visible")) showProgress();
    else showBooking();
  });
  $("operatorViewBtn").addEventListener("click", showOperatorView);
  $("resetBtn").addEventListener("click", showBooking);
  $("clearLogBtn").addEventListener("click", () => {
    $("eventLog").innerHTML = "";
  });

  ["primaryGrade", "fallbackGrade", "maxPrice", "fallbackPrice", "seatCount"].forEach((id) => {
    $(id).addEventListener("input", renderConditionSummary);
  });
  $("parseConditionBtn").addEventListener("click", handleParseConditionClick);
  $("naturalPrompt").addEventListener("input", () => {
    state.parseRequestSeq += 1;
    clearTimeout(state.parseTimer);
    const text = $("naturalPrompt").value.trim();
    if (!text) applyParsedCondition({}, "fallback");
    else applyQuietParsedCondition(parseNaturalPrompt(text));
  });
}

bind();
renderConditionSummary();
renderSteps(0);
renderOperatorView();
refreshEvents();
