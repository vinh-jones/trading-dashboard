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
    closeDate: trade.close_date ?? trade.close ?? null,
    contracts: trade.contracts ?? null,
    capitalFronted: trade.capital_fronted ?? trade.fronted ?? 0,
    entryCost: trade.entry_cost ?? null,
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
 * Live mark-to-market cushion for open recovery members.
 * @returns {{total:number, marked:number, unmarked:number}}
 */
export function unrealizedCushion(members, quoteMap) {
  let total = 0, marked = 0, unmarked = 0;
  for (const m of members) {
    if (m.status !== "open" || m.role !== "recovery") continue;
    if (!LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
    const mark = markFor(m, quoteMap);
    if (mark == null) { unmarked += 1; continue; }
    const mult = (m.contracts ?? 0) * 100;
    const pnl = SHORT_TYPES.has(m.type)
      ? (m.entryCost - mark) * mult
      : (mark - m.entryCost) * mult;
    total += pnl;
    marked += 1;
  }
  return { total, marked, unmarked };
}
