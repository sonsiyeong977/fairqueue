const express = require("express");

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());
app.use("/dashboard", express.static(path.join(__dirname, "..", "dashboard")));
const storefrontDist = path.join(__dirname, "..", "storefront", "dist");
app.get("/", (req, res) => res.redirect("/storefront/"));
app.use("/storefront", express.static(storefrontDist));
app.use("/storefront", (req, res, next) => {
  if (req.method !== "GET" || path.extname(req.path)) return next();
  res.sendFile(path.join(storefrontDist, "index.html"));
});

const PORT = Number(process.env.PORT || 3001);
const TURN_INTERVAL_MS = Number(process.env.TURN_INTERVAL_MS || 8000);
const HOLD_TTL_MS = Number(process.env.HOLD_TTL_MS || 60_000);
const SETTLE_SERVER_URL = process.env.SETTLE_SERVER_URL || "http://localhost:4000";
const SETTLE_API_KEY = process.env.SETTLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const defaultEventName = "IU Concert";
const SEAT_PRICES = { VIP: 250000, R: 190000, S: 120000 };
const catalog = require("../storefront/catalog.json");
const catalogBySession = new Map();

const ruleSchema = {
  type: "OBJECT",
  properties: {
    grade: { type: "STRING" },
    zone_id: { type: "STRING", nullable: true },
    max_price_krw: { type: "NUMBER", nullable: true },
    adjacency_required: { type: "BOOLEAN" },
    allow_split_seats: { type: "BOOLEAN" },
    avoid_restricted_view: { type: "BOOLEAN" },
  },
  required: ["grade", "zone_id", "max_price_krw", "adjacency_required", "allow_split_seats", "avoid_restricted_view"],
};
const conditionSchema = {
  type: "OBJECT",
  properties: {
    primary: ruleSchema,
    fallback_rules: { type: "ARRAY", items: ruleSchema },
    fallback_policy: { type: "STRING", enum: ["inherit_controls", "explicit"] },
    seat_count: { type: "INTEGER" },
    needs_clarification: { type: "BOOLEAN" },
    clarification_question: { type: "STRING", nullable: true },
  },
  required: ["primary", "fallback_rules", "fallback_policy", "seat_count", "needs_clarification", "clarification_question"],
};

const state = {
  events: {
    [defaultEventName]: {
      event: defaultEventName,
      venue: "KSPO Dome",
      sale_status: "OPEN",
      turn_index: 0,
      queue: [],
      seats: [
        { grade: "VIP", price_krw: 250000, count: 4 },
        { grade: "R", price_krw: 190000, count: 48 },
        { grade: "S", price_krw: 120000, count: 72 },
      ],
      holds: [],
      orders: [],
      refunds: [],
    },
  },
};

for (const event of catalog) {
  for (const session of event.sessions) {
    if (catalogBySession.has(session.id)) throw new Error(`Duplicate session: ${session.id}`);
    catalogBySession.set(session.id, { event, session });
    state.events[session.id] = {
      event: session.id,
      catalog_event_id: event.id,
      venue: event.venue,
      sale_status: "OPEN",
      turn_index: 0,
      queue: [],
      seats: session.zones.map((zone) => ({
        zone_id: zone.id,
        label: zone.label,
        grade: zone.grade,
        price_krw: zone.price,
        restricted_view: Boolean(zone.restrictedView),
        capacity: zone.capacity,
        count: zone.remaining,
        available_numbers: event.genre === "Festival"
          ? null
          : Array.from(
              { length: zone.remaining },
              (_, index) => zone.capacity - zone.remaining + index + 1
            ),
      })),
      holds: [],
      orders: [],
      refunds: [],
    };
  }
}

function sessionIsOnSale(sessionId, now = Date.now()) {
  const record = catalogBySession.get(sessionId);
  return Boolean(record) &&
    now >= new Date(record.event.saleOpens).getTime() &&
    record.session.status !== "SOLD_OUT";
}

