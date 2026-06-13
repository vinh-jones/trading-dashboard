// Cohort resolution + math for the CSP cohorts feature. A cohort is the set of
// positions whose journal entries carry a `cohort:<slug>` tag; members are
// tuple-matched against open positions and closed trades so they keep
// resolving after close. See docs/superpowers/specs/2026-06-11-csp-cohorts-design.md.

import { tupleMatch } from "./strategyBasket";
import { buildOccSymbol } from "./trading";
import { shortOptionGlDollars, shortOptionGlPct } from "./positionMetrics";

export function slugifyCohortName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
}

function memberFromOpen(pos) {
  return {
    status: "open",
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: pos.contracts ?? null,
    premiumCollected: pos.premium_collected ?? 0,
    keptPct: null,
  };
}

// Accepts raw DB trade rows and normalizeTrade() output (premium_collected→premium).
function memberFromTrade(trade) {
  return {
    status: "closed",
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: toIsoDate(trade.close_date ?? trade.closeDate) ?? null,
    contracts: trade.contracts ?? null,
    premiumCollected: trade.premium_collected ?? trade.premium ?? 0,
    keptPct: trade.kept_pct ?? null,
  };
}

// Keyed on journal-entry fields; entries carry their ISO expiry in `expiry`.
function entryTupleKey(e) {
  return `${e.ticker}|${e.type}|${e.strike}|${e.expiry}`;
}

/**
 * Resolve a cohort tag into members.
 * @returns {{members: Array, unresolved: Array, createdAt: string|null}}
 */
export function resolveCohort(tag, { openPositions = [], trades = [], entries = [] }) {
  const seen = new Set();
  const members = [];
  const unresolved = [];
  let createdAt = null;

  for (const e of entries) {
    if (!Array.isArray(e.tags) || !e.tags.includes(tag)) continue;
    if (e.created_at && (createdAt == null || e.created_at < createdAt)) createdAt = e.created_at;

    const key = entryTupleKey(e);
    if (seen.has(key)) continue;
    seen.add(key);

    const openMatch = openPositions.find(p => tupleMatch(e, p));
    if (openMatch) { members.push(memberFromOpen(openMatch)); continue; }
    const closedMatch = trades.find(t => tupleMatch(e, t));
    if (closedMatch) { members.push(memberFromTrade(closedMatch)); continue; }
    unresolved.push({ ticker: e.ticker, type: e.type, strike: e.strike ?? null, expiry: e.expiry ?? null });
  }

  return { members, unresolved, createdAt };
}

function optionMidFor(member, quoteMap) {
  if (!member.expiry || member.strike == null || !member.contracts) return null;
  const sym = buildOccSymbol(member.ticker, member.expiry, false, member.strike);
  return quoteMap?.get(sym)?.mid ?? null;
}

/**
 * Roster capture % for one member (percent units, null when unmarked/unkept).
 */
export function memberCapturePct(member, quoteMap) {
  if (member.status === "closed") {
    return member.keptPct != null ? member.keptPct * 100 : null;
  }
  const optionMid = optionMidFor(member, quoteMap);
  return shortOptionGlPct({
    premiumCollected: member.premiumCollected,
    optionMid,
    contracts: member.contracts,
  });
}

/**
 * Roster G/L in dollars for one member — the dollar partner of
 * memberCapturePct, matching the scoreboard's captured math. Open: unrealized
 * mark-to-market $ from live marks; closed: realized kept $ (premium × kept_pct).
 * Null when an open member has no mark or a closed member has no kept_pct.
 */
export function memberGlDollars(member, quoteMap) {
  if (member.status === "closed") {
    return member.keptPct != null ? member.premiumCollected * member.keptPct : null;
  }
  const optionMid = optionMidFor(member, quoteMap);
  return shortOptionGlDollars({
    premiumCollected: member.premiumCollected,
    optionMid,
    contracts: member.contracts,
  });
}

/**
 * Scoreboard: collateral from OPEN members only (closed collateral is freed);
 * premium and capture across all members. Capture = unrealized (open, live
 * marks — same math as the selection calculator) + realized (closed, kept_pct).
 * capturePct's denominator covers contributing rows only, mirroring
 * computeCspAggregates' internally-consistent ratio rule.
 */
