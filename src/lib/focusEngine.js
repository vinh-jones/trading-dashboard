import { calcDTE, buildOccSymbol, parseShareCount } from "./trading.js";
import { getVixBand } from "./vixBand.js";
import { formatExpiry } from "./format.js";

// ── Notification config ──────────────────────────────────────────────────────
// Which Focus Engine rules trigger iPhone pushes via /api/snapshot's EOD step.
// Keys match the `rule` field on items returned by generateFocusItems(); flip a
// value to tune signal/noise without touching rule logic. Decouples push-worthi-
// ness from priority — some P1s are informational, some P2/P3s are actionable.
//
// IMPORTANT: when you add a new rule, add an entry here too. Items whose rule
// isn't listed default to NOT pushed (fail-closed — prevents surprise noise).
export const NOTIFY_RULES = {
  cash_below_floor:       false, // often a conscious deployment decision
  expiring_soon:          false, // already tracked — no surprise value
  uncovered_shares:       false, // known after assignment — no surprise value
  cc_deeply_itm:          true,
  csp_itm_urgency:        true,
  near_worthless:         true,
  rule_60_60:             true,
  earnings_before_expiry: false, // tracked separately
  macro_overlap:          false, // tracked separately
  expiry_cluster:         false, // P3 awareness item, not actionable
  leaps_low_dte:          true,
  leaps_profit_target:    true,
  roll_opportunity:       true,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
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
      id:          `expiring-${opt.type}-${opt.ticker}-${opt.strike}-${opt.expiry_date}`,
      priority,
      rule:        "expiring_soon",
      ticker:      opt.ticker,
      strike:      opt.strike,
      expiry_date: opt.expiry_date,
      dte,
      urgency:     dte,
      title:       `${opt.ticker} ${typeLabel} $${opt.strike} expires ${dteLabel}`,
      detail:      `${opt.contracts} contract${opt.contracts !== 1 ? "s" : ""}, $${opt.premium_collected} premium collected. Expiry: ${formatExpiry(opt.expiry_date)}.`,
    });
  }
  return items;
}