function catalogCondition(text, record, proposed = {}, defaults = {}) {
  const { event, session } = record;
  const grades = [...new Set(session.zones.map((zone) => zone.grade))];
  const faceValue = (grade) => session.zones.find((zone) => zone.grade === grade)?.price || 0;
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const zoneMentions = session.zones.flatMap((zone) => {
    const labelPattern = zone.label.trim().split(/\s+/).map(escapePattern).join("[\\s-]*");
    const match = new RegExp(`(?<![A-Za-z0-9])${labelPattern}(?![A-Za-z0-9])`, "i").exec(text);
    return match ? [{ zone, index: match.index, length: match[0].length }] : [];
  }).sort((a, b) => a.index - b.index);
  const gradeText = text.split("");
  for (const mention of zoneMentions) gradeText.fill(" ", mention.index, mention.index + mention.length);
  const gradeMentions = [...gradeText.join("").toUpperCase().matchAll(/\b(1DAY|VIP|R|S|A)\b/g)]
    .filter((match) => grades.includes(match[1]))
    .map((match) => ({ grade: match[1], index: match.index }));
  const firstMention = [
    ...gradeMentions,
    ...zoneMentions.map((mention) => ({ grade: mention.zone.grade, index: mention.index })),
  ].sort((a, b) => a.index - b.index)[0];
  const fallbackCue = /\b(?:or|else|otherwise|fallback)\b|\bif\s+(?:not|unavailable|sold\s*out)|없으면|안\s*되면|대안|못\s*잡으면/i.exec(text);
  const countMatch = text.match(/(\d+)\s*(?:adjacent\s*)?(?:tickets?|seats?|spots?|연석|매|장)/i);
  const count = Number(proposed.seat_count || countMatch?.[1] || defaults.seat_count || 1);
  if (!Number.isInteger(count) || count < 1 || count > event.maxTickets) {
    throw httpError(400, `Choose between 1 and ${event.maxTickets} tickets`);
  }
  const primaryGradeHint = proposed.primary?.grade || firstMention?.grade || defaults.primary?.grade || grades[0];
  const primaryMention = zoneMentions.find((mention) =>
    mention.zone.grade === primaryGradeHint && (!fallbackCue || mention.index < fallbackCue.index));
  const primaryZoneId = Object.hasOwn(proposed.primary || {}, "zone_id") ? proposed.primary.zone_id : primaryMention?.zone.id ||
    defaults.primary?.zone_id || defaults.preferred_zone_id || null;
  const primaryZone = session.zones.find((zone) => zone.id === primaryZoneId);
  const primaryGrade = primaryZone?.grade || primaryGradeHint;
  const fallbackMention = zoneMentions.find((mention) =>
    mention.zone.id !== primaryZoneId &&
    (fallbackCue ? mention.index > fallbackCue.index :
      mention.zone.grade !== primaryGrade || zoneMentions.length > 1));
  const fallbackZoneId = proposed.fallback_rules?.[0]?.zone_id ||
    fallbackMention?.zone.id ||
    defaults.fallback_rules?.[0]?.zone_id || null;
  const fallbackZone = session.zones.find((zone) => zone.id === fallbackZoneId);
  const fallbackGrade = fallbackZone?.grade || proposed.fallback_rules?.[0]?.grade ||
    gradeMentions.find((mention) => mention.grade !== primaryGrade)?.grade ||
    defaults.fallback_rules?.[0]?.grade || null;
  const amounts = [...text.matchAll(/(?:KRW\s*|₩\s*)(\d[\d,]*)|(\d[\d,]*(?:\.\d+)?)\s*(만원|원|KRW)/gi)]
    .map((match) => match[1]
      ? Number(match[1].replace(/,/g, ""))
      : priceToKrw(match[2], match[3]));
  const totalBudget = /\b(total|budget|overall)\b|총\s*예산|총\s*\d/i.test(text);
  const textPrimaryCap = amounts[0] ? Math.floor(amounts[0] / (totalBudget ? count : 1)) : 0;
  const textFallbackCap = amounts[1] ? Math.floor(amounts[1] / (totalBudget ? count : 1)) : 0;
  const restrictedViewRequested = /avoid\s+(?:restricted|obstructed|limited)[ -]?view|no\s+(?:restricted|obstructed)[ -]?view|시야\s*(?:제한|방해).*(?:피|제외)|시제석.*(?:피|제외)/i.test(text);
  const textAdjacency = /adjacent|together|side.by.side|연석|연속|붙/i.test(text);
  const textSplit = /separate|split|apart|따로|각각|한\s*자리씩/i.test(text);

  function normalizeRule(rawRule, inferred, defaultRule = {}, amountIndex = 0) {
    const raw = rawRule || {};
    const zoneId = Object.hasOwn(raw, "zone_id") ? raw.zone_id : inferred.zone_id || defaultRule.zone_id || null;
    const zone = session.zones.find((item) => item.id === zoneId);
    if (zoneId && !zone) throw httpError(400, `Unknown seat section: ${zoneId}`);
    const grade = String(zone?.grade || raw.grade || inferred.grade || defaultRule.grade || "").toUpperCase();
    if (!grades.includes(grade)) throw httpError(400, `Unsupported seat grade: ${grade || "missing"}`);
    const amount = amounts[amountIndex];
    const capFromText = amount ? Math.floor(amount / (totalBudget ? count : 1)) : 0;
    const maxPrice = Number(Object.hasOwn(raw, "max_price_krw") ? raw.max_price_krw ?? faceValue(grade) : inferred.max_price_krw || capFromText ||
      defaultRule.max_price_krw || faceValue(grade));
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      throw httpError(400, `Enter a valid price limit for ${zone?.label || grade}`);
    }
    const adjacencyRequired = count > 1 && Boolean(
      raw.adjacency_required ?? inferred.adjacency_required ?? defaultRule.adjacency_required ?? defaults.adjacency_required ?? textAdjacency
    );
    const allowSplitSeats = count > 1 && Boolean(
      raw.allow_split_seats ?? inferred.allow_split_seats ?? defaultRule.allow_split_seats ?? textSplit
    );
    return {
      grade,
      zone_id: zone?.id || null,
      max_price_krw: maxPrice,
      adjacency_required: adjacencyRequired,
      allow_split_seats: allowSplitSeats,
      avoid_restricted_view: Boolean(
        raw.avoid_restricted_view ?? inferred.avoid_restricted_view ??
        defaultRule.avoid_restricted_view ?? proposed.avoid_restricted_view ?? restrictedViewRequested
      ),
    };
  }

  const primary = normalizeRule(proposed.primary, {
    grade: primaryGrade,
    zone_id: primaryZone?.id || null,
    max_price_krw: textPrimaryCap,
    adjacency_required: proposed.adjacency_required,
    allow_split_seats: proposed.allow_split_seats,
  }, defaults.primary || {}, 0);

  const proposedFallbacks = Array.isArray(proposed.fallback_rules)
    ? proposed.fallback_rules.slice(0, 4)
    : [];
  const inferredFallbacks = fallbackGrade ? [{
    grade: fallbackGrade,
    zone_id: fallbackZone?.id || null,
    max_price_krw: textFallbackCap || defaults.fallback_rules?.[0]?.max_price_krw || null,
  }] : [];
  const fallbackInputs = proposed.fallback_policy === "inherit_controls"
    ? (defaults.fallback_rules || []).map((rule) => ({
      ...rule,
      adjacency_required: rule.adjacency_required ?? defaults.adjacency_required ?? primary.adjacency_required,
      allow_split_seats: rule.allow_split_seats ?? defaults.allow_split_seats ?? false,
      avoid_restricted_view: rule.avoid_restricted_view ?? primary.avoid_restricted_view,
    }))
    : Array.isArray(proposed.fallback_rules) ? proposedFallbacks : inferredFallbacks;
  const fallbackRules = fallbackInputs.map((rule, index) => normalizeRule(
    rule,
    index === 0 ? inferredFallbacks[0] || {} : {},
    defaults.fallback_rules?.[index] || {},
    index + 1
  )).filter((rule, index, rules) => {
    const signature = JSON.stringify(rule);
    return signature !== JSON.stringify(primary) &&
      rules.findIndex((candidate) => JSON.stringify(candidate) === signature) === index;
  });

  return {
    primary,
    fallback_rules: fallbackRules,
    seat_count: count,
    preferred_zone_id: primary.zone_id,
    adjacency_required: primary.adjacency_required,
    allow_split_seats: primary.allow_split_seats,
    avoid_restricted_view: primary.avoid_restricted_view,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    if (match) return priceToKrw(match[1], match[2]);
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
    /(?:VIP|R|S)\s*석?(?:으로|로)?\s*(?:하면|잡으면|잡을 경우|일 경우)[^0-9]{0,20}(\d[\d,]*)\s*(만원|원)/,
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

function fallbackParseCondition(text) {
  const normalized = text.replace(/\s+/g, " ").trim().toUpperCase();
  const fallbackPart = fallbackTextPart(normalized);
  const primaryPart = fallbackPart ? normalized.slice(0, normalized.indexOf(fallbackPart)).trim() : normalized;
  const grades = ["VIP", "R", "S"];
  const mentions = gradeMentions(normalized);
  const primaryGrade = grades.find((grade) => new RegExp(`${grade}\\s*석?`).test(primaryPart)) || mentions[0] || null;
  const fallbackGrade =
    grades.find((grade) => new RegExp(`${grade}\\s*석?`).test(fallbackPart)) ||
    mentions.find((grade) => grade !== primaryGrade) ||
    null;
  const countMatch = normalized.match(/(\d+)\s*(연석|연속|매|장)/);
  const seatCount = countMatch ? Number(countMatch[1]) : 1;
  const totalBudget = extractTotalBudget(normalized);
  const fallbackBudget = extractFallbackBudget(normalized);
  const perSeatBudget = totalBudget && seatCount ? Math.floor(totalBudget / seatCount) : totalBudget;
  const fallbackPerSeatBudget = fallbackBudget && seatCount ? Math.floor(fallbackBudget / seatCount) : fallbackBudget;
  const primaryPrice = primaryGrade
    ? extractPriceForGrade(normalized, primaryGrade) || perSeatBudget || SEAT_PRICES[primaryGrade]
    : perSeatBudget;
  const fallbackPrice = fallbackGrade
    ? fallbackPerSeatBudget || extractPriceForGrade(fallbackPart, fallbackGrade) || SEAT_PRICES[fallbackGrade] || primaryPrice
    : null;

  return {
    event: defaultEventName,
    primary: { grade: primaryGrade, max_price_krw: primaryPrice },
    fallback_rules: fallbackGrade ? [{ grade: fallbackGrade, max_price_krw: fallbackPrice || primaryPrice }] : [],
    seat_count: seatCount,
    adjacency_required: /연석|연속|붙/.test(normalized),
    allow_split_seats: /각각|따로|한 자리씩|한자리씩/.test(normalized),
  };
}

function normalizeParsedCondition(parsed, originalText) {
  const fallback = fallbackParseCondition(originalText);
  const seatCount = Number(parsed.seat_count || fallback.seat_count || 1);
  const totalBudget = Number(parsed.max_total_budget_krw || parsed.total_budget_krw || 0);
  const textTotalBudget = extractTotalBudget(originalText.toUpperCase());
  const textFallbackBudget = extractFallbackBudget(originalText.toUpperCase());
  const primaryPrice = Number(parsed.primary?.max_price_krw || parsed.max_price_krw || 0);
  const fallbackRule = Array.isArray(parsed.fallback_rules) ? parsed.fallback_rules[0] : null;
  const perSeatFromTotal = totalBudget && seatCount ? Math.floor(totalBudget / seatCount) : 0;
  const perSeatFromTextTotal = textTotalBudget && seatCount ? Math.floor(textTotalBudget / seatCount) : 0;
  const perSeatFromTextFallback = textFallbackBudget && seatCount ? Math.floor(textFallbackBudget / seatCount) : 0;
  const primaryGrade = parsed.primary?.grade || parsed.preferred_grade || fallback.primary.grade;
  const firstFallbackGrade = fallbackRule?.grade || fallback.fallback_rules[0]?.grade;
  const primaryDefaultPrice = SEAT_PRICES[primaryGrade] || fallback.primary.max_price_krw || 0;
  const fallbackDefaultPrice = SEAT_PRICES[firstFallbackGrade] || fallback.fallback_rules[0]?.max_price_krw || 0;

  return {
    event: parsed.event || fallback.event,
    primary: {
      grade: primaryGrade,
      max_price_krw: perSeatFromTextTotal || perSeatFromTotal || primaryPrice || fallback.primary.max_price_krw || primaryDefaultPrice,
    },
    fallback_rules: firstFallbackGrade
      ? [
          {
            grade: firstFallbackGrade,
            max_price_krw:
              perSeatFromTextFallback ||
              Number(fallbackRule?.max_price_krw || 0) ||
              fallback.fallback_rules[0]?.max_price_krw ||
              fallbackDefaultPrice,
          },
        ]
      : [],
    seat_count: seatCount,
    adjacency_required: seatCount > 1 && Boolean(parsed.adjacency_required ?? fallback.adjacency_required),
    allow_split_seats: Boolean(parsed.allow_split_seats ?? fallback.allow_split_seats),
  };
}

function getOrCreateEvent(eventName) {
  const event = eventName || defaultEventName;
  if (!state.events[event]) {
    state.events[event] = {
      event,
      venue: "Demo Venue",
      sale_status: "OPEN",
      turn_index: 0,
      queue: [],
      seats: [],
      holds: [],
      orders: [],
      refunds: [],
    };
  }
  return state.events[event];
}

function publicSeatRows(eventState) {
  expireHolds(eventState);

  return eventState.seats.map((seat) => {
    const held = eventState.holds
      .filter((hold) => seat.zone_id
        ? hold.zone_id === seat.zone_id
        : hold.grade === seat.grade)
      .reduce((sum, hold) => sum + hold.count, 0);

    return {
      ...seat,
      held_count: held,
      sold_count: seat.zone_id
        ? seat.capacity - seat.count
        : soldCountForGrade(eventState, seat.grade),
      available_count: Math.max(seat.count - held, 0),
    };
  });
}

function soldCountForGrade(eventState, grade) {
  return eventState.orders
    .filter((order) => order.grade === grade)
    .reduce((sum, order) => sum + order.count, 0);
}

function seatStatusRows(eventState) {
  return publicSeatRows(eventState).flatMap((seat) => [
    {
      zone_id: seat.zone_id || null,
      grade: seat.grade,
      status: "AVAILABLE",
      count: seat.available_count,
      price_krw: seat.price_krw,
    },
    {
      zone_id: seat.zone_id || null,
      grade: seat.grade,
      status: "HELD",
      count: seat.held_count,
      price_krw: seat.price_krw,
    },
    {
      zone_id: seat.zone_id || null,
      grade: seat.grade,
      status: "SOLD",
      count: seat.sold_count,
      price_krw: seat.price_krw,
    },
  ]);
}

function findQueueEntry(eventState, query) {
  if (query.queue_id) {
    return eventState.queue.find((entry) => entry.queue_id === query.queue_id);
  }

  if (query.user_id) {
    return eventState.queue.find((entry) => entry.user_id === query.user_id);
  }

  return null;
}

function queueSnapshot(eventState, entry) {
  const index = eventState.queue.findIndex((item) => item.queue_id === entry.queue_id);
  const isTurn = index >= 0 && index < eventState.turn_index;
  const waitingAhead = Math.max(index - eventState.turn_index, 0);
  const turnsUntilEntry = Math.max(index - eventState.turn_index + 1, 0);

  return {
    queue_id: entry.queue_id,
    user_id: entry.user_id,
    event: eventState.event,
    status: entry.status,
    position: index + 1,
    current_turn: eventState.turn_index,
    waiting_ahead: waitingAhead,
    turns_until_entry: turnsUntilEntry,
    is_my_turn: isTurn && entry.status === "WAITING",
    joined_at: entry.joined_at,
    estimated_wait_ms: turnsUntilEntry * TURN_INTERVAL_MS,
  };
}

function chooseSeatNumbers(eventState, seat, count, adjacencyRequired) {
  if (!seat.available_numbers) return [];
  const held = new Set(eventState.holds
    .filter((hold) => hold.zone_id === seat.zone_id)
    .flatMap((hold) => hold.seat_numbers || []));
  const available = seat.available_numbers.filter((number) => !held.has(number));
  if (available.length < count) return null;
  for (let index = 0; index <= available.length - count; index += 1) {
    const run = available.slice(index, index + count);
    if (run[count - 1] - run[0] === count - 1) return run;
  }
  return adjacencyRequired ? null : available.slice(0, count);
}

function pickCatalogSeat(eventState, conditions) {
  const count = Number(conditions.seat_count);
  const rules = [conditions.primary, ...(conditions.fallback_rules || [])].filter(Boolean);
  const preferredZoneId = conditions.preferred_zone_id;
  const seats = publicSeatRows(eventState);
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    const candidates = seats
      .filter((seat) => seat.grade === rule.grade &&
        (!rule.zone_id || seat.zone_id === rule.zone_id) &&
        (!rule.avoid_restricted_view || !seat.restricted_view) &&
        seat.price_krw <= Number(rule.max_price_krw) &&
        seat.available_count >= count)
      .sort((a, b) => Number(b.zone_id === preferredZoneId) - Number(a.zone_id === preferredZoneId));
    for (const seat of candidates) {
      const seatNumbers = chooseSeatNumbers(
        eventState,
        seat,
        count,
        Boolean((rule.adjacency_required ?? conditions.adjacency_required) &&
          !(rule.allow_split_seats ?? conditions.allow_split_seats))
      );
      if (seatNumbers === null) continue;
      return {
        zone_id: seat.zone_id,
        zone_label: seat.label,
        seat_numbers: seatNumbers,
        grade: seat.grade,
        price_krw: seat.price_krw,
        count,
        restricted_view: Boolean(seat.restricted_view),
        adjacency_required: Boolean(rule.adjacency_required ?? conditions.adjacency_required),
        allow_split_seats: Boolean(rule.allow_split_seats ?? conditions.allow_split_seats),
        match_type: index === 0 ? "PRIMARY" : "FALLBACK",
        matched_rule_index: index,
      };
    }
  }
  return null;
}

