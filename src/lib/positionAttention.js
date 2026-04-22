import { calcDTE, buildOccSymbol } from "./trading.js";

// ── Target profit % based on how much DTE remains (per user's 60/60 framework) ──
// >80% of DTE left  → take ~50% profit fast and redeploy
// 41–79%            → standard 60/60
// ≤40%              → late stage, take 80%
export function targetProfitPctForDtePct(dtePct) {
  if (dtePct == null) return null;
  if (dtePct > 80) return 50;
  if (dtePct > 40) return 60;
  return 80;
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
  if (!pos.open_date || !pos.expiry_date || dte == null) return null;
  const openMs   = new Date(pos.open_date   + "T00:00:00").getTime();
  const expiryMs = new Date(pos.expiry_date + "T00:00:00").getTime();
  const totalDays = Math.max(1, Math.round((expiryMs - openMs) / (1000 * 60 * 60 * 24)));
  return totalDays > 0 ? (dte / totalDays) * 100 : null;
}

// Compute G/L% for a short (CSP or CC) from premium collected + current option mid.
// LEAPs handled separately (returns null here — Layer 2 keeps LEAP rows minimal).
function shortOptionGlPct(pos, quoteMap, isCC) {
  if (!pos.premium_collected || !pos.strike || !pos.expiry_date || !pos.contracts) return null;
  const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC, pos.strike);
  const q   = quoteMap.get(sym);
  if (!q || q.mid == null) return null;
  const glDollars = pos.premium_collected - (q.mid * pos.contracts * 100);
  return (glDollars / pos.premium_collected) * 100;
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
  const csps   = (positions.open_csps   || []).map(p => buildRow(p, "CSP",  quoteMap, focusItems));

  // Covered calls live inside assigned_shares; active_cc doesn't carry its own
  // ticker, so inject the parent's ticker.
  const ccs    = [];
  for (const shareRow of (positions.assigned_shares || [])) {
    if (shareRow.active_cc) {
      const cc = { ...shareRow.active_cc, ticker: shareRow.ticker };
      ccs.push(buildRow(cc, "CC", quoteMap, focusItems));
    }
  }

  // LEAPs live at top level AND nested under assigned_shares (covered LEAPs).
  const nestedLeaps = (positions.assigned_shares || [])
    .flatMap(s => (s.open_leaps || []).map(l => ({ ...l, ticker: l.ticker ?? s.ticker })));
  const topLevelLeaps = (positions.open_leaps || []).map(p => ({ ...p }));
  const leaps = [...topLevelLeaps, ...nestedLeaps].map(p => buildRow(p, "LEAP", quoteMap, focusItems));

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
