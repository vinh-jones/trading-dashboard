import { describe, it, expect } from "vitest";
import {
  computeExpectedMove,
  daysBetween,
  getUpcomingFridays,
  pickPreEarningsExpiry,
  pickEarningsWeekExpiry,
  selectStrikeForPath,
  computePortfolioBaseline,
  computeFamiliarity,
  computeDeploymentGate,
  scoreConvictionFactors,
  buildEarningsPaths,
  computeTickerConcentration,
  projectedConcentration,
  PATH_META,
  CONVICTION_PROMINENCE,
} from "../earningsEngine.js";

// ── Expected move ────────────────────────────────────────────────────────────
describe("computeExpectedMove", () => {
  it("returns S * IV * sqrt(T/365)", () => {
    // S=100, IV=0.40, T=10/365 → 100 * 0.40 * sqrt(10/365) ≈ 6.615
    expect(computeExpectedMove(100, 0.40, 10)).toBeCloseTo(6.62, 1);
  });

  it("returns null for missing inputs", () => {
    expect(computeExpectedMove(null, 0.40, 10)).toBeNull();
    expect(computeExpectedMove(100, null, 10)).toBeNull();
    expect(computeExpectedMove(100, 0.40, null)).toBeNull();
  });

  it("returns null for non-positive DTE", () => {
    expect(computeExpectedMove(100, 0.40, 0)).toBeNull();
    expect(computeExpectedMove(100, 0.40, -5)).toBeNull();
  });
});

// ── Date helpers ─────────────────────────────────────────────────────────────
describe("daysBetween", () => {
  it("computes calendar-day gap", () => {
    expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
  });

  it("is sign-aware (later minus earlier)", () => {
    expect(daysBetween("2026-01-11", "2026-01-01")).toBe(-10);
  });

  it("returns 0 for same day", () => {
    expect(daysBetween("2026-01-15", "2026-01-15")).toBe(0);
  });
});

describe("getUpcomingFridays", () => {
  // 2026-01-01 is a Thursday. Next Fridays: Jan 2, 9, 16, 23, 30, Feb 6…
  it("returns Fridays only, starting after the 'from' date", () => {
    const fridays = getUpcomingFridays("2026-01-01", 35);
    expect(fridays.map(f => f.expiry)).toEqual([
      "2026-01-02",
      "2026-01-09",
      "2026-01-16",
      "2026-01-23",
      "2026-01-30",
    ]);
  });

  it("attaches DTE relative to from date", () => {
    const fridays = getUpcomingFridays("2026-01-01", 10);
    expect(fridays[0]).toEqual({ expiry: "2026-01-02", dte: 1 });
  });
});

describe("pickPreEarningsExpiry", () => {
  it("returns the latest Friday before the earnings date", () => {
    const fridays = getUpcomingFridays("2026-01-01", 35);
    const pick = pickPreEarningsExpiry(fridays, "2026-01-20");
    expect(pick.expiry).toBe("2026-01-16");
  });

  it("returns null if no Friday precedes earnings", () => {
    const fridays = getUpcomingFridays("2026-01-01", 35);
    expect(pickPreEarningsExpiry(fridays, "2026-01-01")).toBeNull();
  });
});

describe("pickEarningsWeekExpiry", () => {
  it("returns the first Friday on or after earnings date", () => {
    const fridays = getUpcomingFridays("2026-01-01", 35);
    const pick = pickEarningsWeekExpiry(fridays, "2026-01-20");
    expect(pick.expiry).toBe("2026-01-23");
  });

  it("returns the Friday itself when earnings is on a Friday", () => {
    const fridays = getUpcomingFridays("2026-01-01", 35);
    const pick = pickEarningsWeekExpiry(fridays, "2026-01-16");
    expect(pick.expiry).toBe("2026-01-16");
  });
});

