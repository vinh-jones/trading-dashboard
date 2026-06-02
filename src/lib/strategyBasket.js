// Pure basket resolution: tagged journal entries + flat position/trade arrays
// → normalized member list and reducer metrics. No React, no fetch, no quotes.

import { buildOccSymbol } from "./trading";

const BASELINE_TAG = "role:makeup-baseline";

function tupleMatch(a, b) {
  return (
    a.ticker === b.ticker &&
    String(a.type) === String(b.type) &&
    String(a.strike) === String(b.strike) &&
    String(a.expiry ?? a.expiry_date) === String(b.expiry ?? b.expiry_date)
  );
}

// Normalize a close date to an ISO "YYYY-MM-DD" string. Accepts the raw DB
// string (close_date) or normalizeTrade()'s Date object (closeDate).
function toIsoDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
}

function fromOpenPosition(pos, role) {
  return {
    status: "open",
    role,
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: pos.contracts ?? null,
    capitalFronted: pos.capital_fronted ?? 0,
    entryCost: pos.entry_cost ?? null,
    realized: null,
  };
}

// Accepts both the raw DB trade row and the app's normalizeTrade() output, which
// renames premium_collected→premium, capital_fronted→fronted, and drops the ISO
// close_date (keeping `close` as MM/DD). The app only ever passes the normalized
// shape, so read those first with the raw names as fallback.
function fromTrade(trade, role) {
  return {
    status: "closed",
    role,
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: toIsoDate(trade.close_date ?? trade.closeDate) ?? trade.close ?? null,
    contracts: trade.contracts ?? null,
    capitalFronted: trade.capital_fronted ?? trade.fronted ?? 0,
    entryCost: trade.entry_cost ?? null,
    exitCost: trade.exit_cost ?? null,
    realized: trade.premium_collected ?? trade.premium ?? 0,
  };
}

/**
 * Resolve a strategy tag into a normalized member list.
 * @param {string} tag
 * @param {{openPositions: Array, trades: Array, entries: Array}} sources
 * @returns {Array} normalized members
 */
export function resolveBasket(tag, { openPositions = [], trades = [], entries = [] }) {
  const members = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.tags) || !entry.tags.includes(tag)) continue;
    const role = entry.tags.includes(BASELINE_TAG) ? "baseline" : "recovery";

    const tradeId = entry.trade_id ?? entry.metadata?.trade_id;
    if (tradeId) {
      const t = trades.find(tr => tr.id === tradeId);
      if (t) { members.push(fromTrade(t, role)); continue; }
    }
    const openMatch = openPositions.find(p => tupleMatch(entry, p));
    if (openMatch) { members.push(fromOpenPosition(openMatch, role)); continue; }
    const closedMatch = trades.find(tr => tupleMatch(entry, tr));
    if (closedMatch) { members.push(fromTrade(closedMatch, role)); continue; }
    // Unresolved entry (tag points at nothing in current data) — skip silently.
  }
  return members;
}

export function basketTarget(members) {
  return members
    .filter(m => m.role === "baseline" && m.status === "closed")
    .reduce((sum, m) => sum + Math.abs(m.realized ?? 0), 0);
}

export function capitalDeployed(members) {
  return members
    .filter(m => m.role === "recovery" && m.status === "open")
    .reduce((sum, m) => sum + (m.capitalFronted ?? 0), 0);
}

export function realizedRecovery(members) {
  return members
    .filter(m => m.role === "recovery" && m.status === "closed")
    .reduce((sum, m) => sum + (m.realized ?? 0), 0);
}

/**
 * Counterfactual P/L of holding the baseline position instead of closing it:
 * (currentPrice − exit price) × shares. Used for the "vs. holding X" A/B view.
 * Returns null when the baseline lacks an exit price / share count or no current
 * price is available. Assumes a shares baseline (multiplier 1, no ×100).
 */
export function holdCounterfactual(baselineMember, currentPrice) {
  if (!baselineMember) return null;
  const { exitCost, contracts } = baselineMember;
  if (exitCost == null || contracts == null || currentPrice == null) return null;
  return (currentPrice - exitCost) * contracts;
}

const SHORT_TYPES = new Set(["CSP", "CC"]);
const LONG_OPTION_TYPES = new Set(["LEAPS"]);
const CALL_TYPES = new Set(["LEAPS", "CC"]);

function markFor(member, quoteMap) {
  const isCall = CALL_TYPES.has(member.type);
  const sym = buildOccSymbol(member.ticker, member.expiry, isCall, member.strike);
  const q = quoteMap.get(sym);
  if (!q) return null;
  return q.mid ?? q.last ?? null;
}

/**
 * Per-member live mark-to-market P/L for a single open recovery option member.
 * Returns a number in dollars when a live mark is available, or null when the
 * member isn't an open recovery option or has no quote in `quoteMap`.
 * Matches the Open Positions widget's G/L $: short (CSP/CC) profits as the mark
 * falls, long (LEAPS) profits as it rises.
 */
export function memberUnrealized(member, quoteMap) {
  if (member.status !== "open" || member.role !== "recovery") return null;
  if (!LONG_OPTION_TYPES.has(member.type) && !SHORT_TYPES.has(member.type)) return null;
  const mark = markFor(member, quoteMap);
  if (mark == null) return null;
  const mult = (member.contracts ?? 0) * 100;
  return SHORT_TYPES.has(member.type)
    ? (member.entryCost - mark) * mult
    : (mark - member.entryCost) * mult;
}

/**
 * Live mark-to-market cushion for open recovery members.
 * @returns {{total:number, marked:number, unmarked:number}}
 */
export function unrealizedCushion(members, quoteMap) {
  let total = 0, marked = 0, unmarked = 0;
  for (const m of members) {
    if (m.status !== "open" || m.role !== "recovery") continue;
    if (!LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
    const pnl = memberUnrealized(m, quoteMap);
    if (pnl == null) { unmarked += 1; continue; }
    total += pnl;
    marked += 1;
  }
  return { total, marked, unmarked };
}
