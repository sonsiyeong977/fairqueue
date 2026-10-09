const overlay = document.getElementById('overlay');
const body = document.getElementById('modalBody');
const intentKey = 'fairqueue-booking-intent';
const queueKey = 'fairqueue-active-queue';
let booking = null;
let formState = null;
let parsed = null;
let parseSource = null;
let queueId = null;
let stageIndex = 0;
let pollTimer = null;
let busy = false;
let result = null;
let settlementError = null;
let paymentMode = 'demo';
let buyerAddress = null;
let walletPhase = '';
let walletQuote = null;
let approval = null;
let settling = false;
let quoteTimer = null;

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const money = (value) => 'KRW ' + Number(value || 0).toLocaleString('en-US');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function post(path, value) {
  return api(path, { method: 'POST', body: JSON.stringify(value) });
}

function setBar(index) {
  document.querySelectorAll('.steps-bar .seg').forEach((segment, position) => {
    segment.classList.toggle('done', position < index);
    segment.classList.toggle('active', position === index);
  });
}

function showError(message) {
  const error = document.createElement('p');
  error.className = 'flow-error';
  error.textContent = message;
  body.prepend(error);
}

function zoneOptions(selected, includeNone) {
  const zones = booking.session.zones;
  const grades = [...new Set(zones.map((zone) => zone.grade))];
  const options = [includeNone
    ? '<option value="">No alternative</option>'
    : '<option value="">Select a section</option>'];
  for (const grade of grades) {
    const sameGrade = zones.filter((zone) => zone.grade === grade);
    if (sameGrade.length > 1) {
      const value = 'grade:' + grade;
      options.push('<option value="' + html(value) + '"' + (value === selected ? ' selected' : '') +
        '>Any ' + html(grade) + ' section</option>');
    }
    options.push(...sameGrade.map((zone) => {
      const value = 'zone:' + zone.id;
      return '<option value="' + html(value) + '"' + (value === selected ? ' selected' : '') +
        '>' + html(zone.label) + '</option>';
    }));
  }
  return options.join('');
}

function choiceDetails(value) {
  if (!value) return null;
  const zones = booking.session.zones;
  if (value.startsWith('zone:')) {
    const zone = zones.find((item) => item.id === value.slice(5));
    return zone ? { grade: zone.grade, zoneId: zone.id, label: zone.label, price: zone.price } : null;
  }
  if (value.startsWith('grade:')) {
    const grade = value.slice(6);
    const zone = zones.find((item) => item.grade === grade);
    return zone ? { grade, zoneId: null, label: 'Any ' + grade + ' section', price: zone.price } : null;
  }
  return null;
}

function ruleLabel(rule) {
  return booking.session.zones.find((zone) => zone.id === rule.zone_id)?.label ||
    'Any ' + rule.grade + ' section';
}

function placementLabel(rule) {
  if (parsed.seat_count < 2) return 'Single ticket';
  if (rule.adjacency_required && rule.allow_split_seats) return 'Adjacent preferred; split seats accepted';
  if (rule.adjacency_required) return 'Adjacent seats required';
  if (rule.allow_split_seats) return 'Split seats accepted';
  return 'No adjacency requirement';
}

function ruleSummary(rule) {
  return [parsed.seat_count > 1 && (rule.adjacency_required || rule.allow_split_seats) ? placementLabel(rule) : '', rule.avoid_restricted_view ? 'Restricted view excluded' : ''].filter(Boolean).join(' · ');
}

