import { describe, it, expect } from "vitest";
import {
  EARNINGS_PATHS,
  EARNINGS_PRICE_TARGET_PARAMS,
  EARNINGS_PATH_SCORING,
  resolveEarningsPriceTarget,
  PROFIT_TIERS,
  CONVICTION_THRESHOLDS,
  DEPLOYMENT_GATE_TIGHT_THRESHOLD,
} from "../strategyConfig.js";

// Lock-in tests — these values are the spec. A diff here should force
// a conversation, not slide through as an incidental change.

describe("EARNINGS_PATHS", () => {
  it("has four paths A/B/C/D", () => {
    expect(Object.keys(EARNINGS_PATHS).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("pins deltas per spec", () => {
    expect(EARNINGS_PATHS.A.targetDelta).toBe(0.17);
    expect(EARNINGS_PATHS.B.targetDelta).toBe(0.16);
    expect(EARNINGS_PATHS.C.targetDelta).toBe(0.23);
    expect(EARNINGS_PATHS.D.targetDelta).toBe(0.27);
  });

  it("pins price targets and constraints per spec", () => {
    expect(EARNINGS_PATHS.A.priceTarget).toBe("lowerBound");
    expect(EARNINGS_PATHS.A.priceConstraint).toBe("below");
    expect(EARNINGS_PATHS.B.priceTarget).toBe("lowerBoundMinus5");
    expect(EARNINGS_PATHS.B.priceConstraint).toBe("below");
    expect(EARNINGS_PATHS.C.priceTarget).toBe("lowerBound");
    expect(EARNINGS_PATHS.C.priceConstraint).toBe("near");
    expect(EARNINGS_PATHS.D.priceTarget).toBe("aggressiveTarget");
    expect(EARNINGS_PATHS.D.priceConstraint).toBe("above");
  });
});

describe("resolveEarningsPriceTarget", () => {
  it("returns lowerBound unchanged", () => {
    expect(resolveEarningsPriceTarget("lowerBound", 100, 90)).toBe(90);
  });

  it("computes lowerBoundMinus5 as 5% below lower bound", () => {
    expect(resolveEarningsPriceTarget("lowerBoundMinus5", 100, 90)).toBeCloseTo(85.5);
    expect(EARNINGS_PRICE_TARGET_PARAMS.lowerBoundMinus5Fraction).toBe(0.95);
  });

  it("computes aggressiveTarget as 30% of the way from lower bound to spot", () => {
    expect(resolveEarningsPriceTarget("aggressiveTarget", 100, 90)).toBeCloseTo(93);
    expect(EARNINGS_PRICE_TARGET_PARAMS.aggressiveTargetRatio).toBe(0.30);
  });

  it("returns null for unknown target name", () => {
    expect(resolveEarningsPriceTarget("unknown", 100, 90)).toBeNull();
  });
});

describe("EARNINGS_PATH_SCORING", () => {
  it("pins deltaWeight at 10 so delta dominates", () => {
    expect(EARNINGS_PATH_SCORING.deltaWeight).toBe(10);
  });

  it("pins constraintPenalty at 0.5", () => {
    expect(EARNINGS_PATH_SCORING.constraintPenalty).toBe(0.5);
  });
});

describe("PROFIT_TIERS", () => {
  it("has three tiers sorted descending by minDtePct", () => {
    expect(PROFIT_TIERS).toHaveLength(3);
    for (let i = 0; i < PROFIT_TIERS.length - 1; i++) {
      expect(PROFIT_TIERS[i].minDtePct).toBeGreaterThan(PROFIT_TIERS[i + 1].minDtePct);
    }
  });

  it("pins the 50/60/80 tiers at 80/40/0 breakpoints", () => {
    expect(PROFIT_TIERS[0]).toEqual({ minDtePct: 80, targetProfitPct: 50 });
    expect(PROFIT_TIERS[1]).toEqual({ minDtePct: 40, targetProfitPct: 60 });
    expect(PROFIT_TIERS[2]).toEqual({ minDtePct: 0,  targetProfitPct: 80 });
  });
});

describe("CONVICTION_THRESHOLDS", () => {
  it("pins BB position brackets", () => {
    expect(CONVICTION_THRESHOLDS.bbPositionLow).toBe(0.20);
    expect(CONVICTION_THRESHOLDS.bbPositionHigh).toBe(0.80);
  });

  it("pins concentration brackets at 5%/10%", () => {
    expect(CONVICTION_THRESHOLDS.concentrationLow).toBe(0.05);
    expect(CONVICTION_THRESHOLDS.concentrationHigh).toBe(0.10);
  });

  it("pins win-rate brackets at 70%/40%", () => {
    expect(CONVICTION_THRESHOLDS.winRateHigh).toBe(0.70);
    expect(CONVICTION_THRESHOLDS.winRateLow).toBe(0.40);
  });

  it("pins IV rank brackets at 70/40", () => {
    expect(CONVICTION_THRESHOLDS.ivRankElevated).toBe(70);
    expect(CONVICTION_THRESHOLDS.ivRankModerate).toBe(40);
  });

  it("pins familiarity weight at 0.3", () => {
    expect(CONVICTION_THRESHOLDS.familiarityWeight).toBe(0.3);
  });
});

describe("DEPLOYMENT_GATE_TIGHT_THRESHOLD", () => {
  it("pins tight threshold at 5%", () => {
    expect(DEPLOYMENT_GATE_TIGHT_THRESHOLD).toBe(0.05);
  });
});