export function cohortScoreboard(members, quoteMap, accountValue) {
  const open = members.filter(m => m.status === "open");
  const closed = members.filter(m => m.status === "closed");

  let collateral = 0, openPremium = 0, openCaptured = 0, openMarkedPremium = 0, openMissing = 0;
  let hasOpenCapture = false;
  for (const m of open) {
    collateral  += (m.strike ?? 0) * 100 * (m.contracts ?? 0);
    openPremium += m.premiumCollected ?? 0;
    const gl = shortOptionGlDollars({
      premiumCollected: m.premiumCollected,
      optionMid: optionMidFor(m, quoteMap),
      contracts: m.contracts,
    });
    if (gl == null) { openMissing += 1; continue; }
    hasOpenCapture     = true;
    openCaptured      += gl;
    openMarkedPremium += m.premiumCollected ?? 0;
  }

  let closedKept = 0, closedKeptPremium = 0, closedMissing = 0, closedPremium = 0;
  for (const m of closed) {
    closedPremium += m.premiumCollected ?? 0;
    if (m.keptPct == null) { closedMissing += 1; continue; }
    closedKept        += (m.premiumCollected ?? 0) * m.keptPct;
    closedKeptPremium += m.premiumCollected ?? 0;
  }

  const hasClosedCapture = closedKeptPremium > 0;
  const captured = hasOpenCapture || hasClosedCapture ? openCaptured + closedKept : null;
  const captureDenominator = openMarkedPremium + closedKeptPremium;

  return {
    memberCount: members.length,
    openCount: open.length,
    collateral,
    collateralPct: accountValue && open.length ? (collateral / accountValue) * 100 : null,
    maxPremium: openPremium + closedPremium,
    captured,
    capturePct: captured != null && captureDenominator > 0
      ? (captured / captureDenominator) * 100
      : null,
    missingMarkCount: openMissing + closedMissing,
  };
}

// Case-insensitive tuple match between a cohort member and a serialized
// snapshot row (daily_snapshots.forecast_per_position stores type as 'csp').
// The matching backend copy is `tupleMatches` in api/_lib/cohortHistory.js —
// keep the two in sync.
function snapMatch(member, snap) {
  return (
    member.ticker === snap.ticker &&
    String(member.type).toLowerCase() === String(snap.type).toLowerCase() &&
    String(member.strike) === String(snap.strike) &&
    String(member.expiry) === String(snap.expiry)
  );
}

/**
 * Premium-weighted cohort capture % per snapshot day.
 * Open members contribute current_profit_pct (fraction) weighted by
 * premium_at_open; closed members flatline at kept_pct from closeDate.
 * Days with no contributors are skipped. For an all-closed cohort the series
 * keeps the FIRST snapshot day at-or-after the last close (so the final
 * flatline point appears even when the close falls on a non-snapshot day)
 * and trims everything after. `history` must be sorted ascending by date.
 * @param {Array} members - resolveCohort members
 * @param {Array<{date: string, members: Array}>} history - api/cohort-history data
 * @returns {Array<{date: string, capturePct: number}>}
 */
export function cohortCaptureSeries(members, history) {
  if (!members?.length || !history?.length) return [];

  const allClosed = members.every(m => m.status === "closed");
  const lastClose = allClosed
    ? members.reduce((max, m) => (m.closeDate && m.closeDate > max ? m.closeDate : max), "")
    : null;

  const series = [];
  let passedClose = false;
  for (const day of history) {
    if (lastClose && day.date >= lastClose) {
      if (passedClose) continue;
      passedClose = true;
    }
    let num = 0, den = 0;
    for (const m of members) {
      if (m.status === "closed" && m.closeDate && day.date >= m.closeDate) {
        if (m.keptPct == null) continue;
        const w = m.premiumCollected ?? 0;
        num += m.keptPct * w;
        den += w;
        continue;
      }
      const snap = (day.members ?? []).find(s => snapMatch(m, s));
      if (!snap || snap.current_profit_pct == null) continue;
      const w = snap.premium_at_open ?? m.premiumCollected ?? 0;
      num += snap.current_profit_pct * w;
      den += w;
    }
    if (den > 0) series.push({ date: day.date, capturePct: (num / den) * 100 });
  }
  return series;
}
