// Pure filter for the cohort-history endpoint: per-day snapshot rows → the
// subset matching a cohort's member tuples. Snapshot rows store type as
// lowercase 'csp' (serializePerPosition in computeForecastV2.js); journal
// entries/positions use 'CSP' — hence the case-insensitive compare.
// The matching client-side copy is `snapMatch` in src/lib/cohorts.js — keep
// the two in sync.

function tupleMatches(member, row) {
  return (
    member.ticker === row.ticker &&
    String(member.type).toLowerCase() === String(row.type).toLowerCase() &&
    String(member.strike) === String(row.strike) &&
    String(member.expiry) === String(row.expiry)
  );
}

export function buildCohortHistory(snapshotRows, memberTuples) {
  if (!Array.isArray(memberTuples) || memberTuples.length === 0) return [];
  const out = [];
  for (const row of snapshotRows ?? []) {
    const perPosition = Array.isArray(row.forecast_per_position) ? row.forecast_per_position : [];
    const members = perPosition
      .filter(p => memberTuples.some(t => tupleMatches(t, p)))
      .map(p => ({
        ticker: p.ticker,
        type: p.type,
        strike: p.strike,
        expiry: p.expiry,
        current_profit_pct: p.current_profit_pct ?? null,
        premium_at_open: p.premium_at_open ?? null,
      }));
    if (members.length > 0) out.push({ date: row.snapshot_date, members });
  }
  return out;
}