// ── Strike selection ─────────────────────────────────────────────────────────
describe("selectStrikeForPath", () => {
  const strikes = [
    { strike:  90, delta: -0.10, mid: 0.50 },
    { strike:  95, delta: -0.17, mid: 0.80 },
    { strike: 100, delta: -0.23, mid: 1.10 },
    { strike: 102, delta: -0.27, mid: 1.40 },
    { strike: 105, delta: -0.35, mid: 1.80 },
  ];

  // Score uses |delta - target|. Deltas in the table are negative puts, but
  // the live code compares s.delta to the (positive) target. The tests below
  // deliberately use positive deltas at the strikes the path is looking for.
  // Path B targets price at lowerBoundMinus5 (90.25 when lowerBound=95) and
  // must sit below lowerBound — so the 0.16 strike needs to be below 95.
  const putStrikes = [
    { strike:  88, delta: 0.16, mid: 0.40 }, // matches path B target (below LB)
    { strike:  95, delta: 0.17, mid: 0.80 }, // matches path A target (at LB)
    { strike: 100, delta: 0.23, mid: 1.10 }, // matches path C target
    { strike: 102, delta: 0.27, mid: 1.40 }, // matches path D target
    { strike: 105, delta: 0.35, mid: 1.80 },
  ];

  it("picks the 0.17-delta strike for path A (avoid)", () => {
    const pick = selectStrikeForPath("A", 100, 95, putStrikes);
    expect(pick.delta).toBe(0.17);
  });

  it("picks the 0.16-delta strike for path B (defensive)", () => {
    const pick = selectStrikeForPath("B", 100, 95, putStrikes);
    expect(pick.delta).toBe(0.16);
  });

  it("picks the 0.23-delta strike for path C (standard)", () => {
    const pick = selectStrikeForPath("C", 100, 95, putStrikes);
    expect(pick.delta).toBe(0.23);
  });

  it("picks the 0.27-delta strike for path D (aggressive)", () => {
    const pick = selectStrikeForPath("D", 100, 95, putStrikes);
    expect(pick.delta).toBe(0.27);
  });

  it("returns null for unknown path", () => {
    expect(selectStrikeForPath("Z", 100, 95, putStrikes)).toBeNull();
  });

  it("returns null for missing lowerBound", () => {
    expect(selectStrikeForPath("A", 100, null, putStrikes)).toBeNull();
  });

  it("returns null for empty strike list", () => {
    expect(selectStrikeForPath("A", 100, 95, [])).toBeNull();
  });

  it("filters out strikes missing delta or strike", () => {
    const dirty = [{ strike: 95, delta: null, mid: 1 }, { strike: null, delta: 0.17, mid: 1 }];
    expect(selectStrikeForPath("A", 100, 95, dirty)).toBeNull();
  });

  it("applies 'below' constraint penalty when strike > lowerBound", () => {
    // Two strikes at same delta; one above lowerBound should be penalized.
    const both = [
      { strike: 90, delta: 0.17, mid: 0.5 },   // below lowerBound=95 → no penalty
      { strike: 98, delta: 0.17, mid: 0.6 },   // above lowerBound=95 → penalty
    ];
    const pick = selectStrikeForPath("A", 100, 95, both);
    expect(pick.strike).toBe(90);
  });
});

// ── Portfolio baseline ────────────────────────────────────────────────────────
describe("computePortfolioBaseline", () => {
  it("averages ROI and computes win rate across closed CSPs", () => {
    const trades = [
      { type: "CSP", closeDate: 1, roi: 2 },
      { type: "CSP", closeDate: 2, roi: 4 },
      { type: "CSP", closeDate: 3, roi: -1 },
      { type: "CC",  closeDate: 4, roi: 10 }, // excluded
      { type: "CSP", closeDate: null, roi: 9 }, // excluded (not closed)
    ];
    const result = computePortfolioBaseline(trades);
    expect(result.count).toBe(3);
    expect(result.avgRoi).toBeCloseTo(5 / 3);
    expect(result.winRate).toBeCloseTo(2 / 3);
  });

  it("returns null stats when no CSPs", () => {
    expect(computePortfolioBaseline([])).toEqual({ avgRoi: null, winRate: null, count: 0 });
    expect(computePortfolioBaseline(null)).toEqual({ avgRoi: null, winRate: null, count: 0 });
  });
});

// ── Familiarity ──────────────────────────────────────────────────────────────
describe("computeFamiliarity", () => {
  const baseline = { avgRoi: 2 };

  it("returns null for missing ticker or trades", () => {
    expect(computeFamiliarity(null, [], baseline)).toBeNull();
    expect(computeFamiliarity("AAPL", null, baseline)).toBeNull();
  });

  it("returns zeroed stats when ticker has no prior CSPs", () => {
    const result = computeFamiliarity("AAPL", [{ ticker: "MSFT", type: "CSP", closeDate: 1, roi: 5 }], baseline);
    expect(result.lifetimeCsps).toBe(0);
    expect(result.winRate).toBeNull();
    expect(result.avgRoi).toBeNull();
  });

  it("aggregates per-ticker stats", () => {
    const trades = [
      { ticker: "AAPL", type: "CSP", closeDate: 3, roi:  4, subtype: "Close" },
      { ticker: "AAPL", type: "CSP", closeDate: 2, roi: -1, subtype: "Assigned" },
      { ticker: "AAPL", type: "CSP", closeDate: 1, roi:  2, subtype: "Close" },
      { ticker: "MSFT", type: "CSP", closeDate: 9, roi: 10 },
    ];
    const result = computeFamiliarity("AAPL", trades, baseline);
    expect(result.lifetimeCsps).toBe(3);
    expect(result.assignments).toBe(1);
    expect(result.winRate).toBeCloseTo(2 / 3);
    expect(result.avgRoi).toBeCloseTo(5 / 3);
    expect(result.relativeRoi).toBeCloseTo(5 / 3 - 2);
    expect(result.lastTrade.roi).toBe(4);
    expect(result.best.roi).toBe(4);
    expect(result.worst.roi).toBe(-1);
  });
});