function renderConditions() {
  const { event, session, intent } = booking;
  const chosen = session.zones.find((zone) => zone.id === intent.preferredZoneId);
  const initialChoice = chosen ? 'zone:' + chosen.id : '';
  if (!formState) {
    formState = {
      text: '',
      quantity: intent.quantity,
      primaryChoice: initialChoice,
      primaryCap: chosen?.price || '',
      fallbackChoice: '',
      fallbackCap: '',
    };
  }
  body.innerHTML = [
    '<h2 class="step-title">Set your booking conditions</h2>',
    '<p class="step-sub">Describe complex preferences in Korean or English, or use the controls below. You will review the interpretation before joining the queue.</p>',
    '<div class="field"><label for="conditionText">Natural-language request (optional)</label>',
    '<textarea id="conditionText" aria-label="Booking request" placeholder="e.g. Avoid restricted-view seats. Find 2 adjacent VIP seats; if unavailable, allow split VIP seats or 2 adjacent R seats.">',
    html(formState.text), '</textarea></div>',
    '<div class="field-row"><div class="field"><label for="ticketCount">Tickets</label>',
    '<input id="ticketCount" type="number" min="1" max="', event.maxTickets,
    '" value="', formState.quantity, '"></div>',
    '<div class="field"><label for="primaryZone">First-choice section</label><select id="primaryZone">',
    zoneOptions(formState.primaryChoice, false), '</select></div></div>',
    '<div class="field-row"><div class="field"><label for="primaryCap">Max per ticket (KRW)</label>',
    '<input id="primaryCap" type="number" min="1" placeholder="Face value if blank" value="', formState.primaryCap, '"></div>',
    '<div class="field"><label for="fallbackZone">Alternative section</label>',
    '<select id="fallbackZone">', zoneOptions(formState.fallbackChoice, true), '</select></div></div>',
    '<div class="field-row', formState.fallbackChoice ? '' : ' is-hidden', '" id="fallbackCapRow">',
    '<div class="field"><label for="fallbackCap">Alternative max per ticket (KRW)</label>',
    '<input id="fallbackCap" type="number" min="1" placeholder="Face value if blank" value="',
    html(formState.fallbackCap), '"></div></div>',
    '<p class="flow-note">No seats reserved yet.</p>',
    '<button class="primary-btn" data-action="interpret">Interpret request</button>'
  ].join('');
}

function renderParsed() {
  const fallbacks = parsed.fallback_rules || [];
  const sourceCopy = parseSource === 'gemini'
    ? ['Gemini interpreted your request. Check every detail before joining the platform queue.', 'GEMINI PARSED']
    : parseSource === 'controls'
      ? ['Your selected controls were converted into booking conditions. Check every detail before continuing.', 'CONTROLS']
      : ['Gemini was unavailable, so the basic parser was used. Check every detail before continuing.', 'BASIC PARSER'];
  const fallbackRows = fallbacks.length
    ? fallbacks.map((rule, index) =>
      '<div class="parsed-row"><span class="k">Alternative ' + (index + 1) + '</span><span class="v">' +
      html(ruleLabel(rule)) + ' &middot; ' + money(rule.max_price_krw) + ' / ticket<br><small>' +
      html(ruleSummary(rule)) + '</small></span></div>').join('')
    : '<div class="parsed-row"><span class="k">Alternatives</span><span class="v">None</span></div>';
  body.innerHTML = [
    '<h2 class="step-title">Review your conditions</h2>',
    '<p class="step-sub">', sourceCopy[0], '</p>',
    '<div class="agreed-pill"><span class="dot"></span>', sourceCopy[1], '</div>',
    '<div class="parsed-card">',
    '<div class="parsed-row"><span class="k">First choice</span><span class="v">',
    html(ruleLabel(parsed.primary)), ' &middot; ', money(parsed.primary.max_price_krw), ' / ticket<br><small>',
    html(ruleSummary(parsed.primary)), '</small></span></div>',
    fallbackRows,
    '<div class="parsed-row"><span class="k">Quantity</span><span class="v">', parsed.seat_count, '</span></div>',
    '</div>',
    '<fieldset class="payment-options"><legend>Payment method</legend>',
    '<label><input type="radio" name="paymentMode" value="demo"', paymentMode === 'demo' ? ' checked' : '', '>Server demo wallet</label>',
    '<label><input type="radio" name="paymentMode" value="wallet"', paymentMode === 'wallet' ? ' checked' : '', '>My wallet &middot; Devnet</label></fieldset>',
    '<div id="walletPane" class="wallet-pane"', paymentMode === 'wallet' ? '' : ' hidden', '></div>',
    '<p class="flow-note">', paymentMode === 'wallet'
      ? 'Devnet test SOL only. Wallet approval required at your turn.'
      : 'Devnet test SOL only. Funded by the demo wallet.', '</p>',
    '<button class="primary-btn" data-action="join">Confirm & join queue</button>',
    '<button class="ghost-btn" data-action="edit">Edit conditions</button>'
  ].join('');
  updateWalletPane();
}

