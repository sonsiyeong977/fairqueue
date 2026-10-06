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
  const options = includeNone ? ['<option value="">No alternative</option>'] : [];
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

function renderConditions() {
  const { event, session, intent } = booking;
  const chosen = session.zones.find((zone) => zone.id === intent.preferredZoneId);
  const grade = chosen?.grade || session.zones.find((zone) => zone.remaining >= intent.quantity)?.grade || session.zones[0].grade;
  const cap = chosen?.price || session.zones.find((zone) => zone.grade === grade)?.price || 0;
  const firstGradeZones = session.zones.filter((zone) => zone.grade === grade);
  const initialChoice = chosen ? 'zone:' + chosen.id : firstGradeZones.length > 1
    ? 'grade:' + grade : 'zone:' + firstGradeZones[0].id;
  if (!formState) {
    formState = {
      text: 'Please book ' + intent.quantity + ' ' + grade + ' ticket' + (intent.quantity === 1 ? '' : 's') +
        ' for ' + event.title + ' on ' + session.date + ', up to ' + money(cap) + ' per ticket.',
      quantity: intent.quantity,
      primaryChoice: initialChoice,
      primaryCap: cap,
      fallbackChoice: '',
      fallbackCap: '',
    };
  }
  body.innerHTML = [
    '<h2 class="step-title">Set your booking conditions</h2>',
    '<p class="step-sub">Edit the request in your own words. Review the interpreted conditions before joining the queue.</p>',
    '<textarea id="conditionText" aria-label="Booking request">', html(formState.text), '</textarea>',
    '<div class="field-row"><div class="field"><label for="ticketCount">Tickets</label>',
    '<input id="ticketCount" type="number" min="1" max="', event.maxTickets,
    '" value="', formState.quantity, '"></div>',
    '<div class="field"><label for="primaryZone">First-choice section</label><select id="primaryZone">',
    zoneOptions(formState.primaryChoice, false), '</select></div></div>',
    '<div class="field-row"><div class="field"><label for="primaryCap">Max per ticket (KRW)</label>',
    '<input id="primaryCap" type="number" min="1" value="', formState.primaryCap, '"></div>',
    '<div class="field"><label for="fallbackZone">Alternative section</label>',
    '<select id="fallbackZone">', zoneOptions(formState.fallbackChoice, true), '</select></div></div>',
    '<div class="field-row', formState.fallbackChoice ? '' : ' is-hidden', '" id="fallbackCapRow">',
    '<div class="field"><label for="fallbackCap">Alternative max per ticket (KRW)</label>',
    '<input id="fallbackCap" type="number" min="1" placeholder="Face value if blank" value="',
    html(formState.fallbackCap), '"></div></div>',
    '<p class="flow-note">A section is a booking condition, not a held seat. The next screen shows the interpreted request. Devnet uses a demo agent wallet, not your funds.</p>',
    '<button class="primary-btn" data-action="interpret">Interpret request</button>'
  ].join('');
}