function pickSeat(eventState, conditions = {}) {
  if (catalogBySession.has(eventState.event)) return pickCatalogSeat(eventState, conditions);
  const primary = conditions.primary;
  const fallbackRules = conditions.fallback_rules || [];
  const seatCount = Number(conditions.seat_count || 1);
  const orderedRules = [
    primary,
    ...fallbackRules,
  ].filter(Boolean);
  if (orderedRules.length === 0) {
    orderedRules.push({});
  }
  const availableRows = publicSeatRows(eventState);

  for (let index = 0; index < orderedRules.length; index += 1) {
    const rule = orderedRules[index];
    const seat = availableRows.find((row) => {
      const gradeMatches = !rule.grade || row.grade === rule.grade;
      const priceMatches = !rule.max_price_krw || row.price_krw <= rule.max_price_krw;
      return gradeMatches && priceMatches && row.available_count >= seatCount;
    });

    if (seat) {
      return {
        grade: seat.grade,
        price_krw: seat.price_krw,
        count: seatCount,
        match_type: index === 0 ? "PRIMARY" : "FALLBACK",
        matched_rule_index: index,
      };
    }
  }

  return null;
}

function explainNoOffer(eventState, conditions = {}) {
  if (catalogBySession.has(eventState.event)) {
    const count = Number(conditions.seat_count || 1);
    const details = [conditions.primary, ...(conditions.fallback_rules || [])]
      .filter(Boolean)
      .map((rule) => {
        const rows = publicSeatRows(eventState).filter((seat) =>
          seat.grade === rule.grade && (!rule.zone_id || seat.zone_id === rule.zone_id));
        const label = rows[0]?.label || rule.zone_id || rule.grade;
        if (!rows.length) return `${label} is not sold for this performance.`;
        if (rows.every((seat) => seat.price_krw > Number(rule.max_price_krw))) {
          return `${label} exceeds your price limit.`;
        }
        return `No ${label} zone has ${count} suitable ${count === 1 ? "seat" : "seats"} left together.`;
      });
    return details.join(" ") || "No seats match your conditions.";
  }
  const primary = conditions.primary;
  const fallbackRules = conditions.fallback_rules || [];
  const seatCount = Number(conditions.seat_count || 1);
  const rules = [primary, ...fallbackRules].filter(Boolean);
  const availableRows = publicSeatRows(eventState);

  if (rules.length === 0) {
    return "구매 조건이 비어 있고, 제안 가능한 좌석이 없습니다.";
  }

  const details = rules.map((rule, index) => {
    const label = index === 0 ? "1순위" : `대안 ${index}`;
    const seat = availableRows.find((row) => row.grade === rule.grade);

    if (!seat) {
      return `${label} ${rule.grade}석은 판매 목록에 없습니다.`;
    }

    if (seat.available_count < seatCount) {
      const shortage = seatCount - seat.available_count;
      return `${label} ${rule.grade}석: 요청 ${seatCount}매, 현재 재고 ${seat.available_count}매로 ${shortage}매 부족합니다.`;
    }

    if (rule.max_price_krw && seat.price_krw > rule.max_price_krw) {
      return `${label} ${rule.grade}석: 가격 ${seat.price_krw}원이 최대 허용 금액 ${rule.max_price_krw}원을 초과합니다.`;
    }

    return `${label} ${rule.grade}석은 조건을 만족하지 못했습니다.`;
  });

  return details.join(" ");
}