const sol = (lamports) => (Number(lamports) / 1000000000).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') + ' SOL';
function updateWalletPane() {
  const pane = document.getElementById('walletPane');
  if (!pane || paymentMode !== 'wallet') return;
  const wallet = window.FairQueueWallet?.state();
  pane.innerHTML = wallet?.address
    ? '<strong>' + html(wallet.name) + ' &middot; Devnet</strong><span class="wallet-address">' + html(wallet.address) + '</span>' +
      '<span>Balance: ' + (wallet.lamports === null ? 'Loading...' : sol(wallet.lamports)) + '</span>' +
      '<div class="wallet-actions"><button class="ghost-btn" data-action="refresh-wallet">Refresh balance</button>' +
      '<button class="ghost-btn" data-action="disconnect-wallet">Disconnect</button></div>' +
      (!wallet.configuration?.enabled ? '<p class="flow-error">The x402 escrow service is not enabled.</p>' : '')
    : '<span>Connect a buyer wallet on Solana Devnet.</span>' +
      (wallet?.wallets.length ? '<select id="walletChoice" aria-label="Wallet">' + wallet.wallets.map((name) => '<option>' + html(name) + '</option>').join('') + '</select>' :
        '<p class="flow-note">No wallet detected. Install Phantom or another Solana Wallet Standard wallet, then reload.</p>') +
      '<div class="wallet-actions"><button class="ghost-btn" data-action="connect-wallet">Connect wallet</button></div>';
  const join = body.querySelector('[data-action="join"]');
  if (join) join.disabled = !wallet?.address || !wallet.configuration?.enabled;
}

function renderQueue(snapshot) {
  const ahead = Number(snapshot?.waiting_ahead ?? 0);
  body.innerHTML = [
    '<h2 class="step-title">Waiting in the official queue</h2>',
    '<p class="step-sub">Your turn is determined by the platform queue. This page does not skip ahead.</p>',
    '<div class="queue-box"><div class="queue-caption">PEOPLE AHEAD</div>',
    '<div class="queue-num" id="aheadCount">', ahead, '</div>',
    '<div class="bar-bg"><div class="bar-fill"></div></div></div>',
    '<div class="queue-stats">',
    '<div class="queue-stat"><div class="n" id="queuePosition">#', html(snapshot?.position || '-'),
    '</div><div class="l">Queue position</div></div>',
    '<div class="queue-stat"><div class="n" id="queueState">', html(snapshot?.status || 'WAITING'),
    '</div><div class="l">Status</div></div></div>',
    '<p class="flow-note">Queue ID: <strong>', html(queueId), '</strong></p>'
  ].join('');
}

function explorerLink(url, label) {
  if (!/^https:\/\/explorer\.solana\.com\/tx\/[A-Za-z0-9]+\?cluster=devnet$/.test(url || '')) return '';
  return '<a class="explorer-link" href="' + html(url) + '" target="_blank" rel="noopener noreferrer">' + label + ' ↗</a>';
}

