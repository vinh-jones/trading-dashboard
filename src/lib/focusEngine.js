import { calcDTE } from "./trading";
import { getVixBand } from "./vixBand";
import { formatExpiry } from "./format";

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// Builds the OCC symbol used as the key in quoteMap for option lookups.
// Mirrors the same function in api/quotes.js — kept in sync manually.
function buildOccSymbol(ticker, expiryIso, isCall, strike) {
  const [y, m, d] = expiryIso.split("-");
  const expiry = y.slice(2) + m + d;
  const side = isCall ? "C" : "P";
  const strikePadded = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return `${ticker}${expiry}${side}${strikePadded}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Build a lookup map from marketContext.positions: { TICKER -> positionEntry }
function buildEarningsMap(marketContext) {
  if (!marketContext?.positions) return {};
  const map = {};
  for (const p of marketContext.positions) {
    if (p.nextEarnings?.date) map[p.ticker] = p.nextEarnings;
  }
  return map;
}

// Deduplicate macro events by eventType, keeping the soonest upcoming one per type
function getUpcomingMacroEvents(marketContext) {
  if (!marketContext?.macroEvents) return [];
  const todayStr = today();
  const byType = {};
  for (const evt of marketContext.macroEvents) {
    const evtDate = evt.dateTime.slice(0, 10);
    if (evtDate < todayStr) continue; // already passed
    if (!byType[evt.eventType] || evtDate < byType[evt.eventType].date) {
      byType[evt.eventType] = { ...evt, date: evtDate };
    }
  }
  return Object.values(byType);
}

// ── Rule implementations ─────────────────────────────────────────────────────

function ruleCashBelowFloor(account) {
  const items = [];
  if (!account?.vix_current || account.free_cash_pct_est == null) return items;
  const band = getVixBand(account.vix_current);
  if (!band) return items;
  const cashPct = account.free_cash_pct_est; // already a fraction (e.g. 0.059)
  if (cashPct < band.floorPct) {
    const cashDisplay  = Math.round(cashPct * 100);
    const floorDisplay = Math.round(band.floorPct * 100);
    items.push({
      id:       "cash-below-floor",
      priority: "P1",
      rule:     "cash_below_floor",
      ticker:   null,
      dte:      null,
      urgency:  0,
      title:    `Cash ${cashDisplay}% — below VIX band floor (${floorDisplay}%)`,
      detail:   `VIX ${account.vix_current} puts your cash floor at ${floorDisplay}–${Math.round(band.ceilingPct * 100)}%. Current free cash is ${cashDisplay}%. Consider reducing deployed capital or avoiding new positions.`,
    });
  }
  return items;
}

function ruleExpiringSoon(positions) {
  const items = [];
  const options = [];

  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc) options.push({ ...s.active_cc, _category: "cc" });
  }
  for (const csp of positions.open_csps ?? []) {
    options.push({ ...csp, _category: "csp" });
  }

  for (const opt of options) {
    const dte = calcDTE(opt.expiry_date);
    if (dte == null || dte > 5) continue;
    const priority = dte <= 2 ? "P1" : "P2";
    const dteLabel = dte === 0 ? "today" : dte === 1 ? "tomorrow" : `${dte}d`;
    const typeLabel = opt.type === "CC" ? "CC" : "CSP";
    items.push({
      id:       `expiring-${opt.type}-${opt.ticker}-${opt.expiry_date}`,
      priority,
      rule:     "expiring_soon",
      ticker:   opt.ticker,
      dte,
      urgency:  dte,
      title:    `${opt.ticker} ${typeLabel} $${opt.strike} expires ${dteLabel}`,
      detail:   `${opt.contracts} contract${opt.contracts !== 1 ? "s" : ""}, $${opt.premium_collected} premium collected. Expiry: ${formatExpiry(opt.expiry_date)}.`,
    });
  }
  return items;
}

function ruleUncoveredShares(positions, quoteMap) {
  const items = [];
  for (const s of positions.assigned_shares ?? []) {
    if (!s.active_cc) {
      const totalShares = s.positions?.reduce((sum, lot) => {
        const m = lot.description?.match(/\((\d[\d,]*)[,\s]/);
        return sum + (m ? parseInt(m[1].replace(/,/g, ""), 10) : 0);
      }, 0) ?? 0;

      const quote = quoteMap.get(s.ticker);
      const ivRank = quote?.iv_rank ?? null;
      const iv     = quote?.iv     ?? null;

      let ivGuidance, ivDisplay;
      if (ivRank != null) {
        ivDisplay = `IV rank ${ivRank.toFixed(0)}`;
        if (ivRank >= 50)      ivGuidance = "favorable";
        else if (ivRank >= 25) ivGuidance = "moderate";
        else                   ivGuidance = "unfavorable";
      } else if (iv != null) {
        ivDisplay = `IV ${(iv * 100).toFixed(0)}%`;
        if (iv >= 0.45)      ivGuidance = "favorable";
        else if (iv >= 0.25) ivGuidance = "moderate";
        else                 ivGuidance = "unfavorable";
      } else {
        ivDisplay  = null;
        ivGuidance = "unknown";
      }

      const guidanceText = {
        favorable:   "IV elevated — good window to write CC.",
        moderate:    "IV moderate — acceptable conditions for CC.",
        unfavorable: "IV low — consider waiting for better premium.",
        unknown:     null,
      }[ivGuidance];

      const costBasis  = s.cost_basis_total ?? 0;
      const ivSuffix   = ivDisplay && guidanceText
        ? ` ${ivDisplay}. ${guidanceText}`
        : ivDisplay
        ? ` ${ivDisplay}.`
        : "";

      items.push({
        id:       `uncovered-${s.ticker}`,
        priority: "P1",
        rule:     "uncovered_shares",
        ticker:   s.ticker,
        dte:      null,
        urgency:  5,
        title:    `${s.ticker} — shares uncovered${totalShares ? ` (${totalShares})` : ""}`,
        detail:   `No active covered call on ${s.ticker}. Cost basis: $${costBasis.toLocaleString()}.${ivSuffix}`,
      });
    }
  }
  return items;
}

function ruleCCDeeplyITM(positions, quoteMap) {
  const items = [];
  for (const s of positions.assigned_shares ?? []) {
    const cc = s.active_cc;
    if (!cc || cc.delta == null) continue;

    const stockPrice = quoteMap.get(s.ticker)?.mid;
    if (!stockPrice) continue;

    if (stockPrice <= cc.strike) continue;

    const entryDelta = Math.abs(cc.delta);
    let threshold;
    if (entryDelta < 0.15)       threshold = 0.02;
    else if (entryDelta <= 0.25) threshold = 0.04;
    else                         threshold = 0.07;

    const itmPct = (stockPrice - cc.strike) / cc.strike;
    if (itmPct < threshold) continue;

    const daysToExpiry = calcDTE(cc.expiry_date) ?? 0;
    const priority     = daysToExpiry <= 7 ? "P1" : "P2";
    const itmPctDisplay   = (itmPct * 100).toFixed(1);
    const thresholdDisplay = (threshold * 100).toFixed(0);

    items.push({
      id:       `cc-itm-${s.ticker}`,
      priority,
      rule:     "cc_deeply_itm",
      ticker:   s.ticker,
      dte:      daysToExpiry,
      urgency:  daysToExpiry,
      title:    `${s.ticker} CC $${cc.strike} — stock ${itmPctDisplay}% ITM`,
      detail:   `Stock at $${stockPrice.toFixed(2)} vs strike $${cc.strike}. `
        + `Opened at ${(entryDelta * 100).toFixed(0)}δ (threshold: ${thresholdDisplay}%). `
        + `${daysToExpiry}d to expiry. Review roll or assignment plan.`,
    });
  }
  return items;
}

function ruleCSPITMUrgency(positions, quoteMap) {
  const items = [];
  for (const pos of positions.open_csps ?? []) {
    const stockPrice = quoteMap.get(pos.ticker)?.mid;
    if (!stockPrice) continue;

    if (stockPrice >= pos.strike) continue;

    const itmPct = (pos.strike - stockPrice) / pos.strike;
    if (itmPct < 0.03) continue;

    const openDate   = new Date(pos.open_date   + "T00:00:00");
    const expiryDate = new Date(pos.expiry_date  + "T00:00:00");
    const todayDate  = new Date();
    const originalDTE  = Math.ceil((expiryDate - openDate)   / (1000 * 60 * 60 * 24));
    const remainingDTE = Math.ceil((expiryDate - todayDate)  / (1000 * 60 * 60 * 24));
    const dteElapsedPct = originalDTE > 0 ? 1 - (remainingDTE / originalDTE) : 0;

    const urgencyScore = itmPct * dteElapsedPct;
    if (urgencyScore < 0.05) continue;

    const priority = urgencyScore >= 0.10 ? "P1" : "P2";
    const itmPctDisplay     = (itmPct * 100).toFixed(1);
    const dteElapsedDisplay = (dteElapsedPct * 100).toFixed(0);
    const urgencyDisplay    = (urgencyScore * 100).toFixed(1);

    items.push({
      id:       `csp-itm-${pos.ticker}-${pos.expiry_date}`,
      priority,
      rule:     "csp_itm_urgency",
      ticker:   pos.ticker,
      dte:      remainingDTE,
      urgency:  urgencyScore * 100,
      title:    `${pos.ticker} CSP $${pos.strike} — ${itmPctDisplay}% ITM`,
      detail:   `Stock at $${stockPrice.toFixed(2)} vs strike $${pos.strike}. `
        + `${dteElapsedDisplay}% of DTE elapsed. `
        + `Urgency score: ${urgencyDisplay} (${urgencyScore >= 0.10 ? "high" : "moderate"}). `
        + `${remainingDTE}d remaining.`,
    });
  }
  return items;
}

function ruleNearWorthlessOption(positions, quoteMap) {
  const items = [];
  const candidates = [];

  for (const pos of positions.open_csps ?? []) {
    candidates.push({ ...pos, isCall: false });
  }
  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc) candidates.push({ ...s.active_cc, isCall: true });
  }

  for (const pos of candidates) {
    if (!pos.contracts || !pos.premium_collected) continue;
    const occSym     = buildOccSymbol(pos.ticker, pos.expiry_date, pos.isCall, pos.strike);
    const currentMid = quoteMap.get(occSym)?.mid;
    if (currentMid == null) continue;

    if (currentMid >= 0.10) continue;

    const premiumPerShare = pos.premium_collected / (pos.contracts * 100);
    if (premiumPerShare <= 0) continue;
    const pctOfOriginal = currentMid / premiumPerShare;
    if (pctOfOriginal >= 0.05) continue;

    const capturedPct  = ((1 - pctOfOriginal) * 100).toFixed(0);
    const daysToExpiry = calcDTE(pos.expiry_date) ?? 0;
    const typeLabel    = pos.isCall ? "CC" : "CSP";

    items.push({
      id:       `near-worthless-${pos.ticker}-${pos.expiry_date}`,
      priority: "P2",
      rule:     "near_worthless",
      ticker:   pos.ticker,
      dte:      daysToExpiry,
      urgency:  daysToExpiry,
      title:    `${pos.ticker} ${typeLabel} $${pos.strike} — worth $${currentMid.toFixed(2)}`,
      detail:   `${capturedPct}% of premium already captured. `
        + `Current mid $${currentMid.toFixed(2)} vs $${premiumPerShare.toFixed(2)} at open. `
        + `${daysToExpiry}d remaining. Consider closing to free collateral.`,
    });
  }
  return items;
}

function rule6060(positions, quoteMap) {
  const items = [];
  const candidates = [];

  for (const pos of positions.open_csps ?? []) {
    candidates.push({ ...pos, isCall: false });
  }
  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc) candidates.push({ ...s.active_cc, isCall: true });
  }

  for (const pos of candidates) {
    if (!pos.contracts || !pos.premium_collected || !pos.open_date) continue;
    const occSym     = buildOccSymbol(pos.ticker, pos.expiry_date, pos.isCall, pos.strike);
    const currentMid = quoteMap.get(occSym)?.mid;
    if (currentMid == null) continue;

    const premiumPerShare = pos.premium_collected / (pos.contracts * 100);
    if (premiumPerShare <= 0) continue;
    const profitPct = 1 - (currentMid / premiumPerShare);
    if (profitPct < 0.60) continue;

    const openDate   = new Date(pos.open_date   + "T00:00:00");
    const expiryDate = new Date(pos.expiry_date  + "T00:00:00");
    const todayDate  = new Date();
    const originalDTE  = Math.ceil((expiryDate - openDate)  / (1000 * 60 * 60 * 24));
    const remainingDTE = Math.ceil((expiryDate - todayDate) / (1000 * 60 * 60 * 24));
    if (remainingDTE < 5) continue;

    const dteRemainingPct = originalDTE > 0 ? remainingDTE / originalDTE : 0;
    if (dteRemainingPct < 0.60) continue;

    const profitDisplay = (profitPct * 100).toFixed(0);
    const dteDisplay    = (dteRemainingPct * 100).toFixed(0);
    const typeLabel     = pos.isCall ? "CC" : "CSP";

    items.push({
      id:       `60-60-${pos.ticker}-${pos.expiry_date}`,
      priority: "P2",
      rule:     "rule_60_60",
      ticker:   pos.ticker,
      dte:      remainingDTE,
      urgency:  remainingDTE,
      title:    `${pos.ticker} ${typeLabel} $${pos.strike} — 60/60 threshold met`,
      detail:   `${profitDisplay}% of premium captured with ${dteDisplay}% DTE remaining. `
        + `Current mark $${currentMid.toFixed(2)} vs $${premiumPerShare.toFixed(2)} at open. `
        + `${remainingDTE}d remaining. Consider closing and redeploying capital.`,
    });
  }
  return items;
}

function ruleEarningsBeforeExpiry(positions, marketContext) {
  if (!marketContext) return [];
  const items = [];
  const earningsMap = buildEarningsMap(marketContext);
  const options = [];

  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc) options.push({ ...s.active_cc, _category: "cc" });
  }
  for (const csp of positions.open_csps ?? []) {
    options.push({ ...csp, _category: "csp" });
  }

  const seen = new Set();
  for (const opt of options) {
    const earnings = earningsMap[opt.ticker];
    if (!earnings?.date) continue;
    const expiryDate = opt.expiry_date;
    if (!expiryDate) continue;
    // Earnings falls on or before expiry
    if (earnings.date > expiryDate) continue;
    // Earnings already passed
    if (earnings.date < today()) continue;
    const key = `${opt.ticker}-${earnings.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const daysToEarnings = daysBetween(today(), earnings.date);
    const timeLabel = earnings.time === "bmo" ? "BMO" : earnings.time === "amc" ? "AMC" : "";
    const epsStr = earnings.epsEstimate != null
      ? ` (est. EPS ${earnings.epsEstimate > 0 ? "+" : ""}${earnings.epsEstimate.toFixed(2)})`
      : "";
    items.push({
      id:       `earnings-before-expiry-${opt.ticker}-${earnings.date}`,
      priority: "P2",
      rule:     "earnings_before_expiry",
      ticker:   opt.ticker,
      dte:      calcDTE(opt.expiry_date),
      urgency:  daysToEarnings,
      title:    `${opt.ticker} earnings ${formatExpiry(earnings.date)}${timeLabel ? ` ${timeLabel}` : ""} — before ${formatExpiry(expiryDate)} expiry`,
      detail:   `${opt.type} $${opt.strike} expires ${formatExpiry(expiryDate)}. Earnings on ${formatExpiry(earnings.date)}${timeLabel ? ` ${timeLabel}` : ""}${epsStr}. Consider closing or rolling before the event.`,
    });
  }
  return items;
}