function expireHolds(eventState) {
  const now = Date.now();
  eventState.holds = eventState.holds.filter((hold) =>
    hold.expires_at_ms > now ||
    eventState.queue.some((entry) => entry.queue_id === hold.queue_id &&
      (entry.processing || entry.payment_unknown || entry.payment_wait_until > now))
  );
}

function createHold(eventState, queueEntry, seat) {
  const hold = {
    hold_id: makeId("hold"),
    queue_id: queueEntry.queue_id,
    user_id: queueEntry.user_id,
    event: eventState.event,
    grade: seat.grade,
    zone_id: seat.zone_id || null,
    zone_label: seat.zone_label || null,
    seat_numbers: seat.seat_numbers || [],
    price_krw: seat.price_krw,
    count: seat.count,
    restricted_view: Boolean(seat.restricted_view),
    adjacency_required: Boolean(seat.adjacency_required),
    allow_split_seats: Boolean(seat.allow_split_seats),
    match_type: seat.match_type,
    matched_rule_index: seat.matched_rule_index,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + HOLD_TTL_MS).toISOString(),
    expires_at_ms: Date.now() + HOLD_TTL_MS,
  };

  eventState.holds.push(hold);
  queueEntry.status = "OFFERED";
  queueEntry.offer = hold;
  return hold;
}