function renderSettlement() {
  if (!result) {
    if (paymentMode === 'wallet' && walletQuote && walletPhase === 'review-deposit') {
      body.innerHTML = '<h2 class="step-title">Review your Devnet deposit</h2>' +
        '<p class="step-sub">' + (walletQuote.decision === 'REFUND' ? 'No matching offer was found. This refund rehearsal creates an escrow deposit, then requests its principal back. No seats will be booked.' : 'The held offer passed your conditions. Approve its escrow deposit in your wallet.') + '</p>' +
        '<div class="parsed-card">' + [['Deposit principal', sol(walletQuote.amount)], ['Locked account rent', sol(walletQuote.rent)], ['Deposit network fee', sol(walletQuote.fee)], ['Estimated wallet debit', sol(walletQuote.total)]].map(([label, value]) =>
          '<div class="parsed-row"><span class="k">' + label + '</span><span class="v">' + value + '</span></div>').join('') + '</div>' +
        '<p class="flow-note">Rent remains in the escrow account after settlement or refund. Network fees are not refunded.</p>' +
        '<p class="flow-note">Payer: <strong>' + html(walletQuote.payer) + '</strong></p>' +
        '<p class="flow-note" id="quoteExpiry" role="status"></p>' +
        '<button class="primary-btn" data-action="approve-wallet">Approve deposit in wallet</button>' +
        '<button class="ghost-btn" data-action="cancel-wallet">Cancel payment</button>';
      const updateExpiry = () => {
        const seconds = Math.max(0, Math.ceil((walletQuote.expiresAt - Date.now()) / 1000));
        document.getElementById('quoteExpiry').textContent = seconds > 0 ? 'Quote valid for ' + seconds + ' seconds' : 'Quote expired. Cancel this unpaid booking and start again.';
        body.querySelector('[data-action="approve-wallet"]').disabled = seconds === 0;
        if (seconds === 0) { clearInterval(quoteTimer); quoteTimer = null; }
      };
      updateExpiry();
      if (walletQuote.expiresAt > Date.now()) quoteTimer = setInterval(updateExpiry, 1000);
      return;
    }
    body.innerHTML = '<h2 class="step-title">' + (settlementError ? (paymentMode === 'wallet' && walletPhase !== 'submitting' ? 'Wallet approval stopped' : 'Payment confirmation pending') : 'Checking the seat offer') + '</h2>' +
      '<p class="step-sub">' + (walletPhase === 'awaiting-wallet' ? (walletQuote?.decision === 'REFUND' ? 'Approve the refund rehearsal deposit in your wallet. No seats are reserved.' : 'Approve the deposit in your wallet before the quote expires. The selected seats are held by this demo platform.') :
        walletPhase === 'submitting' ? 'Confirming your buyer-signed deposit and escrow settlement on Devnet.' : 'The platform is checking current inventory and preparing the escrow transaction on Devnet.') + '</p>' +
      '<div class="bar-bg"><div class="bar-fill"></div></div>' +
      '<p class="flow-note">Queue ID: <strong>' + html(queueId) + '</strong>. Please keep this page open.</p>' +
      (settlementError ? '<p class="flow-error">' + html(settlementError) + '</p>' : '') +
      (paymentMode === 'wallet' && settlementError ? '<div id="walletPane" class="wallet-pane"></div><button class="ghost-btn" data-action="payment-status">Check existing payment</button>' +
        (walletPhase !== 'submitting' ? (walletPhase !== 'rejected-unfunded' ? '<button class="ghost-btn" data-action="retry-wallet">Continue wallet approval</button>' : '') + '<button class="ghost-btn" data-action="cancel-booking">Cancel booking</button>' : '') : '');
    updateWalletPane();
    return;
  }
  const settled = Boolean(result.order);
  const seat = result.offered_seat;
  const settlement = result.settle_result || {};
  const offerLabel = seat?.zone_label || seat?.grade || 'The seat offer';
  const offerReview = settlement.final_decision === 'SETTLE_PRIMARY'
    ? offerLabel + ' matched the approved first-choice section, quantity, and price limit.'
    : settlement.final_decision === 'SETTLE_FALLBACK'
      ? 'The first choice was unavailable. ' + offerLabel + ' matched the approved alternative conditions.'
      : 'No available seat offer matched the approved conditions, so the escrow was refunded.';
  const verificationReview = settlement.overridden_by_verification
    ? 'The code-based verification corrected the AI decision before settlement.'
    : 'The code-based verification confirmed the final decision before settlement.';
  const detail = settled
    ? html(seat.zone_label || seat.grade) + ' · ' + result.order.count + ' ticket(s)' +
      (seat.seat_numbers?.length ? ' · Seats ' + seat.seat_numbers.join(', ') : ' · General admission')
    : html(result.refund?.reason || 'No available offer met your conditions.');
  body.innerHTML = [
    '<div class="result-hero"><div class="icon">', settled ? '✓' : '↩', '</div>',
    '<h2>', settled ? 'Booking settled on Devnet' : 'Escrow refunded on Devnet', '</h2>',
    '<p>', detail, '</p></div>',
    settled ? '<div class="parsed-card"><div class="parsed-row"><span class="k">Reference price (KRW)</span><span class="v">' +
      money(result.order.price_krw * result.order.count) + '</span></div></div>' : '',
    paymentMode === 'wallet' && settlement.escrow_amount_lamports ? '<div class="parsed-card"><div class="parsed-row"><span class="k">' + (settled ? 'Escrow principal released' : 'Principal returned to buyer') + '</span><span class="v">' + sol(settlement.escrow_amount_lamports) + '</span></div></div>' : '',
    '<div class="reasoning-banner"><b>Offer review</b><br>' + html(offerReview) + '</div>',
    '<p class="flow-note">Independent verification: ' + html(verificationReview) + '</p>',
    '<div class="tx-card"><div class="tlabel">DEPOSIT TX</div><div class="thash">',
    html(settlement.fund_tx || '-'), '</div></div>',
    '<div class="tx-card"><div class="tlabel">', settled ? 'RELEASE TX' : 'REFUND TX',
    '</div><div class="thash">', html(settlement.settle_tx || '-'), '</div></div>',
    explorerLink(settlement.explorer_urls?.fund, 'View deposit on Solana Explorer'),
    explorerLink(settlement.explorer_urls?.settle, settled ? 'View settlement on Solana Explorer' : 'View refund on Solana Explorer'),
    paymentMode === 'wallet' ? '<p class="flow-note">Buyer wallet: <strong>' + html(settlement.escrow_user || buyerAddress) + '</strong></p>' : '',
    !settled && paymentMode === 'wallet' ? '<p class="flow-note">Network fees are not refunded; account rent remains locked in escrow.</p>' : '',
    '<p class="flow-note">Devnet test transaction · No real ticket issued.</p>',
    '<button class="ghost-btn" data-action="return">Back to event</button>'
  ].join('');
}