function renderParsed() {
  const fallback = parsed.fallback_rules[0];
  body.innerHTML = [
    '<h2 class="step-title">Review your conditions</h2>',
    '<p class="step-sub">', parseSource === 'gemini'
      ? 'Gemini interpreted your request. Check every detail before joining the official queue.'
      : 'The basic parser was used because Gemini was unavailable. Check every detail before continuing.', '</p>',
    '<div class="agreed-pill"><span class="dot"></span>', parseSource === 'gemini' ? 'GEMINI PARSED' : 'BASIC PARSER', '</div>',
    '<div class="parsed-card">',
    '<div class="parsed-row"><span class="k">First choice</span><span class="v">',
    html(ruleLabel(parsed.primary)), ' · ', money(parsed.primary.max_price_krw), ' / ticket</span></div>',
    '<div class="parsed-row"><span class="k">Alternative</span><span class="v">',
    fallback ? html(ruleLabel(fallback)) + ' · ' + money(fallback.max_price_krw) + ' / ticket' : 'None', '</span></div>',
    '<div class="parsed-row"><span class="k">Quantity</span><span class="v">', parsed.seat_count, '</span></div>',
    '<div class="parsed-row"><span class="k">Adjacent seats</span><span class="v">',
    parsed.adjacency_required ? 'Required' : 'Not required', '</span></div>',
    '</div>',
    '<p class="flow-note">No payment has been made. When your turn comes, the platform checks its current inventory and an independent rule check runs before settlement.</p>',
    '<button class="primary-btn" data-action="join">Confirm & join queue</button>',
    '<button class="ghost-btn" data-action="edit">Edit conditions</button>'
  ].join('');
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
    body.innerHTML = '<h2 class="step-title">Checking the seat offer</h2>' +
      '<p class="step-sub">The platform is checking current inventory and submitting the escrow transaction on Devnet. This may take a moment.</p>' +
      '<div class="bar-bg"><div class="bar-fill"></div></div>' +
      '<p class="flow-note">Queue ID: <strong>' + html(queueId) + '</strong>. Please keep this page open.</p>' +
      (settlementError ? '<p class="flow-error">' + html(settlementError) + '</p>' : '');
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
    settled ? '<div class="parsed-card"><div class="parsed-row"><span class="k">Total ticket price</span><span class="v">' +
      money(result.order.price_krw * result.order.count) + '</span></div></div>' : '',
    '<div class="reasoning-banner"><b>Offer review</b><br>' + html(offerReview) + '</div>',
    '<p class="flow-note">Independent verification: ' + html(verificationReview) + '</p>',
    '<div class="tx-card"><div class="tlabel">DEPOSIT TX</div><div class="thash">',
    html(settlement.fund_tx || '-'), '</div></div>',
    '<div class="tx-card"><div class="tlabel">', settled ? 'RELEASE TX' : 'REFUND TX',
    '</div><div class="thash">', html(settlement.settle_tx || '-'), '</div></div>',
    explorerLink(settlement.explorer_urls?.fund, 'View deposit on Solana Explorer'),
    explorerLink(settlement.explorer_urls?.settle, 'View settlement on Solana Explorer'),
    '<p class="flow-note">Devnet uses a demo agent wallet. No card payment or real ticket issuance occurs here.</p>',
    '<button class="ghost-btn" data-action="return">Back to event</button>'
  ].join('');
}

function render(snapshot) {
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
  const primaryCap = Number(document.getElementById('primaryCap').value);
  const fallbackCap = Number(document.getElementById('fallbackCap').value) ||
    fallback?.price || 0;
  if (!text || !Number.isInteger(quantity) || quantity < 1 || quantity > booking.event.maxTickets ||
      !primary || !Number.isFinite(primaryCap) || primaryCap <= 0 ||
      (fallback && (!Number.isFinite(fallbackCap) || fallbackCap <= 0 || fallbackChoice === primaryChoice))) {
    showError('Enter a request, valid ticket quantity, different sections, and price limits.');
    return;
  }
  formState = { text, quantity, primaryChoice, primaryCap, fallbackChoice,
    fallbackCap: fallback ? fallbackCap : '' };
  const defaults = {
    primary: { grade: primary.grade, zone_id: primary.zoneId, max_price_krw: primaryCap },
    fallback_rules: fallback ? [{ grade: fallback.grade, zone_id: fallback.zoneId, max_price_krw: fallbackCap }] : [],
    seat_count: quantity,
    preferred_zone_id: primary.zoneId,
    adjacency_required: quantity > 1 && booking.event.genre !== 'Festival',
  };
  const button = body.querySelector('[data-action="interpret"]');
  button.disabled = true;
  button.textContent = 'Interpreting request...';
  try {
    const response = await post('/parse-condition', {
      session_id: booking.session.id, text, defaults
    });
    parsed = response.parsed;
    parseSource = response.source;
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
    sessionStorage.setItem(queueKey, JSON.stringify({ sessionId: booking.session.id, queueId }));
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
    if (snapshot.is_my_turn) {
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
  busy = true;
  try {
    result = await post('/demo/settle-offer', {
      event: booking.session.id, queue_id: queueId
    });
    sessionStorage.removeItem(queueKey);
    saveBookingHistory();
    render();
  } catch (error) {
    settlementError = 'Settlement could not be confirmed: ' + error.message +
      '. Do not submit a second payment request. Queue ID: ' + queueId;
    render();
  } finally {
    busy = false;
  }
}

function openModal() {
  overlay.classList.add('open');
  render();
  if (stageIndex === 2 && queueId) schedulePoll();
}

function closeModal() {
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
});
body.addEventListener('change', (event) => {
  const select = event.target;
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
      stageIndex = 2;
      openModal();
    }
  } catch (error) {
    document.querySelector('.tagline').textContent = error.message ||
      'Choose a performance in the event catalog to start a booking session.';
    document.getElementById('backLink').href = '/storefront/';
  }
})();