function createRefund(eventState, queueEntry, reason) {
  const existing = eventState.refunds.find(
    (refund) => refund.queue_id === queueEntry.queue_id && refund.status === "REFUND_PENDING"
  );
  if (existing) return existing;

  const refund = {
    refund_id: makeId("refund"),
    queue_id: queueEntry.queue_id,
    user_id: queueEntry.user_id,
    event: eventState.event,
    status: "REFUND_PENDING",
    reason,
    requested_at: nowIso(),
    refunded_at: null,
    refund_tx_hash: null,
  };

  eventState.refunds.push(refund);
  queueEntry.status = "REFUND_PENDING";
  queueEntry.refund = refund;
  return refund;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function confirmHold(eventState, hold, txHash) {
  const seat = eventState.seats.find((row) => hold.zone_id
    ? row.zone_id === hold.zone_id
    : row.grade === hold.grade);
  if (!seat || seat.count < hold.count) {
    throw httpError(409, "seat is no longer available");
  }

  if (seat.available_numbers &&
      !hold.seat_numbers.every((number) => seat.available_numbers.includes(number))) {
    throw httpError(409, "held seats are no longer available");
  }

  seat.count -= hold.count;
  if (seat.available_numbers) {
    const assigned = new Set(hold.seat_numbers);
    seat.available_numbers = seat.available_numbers.filter((number) => !assigned.has(number));
  }
  eventState.holds = eventState.holds.filter((item) => item.hold_id !== hold.hold_id);

  const entry = eventState.queue.find((item) => item.queue_id === hold.queue_id);
  if (entry) entry.status = txHash ? "SETTLED" : "PURCHASED";

  const order = {
    order_id: makeId("order"),
    event: eventState.event,
    user_id: hold.user_id,
    queue_id: hold.queue_id,
    grade: hold.grade,
    zone_id: hold.zone_id,
    zone_label: hold.zone_label,
    seat_numbers: hold.seat_numbers,
    price_krw: hold.price_krw,
    count: hold.count,
    status: txHash ? "SETTLED" : "PURCHASED",
    settlement_tx_hash: txHash || null,
    purchased_at: nowIso(),
    settled_at: txHash ? nowIso() : null,
  };
  eventState.orders.push(order);
  return order;
}

function markRefundCompleted(eventState, queueEntry, reason, txHash) {
  if (queueEntry.offer) {
    eventState.holds = eventState.holds.filter(
      (hold) => hold.hold_id !== queueEntry.offer.hold_id
    );
    queueEntry.offer = null;
  }

  const refund = createRefund(eventState, queueEntry, reason);
  refund.status = "REFUNDED";
  refund.refund_tx_hash = txHash || null;
  refund.refunded_at = nowIso();
  queueEntry.status = "REFUNDED";
  return refund;
}

async function callSettleServer(eventState, queueEntry, offeredSeat) {
  const headers = { "Content-Type": "application/json" };
  if (SETTLE_API_KEY) headers["x-api-key"] = SETTLE_API_KEY;
  const payment = queueEntry.agent_payment;
  if (payment?.signature) headers["PAYMENT-SIGNATURE"] = payment.signature;
  if (payment?.signature) queueEntry.payment_unknown = true;

  let response;
  try {
    response = await fetch(`${SETTLE_SERVER_URL}${payment ? "/x402/settle" : "/settle"}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: queueEntry.user_id,
        event: eventState.event,
        user_conditions: queueEntry.conditions || {},
        offered_seat: offeredSeat,
        ...(payment ? { payer: payment.payer, queue_id: queueEntry.queue_id } : {}),
      }),
    });
  } catch (error) {
    if (payment?.signature) queueEntry.payment_unknown = true;
    throw error;
  }

  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (error) {
    body = { raw: bodyText };
  }

  if (!response.ok) {
    const message = body.error || `settle-server returned ${response.status}`;
    const error = httpError(response.status === 402 ? 402 : 502, message);
    error.paymentRequired = response.headers.get("PAYMENT-REQUIRED");
    error.paymentBody = body;
    if (payment && ["READY", "PREPARING"].includes(body.payment_status)) queueEntry.payment_unknown = false;
    if (payment && body.payment_status === "REJECTED_UNFUNDED" && !body.fund_tx) {
      queueEntry.payment_unknown = false;
      queueEntry.payment_rejected_unfunded = true;
    }
    throw error;
  }
  if (payment) {
    queueEntry.payment_response = response.headers.get("PAYMENT-RESPONSE");
    queueEntry.payment_wait_until = 0;
  }

  if (!["SETTLE_PRIMARY", "SETTLE_FALLBACK", "REFUND"].includes(body.final_decision) ||
      !body.fund_tx || !body.settle_tx) {
    throw httpError(502, "settle-server returned an incomplete settlement result");
  }
  if (payment) queueEntry.payment_unknown = false;

  return body;
}

function advanceTurns() {
  const now = Date.now();

  for (const eventState of Object.values(state.events)) {
    if (eventState.sale_status !== "OPEN") continue;

    if (!eventState.last_turn_advance_ms) {
      eventState.last_turn_advance_ms = now;
    }

    const elapsed = now - eventState.last_turn_advance_ms;
    const steps = Math.floor(elapsed / TURN_INTERVAL_MS);
    if (steps <= 0) continue;

    eventState.turn_index = Math.min(
      eventState.turn_index + steps,
      eventState.queue.length
    );
    eventState.last_turn_advance_ms += steps * TURN_INTERVAL_MS;
  }
}

setInterval(advanceTurns, 1000).unref();

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "fairqueue-platform-sim", time: nowIso() });
});

app.get("/catalog/events", (req, res) => {
  res.json({
    events: catalog.map((event) => ({
      id: event.id,
      title: event.title,
      subtitle: event.subtitle,
      genre: event.genre,
      venue: event.venue,
      saleOpens: event.saleOpens,
      maxTickets: event.maxTickets,
      status: Date.now() >= new Date(event.saleOpens).getTime() ? "ON_SALE" : "OPENING_SOON",
      sessions: event.sessions.map((session) => {
        const rows = publicSeatRows(state.events[session.id]);
        const remaining = rows.reduce((sum, row) => sum + row.available_count, 0);
        return {
          id: session.id,
          date: session.date,
          time: session.time,
          status: !sessionIsOnSale(session.id)
            ? (session.status === "SOLD_OUT" ? "SOLD_OUT" : "OPENING_SOON")
            : remaining === 0 ? "SOLD_OUT" : session.status,
          zones: rows.map((row) => ({
            id: row.zone_id,
            label: row.label,
            grade: row.grade,
            view: session.zones.find((zone) => zone.id === row.zone_id)?.view,
            remaining: row.available_count,
            price: row.price_krw,
          })),
        };
      }),
    })),
  });
});

async function walletService(req, res, endpoint) {
  try {
    const url = new URL(`/x402/${endpoint}`, SETTLE_SERVER_URL);
    if (endpoint === "balance") url.searchParams.set("address", String(req.query.address || ""));
    const response = await fetch(url, { headers: SETTLE_API_KEY ? { "x-api-key": SETTLE_API_KEY } : {}, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (endpoint === "config") data.enabled = Boolean(data.enabled && process.env.X402_ESCROW_ENABLED === "true");
    res.setHeader("Cache-Control", "no-store");
    res.status(response.status).json(data);
  } catch { res.status(503).json({ error: "The Devnet wallet service is unavailable. Check the settlement server connection." }); }
}
app.get("/wallet/config", (req, res) => walletService(req, res, "config"));
app.get("/wallet/balance", (req, res) => walletService(req, res, "balance"));

app.post("/parse-condition", async (req, res) => {
  const text = String(req.body.text || "").trim();
  const controlsOnly = req.body.mode === "controls";
  if (!text && !controlsOnly) {
    return res.status(400).json({ error: "text is required" });
  }

  if (req.body.session_id) {
    const record = catalogBySession.get(req.body.session_id);
    if (!record) return res.status(404).json({ error: "Performance not found" });
    const defaults = req.body.defaults || {};
    let fallback;
    try {
      fallback = catalogCondition(text, record, {}, defaults);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    if (controlsOnly) return res.json({ source: "controls", parsed: fallback });
    if (!genAI) return res.status(503).json({ error: "Natural-language interpretation is unavailable. Select your conditions using the controls, or try again later." });
    try {
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { responseMimeType: "application/json", responseSchema: conditionSchema, temperature: 0.1 },
      });
      const grades = [...new Set(record.session.zones.map((zone) => zone.grade))];
      const zones = record.session.zones.map((zone) => ({
        label: zone.label,
        id: zone.id,
        grade: zone.grade,
        price_krw: zone.price,
        restricted_view: Boolean(zone.restrictedView),
      }));
      const prompt = `You parse Korean or English ticket-booking requests into ordered, executable conditions.
Event: ${record.event.title}
Valid grades: ${grades.join(", ")}
Valid sections: ${JSON.stringify(zones)}
Maximum tickets: ${record.event.maxTickets}

Return JSON only:
{
  "primary": {
    "grade": "valid grade",
    "zone_id": "valid section id or null",
    "max_price_krw": "number or null",
    "adjacency_required": "boolean",
    "allow_split_seats": "boolean",
    "avoid_restricted_view": "boolean"
  },
  "fallback_rules": ["zero or more rules with the same fields, in the user's stated order"],
  "fallback_policy": "inherit_controls or explicit",
  "seat_count": "integer",
  "needs_clarification": "boolean",
  "clarification_question": "short question in the user's language, or null"
}

Rules:
- A section such as VIP A is more specific than a grade such as VIP. Never invent grades or section IDs.
- Prices are per ticket. Divide an explicitly stated total budget by seat_count.
- If no price is stated, use null; the server applies face value.
- Keep alternatives in the exact order stated by the user.
- Placement policy belongs to each rule. "Adjacent/consecutive/연석/연속" means adjacency_required=true.
- "Separate/split/각각/따로/한 좌석씩" means allow_split_seats=true for that alternative.
- "Avoid restricted/obstructed view/시야제한석을 피해서" means avoid_restricted_view=true for every applicable rule.
- If an essential grade or quantity cannot be determined, set needs_clarification=true instead of guessing.

Selected controls (use only for details omitted from the request): ${JSON.stringify(defaults)}
- Explicit natural-language conditions override controls. An explicit refusal of alternatives means fallback_rules=[].
- If the request does not discuss alternatives, set fallback_policy="inherit_controls". The server retains the buyer's selected alternative controls, even if fallback_rules=[].
- If the request specifies alternatives or explicitly rejects them (including "R seats only" or "no alternatives"), set fallback_policy="explicit" and include only those authorized alternatives.
- Example: text "Find 2 adjacent R seats" plus selected alternative S means primary R and alternative S. Do not discard S merely because the text omitted it.
- Example: text "Find 2 adjacent R seats only, no alternatives" plus selected alternative S means primary R and no alternative.
- Never add split seats, another grade, or a fallback that the buyer did not authorize.
- The example below is illustrative only, not a default policy.
Example request: Avoid restricted-view seats. Book 2 adjacent VIP seats. If unavailable, accept 2 separate VIP seats; if that also fails, try 2 adjacent R seats.
Example interpretation: primary VIP adjacent; fallback 1 VIP split allowed; fallback 2 R adjacent; all avoid restricted view.

Buyer request: ${text}`;
      const result = await model.generateContent(prompt, { timeout: 15000 });
      const parsed = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());
      if (parsed.needs_clarification) {
        return res.status(422).json({
          error: parsed.clarification_question || "Please clarify your seat grade and ticket quantity.",
          needs_clarification: true,
        });
      }
      return res.json({
        source: "gemini",
        model: GEMINI_MODEL,
        parsed: catalogCondition(text, record, parsed, defaults),
      });
    } catch (error) {
      console.warn(`[parse-condition] Gemini unavailable for ${record.session.id}: ${error.message}`);
      return res.status(503).json({ error: "Gemini could not interpret the request. Your conditions have not been submitted. Try again or use the controls." });
    }
  }

  const fallback = fallbackParseCondition(text);

  if (!genAI) {
    return res.json({
      source: "fallback",
      reason: "GEMINI_API_KEY is not configured",
      parsed: fallback,
    });
  }

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const prompt = `
너는 공식 티켓팅 조건 파싱 엔진이다.
사용자 자연어 요청을 FairQueue가 실행할 수 있는 JSON으로 구조화해라.

좌석 등급은 반드시 "VIP", "R", "S" 중 하나로만 써라.
가격은 원화 숫자만 써라.
"40만원까지 예산", "총 40만원"처럼 총예산 표현이면 seat_count로 나눈 1장당 최대 가격을 primary.max_price_krw에 넣어라.
대안 좌석이 있으면 fallback_rules[0]에 넣어라.
대안 좌석의 예산이 따로 있으면 fallback_rules[0].max_price_krw에는 대안 총예산을 seat_count로 나눈 1장당 최대 가격을 넣어라.
예: "VIP 5연석, 총 130만원. R석은 100만원까지만"이면 primary.max_price_krw=260000, fallback_rules[0].max_price_krw=200000.
사용자가 예산 또는 가격 상한을 말하지 않았다면 max_price_krw는 null로 둬라. 공연장 정상가는 서버가 나중에 적용한다.
사용자가 "정상가", "좌석 가격"을 말하지 않았다면 공연장 정상가를 예산으로 추정하지 마라.
사용자 요청에 명시된 예산이 좌석 실제 가격보다 우선한다.
"각각 한 자리씩", "따로 잡아도 됨" 표현은 allow_split_seats=true로 둔다.

출력은 아래 JSON 형식으로만 해라. 설명이나 markdown은 쓰지 마라.
{
  "event": "IU Concert",
  "primary": { "grade": "VIP", "max_price_krw": 200000 },
  "fallback_rules": [{ "grade": "R", "max_price_krw": 200000 }],
  "seat_count": 2,
  "adjacency_required": true,
  "allow_split_seats": true
}

사용자 요청:
${text}
`;
    const result = await model.generateContent(prompt);
    const cleaned = result.response.text().replace(/```json|```/g, "").trim();
    const parsed = normalizeParsedCondition(JSON.parse(cleaned), text);

    res.json({
      source: "gemini",
      model: GEMINI_MODEL,
      parsed,
      raw: cleaned,
    });
  } catch (error) {
    console.warn(`[parse-condition] Gemini failed, fallback parser used: ${error.message}`);
    res.json({
      source: "fallback",
      reason: error.message,
      parsed: fallback,
    });
  }
});

app.get("/events", (req, res) => {
  advanceTurns();
  res.json({
    events: Object.values(state.events).map((eventState) => ({
      event: eventState.event,
      venue: eventState.venue,
      sale_status: eventState.sale_status,
      queue_size: eventState.queue.length,
      current_turn: eventState.turn_index,
      order_count: eventState.orders.length,
      refund_pending_count: eventState.refunds.filter((refund) => refund.status === "REFUND_PENDING").length,
      refunded_count: eventState.refunds.filter((refund) => refund.status === "REFUNDED").length,
      seats: publicSeatRows(eventState),
      seat_statuses: seatStatusRows(eventState),
    })),
  });
});

app.get("/seats/status", (req, res) => {
  const eventState = getOrCreateEvent(req.query.event);
  res.json({
    event: eventState.event,
    sale_status: eventState.sale_status,
    availableSeats: publicSeatRows(eventState),
    seats: publicSeatRows(eventState),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.get("/seats/:event", (req, res) => {
  const eventState = getOrCreateEvent(decodeURIComponent(req.params.event));
  res.json({
    event: eventState.event,
    availableSeats: publicSeatRows(eventState).map(({ grade, price_krw, available_count }) => ({
      grade,
      price_krw,
      count: available_count,
    })),
  });
});

app.post("/seats/:event", (req, res) => {
  if (catalogBySession.has(req.params.event)) {
    return res.status(403).json({ error: "Catalog inventory cannot be edited from this endpoint" });
  }
  const eventState = getOrCreateEvent(decodeURIComponent(req.params.event));
  eventState.seats = (req.body.availableSeats || []).map((seat) => ({
    grade: seat.grade,
    price_krw: Number(seat.price_krw),
    count: Number(seat.count || seat.available_count || 0),
  }));
  eventState.holds = [];
  res.json({
    event: eventState.event,
    availableSeats: publicSeatRows(eventState),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.post("/queue/join", (req, res) => {
  advanceTurns();

  const { user_id, event, conditions } = req.body;
  if (!user_id || !event) {
    return res.status(400).json({ error: "user_id and event are required" });
  }

  const catalogRecord = catalogBySession.get(event);
  if (catalogRecord) {
    if (!sessionIsOnSale(event)) {
      return res.status(409).json({ error: "Tickets are not on sale for this performance" });
    }
    const count = Number(conditions?.seat_count);
    const grades = new Set(catalogRecord.session.zones.map((zone) => zone.grade));
    const fallbacks = Array.isArray(conditions?.fallback_rules) ? conditions.fallback_rules : [];
    const rules = [conditions?.primary, ...fallbacks];
    const validRules = rules.length > 0 && rules.every((rule) =>
      rule && grades.has(rule.grade) &&
      (!rule.zone_id || catalogRecord.session.zones.some((zone) =>
        zone.id === rule.zone_id && zone.grade === rule.grade)) &&
      Number.isFinite(Number(rule.max_price_krw)) && Number(rule.max_price_krw) > 0);
    const preferredZoneValid = !conditions?.preferred_zone_id ||
      catalogRecord.session.zones.some((zone) => zone.id === conditions.preferred_zone_id);
    if (!Number.isInteger(count) || count < 1 || count > catalogRecord.event.maxTickets ||
        !validRules || !preferredZoneValid) {
      return res.status(400).json({ error: "Invalid seat conditions for this performance" });
    }
  } else if (event !== defaultEventName) {
    return res.status(404).json({ error: "Performance not found" });
  }

  const eventState = getOrCreateEvent(event);
  const existing = eventState.queue.find(
    (entry) => entry.user_id === user_id && ["WAITING", "OFFERED", "REFUND_PENDING"].includes(entry.status)
  );

  if (existing) {
    return res.json({ already_joined: true, ...queueSnapshot(eventState, existing) });
  }

  const entry = {
    queue_id: makeId("queue"),
    user_id,
    conditions: conditions || {},
    status: "WAITING",
    joined_at: nowIso(),
    offer: null,
  };

  eventState.queue.push(entry);
  res.status(201).json(queueSnapshot(eventState, entry));
});

app.get("/queue/my-turn", (req, res) => {
  advanceTurns();

  const eventState = getOrCreateEvent(req.query.event);
  const entry = findQueueEntry(eventState, req.query);
  if (!entry) {
    return res.status(404).json({ error: "queue entry not found" });
  }

  res.json(queueSnapshot(eventState, entry));
});

app.get("/queue/result", (req, res) => {
  const eventState = getOrCreateEvent(req.query.event);
  const entry = findQueueEntry(eventState, req.query);
  if (!entry) return res.status(404).json({ error: "Queue entry not found" });
  if (entry.agent_payment?.payer && entry.agent_payment.payer !== req.query.payer) return res.status(403).json({ error: "Reconnect the payer wallet for this booking" });
  res.json({ status: entry.status, payment_unknown: Boolean(entry.payment_unknown), payment_rejected_unfunded: Boolean(entry.payment_rejected_unfunded), result: entry.completed_result || null });
});

app.post("/queue/cancel", async (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  const entry = findQueueEntry(eventState, req.body);
  if (!entry) return res.status(404).json({ error: "Queue entry not found" });
  if (entry.processing || entry.payment_unknown || ["SETTLED", "PURCHASED", "REFUNDED"].includes(entry.status)) return res.status(409).json({ error: "Check the existing payment; it cannot be cancelled here" });
  if (entry.agent_payment) {
    if (req.body.payer !== entry.agent_payment.payer) return res.status(403).json({ error: "Reconnect the payer wallet" });
    entry.processing = true;
    try {
      const response = await fetch(`${SETTLE_SERVER_URL}/x402/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": SETTLE_API_KEY },
        body: JSON.stringify({ event: entry.event || eventState.event, queue_id: entry.queue_id, payer: entry.agent_payment.payer }),
      });
      if (!response.ok) return res.status(409).json({ error: "The payment could not be cancelled. Check its existing status." });
    } catch { return res.status(503).json({ error: "The payment service is unavailable; cancellation is not confirmed" }); }
    finally { entry.processing = false; }
  }
  eventState.holds = eventState.holds.filter(hold => hold.queue_id !== entry.queue_id);
  entry.offer = null; entry.status = "CANCELLED";
  res.json({ cancelled: true });
});

