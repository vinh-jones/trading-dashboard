// Pure basket resolution: tagged journal entries + flat position/trade arrays
// → normalized member list and reducer metrics. No React, no fetch, no quotes.

const BASELINE_TAG = "role:makeup-baseline";

function tupleMatch(a, b) {
  return (
    a.ticker === b.ticker &&
    String(a.type) === String(b.type) &&
    Number(a.strike) === Number(b.strike) &&
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

function fromTrade(trade, role) {
  return {
    status: "closed",
    role,
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: trade.close_date ?? null,
    contracts: trade.contracts ?? null,
    capitalFronted: trade.capital_fronted ?? 0,
    entryCost: trade.entry_cost ?? null,
    realized: trade.premium_collected ?? 0,
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

    if (entry.trade_id) {
      const t = trades.find(tr => tr.id === entry.trade_id);
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
