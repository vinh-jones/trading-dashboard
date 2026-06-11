import { describe, it, expect } from "vitest";
import { computeCspAggregates } from "../cspAggregates";

// Row shape mirrors PositionsTable's `enriched` items (extra fields are ignored).
const row = (strike, contracts, premium, glDollars) => ({
  pos: { strike, contracts, premium_collected: premium },
  glDollars,
});

describe("computeCspAggregates", () => {
  it("returns an empty result for no rows", () => {
    expect(computeCspAggregates([], 100000)).toEqual({
      count: 0, collateral: null, collateralPct: null, maxPremium: null,
      captured: null, avgGlPct: null, missingMarkCount: 0,
    });
    expect(computeCspAggregates(null, 100000).count).toBe(0);
  });

  it("sums collateral as strike × 100 × contracts", () => {
    const agg = computeCspAggregates([row(107, 1, 462, -681), row(18, 10, 1180, -1450)], null);
    expect(agg.collateral).toBe(107 * 100 * 1 + 18 * 100 * 10); // 10700 + 18000 = 28700
  });

  it("computes collateral % of account when accountValue is present", () => {
    const agg = computeCspAggregates([row(100, 1, 500, 100)], 50000);
    expect(agg.collateral).toBe(10000);
    expect(agg.collateralPct).toBeCloseTo(20.0, 5);
  });

  it("omits collateral % when accountValue is missing or zero", () => {
    expect(computeCspAggregates([row(100, 1, 500, 100)], null).collateralPct).toBeNull();
    expect(computeCspAggregates([row(100, 1, 500, 100)], 0).collateralPct).toBeNull();
  });

  it("sums max premium across all rows regardless of marks", () => {
    const agg = computeCspAggregates([row(100, 1, 462, -681), row(50, 2, 1180, null)], null);
    expect(agg.maxPremium).toBe(462 + 1180);
  });

  it("skips rows with null glDollars from captured and counts them", () => {
    const agg = computeCspAggregates(
      [row(100, 1, 1000, 500), row(50, 1, 800, null), row(60, 1, 200, -100)],
      null,
    );
    expect(agg.captured).toBe(400); // 500 + (-100); the null-mark row skipped
    expect(agg.missingMarkCount).toBe(1);
  });

  it("weights avg G/L by premium of marked rows only", () => {
    // Marked: 1000 prem / +500 gl. Unmarked: 500 prem excluded from denominator.
    const agg = computeCspAggregates([row(100, 1, 1000, 500), row(50, 1, 500, null)], null);
    expect(agg.avgGlPct).toBeCloseTo(50.0, 5); // 500 / 1000, NOT 500 / 1500
  });

  it("returns null captured and avg G/L when no rows have marks", () => {
    const agg = computeCspAggregates([row(100, 1, 500, null), row(50, 1, 300, null)], 10000);
    expect(agg.captured).toBeNull();
    expect(agg.avgGlPct).toBeNull();
    expect(agg.missingMarkCount).toBe(2);
    expect(agg.collateral).toBe(15000); // collateral/premium still computed
    expect(agg.maxPremium).toBe(800);
  });

  it("treats glDollars of 0 as a valid mark, not a missing one", () => {
    const agg = computeCspAggregates([row(100, 1, 500, 0)], null);
    expect(agg.missingMarkCount).toBe(0);
    expect(agg.captured).toBe(0);
    expect(agg.avgGlPct).toBeCloseTo(0, 5);
  });
});