app.post("/queue/advance", (req, res) => {
  if (catalogBySession.has(req.body.event)) {
    return res.status(403).json({ error: "Queue turns advance automatically for catalog events" });
  }
  const eventState = getOrCreateEvent(req.body.event);
  const count = Number(req.body.count || 1);
  eventState.turn_index = Math.min(eventState.turn_index + count, eventState.queue.length);
  eventState.last_turn_advance_ms = Date.now();

  res.json({
    event: eventState.event,
    current_turn: eventState.turn_index,
    queue_size: eventState.queue.length,
  });
});

app.post("/queue/offer", (req, res) => {
  if (catalogBySession.has(req.body.event)) {
    return res.status(403).json({ error: "Catalog offers are processed through settlement" });
  }
  advanceTurns();

  const eventState = getOrCreateEvent(req.body.event);
  const entry = findQueueEntry(eventState, req.body);
  if (!entry) {
    return res.status(404).json({ error: "queue entry not found" });
  }

  const snapshot = queueSnapshot(eventState, entry);
  if (!snapshot.is_my_turn && entry.status !== "OFFERED") {
    return res.status(409).json({ error: "not your turn yet", queue: snapshot });
  }

  if (entry.offer) {
    return res.json({ event: eventState.event, offered_seat: entry.offer, queue: snapshot });
  }

  const offeredSeat = pickSeat(eventState, entry.conditions);
  if (!offeredSeat) {
    const reason = explainNoOffer(eventState, entry.conditions);
    const refund = createRefund(
      eventState,
      entry,
      reason
    );
    return res.json({
      event: eventState.event,
      offered_seat: null,
      refund,
      reason: refund.reason,
      queue: queueSnapshot(eventState, entry),
    });
  }

  const hold = createHold(eventState, entry, offeredSeat);
  res.status(201).json({
    event: eventState.event,
    offered_seat: hold,
    queue: queueSnapshot(eventState, entry),
  });
});