function render(snapshot) {
  clearInterval(quoteTimer); quoteTimer = null;
  setBar(stageIndex);
  if (!booking) {
    body.innerHTML = '<p class="flow-error">No valid booking request was found. Select a performance in the event catalog first.</p>';
  } else if (stageIndex === 0) renderConditions();
  else if (stageIndex === 1) renderParsed();
  else if (stageIndex === 2) renderQueue(snapshot);
  else renderSettlement();
}

function saveBookingHistory() {
  try {
    const profile = JSON.parse(localStorage.getItem('fairqueue-storefront-demo-user') || 'null');
    if (!profile?.email || !booking || !result) return;
    const key = 'fairqueue-storefront-bookings:' + profile.email.toLowerCase();
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    if (history.some((item) => item.queueId === queueId)) return;
    history.unshift({
      queueId,
      eventId: booking.event.id,
      sessionId: booking.session.id,
      status: result.order ? 'SETTLED' : 'REFUNDED',
      quantity: result.order?.count || parsed?.seat_count || booking.intent.quantity,
      grade: result.order?.grade || null,
      zone: result.order?.zone_label || null,
      seats: result.order?.seat_numbers || [],
      totalKrw: result.order ? result.order.price_krw * result.order.count : 0,
      txUrl: result.settle_result?.explorer_urls?.settle || null,
      paymentMode, payer: buyerAddress,
      depositTxUrl: result.settle_result?.explorer_urls?.fund || null,
      principalLamports: result.settle_result?.escrow_amount_lamports || null,
      completedAt: new Date().toISOString(),
    });
    localStorage.setItem(key, JSON.stringify(history.slice(0, 30)));
  } catch {
    // Browser-local history is optional; it must never block settlement.
  }
}