// ── Deployment gate ──────────────────────────────────────────────────────────
describe("computeDeploymentGate", () => {
  it("returns 'at-floor' when free cash is at or below VIX band floor", () => {
    // VIX 18 → band ≤20, floorPct 0.20. freeCash 0.20 → roomToDeploy 0 → at-floor
    const gate = computeDeploymentGate(18, 0.20, 100000);
    expect(gate.status).toBe("at-floor");
    expect(gate.roomToDeploy).toBe(0);
  });

  it("returns 'tight' when roomToDeploy is positive but below 5%", () => {
    // freeCash 0.22, floor 0.20 → room 0.02 < 0.05 → tight
    const gate = computeDeploymentGate(18, 0.22, 100000);
    expect(gate.status).toBe("tight");
  });

  it("returns 'open' when room ≥ 5%", () => {
    const gate = computeDeploymentGate(18, 0.30, 100000);
    expect(gate.status).toBe("open");
    expect(gate.marginPct).toBeCloseTo(0.10 * 100000);
  });

  it("returns 'unknown' when free cash not provided", () => {
    const gate = computeDeploymentGate(18, null, 100000);
    expect(gate.status).toBe("unknown");
  });

  it("returns no band when VIX missing", () => {
    const gate = computeDeploymentGate(null, 0.30, 100000);
    expect(gate.band).toBeNull();
    expect(gate.status).toBe("unknown");
  });
});

// ── Conviction scoring ───────────────────────────────────────────────────────
describe("scoreConvictionFactors", () => {
  it("returns STANDARD when no signals provided", () => {
    const result = scoreConvictionFactors({});
    expect(result.suggested).toBe("STANDARD");
    expect(result.factors).toEqual([]);
  });

  it("flags BB at/below lower band as high conviction", () => {
    const result = scoreConvictionFactors({ bbPosition: 0.10 });
    expect(result.highCount).toBe(1);
    expect(result.factors[0].suggests).toBe("High");
  });

  it("flags BB near upper band as low conviction", () => {
    const result = scoreConvictionFactors({ bbPosition: 0.90 });
    expect(result.lowCount).toBe(1);
    expect(result.factors[0].suggests).toBe("Low");
  });

  it("flags mid-range BB as standard", () => {
    const result = scoreConvictionFactors({ bbPosition: 0.50 });
    expect(result.standardCount).toBe(1);
  });

  it("flags concentration < 5% as room for high conviction", () => {
    const result = scoreConvictionFactors({ concentration: 0.03 });
    expect(result.highCount).toBe(1);
  });

  it("flags concentration > 10% as low conviction", () => {
    const result = scoreConvictionFactors({ concentration: 0.12 });
    expect(result.lowCount).toBe(1);
  });

  it("weights familiarity by 0.3", () => {
    const result = scoreConvictionFactors({
      familiarity: { lifetimeCsps: 10, winRate: 0.80, avgRoi: 5, relativeRoi: 2, assignments: 1 },
    });
    expect(result.highCount).toBeCloseTo(0.3);
  });

  it("suggests HIGH direction when highCount dominates", () => {
    const result = scoreConvictionFactors({ bbPosition: 0.10, concentration: 0.03 });
    expect(result.suggested).toBe("STANDARD with room for HIGH");
  });

  it("suggests LOW direction when lowCount dominates", () => {
    const result = scoreConvictionFactors({ bbPosition: 0.90, concentration: 0.15 });
    expect(result.suggested).toBe("LOW with room for STANDARD");
  });

  it("labels IV rank context without affecting counts", () => {
    const result = scoreConvictionFactors({ ivRank: 75 });
    expect(result.factors[0].value).toContain("elevated");
    expect(result.highCount).toBe(0);
    expect(result.lowCount).toBe(0);
  });
});

