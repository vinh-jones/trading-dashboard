/**
 * Shared data helpers for the Pipeline Detail panel.
 * Pure functions — the two themed view components (legacy + v2) consume these.
 */

// Group per_position rows by expiry, then summarize.
export function byExpiry(perPosition) {
  if (!Array.isArray(perPosition)) return [];
  const groups = new Map();
  for (const p of perPosition) {
    const key = p.expiry ?? "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([expiry, rows]) => ({
      expiry,
      count:        rows.length,
      premium:      rows.reduce((s, r) => s + (r.premium_at_open ?? 0), 0),
      remaining:    rows.reduce((s, r) => s + (r.remaining ?? 0), 0),
      this_month:   rows.reduce((s, r) => s + (r.this_month ?? 0), 0),
    }));
}

// Split by type (CSP vs CC) and aggregate premium + expected realization.
export function byType(perPosition) {
  if (!Array.isArray(perPosition)) return { csp: null, cc: null };
  const buckets = { csp: [], cc: [] };
  for (const p of perPosition) {
    const t = (p.type || "").toLowerCase();
    if (t === "csp" || t === "cc") buckets[t].push(p);
  }
  const agg = rows => rows.length === 0 ? null : {
    count:      rows.length,
    premium:    rows.reduce((s, r) => s + (r.premium_at_open ?? 0), 0),
    remaining:  rows.reduce((s, r) => s + (r.remaining ?? 0), 0),
    this_month: rows.reduce((s, r) => s + (r.this_month ?? 0), 0),
    // Weighted-average capture: total expected / total premium
    avg_capture: (() => {
      const totalPrem = rows.reduce((s, r) => s + (r.premium_at_open ?? 0), 0);
      if (!totalPrem) return null;
      const expected = rows.reduce((s, r) => s + ((r.premium_at_open ?? 0) * (r.capture_pct ?? 0)), 0);
      return expected / totalPrem;
    })(),
  };
  return { csp: agg(buckets.csp), cc: agg(buckets.cc) };
}

// Sort per-position rows by expiry ascending, then by ticker.
export function sortedPositions(perPosition) {
  if (!Array.isArray(perPosition)) return [];
  return [...perPosition].sort((a, b) => {
    const ex = String(a.expiry ?? "").localeCompare(String(b.expiry ?? ""));
    if (ex !== 0) return ex;
    return String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
  });
}

// Human-readable bucket label — maps snake_case bucket id to a short phrase.
const BUCKET_LABELS = {
  profit_60_plus:             "≥60% profit",
  profit_40_60_dte_high:      "40-60% · DTE>10",
  profit_40_60_dte_low:       "40-60% · DTE≤10",
  profit_20_40_dte_high:      "20-40% · DTE>10",
  profit_20_plus_dte_low:     "≥20% · DTE≤10",
  profit_low_dte_high:        "<20% · DTE>10",
  profit_low_dte_low:         "<20% · DTE≤10",
  profit_80_plus:             "≥80% profit",
  profit_60_plus_dte_low:     "≥60% · DTE≤5",
  dte_very_low:               "DTE≤3",
  below_cost_strike_near:     "below-cost · near strike",
  strike_near_non_below_cost: "near strike",
  default:                    "default",
};
export function bucketLabel(bucket) {
  return BUCKET_LABELS[bucket] ?? bucket ?? "—";
}
