// Pure basket resolution: tagged journal entries + flat position/trade arrays
// → normalized member list and reducer metrics. No React, no fetch, no quotes.

import { buildOccSymbol } from "./trading";

const BASELINE_TAG = "role:makeup-baseline";

export function tupleMatch(a, b) {
  // Prefer the ISO `expiry_date` over `expiry`. Journal entries carry the ISO
  // date in `expiry`; open positions carry it in `expiry_date`. But a CLOSED
  // leg goes through normalizeTrade(), which adds an MM/DD `expiry` ("07/02")
  // ALONGSIDE the ISO `expiry_date` — so reading `expiry` first would compare
  // "07/02" against the entry's "2026-07-02" and silently fail to match.
  const exp = (x) => String(x.expiry_date ?? x.expiry);
  return (
    a.ticker === b.ticker &&
    String(a.type) === String(b.type) &&
    String(a.strike) === String(b.strike) &&
    exp(a) === exp(b)
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
    daysHeld: trade.days_held ?? trade.days ?? null,
    roi: trade.roi ?? null,
    keptPct: trade.kept_pct ?? null,
    realized: trade.premium_collected ?? trade.premium ?? 0,
  };
}

// An open recovery shares lot declared directly on a tagged journal entry.
// The basket slice is ASSERTED via metadata (shares + basis), never derived from
// the blended broker position — so a partial or multi-basis lot stays honest, and
// the null-strike/null-expiry tuple-match landmine is avoided entirely.
function fromDeclaredShares(entry, role, meta) {
  const shares = meta.shares;
  const basis = meta.basis;
  return {
    status: "open",
    role,
    ticker: entry.ticker,
    type: "Shares",
    strike: null,
    expiry: null,
    openDate: entry.entry_date ?? null,
    closeDate: null,
    contracts: shares,
    capitalFronted: shares * basis,
    entryCost: basis,
    realized: null,
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

    // Declared shares lot: a tagged Shares entry carrying its own share-count +
    // basis in metadata resolves directly. Baseline Shares carry no
    // metadata.shares and fall through to the trade_id path below.
    const meta = entry.metadata ?? {};
    if (entry.type === "Shares" && meta.shares != null && meta.basis != null) {
      members.push(fromDeclaredShares(entry, role, meta));
      continue;
    }

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
const SHARES_TYPES = new Set(["Shares"]);
const CALL_TYPES = new Set(["LEAPS", "CC"]);

function markFor(member, quoteMap) {
  // Shares mark off the equity quote (keyed by plain ticker), not an OCC symbol.
  if (SHARES_TYPES.has(member.type)) {
    const q = quoteMap.get(member.ticker);
    return q ? (q.mid ?? q.last ?? null) : null;
  }
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
  const isShares = SHARES_TYPES.has(member.type);
  if (!isShares && !LONG_OPTION_TYPES.has(member.type) && !SHORT_TYPES.has(member.type)) return null;
  const mark = markFor(member, quoteMap);
  if (mark == null) return null;
  // Shares are delta-1 longs: (mark - basis) * shares — no ×100 option multiplier.
  if (isShares) return (mark - member.entryCost) * (member.contracts ?? 0);
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
    if (!SHARES_TYPES.has(m.type) && !LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
    const pnl = memberUnrealized(m, quoteMap);
    if (pnl == null) { unmarked += 1; continue; }
    total += pnl;
    marked += 1;
  }
  return { total, marked, unmarked };
}

/**
 * Over-allocation check: a basket may tag more covered-call contracts than its
 * declared open shares cover (the broker holds a blended lot, so the basket
 * can't enforce this structurally). Returns one entry per ticker where tagged
 * open CC contracts × 100 exceed declared open shares. Empty array = all clear.
 * @returns {Array<{ticker:string, declaredShares:number, ccContracts:number, coveredShares:number}>}
 */
export function shareCoverageWarnings(members) {
  const byTicker = new Map();
  for (const m of members) {
    if (m.status !== "open" || m.role !== "recovery") continue;
    const slot = byTicker.get(m.ticker) ?? { shares: 0, ccContracts: 0 };
    if (m.type === "Shares") slot.shares += m.contracts ?? 0;
    else if (m.type === "CC") slot.ccContracts += m.contracts ?? 0;
    byTicker.set(m.ticker, slot);
  }
  const warnings = [];
  for (const [ticker, { shares, ccContracts }] of byTicker) {
    if (ccContracts > 0 && ccContracts * 100 > shares) {
      warnings.push({ ticker, declaredShares: shares, ccContracts, coveredShares: ccContracts * 100 });
    }
  }
  return warnings;
}
