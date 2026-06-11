// Aggregate stats for a user-selected subset of open CSP rows.
// Consumed by the selection calculator bar on the Open Positions tab.
// See docs/superpowers/specs/2026-06-11-csp-selection-calculator-design.md.

/**
 * @param {Array<{pos: {strike, contracts, premium_collected}, glDollars: number|null}>} rows
 *   Selected rows in PositionsTable's `enriched` shape. glDollars is unrealized
 *   G/L $ from live option mids — null when the option has no quote.
 * @param {number|null} accountValue - account_value from /api/data, may be absent.
 * @returns {{count, collateral, collateralPct, maxPremium, captured, avgGlPct, missingMarkCount}}
 *   Dollar fields in $, pct fields in % units. captured/avgGlPct cover only rows
 *   with marks (missingMarkCount reports the rest); avgGlPct's denominator is the
 *   premium of marked rows so the ratio stays internally consistent.
 */
export function computeCspAggregates(rows, accountValue) {
  if (!rows?.length) {
    return {
      count: 0, collateral: null, collateralPct: null, maxPremium: null,
      captured: null, avgGlPct: null, missingMarkCount: 0,
    };
  }

  let collateral = 0, maxPremium = 0, captured = 0, markedPremium = 0, missingMarkCount = 0;
  for (const { pos, glDollars } of rows) {
    collateral += (pos.strike ?? 0) * 100 * (pos.contracts ?? 0);
    maxPremium += pos.premium_collected ?? 0;
    if (glDollars == null) { missingMarkCount += 1; continue; }
    captured       += glDollars;
    markedPremium  += pos.premium_collected ?? 0;
  }

  const allUnmarked = missingMarkCount === rows.length;
  return {
    count: rows.length,
    collateral,
    collateralPct: accountValue ? (collateral / accountValue) * 100 : null,
    maxPremium,
    captured: allUnmarked ? null : captured,
    avgGlPct: !allUnmarked && markedPremium > 0 ? (captured / markedPremium) * 100 : null,
    missingMarkCount,
  };
}