async function interpret() {
  const text = document.getElementById('conditionText').value.trim();
  const quantity = Number(document.getElementById('ticketCount').value);
  const primaryChoice = document.getElementById('primaryZone').value;
  const fallbackChoice = document.getElementById('fallbackZone').value;
  const primary = choiceDetails(primaryChoice);
  const fallback = choiceDetails(fallbackChoice);
  const primaryCap = Number(document.getElementById('primaryCap').value) || primary?.price || 0;
  const fallbackCap = Number(document.getElementById('fallbackCap').value) ||
    fallback?.price || 0;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > booking.event.maxTickets ||
      (!text && !primary) || (primary && (!Number.isFinite(primaryCap) || primaryCap <= 0)) ||
      (fallback && (!Number.isFinite(fallbackCap) || fallbackCap <= 0 || fallbackChoice === primaryChoice))) {
    showError('Describe your request or select a first-choice section, then review the quantity and price limits.');
    return;
  }
  formState = { text, quantity, primaryChoice, primaryCap, fallbackChoice,
    fallbackCap: fallback ? fallbackCap : '' };
  const defaults = {
    primary: primary ? { grade: primary.grade, zone_id: primary.zoneId, max_price_krw: primaryCap } : undefined,
    fallback_rules: fallback ? [{ grade: fallback.grade, zone_id: fallback.zoneId, max_price_krw: fallbackCap }] : [],
    seat_count: quantity,
    preferred_zone_id: primary?.zoneId || null,
    adjacency_required: quantity > 1 && booking.event.genre !== 'Festival',
  };
  const button = body.querySelector('[data-action="interpret"]');
  button.disabled = true;
  button.textContent = 'Interpreting request...';
  try {
    const response = await post('/parse-condition', {
      session_id: booking.session.id, text, defaults, mode: text ? 'natural_language' : 'controls'
    });
    parsed = response.parsed;
    parseSource = response.source;
    if (parseSource === 'gemini') {
      const choice = (rule) => {
        if (!rule) return '';
        if (rule.zone_id) return 'zone:' + rule.zone_id;
        const zones = booking.session.zones.filter((zone) => zone.grade === rule.grade);
        return zones.length === 1 ? 'zone:' + zones[0].id : 'grade:' + rule.grade;
      };
      formState.quantity = parsed.seat_count;
      formState.primaryChoice = choice(parsed.primary);
      formState.primaryCap = parsed.primary.max_price_krw;
      formState.fallbackChoice = choice(parsed.fallback_rules[0]);
      formState.fallbackCap = parsed.fallback_rules[0]?.max_price_krw || '';
    }
    stageIndex = 1;
    render();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Interpret request';
    showError(error.message);
  }
}

async function joinQueue() {
  if (!parsed || busy) return;
  if (paymentMode === 'wallet') {
    const wallet = window.FairQueueWallet?.state();
    if (!wallet?.address || !wallet.configuration?.enabled) { showError('Connect a buyer wallet to the enabled Devnet escrow service first.'); return; }
    buyerAddress = wallet.address;
  }
  busy = true;
  const button = body.querySelector('[data-action="join"]');
  button.disabled = true;
  button.textContent = 'Joining queue...';
  try {
    const userId = 'demo-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
    const snapshot = await post('/queue/join', {
      event: booking.session.id, user_id: userId, conditions: parsed
    });
    queueId = snapshot.queue_id;
    sessionStorage.setItem(queueKey, JSON.stringify({ sessionId: booking.session.id, queueId, paymentMode, payer: buyerAddress, conditions: parsed }));
    stageIndex = 2;
    render(snapshot);
    schedulePoll();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Confirm & join queue';
    showError(error.message);
  } finally {
    busy = false;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollQueue, 1500);
}

