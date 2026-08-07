// Pure basket resolution: tagged journal entries + flat position/trade arrays
// → normalized member list and reducer metrics. No React, no fetch, no quotes.

import { buildOccSymbol } from "./trading";
import { spreadUnrealized } from "./spreads";

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

// The slice of a shared position or trade a basket owns, asserted on the tagged
// journal entry as metadata.contracts. The denominator is the resolved source's
// own contracts column — never stored, so the two can't drift apart. Returns
// null (meaning "the whole thing", today's behavior) when the entry declares
// nothing, when the declared count is not a positive number, or when the
// source carries no usable count to divide by.
//
// TWO RULES bind every consumer of the returned {weight, owned, total}, and both
// fromTrade and fromOpenPosition follow them — read this before adding a third:
//
//  1. Take the contract count from `owned`, NEVER from `total × weight`.
//     total × (owned/total) is not an identity in IEEE 754: it dusts in both
//     directions (22 × (15/22) = 14.999999999999998, 29 × (15/29) =
//     15.000000000000002) for 151,406 of the pairs with total ∈ [1,2000].
//     `owned` is already the exact clamped integer. Upward dust is not cosmetic:
//     it makes shareCoverageWarnings' `ccContracts * 100 > shares` fire a
//     spurious over-allocation on a basket whose CCs exactly cover its shares —
//     a wheel trader's most common deliberate state — and 2,981 pairs under
//     total ≤ 400 dust upward.
//
//  2. Multiply only on the attributed path — `(v) => (attr ? v * attr.weight : v)`,
//     never `v * (attr?.weight ?? 1)`. Both forms are arithmetically identical on
//     today's data; the point is provability, not correctness of the multiply. An
//     unattributed member must come out of here as the SAME value pre-branch code
//     produced, byte for byte, with no arithmetic in the path at all — which is
//     what makes it checkable by inspection that this feature cannot perturb any
//     existing basket, only the ones someone deliberately slices.
//
// Per-unit and metadata fields (entryCost, strike, expiry, dates) never scale.
function resolveAttribution(entry, source) {
  const owned = Number(entry?.metadata?.contracts);
  const total = Number(source?.contracts);
  if (!Number.isFinite(owned) || owned <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const capped = Math.min(owned, total);
  return { weight: capped / total, owned: capped, total };
}

function fromOpenPosition(pos, role, attr = null) {
  // Attribution rules 1 and 2 live on resolveAttribution — read them before editing.
  const scale = (v) => (attr ? v * attr.weight : v);
  return {
    status: "open",
    role,
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: attr ? attr.owned : (pos.contracts ?? null), // rule 1: `owned`, not total × weight
    capitalFronted: scale(pos.capital_fronted ?? 0),
    // Spreads carry the per-share price in `credit`, not `entry_cost`.
    entryCost: pos.entry_cost ?? pos.credit ?? null,
    realized: null,
    // Vertical-spread second leg (null on non-spreads) — needed to mark both legs.
    longStrike: pos.long_strike ?? null,
    right: pos.right ?? null,
    isCredit: pos.is_credit ?? null,
    // {owned, total} when this member is a slice; null when it owns the position whole.
    attribution: attr ? { owned: attr.owned, total: attr.total } : null,
  };
}

// Accepts both the raw DB trade row and the app's normalizeTrade() output, which
// renames premium_collected→premium (keeping the raw name as an alias) and
// capital_fronted→fronted (dropping the raw name). It emits three close-date
// shapes at once (trading.js): `close` as MM/DD, `closeDate` as a Date, and
// `close_date` as the raw ISO string — the ISO one is NOT dropped, and is
// load-bearing both here and upstream, where the attribution form's trade picker
// sorts and labels on it. The app only ever passes the normalized shape, so read
// those first with the raw names as fallback.
function fromTrade(trade, role, attr = null) {
  // Attribution rules 1 and 2 live on resolveAttribution — read them before editing.
  const scale = (v) => (attr ? v * attr.weight : v);
  return {
    status: "closed",
    role,
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: toIsoDate(trade.close_date ?? trade.closeDate) ?? trade.close ?? null,
    contracts: attr ? attr.owned : (trade.contracts ?? null), // rule 1: `owned`, not total × weight
    capitalFronted: scale(trade.capital_fronted ?? trade.fronted ?? 0),
    entryCost: trade.entry_cost ?? null,
    exitCost: trade.exit_cost ?? null,
    daysHeld: trade.days_held ?? trade.days ?? null,
    roi: trade.roi ?? null,
    keptPct: trade.kept_pct ?? null,
    realized: scale(trade.premium_collected ?? trade.premium ?? 0),
    // {owned, total} when this member is a slice; null when it owns the trade whole.
    attribution: attr ? { owned: attr.owned, total: attr.total } : null,
  };
}

// An open recovery shares lot declared directly on a tagged journal entry.
// The basket slice is ASSERTED via metadata (shares + basis), never derived from
// the blended broker position — so a partial or multi-basis lot stays honest, and
// the null-strike/null-expiry tuple-match landmine is avoided entirely.
//
// LOAD-BEARING DEPENDENCY: nothing in here enforces that. Since metadata.contracts
// now scales OPEN positions too, a Shares entry carrying {contracts: N} and no
// `basis` would tuple-match a blended broker Shares position and inherit its
// BLENDED basis — the exact dishonesty this function exists to prevent. Two
// accidents block it today, neither of them a deliberate guard:
//   1. flattenOpen (StrategyBasketTab.jsx) builds openPositions from CSP/CC/LEAPS/
//      Spread only, so no Shares row is ever in the array to match. This is the
//      real barrier — do not widen that filter without revisiting this.
//   2. tupleMatch compares String(expiry_date ?? expiry), and the Shares entries
//      we write carry an explicit `expiry: null` → "null", while a position with
//      neither key yields "undefined". Weak: an entry that merely OMITS `expiry`
//      yields "undefined" too and WOULD match. Do not rely on this one.
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
    attribution: null,
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
    //
    // LANDMINE — two different metadata keys mean "part of a lot", and this
    // branch decides which one is read. The split is ASSERTED vs. DERIVED, not
    // open vs. closed: `shares` + `basis` asserts an open shares lot outright,
    // with no position or trade behind it, while `contracts` scales a
    // tuple-matched position or trade fractionally — either side, open or
    // closed. When an entry carries both, this branch wins and `contracts` is
    // ignored. Declaring a partial slice as `{shares: 50}` with no `basis`
    // reaches neither: this branch is skipped, and every fallback path below
    // reads `contracts`, which is unset — so resolveAttribution returns null
    // and the basket is silently credited the ENTIRE lot. Use `{contracts: 50}`
    // to slice something that already exists as a position or trade; `shares` +
    // `basis` only to assert an open lot that does not.
    const meta = entry.metadata ?? {};
    if (entry.type === "Shares" && meta.shares != null && meta.basis != null) {
      members.push(fromDeclaredShares(entry, role, meta));
      continue;
    }

    const tradeId = entry.trade_id ?? entry.metadata?.trade_id;
    if (tradeId) {
      const t = trades.find(tr => tr.id === tradeId);
      if (t) { members.push(fromTrade(t, role, resolveAttribution(entry, t))); continue; }
    }
    const openMatch = openPositions.find(p => tupleMatch(entry, p));
    if (openMatch) { members.push(fromOpenPosition(openMatch, role, resolveAttribution(entry, openMatch))); continue; }
    const closedMatch = trades.find(tr => tupleMatch(entry, tr));
    if (closedMatch) { members.push(fromTrade(closedMatch, role, resolveAttribution(entry, closedMatch))); continue; }
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
const SPREAD_TYPES = new Set(["Spread"]);
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
  const isSpread = SPREAD_TYPES.has(member.type);
  if (!isShares && !isSpread && !LONG_OPTION_TYPES.has(member.type) && !SHORT_TYPES.has(member.type)) return null;

  // Vertical spreads mark from BOTH legs. Reuse the same spreadUnrealized math
  // the Spreads tab uses so the two surfaces agree exactly. Returns null (unmarked)
  // when either leg lacks a quote.
  if (isSpread) {
    const isCall = member.right === "call";
    const shortSym = buildOccSymbol(member.ticker, member.expiry, isCall, member.strike);
    const longSym = member.longStrike != null ? buildOccSymbol(member.ticker, member.expiry, isCall, member.longStrike) : null;
    const sq = quoteMap.get(shortSym);
    const lq = longSym ? quoteMap.get(longSym) : null;
    const shortMid = sq ? (sq.mid ?? sq.last ?? null) : null;
    const longMid = lq ? (lq.mid ?? lq.last ?? null) : null;
    return spreadUnrealized({
      credit: member.entryCost, shortMid, longMid,
      contracts: member.contracts, is_credit: member.isCredit,
    }).gl_dollars;
  }

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
    if (!SHARES_TYPES.has(m.type) && !SPREAD_TYPES.has(m.type) && !LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
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

// Display order for type groups in the transactions table. Anything not listed
// (a future type, or a null) sorts after these, alphabetically.
const TYPE_DISPLAY_ORDER = ["CC", "CSP", "Shares", "LEAPS", "Spread"];

/**
 * Bucket members by type for the transactions table, in a stable display order.
 * Order WITHIN each bucket is the order they arrived in, so an active column
 * sort upstream is preserved.
 * @returns {Array<{type: string, members: Array}>}
 */
export function groupMembersByType(members) {
  const byType = new Map();
  for (const m of members) {
    const key = m.type ?? "Other";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(m);
  }
  const rank = (t) => {
    const i = TYPE_DISPLAY_ORDER.indexOf(t);
    return i === -1 ? TYPE_DISPLAY_ORDER.length : i;
  };
  return [...byType.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || String(a[0]).localeCompare(String(b[0])))
    .map(([type, ms]) => ({ type, members: ms }));
}