// ── Path metadata structure ──────────────────────────────────────────────────
describe("PATH_META and CONVICTION_PROMINENCE", () => {
  it("has labels for all four paths", () => {
    expect(PATH_META.A.label).toBe("Avoid Earnings");
    expect(PATH_META.B.label).toBe("Defensive");
    expect(PATH_META.C.label).toBe("Standard");
    expect(PATH_META.D.label).toBe("Aggressive");
  });

  it("maps each conviction level to exactly two prominent paths", () => {
    expect(CONVICTION_PROMINENCE.low).toEqual(["A", "B"]);
    expect(CONVICTION_PROMINENCE.standard).toEqual(["B", "C"]);
    expect(CONVICTION_PROMINENCE.high).toEqual(["C", "D"]);
  });
});

// ── buildEarningsPaths (integration) ─────────────────────────────────────────
describe("buildEarningsPaths", () => {
  const strikes = [
    { strike:  90, delta: 0.10, mid: 0.50, bid: 0.45, ask: 0.55, iv: 0.40, osi: "x" },
    { strike:  95, delta: 0.17, mid: 0.80, bid: 0.75, ask: 0.85, iv: 0.42, osi: "x" },
    { strike: 100, delta: 0.23, mid: 1.10, bid: 1.05, ask: 1.15, iv: 0.45, osi: "x" },
    { strike: 102, delta: 0.27, mid: 1.40, bid: 1.35, ask: 1.45, iv: 0.46, osi: "x" },
  ];

  it("returns four paths with expected move summary", () => {
    // todayIso=2026-01-05 (Mon), earningsIso=2026-01-21 (Wed)
    // Earnings-week Friday = 2026-01-23, pre Friday = 2026-01-16
    const result = buildEarningsPaths({
      ticker: "AAPL",
      todayIso: "2026-01-05",
      earningsIso: "2026-01-21",
      spot: 100,
      chainByExpiry: {
        "2026-01-16": { atmIV: 0.40, strikes },
        "2026-01-23": { atmIV: 0.45, strikes },
      },
    });
    expect(Object.keys(result.paths).sort()).toEqual(["A", "B", "C", "D"]);
    expect(result.expectedMove.atmIV).toBe(0.45);
    expect(result.expectedMove.lowerBound).toBeLessThan(100);
    expect(result.expectedMove.upperBound).toBeGreaterThan(100);
  });

  it("marks paths unavailable when their chain is missing", () => {
    const result = buildEarningsPaths({
      ticker: "AAPL",
      todayIso: "2026-01-05",
      earningsIso: "2026-01-21",
      spot: 100,
      chainByExpiry: {}, // no chains
    });
    expect(result.paths.A.available).toBe(false);
    expect(result.paths.B.available).toBe(false);
  });
});

// ── Concentration ────────────────────────────────────────────────────────────
describe("computeTickerConcentration", () => {
  const positions = {
    open_csps: [
      { ticker: "AAPL", strike: 100, contracts: 2 },        // 100*2*100 = 20000
      { ticker: "MSFT", strike: 300, contracts: 1 },
    ],
    assigned_shares: [
      { ticker: "AAPL", cost_basis_total: 10000, open_leaps: [{ entry_cost: 500 }] },
      { ticker: "NVDA", cost_basis_total: 5000, open_leaps: [] },
    ],
    open_leaps: [
      { ticker: "AAPL", entry_cost: 1500 },
    ],
  };

  it("sums CSPs, assigned shares, nested LEAPs, and top-level LEAPs for the ticker", () => {
    // AAPL: 20000 + 10000 + 500 + 1500 = 32000 / 100000 = 0.32
    expect(computeTickerConcentration("AAPL", positions, 100000)).toBeCloseTo(0.32);
  });

  it("returns null for missing inputs", () => {
    expect(computeTickerConcentration(null, positions, 100000)).toBeNull();
    expect(computeTickerConcentration("AAPL", null, 100000)).toBeNull();
    expect(computeTickerConcentration("AAPL", positions, 0)).toBeNull();
  });
});

describe("projectedConcentration", () => {
  it("adds strike * 100 / accountValue to current concentration", () => {
    expect(projectedConcentration(0.05, 100, 100000)).toBeCloseTo(0.05 + 0.10);
  });

  it("returns null for missing inputs", () => {
    expect(projectedConcentration(null, 100, 100000)).toBeNull();
    expect(projectedConcentration(0.05, null, 100000)).toBeNull();
    expect(projectedConcentration(0.05, 100, null)).toBeNull();
  });
});