async function pollQueue() {
  if (!queueId || !overlay.classList.contains('open') || stageIndex !== 2) return;
  try {
    const query = new URLSearchParams({ event: booking.session.id, queue_id: queueId });
    const snapshot = await api('/queue/my-turn?' + query);
    render(snapshot);
    if (['SETTLED', 'REFUNDED'].includes(snapshot.status)) {
      await checkExistingPayment();
    } else if (snapshot.is_my_turn || ['OFFERED', 'REFUND_PENDING'].includes(snapshot.status)) {
      stageIndex = 3;
      render();
      await settle();
    } else {
      schedulePoll();
    }
  } catch (error) {
    showError('Queue status could not be refreshed: ' + error.message);
    schedulePoll();
  }
}

async function settle() {
  if (busy || result) return;
  if (settling) return;
  settling = true;
  busy = true;
  try {
    settlementError = null;
    if (paymentMode === 'wallet') {
      result = await window.FairQueueWallet.settle({ event: booking.session.id, queueId, conditions: parsed, payer: buyerAddress,
        onQuote: (quote) => new Promise((resolve, reject) => {
          walletQuote = quote; walletPhase = 'review-deposit'; approval = { resolve, reject }; render();
        }),
        onSubmitting: () => { walletPhase = 'submitting'; render(); },
      });
    } else result = await post('/demo/settle-offer', { event: booking.session.id, queue_id: queueId });
    sessionStorage.removeItem(queueKey);
    saveBookingHistory();
    render();
  } catch (error) {
    walletQuote = null;
    if (error.name === 'DepositNotSubmittedError') walletPhase = 'rejected-unfunded';
    settlementError = 'Settlement could not be confirmed: ' + error.message +
      (walletPhase === 'rejected-unfunded' ? '. No deposit was broadcast.' : paymentMode === 'wallet' && walletPhase !== 'submitting' ? '. No signed deposit was submitted by this attempt.' : '. Do not submit a second payment request.') + ' Queue ID: ' + queueId;
    render();
  } finally {
    busy = false;
    settling = false;
  }
}

async function checkExistingPayment() {
  try {
    const query = new URLSearchParams({ event: booking.session.id, queue_id: queueId });
    if (buyerAddress) query.set('payer', buyerAddress);
    const response = await api('/queue/result?' + query);
    if (response.result) { result = response.result; stageIndex = 3; saveBookingHistory(); sessionStorage.removeItem(queueKey); render(); }
    else {
      if (response.payment_rejected_unfunded) walletPhase = 'rejected-unfunded';
      settlementError = response.payment_rejected_unfunded ? 'The deposit was rejected before submission. Cancel this booking and start again.' : response.payment_unknown ? 'Payment requires server reconciliation. Do not pay again.' : 'No completed payment result is available yet.';
      render();
    }
  } catch (error) { showError(error.message); }
}
async function cancelWalletBooking() {
  try {
    await post('/queue/cancel', { event: booking.session.id, queue_id: queueId, payer: buyerAddress });
    sessionStorage.removeItem(queueKey);
    location.href = document.getElementById('backLink').href;
  } catch (error) { showError(error.message); }
}

function openModal() {
  overlay.classList.add('open');
  render();
  if (stageIndex === 2 && queueId) schedulePoll();
}

function closeModal() {
  clearInterval(quoteTimer); quoteTimer = null;
  if (approval) { approval.reject(new Error('Payment approval cancelled')); approval = null; }
  clearTimeout(pollTimer);
  overlay.classList.remove('open');
}