app.post("/purchase/confirm", (req, res) => {
  if (catalogBySession.has(req.body.event)) {
    return res.status(403).json({ error: "Catalog purchases require settlement" });
  }
  const eventState = getOrCreateEvent(req.body.event);
  expireHolds(eventState);

  const hold = eventState.holds.find((item) => item.hold_id === req.body.hold_id);
  if (!hold) {
    return res.status(404).json({ error: "hold not found or expired" });
  }

  try {
    const order = confirmHold(eventState, hold, req.body.tx_hash);
    res.status(201).json({
      order,
      remainingSeats: publicSeatRows(eventState),
      seat_statuses: seatStatusRows(eventState),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/settlement/mark-paid", (req, res) => {
  const eventState = getOrCreateEvent(req.body.event);
  const order = eventState.orders.find(
    (item) => item.order_id === req.body.order_id || item.queue_id === req.body.queue_id
  );

  if (!order) {
    return res.status(404).json({ error: "order not found" });
  }

  order.status = "SETTLED";
  order.settlement_tx_hash = req.body.tx_hash || order.settlement_tx_hash;
  order.settled_at = nowIso();

  res.json({ order });
});

app.post("/refund/request", (req, res) => {
  if (catalogBySession.has(req.body.event)) {
    return res.status(403).json({ error: "Catalog refunds are processed through settlement" });
  }
  const eventState = getOrCreateEvent(req.body.event);
  const entry = findQueueEntry(eventState, req.body);
  if (!entry) {
    return res.status(404).json({ error: "queue entry not found" });
  }

  if (entry.offer) {
    eventState.holds = eventState.holds.filter(
      (hold) => hold.hold_id !== entry.offer.hold_id
    );
    entry.offer = null;
  }

  const refund = createRefund(
    eventState,
    entry,
    req.body.reason || "Payment failed or user conditions were not satisfied"
  );

  res.status(201).json({
    refund,
    queue: queueSnapshot(eventState, entry),
    seat_statuses: seatStatusRows(eventState),
  });
});

app.post("/refund/mark-refunded", (req, res) => {
  if (catalogBySession.has(req.body.event)) {
    return res.status(403).json({ error: "Catalog refunds require settlement" });
  }
  const eventState = getOrCreateEvent(req.body.event);
  const refund = eventState.refunds.find(
    (item) => item.refund_id === req.body.refund_id || item.queue_id === req.body.queue_id
  );

  if (!refund) {
    return res.status(404).json({ error: "refund not found" });
  }

  refund.status = "REFUNDED";
  refund.refund_tx_hash = req.body.tx_hash || null;
  refund.refunded_at = nowIso();

  const entry = eventState.queue.find((item) => item.queue_id === refund.queue_id);
  if (entry) entry.status = "REFUNDED";

  res.json({
    refund,
    queue: entry ? queueSnapshot(eventState, entry) : null,
  });
});

app.post("/demo/settle-offer", async (req, res) => {
  let activeEntry = null;
  try {
    advanceTurns();

    const eventState = getOrCreateEvent(req.body.event);
    expireHolds(eventState);

    const entry = findQueueEntry(eventState, req.body);
    if (!entry) {
      return res.status(404).json({ error: "queue entry not found" });
    }

    if (["PURCHASED", "SETTLED", "REFUNDED"].includes(entry.status)) {
      return res.status(409).json({
        error: "queue entry already finalized",
        queue: queueSnapshot(eventState, entry),
      });
    }
    if (entry.processing) {
      return res.status(409).json({ error: "settlement is already in progress" });
    }
    if (entry.payment_unknown) return res.status(409).json({ error: "Payment requires reconciliation. Do not pay again." });
    if (req.body.payment_mode === "x402") {
      if (process.env.X402_ESCROW_ENABLED !== "true") return res.status(409).json({ error: "x402 escrow experiment is disabled" });
      if (!req.body.payer) return res.status(400).json({ error: "A buyer-authorized payer wallet is required" });
      if (entry.agent_payment && entry.agent_payment.payer !== req.body.payer) return res.status(409).json({ error: "This queue entry is already bound to another payer" });
      entry.agent_payment = { payer: req.body.payer, signature: req.get("PAYMENT-SIGNATURE") || null };
    } else if (entry.agent_payment) {
      return res.status(409).json({ error: "Continue this entry with its authorized x402 payment" });
    }

    if (entry.offer) {
      const activeHold = eventState.holds.find((hold) => hold.hold_id === entry.offer.hold_id);
      if (!activeHold) {
        entry.offer = null;
        entry.status = "WAITING";
      }
    }

    let snapshot = queueSnapshot(eventState, entry);
    if (!snapshot.is_my_turn && !["OFFERED", "REFUND_PENDING"].includes(entry.status)) {
      return res.status(409).json({ error: "not your turn yet", queue: snapshot });
    }
    entry.processing = true;
    activeEntry = entry;

    let hold = entry.offer;
    if (!hold) {
      const offeredSeat = pickSeat(eventState, entry.conditions);
      if (offeredSeat) {
        hold = createHold(eventState, entry, offeredSeat);
      } else {
        const reason = explainNoOffer(eventState, entry.conditions);
        createRefund(eventState, entry, reason);
        const settleResult = await callSettleServer(eventState, entry, null);
        const refund = markRefundCompleted(
          eventState,
          entry,
          reason,
          settleResult.settle_tx
        );
        if (entry.payment_response) res.setHeader("PAYMENT-RESPONSE", entry.payment_response);

        entry.completed_result = {
          event: eventState.event,
          queue: queueSnapshot(eventState, entry),
          offered_seat: null,
          refund,
          settle_result: settleResult,
          seat_statuses: seatStatusRows(eventState),
        };
        return res.status(201).json(entry.completed_result);
      }
    }

    const settleResult = await callSettleServer(eventState, entry, hold);

    if (settleResult.final_decision === "REFUND") {
      const refund = markRefundCompleted(
        eventState,
        entry,
        settleResult.verify_note || "Settle server decided to refund",
        settleResult.settle_tx
      );
      if (entry.payment_response) res.setHeader("PAYMENT-RESPONSE", entry.payment_response);

      entry.completed_result = {
        event: eventState.event,
        queue: queueSnapshot(eventState, entry),
        offered_seat: null,
        refund,
        settle_result: settleResult,
        seat_statuses: seatStatusRows(eventState),
      };
      return res.status(201).json(entry.completed_result);
    }

    const order = confirmHold(eventState, hold, settleResult.settle_tx);
    if (entry.payment_response) res.setHeader("PAYMENT-RESPONSE", entry.payment_response);
    entry.completed_result = {
      event: eventState.event,
      queue: queueSnapshot(eventState, entry),
      offered_seat: hold,
      order,
      settle_result: settleResult,
      remainingSeats: publicSeatRows(eventState),
      seat_statuses: seatStatusRows(eventState),
    };
    res.status(201).json(entry.completed_result);
  } catch (error) {
    if (error.paymentRequired) {
      res.setHeader("PAYMENT-REQUIRED", error.paymentRequired);
      if (activeEntry) activeEntry.payment_wait_until = error.paymentBody.accepts?.[0]?.extra?.expires_at || 0;
      return res.status(402).json(error.paymentBody);
    }
    res.status(error.status || 500).json({ error: error.message, payment_rejected_unfunded: Boolean(activeEntry?.payment_rejected_unfunded) });
  } finally {
    if (activeEntry) activeEntry.processing = false;
  }
});

app.post("/admin/scenario", (req, res) => {
  if (catalogBySession.has(req.body.event)) {
    return res.status(403).json({ error: "Catalog sessions cannot be reset from this endpoint" });
  }
  const eventState = getOrCreateEvent(req.body.event || defaultEventName);
  eventState.sale_status = req.body.sale_status || "OPEN";
  eventState.turn_index = Number(req.body.turn_index || 0);
  eventState.last_turn_advance_ms = Date.now();
  eventState.queue = [];
  eventState.holds = [];
  eventState.orders = [];
  eventState.refunds = [];
  eventState.seats = (req.body.seats || eventState.seats).map((seat) => ({
    grade: seat.grade,
    price_krw: Number(seat.price_krw),
    count: Number(seat.count || 0),
  }));

  res.json({
    event: eventState.event,
    sale_status: eventState.sale_status,
    seats: publicSeatRows(eventState),
    seat_statuses: seatStatusRows(eventState),
  });
});

if (require.main === module) app.listen(PORT, () => {
  console.log(`FairQueue platform simulator running on http://localhost:${PORT}`);
  console.log("GET  /health");
  console.log("GET  /events");
  console.log("GET  /seats/status?event=IU%20Concert");
  console.log("POST /queue/join");
  console.log("GET  /queue/my-turn?event=IU%20Concert&queue_id=...");
  console.log("POST /queue/offer");
  console.log("POST /purchase/confirm");
  console.log("POST /settlement/mark-paid");
  console.log("POST /demo/settle-offer");
  console.log("POST /refund/request");
  console.log("POST /refund/mark-refunded");
});

module.exports = { app, state, sessionIsOnSale, catalogCondition, catalogBySession, pickCatalogSeat, createHold, expireHolds };
