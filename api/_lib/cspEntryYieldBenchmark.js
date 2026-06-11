// CSP entry-yield benchmark — the "typical fresh CSP forward-yield" the
// hold-yield signal is measured against. See
// docs/superpowers/specs/SPEC_HOLD_YIELD_SIGNAL_V2.md.
//
// Computed from CLOSED CSPs in the trades table. Note the open/closed schema
// split: on `trades` (closed) rows, `premium_collected` is NET P&L and
// `kept_pct` is the net/gross fraction, so the GROSS entry premium is
// reconstructed as `premium_collected / kept_pct` (exact by construction).

const DAY_MS = 86400000;

function calendarDays(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/**
 * Annualized return-on-capital a trade offered at ENTRY, outcome-independent.
 * Returns null if the row lacks the fields needed to reconstruct gross.
 */
export function entryYieldAnn(row) {
  const capital = Number(row.capital_fronted);
  const net = Number(row.premium_collected);
  const keptPct = Number(row.kept_pct);
  if (!(capital > 0) || !Number.isFinite(net) || !Number.isFinite(keptPct) || keptPct === 0) {
    return null;
  }
  const gross = net / keptPct; // exact: kept_pct ≡ net/gross
  const origDte = Math.max(1, calendarDays(row.open_date, row.expiry_date));
  return (gross / capital) / origDte * 365;
}

function isEligible(row) {
  return (
    row.type === "CSP" &&
    row.subtype === "Close" &&
    Number(row.capital_fronted) > 0 &&
    row.kept_pct !== null &&
    row.kept_pct !== undefined &&
    Number(row.kept_pct) !== 0
  );
}

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * @param {Array<object>} rows - raw trade rows from Supabase
 * @param {{today: string, windowDays?: number, minTrades?: number}} opts
 */
export function computeCspEntryYieldBenchmark(rows, opts = {}) {
  const { today, windowDays = 90, minTrades = 10 } = opts;
  const eligible = (rows || []).filter(isEligible);

  const cutoff = today
    ? new Date(Date.parse(`${today}T00:00:00Z`) - windowDays * DAY_MS).toISOString().slice(0, 10)
    : null;
  const windowed = cutoff ? eligible.filter(r => r.close_date >= cutoff) : eligible;

  // Use the trailing window if it has enough trades; otherwise widen to lifetime.
  const useWindow = windowed.length >= minTrades;
  const chosen = useWindow ? windowed : eligible;

  const yields = chosen.map(entryYieldAnn).filter(y => y !== null && Number.isFinite(y));

  return {
    window_days: useWindow ? windowDays : null, // null = widened to lifetime
    trade_count: yields.length,
    avg_csp_entry_yield_ann: median(yields),
    benchmark_immature: yields.length < minTrades,
  };
}