window.openModal = openModal;
window.closeModal = closeModal;
body.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'interpret') interpret();
  if (action === 'join') joinQueue();
  if (action === 'edit') { stageIndex = 0; render(); }
  if (action === 'return') location.href = document.getElementById('backLink').href;
  if (action === 'connect-wallet') window.FairQueueWallet?.connect(document.getElementById('walletChoice')?.value).catch((error) => showError(error.message));
  if (action === 'disconnect-wallet') window.FairQueueWallet?.disconnect().catch((error) => showError(error.message));
  if (action === 'refresh-wallet') window.FairQueueWallet?.refreshBalance().catch((error) => showError(error.message));
  if (action === 'approve-wallet' && approval) { const pending = approval; approval = null; walletPhase = 'awaiting-wallet'; render(); pending.resolve(); }
  if (action === 'cancel-wallet' && approval) { const pending = approval; approval = null; walletPhase = 'cancelled'; pending.reject(new Error('Payment approval cancelled')); cancelWalletBooking(); }
  if (action === 'cancel-booking') cancelWalletBooking();
  if (action === 'payment-status') checkExistingPayment();
  if (action === 'retry-wallet' && !settling) { walletQuote = null; walletPhase = ''; settle(); }
});
body.addEventListener('change', (event) => {
  const select = event.target;
  if (select.name === 'paymentMode') { paymentMode = select.value; renderParsed(); return; }
  if (select.id !== 'primaryZone' && select.id !== 'fallbackZone') return;
  const isFallback = select.id === 'fallbackZone';
  const input = document.getElementById(isFallback ? 'fallbackCap' : 'primaryCap');
  const previous = choiceDetails(select.dataset.previousChoice ||
    (isFallback ? formState.fallbackChoice : formState.primaryChoice));
  const current = choiceDetails(select.value);
  if (!current) input.value = '';
  else if (!input.value || Number(input.value) === previous?.price) input.value = current.price;
  select.dataset.previousChoice = select.value;
  if (isFallback) document.getElementById('fallbackCapRow').classList.toggle('is-hidden', !current);
});
window.addEventListener('fairqueue-wallet-change', updateWalletPane);
overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });

(async function initialize() {
  try {
    const intent = JSON.parse(sessionStorage.getItem(intentKey) || 'null');
    if (!intent) throw new Error('No booking request');
    const response = await api('/catalog/events');
    const event = response.events.find((item) => item.id === intent.eventId);
    const session = event?.sessions.find((item) => item.id === intent.sessionId);
    if (!event || !session || !Number.isInteger(intent.quantity) ||
        intent.quantity < 1 || intent.quantity > event.maxTickets) {
      throw new Error('Invalid event, performance, or ticket quantity');
    }
    booking = { event, session, intent };
    const profile = JSON.parse(localStorage.getItem('fairqueue-storefront-demo-user') || 'null');
    if (!profile?.email || profile.email.toLowerCase() !== intent.userEmail?.toLowerCase()) {
      throw new Error('Sign in with the profile used to start this booking');
    }
    document.title = 'FairQueue · ' + event.title;
    document.getElementById('eventChipName').textContent = event.title;
    document.getElementById('eventChipMeta').textContent = session.date + ' · ' + session.time + ' · ' + event.venue;
    document.getElementById('eventChip').hidden = false;
    document.getElementById('backLink').href = '/storefront/events/' + encodeURIComponent(event.id);
    const onSale = event.status === 'ON_SALE' && session.status !== 'OPENING_SOON' && session.status !== 'SOLD_OUT';
    document.getElementById('openBooking').disabled = !onSale;
    if (!onSale) {
      document.querySelector('.tagline').textContent = session.status === 'SOLD_OUT'
        ? 'This performance is sold out. Choose another date.'
        : 'Tickets are not on sale for this performance yet.';
    }
    const active = JSON.parse(sessionStorage.getItem(queueKey) || 'null');
    if (active?.sessionId === session.id && active.queueId) {
      queueId = active.queueId;
      paymentMode = active.paymentMode || 'demo'; buyerAddress = active.payer || null; parsed = active.conditions || null;
      stageIndex = 2;
      openModal();
    }
  } catch (error) {
    document.querySelector('.tagline').textContent = error.message ||
      'Choose a performance in the event catalog to start a booking session.';
    document.getElementById('backLink').href = '/storefront/';
  }
})();