function ruleUncoveredShares(positions, quoteMap) {
  const items = [];
  for (const s of positions.assigned_shares ?? []) {
    if (!s.active_cc) {
      const totalShares = s.positions?.reduce(
        (sum, lot) => sum + parseShareCount(lot.description),
        0,
      ) ?? 0;

      const quote     = quoteMap.get(s.ticker);
      const ivRank    = quote?.iv_rank ?? null;
      const iv        = quote?.iv      ?? null;
      const costBasis = s.cost_basis_total ?? 0;

      let ivSuffix;

      if (ivRank == null && iv == null) {
        // Both missing — still fire P1, note data gap, never suppress
        ivSuffix = " IV data unavailable.";
      } else {
        // Composite 60/40 weighted score
        // iv_rank weighted 60%: historically favorable conditions for this name
        // raw iv weighted 40%: absolute premium size, capped at 150% to prevent distortion
        const rankComponent = ivRank != null ? (ivRank / 100) * 0.60 : 0;
        const ivComponent   = iv     != null ? Math.min(iv / 1.50, 1.0) * 0.40 : 0;
        const score         = rankComponent + ivComponent;

        let quality, guidance;
        if (score >= 0.65) {
          quality  = "Strong";
          guidance = "Good window to write CC.";
        } else if (score >= 0.45) {
          quality  = "Moderate";
          guidance = "Acceptable conditions to write CC.";
        } else {
          quality  = "Weak";
          guidance = "Consider waiting for better premium.";
        }

        const rawIvDisplay  = iv     != null ? `${(iv * 100).toFixed(0)}%` : "N/A";
        const ivRankDisplay = ivRank != null ? ivRank.toFixed(1)            : "N/A";

        ivSuffix = ` IV ${rawIvDisplay} · IV Rank ${ivRankDisplay} · Premium quality: ${quality} (${score.toFixed(2)}). ${guidance}`;
      }

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
      id:          `csp-itm-${pos.ticker}-${pos.strike}-${pos.expiry_date}`,
      priority,
      rule:        "csp_itm_urgency",
      ticker:      pos.ticker,
      strike:      pos.strike,
      expiry_date: pos.expiry_date,
      dte:         remainingDTE,
      urgency:     urgencyScore * 100,
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
      id:          `near-worthless-${pos.ticker}-${pos.strike}-${pos.expiry_date}`,
      priority:    "P2",
      rule:        "near_worthless",
      ticker:      pos.ticker,
      strike:      pos.strike,
      expiry_date: pos.expiry_date,
      dte:         daysToExpiry,
      urgency:     daysToExpiry,
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
      id:          `60-60-${pos.ticker}-${pos.strike}-${pos.expiry_date}`,
      priority:    "P2",
      rule:        "rule_60_60",
      ticker:      pos.ticker,
      strike:      pos.strike,
      expiry_date: pos.expiry_date,
      dte:         remainingDTE,
      urgency:     remainingDTE,
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

function ruleLeapsLowDTE(positions) {
  const items = [];
  const leaps = [
    ...(positions.open_leaps ?? []),
    ...((positions.assigned_shares ?? []).flatMap(s => s.open_leaps ?? [])),
  ];
  for (const leap of leaps) {
    const dte = calcDTE(leap.expiry_date);
    if (dte == null || dte >= 90) continue;
    items.push({
      id:       `leaps-low-dte-${leap.ticker}-${leap.expiry_date}`,
      priority: "P2",
      rule:     "leaps_low_dte",
      ticker:   leap.ticker,
      dte,
      urgency:  dte,
      title:    `${leap.ticker} LEAP $${leap.strike} — ${dte}d to expiry`,
      detail:   `LEAP has ${dte} DTE (under 90). Time decay accelerates significantly here. Consider rolling to a later expiry, closing the position, or converting to shares.`,
    });
  }
  return items;
}

function ruleLeapsProfitTarget(positions, quoteMap) {
  const items = [];
  const leaps = [
    ...(positions.open_leaps ?? []),
    ...((positions.assigned_shares ?? []).flatMap(s => s.open_leaps ?? [])),
  ];
  for (const leap of leaps) {
    if (!leap.capital_fronted || !leap.contracts) continue;
    const dte = calcDTE(leap.expiry_date);
    const sym = buildOccSymbol(leap.ticker, leap.expiry_date, true, leap.strike);
    const mid = quoteMap.get(sym)?.mid;
    if (mid == null) continue;
    const glDollars = (mid * leap.contracts * 100) - leap.capital_fronted;
    const glPct = (glDollars / leap.capital_fronted) * 100;
    if (glPct < 10) continue;
    items.push({
      id:       `leaps-profit-target-${leap.ticker}-${leap.expiry_date}`,
      priority: "P2",
      rule:     "leaps_profit_target",
      ticker:   leap.ticker,
      dte,
      urgency:  -glPct,
      title:    `${leap.ticker} LEAP $${leap.strike} — +${glPct.toFixed(1)}% return`,
      detail:   `LEAP has returned ${glPct.toFixed(1)}% on $${leap.capital_fronted.toLocaleString()} invested ($${glDollars >= 0 ? "+" : ""}${Math.round(glDollars).toLocaleString()}). Target is 10%+ — consider taking profits.`,
    });
  }
  return items;
}

function ruleRollOpportunity(positions, rollAnalysisMap) {
  const items = [];
  if (!rollAnalysisMap || !Object.keys(rollAnalysisMap).length) return items;

  for (const s of positions.assigned_shares ?? []) {
    const rollData = rollAnalysisMap[s.ticker];
    if (!rollData?.any_viable) continue;

    const { assignment_strike, current_cc_strike, current_cc_mid,
            roll_14dte_expiry, roll_14dte_net, roll_14dte_viable,
            roll_28dte_expiry, roll_28dte_net, roll_28dte_viable } = rollData;

    const windows = [
      roll_14dte_viable && roll_14dte_expiry
        ? `14 DTE (${formatExpiry(roll_14dte_expiry)}): +$${roll_14dte_net?.toFixed(2)} credit`
        : null,
      roll_28dte_viable && roll_28dte_expiry
        ? `28 DTE (${formatExpiry(roll_28dte_expiry)}): +$${roll_28dte_net?.toFixed(2)} credit`
        : null,
    ].filter(Boolean).join(" · ");

    const ccMidStr = current_cc_mid != null ? ` @ $${current_cc_mid.toFixed(2)} mid` : "";

    items.push({
      id:       `roll-opportunity-${s.ticker}`,
      priority: "P2",
      rule:     "roll_opportunity",
      ticker:   s.ticker,
      dte:      null,
      urgency:  50,
      title:    `${s.ticker} — roll to $${assignment_strike} available`,
      detail:   `Net-neutral or better roll from $${current_cc_strike}${ccMidStr} up to assignment price $${assignment_strike}. `
        + windows
        + ". Review and decide.",
    });
  }
  return items;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateFocusItems(positions, account, marketContext, liveVix, quoteMap = new Map(), rollAnalysisMap = {}) {
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
    ...ruleLeapsLowDTE(positions),
    ...ruleLeapsProfitTarget(positions, quoteMap),
    ...ruleRollOpportunity(positions, rollAnalysisMap),
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
