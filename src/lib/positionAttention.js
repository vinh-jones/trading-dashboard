import { calcDTE, buildOccSymbol } from "./trading.js";
import { getOpenCSPs, getOpenCCs, getOpenLEAPs } from "./positionSchema.js";
import {
  shortOptionGlPct as _shortOptionGlPct,
  dtePctRemaining,
} from "./positionMetrics.js";
import { PROFIT_TIERS } from "./strategyConfig.js";

// ── Target profit % based on how much DTE remains (per user's 60/60 framework) ──
// Walks PROFIT_TIERS (sorted by descending minDtePct) and returns the first
// tier whose threshold the remaining-DTE% exceeds. Last tier acts as floor.
export function targetProfitPctForDtePct(dtePct) {
  if (dtePct == null) return null;
  for (const tier of PROFIT_TIERS) {
    if (dtePct > tier.minDtePct) return tier.targetProfitPct;
  }
  return PROFIT_TIERS[PROFIT_TIERS.length - 1].targetProfitPct;
}

// Fraction of the way from 0% G/L to target, clamped to [0, 1]. Null/negative → 0.
export function proximityFraction(currentPct, targetPct) {
  if (currentPct == null || !targetPct || targetPct <= 0) return 0;
  if (currentPct <= 0) return 0;
  if (currentPct >= targetPct) return 1;
  return currentPct / targetPct;
}

// Priority ordering — smaller number = more urgent
const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };

function dtePctFor(pos, dte) {
  return dtePctRemaining({
    openDateIso:   pos.open_date,
    expiryDateIso: pos.expiry_date,
    dte,
  });
}

// Compute G/L% for a short (CSP or CC) by looking up the option mid in quoteMap
// and delegating to positionMetrics. LEAPs handled separately (returns null here
// — Layer 2 keeps LEAP rows minimal).
function shortOptionGlPct(pos, quoteMap, isCC) {
  if (!pos.strike || !pos.expiry_date) return null;
  const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC, pos.strike);
  const q   = quoteMap.get(sym);
  return _shortOptionGlPct({
    premiumCollected: pos.premium_collected,
    optionMid:        q?.mid ?? null,
    contracts:        pos.contracts,
  });
}

function higherPriority(a, b) {
  const ar = PRIORITY_RANK[a] ?? 99;
  const br = PRIORITY_RANK[b] ?? 99;
  return ar <= br ? a : b;
}

// Determines whether a focus alert belongs on a specific position row.
// Prevents ticker-level alerts from bleeding across all positions for that ticker
// (e.g., CC expiry alert should not appear on the LEAP row for the same ticker).
function alertBelongsToRow(item, pos, type) {
  if (!item.ticker) return false;
  if (item.ticker !== pos.ticker) return false;

  const { rule, id } = item;

  // Roll opportunity is a CC action — don't show on LEAPs or CSPs
  if (rule === "roll_opportunity")   return type === "CC";
  // Uncovered shares is share-level, not tied to any option row
  if (rule === "uncovered_shares")   return false;
  // CC deeply ITM: one active CC per share block, ticker match is enough
  if (rule === "cc_deeply_itm")      return type === "CC";
  // LEAP-only rules
  if (rule === "leaps_low_dte" || rule === "leaps_profit_target") return type === "LEAP";
  // Assigned-CC breach is a CC-only signal
  if (rule === "assigned_cc_breach_imminent") return type === "CC";

  // Expiry+strike scoped rules — match on fields added to each item by focusEngine
  if (rule === "csp_itm_urgency") {
    return type === "CSP"
      && item.expiry_date === pos.expiry_date
      && item.strike === pos.strike;
  }

  if (rule === "expiring_soon") {
    if (id.startsWith("expiring-CC-")  && type !== "CC")  return false;
    if (id.startsWith("expiring-CSP-") && type !== "CSP") return false;
    return item.expiry_date === pos.expiry_date && item.strike === pos.strike;
  }

  if (rule === "near_worthless" || rule === "rule_60_60") {
    return type !== "LEAP"
      && item.expiry_date === pos.expiry_date
      && item.strike === pos.strike;
  }

  // Ticker-wide rules (earnings_before_expiry, macro_overlap, expiry_cluster)
  return true;
}

function buildRow(pos, type, quoteMap, focusItems) {
  const dte    = calcDTE(pos.expiry_date);
  const dtePct = dtePctFor(pos, dte);
  const target = targetProfitPctForDtePct(dtePct);
  const isCC   = type === "CC";
  const isLeap = type === "LEAP";
  const glPct  = isLeap ? null : shortOptionGlPct(pos, quoteMap, isCC);
  const proximity = proximityFraction(glPct, target);

  const alertTags = focusItems
    .filter(it => alertBelongsToRow(it, pos, type))
    .map(it => ({ id: it.id, priority: it.priority, rule: it.rule, title: it.title }));

  const priority = alertTags.reduce(
    (best, t) => higherPriority(best, t.priority),
    null
  );

  return {
    ticker:    pos.ticker,
    type,                    // "CSP" | "CC" | "LEAP"
    strike:    pos.strike,
    dte,
    dtePct,
    glPct,
    targetPct: target,
    proximity,
    alertTags,
    priority,
    position:  pos,          // keep original for downstream drill-in
  };
}

export function buildAttentionList(positions, quoteMap, focusItems) {
  if (!positions) return [];
  const csps  = getOpenCSPs(positions).map(p => buildRow(p, "CSP",  quoteMap, focusItems));
  const ccs   = getOpenCCs(positions).map(p => buildRow(p, "CC",   quoteMap, focusItems));
  const leaps = getOpenLEAPs(positions).map(p => buildRow(p, "LEAP", quoteMap, focusItems));

  const rows = [...csps, ...ccs, ...leaps];

  rows.sort((a, b) => {
    const ar = PRIORITY_RANK[a.priority] ?? 99;
    const br = PRIORITY_RANK[b.priority] ?? 99;
    if (ar !== br) return ar - br;
    // No alerts on either — sort by proximity desc (closer to target first), then DTE asc.
    if (b.proximity !== a.proximity) return b.proximity - a.proximity;
    return (a.dte ?? Infinity) - (b.dte ?? Infinity);
  });

  return rows;
}