function ruleMacroOverlap(positions, marketContext) {
  if (!marketContext) return [];
  const items = [];
  const macroEvents = getUpcomingMacroEvents(marketContext);
  if (!macroEvents.length) return items;

  const options = [];
  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc) options.push({ ...s.active_cc });
  }
  for (const csp of positions.open_csps ?? []) {
    options.push({ ...csp });
  }

  const seen = new Set();
  for (const evt of macroEvents) {
    // Find options expiring within 2 days of this macro event
    const affected = options.filter(opt => {
      if (!opt.expiry_date) return false;
      const gap = Math.abs(daysBetween(evt.date, opt.expiry_date));
      return gap <= 2;
    });
    if (!affected.length) continue;
    const key = `macro-${evt.eventType}-${evt.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tickers = [...new Set(affected.map(o => o.ticker))];
    const daysToEvent = daysBetween(today(), evt.date);
    const eventLabel = evt.eventType === "FOMC_RATE_DECISION" ? "FOMC" : evt.eventType;
    items.push({
      id:       key,
      priority: "P2",
      rule:     "macro_overlap",
      ticker:   tickers.length === 1 ? tickers[0] : null,
      dte:      null,
      urgency:  daysToEvent,
      title:    `${eventLabel} on ${formatExpiry(evt.date)} — near ${tickers.join(", ")} expiry`,
      detail:   `${evt.title} on ${formatExpiry(evt.date)}. Affects ${affected.length} position${affected.length !== 1 ? "s" : ""} (${tickers.join(", ")}) expiring within 2 days. Review exposure before the event.`,
    });
  }
  return items;
}

function ruleExpiryCluster(positions) {
  const items = [];
  const byDate = {};

  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc?.expiry_date) {
      const d = s.active_cc.expiry_date;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({ ticker: s.ticker, type: "CC" });
    }
  }
  for (const csp of positions.open_csps ?? []) {
    if (csp.expiry_date) {
      const d = csp.expiry_date;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({ ticker: csp.ticker, type: "CSP" });
    }
  }

  for (const [date, opts] of Object.entries(byDate)) {
    if (opts.length < 3) continue;
    const dte = calcDTE(date);
    if (dte == null || dte < 0) continue;
    const tickers = [...new Set(opts.map(o => o.ticker))];
    items.push({
      id:       `expiry-cluster-${date}`,
      priority: "P3",
      rule:     "expiry_cluster",
      ticker:   null,
      dte,
      urgency:  dte,
      title:    `${opts.length} options expire ${formatExpiry(date)} (${tickers.join(", ")})`,
      detail:   `${opts.length} positions expire on the same date — ${opts.map(o => `${o.ticker} ${o.type}`).join(", ")}. This concentrates decision-making. Consider spreading future expirations.`,
    });
  }
  return items;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateFocusItems(positions, account, marketContext, liveVix, quoteMap = new Map()) {
  if (!positions) return [];

  // Allow caller to pass a fresher VIX (e.g. from useLiveVix) to override the snapshot value
  const accountWithVix = liveVix != null
    ? { ...account, vix_current: liveVix }
    : account;

  const items = [
    ...ruleCashBelowFloor(accountWithVix),
    ...ruleExpiringSoon(positions),
    ...ruleUncoveredShares(positions, quoteMap),
    ...ruleCCDeeplyITM(positions, quoteMap),
    ...ruleCSPITMUrgency(positions, quoteMap),
    ...ruleEarningsBeforeExpiry(positions, marketContext),
    ...ruleMacroOverlap(positions, marketContext),
    ...ruleNearWorthlessOption(positions, quoteMap),
    ...rule6060(positions, quoteMap),
    ...ruleExpiryCluster(positions),
  ];

  const priorityOrder = { P1: 0, P2: 1, P3: 2 };
  return items.sort((a, b) => {
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pd !== 0) return pd;
    return a.urgency - b.urgency;
  });
}

export function categorizeFocusItems(items) {
  return {
    focus:    items.filter(i => i.priority === "P1"),
    watching: items.filter(i => i.priority === "P2"),
    info:     items.filter(i => i.priority === "P3"),
  };
}
