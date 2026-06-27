import { describe, it, expect } from "vitest";
import {
  adjBeta, legRisk, legPnlUnderShock, scenarioGrid, aggregateRisk,
  buildRiskLegs, computeRiskUnits, DEFAULT_SPX_SHOCKS, DEFAULT_IV_SHOCKS,
} from "../riskEngine.js";

// Leg factories ──────────────────────────────────────────────────────────────
const shareLeg = (o = {}) => ({
  kind: "SHARES", ticker: "T", shares: 100, spot: 50, sign: +1,
  betaAdj: 1.0, capital: 5000, covered: true, ...o,
});
const optLeg = (o = {}) => ({
  kind: "LEAP", ticker: "T", right: "call", contracts: 1, strike: 100,
  T: 1.0, spot: 100, iv: 0.30, quoteDelta: null, sign: +1, betaAdj: 1.0,
  capital: 0, covered: true, ...o,
});

describe("adjBeta (Blume shrinkage toward 1.0)", () => {
  it("0.67·β + 0.33", () => expect(adjBeta(1.8)).toBeCloseTo(1.536, 3));
  it("β=1 is a fixed point", () => expect(adjBeta(1.0)).toBeCloseTo(1.0, 6));
  it("null/NaN → 1.0 (assumed market)", () => {
    expect(adjBeta(null)).toBe(1.0);
    expect(adjBeta(undefined)).toBe(1.0);
  });
  it("β=0 → 0.33", () => expect(adjBeta(0)).toBeCloseTo(0.33, 6));
});

describe("legRisk — signs encode instrument structure", () => {
  it("shares: beta-weighted delta = shares·spot·1%·betaAdj", () => {
    const r = legRisk(shareLeg({ betaAdj: 1.2 }));
    expect(r.betaWeightedDelta).toBeCloseTo(100 * 50 * 0.01 * 1.2, 6); // 60
    expect(r.positionDelta).toBe(100);
    expect(r.vegaDollars).toBe(0);
    expect(r.thetaDollars).toBe(0);
  });

  it("long LEAP call: +delta, +vega (long vol), −theta (pays decay)", () => {
    const r = legRisk(optLeg({ kind: "LEAP", sign: +1 }));
    expect(r.positionDelta).toBeGreaterThan(0);
    expect(r.betaWeightedDelta).toBeGreaterThan(0);
    expect(r.vegaDollars).toBeGreaterThan(0);
    expect(r.thetaDollars).toBeLessThan(0);
  });

  it("short put (CSP): +delta (bullish), −vega (short vol), +theta (collects)", () => {
    const r = legRisk(optLeg({ kind: "CSP", right: "put", sign: -1, T: 30 / 365 }));
    expect(r.positionDelta).toBeGreaterThan(0);   // short put is long the underlying
    expect(r.betaWeightedDelta).toBeGreaterThan(0);
    expect(r.vegaDollars).toBeLessThan(0);
    expect(r.thetaDollars).toBeGreaterThan(0);
  });

  it("LEAP and CSP have OPPOSITE vega and theta signs (the research point)", () => {
    const leap = legRisk(optLeg({ kind: "LEAP", right: "call", sign: +1 }));
    const csp  = legRisk(optLeg({ kind: "CSP",  right: "put",  sign: -1 }));
    expect(Math.sign(leap.vegaDollars)).toBe(-Math.sign(csp.vegaDollars));
    expect(Math.sign(leap.thetaDollars)).toBe(-Math.sign(csp.thetaDollars));
  });

  it("prefers the live quote delta over BS when present", () => {
    const withQuote = legRisk(optLeg({ quoteDelta: 0.80 }));
    const noQuote   = legRisk(optLeg({ quoteDelta: null }));
    expect(withQuote.positionDelta).toBeCloseTo(0.80 * 100, 6);
    expect(withQuote.positionDelta).not.toBeCloseTo(noQuote.positionDelta, 1);
  });

  it("uncovered leg → null", () => {
    expect(legRisk(optLeg({ covered: false }))).toBeNull();
  });
});

describe("legPnlUnderShock — full revaluation", () => {
  it("shares: linear, beta-scaled", () => {
    // 100sh @ $50, betaAdj 1.2, SPX −5% → underlying −6% → −$300
    const pnl = legPnlUnderShock(shareLeg({ betaAdj: 1.2 }), -5, 0);
    expect(pnl).toBeCloseTo(100 * (50 * (1 - 0.06) - 50), 6); // −300
  });

  it("flat shock (0%, 0pts) → 0 P&L", () => {
    expect(legPnlUnderShock(optLeg(), 0, 0)).toBeCloseTo(0, 6);
    expect(legPnlUnderShock(shareLeg(), 0, 0)).toBe(0);
  });

  it("short put loses on a down move and on a vol spike", () => {
    const csp = optLeg({ kind: "CSP", right: "put", sign: -1, T: 30 / 365 });
    expect(legPnlUnderShock(csp, -5, 0)).toBeLessThan(0);  // price drop
    expect(legPnlUnderShock(csp, 0, 10)).toBeLessThan(0);  // IV +10pts, short vol
  });

  it("long call gains on an up move", () => {
    expect(legPnlUnderShock(optLeg({ sign: +1 }), 3, 0)).toBeGreaterThan(0);
  });

  it("uncovered leg contributes 0", () => {
    expect(legPnlUnderShock(optLeg({ covered: false }), -5, 0)).toBe(0);
  });
});

describe("scenarioGrid", () => {
  const legs = [optLeg({ sign: +1 }), shareLeg()];
  const grid = scenarioGrid(legs);

  it("has default dimensions (5 SPX × 4 IV)", () => {
    expect(grid).toHaveLength(DEFAULT_SPX_SHOCKS.length);
    expect(grid[0].cells).toHaveLength(DEFAULT_IV_SHOCKS.length);
  });

  it("the flat cell (0% SPX, 0 IV) is ~0", () => {
    const flatRow = grid.find(r => r.spxShock === 0);
    const flatCell = flatRow.cells.find(c => c.ivShock === 0);
    expect(flatCell.pnl).toBeCloseTo(0, 4);
  });

  it("a long-biased book loses in the −8% row vs the +3% row", () => {
    const down = grid.find(r => r.spxShock === -8).cells.find(c => c.ivShock === 0).pnl;
    const up   = grid.find(r => r.spxShock ===  3).cells.find(c => c.ivShock === 0).pnl;
    expect(down).toBeLessThan(up);
  });
});

describe("aggregateRisk", () => {
  it("sums denominators over covered legs and reports coverage", () => {
    const legs = [
      optLeg({ kind: "LEAP", sign: +1, ticker: "A" }),
      optLeg({ kind: "CSP", right: "put", sign: -1, ticker: "B", T: 30 / 365, capital: 10000 }),
      optLeg({ covered: false, ticker: "C", uncoveredReason: "no IV" }),
    ];
    const agg = aggregateRisk(legs);
    expect(agg.coverage.covered).toBe(2);
    expect(agg.coverage.total).toBe(3);
    expect(agg.coverage.uncovered[0].ticker).toBe("C");
    expect(agg.perPosition).toHaveLength(2);
    // net vega: long LEAP (+) partly offsets short CSP (−)
    const leapVega = legRisk(legs[0]).vegaDollars;
    const cspVega  = legRisk(legs[1]).vegaDollars;
    expect(agg.netVega).toBeCloseTo(leapVega + cspVega, 6);
  });

  it("rolls capital up by family even for uncovered legs", () => {
    const legs = [optLeg({ covered: false, kind: "LEAP", capital: 4000, uncoveredReason: "x" })];
    const agg = aggregateRisk(legs);
    expect(agg.byFamily.LEAP.capital).toBe(4000);
    expect(agg.totalCapital).toBe(4000);
  });
});

// buildRiskLegs / computeRiskUnits with injected stubs ────────────────────────
describe("buildRiskLegs (pure, injected deps)", () => {
  const positions = {
    open_csps: [{ ticker: "NVDA", strike: 100, expiry_date: "2026-08-21", contracts: 2, capital_fronted: 20000 }],
    open_leaps: [{ ticker: "GOOGL", strike: 150, expiry_date: "2027-08-20", contracts: 1, entry_cost: 9000 }],
    assigned_shares: [{ ticker: "HOOD", cost_basis_total: 50000, positions: [{ description: "100 shares", fronted: 50000 }] }],
    open_spreads: [],
  };
  const quotes = {
    NVDA: { last: 105 },
    GOOGL: { last: 160 },
    HOOD: { last: 25 },
    "NVDA260821P00100000": { iv: 0.45, delta: -0.30 },
    "GOOGL270820C00150000": { iv: 0.35, delta: 0.62 },
  };
  const ctx = {
    getQuote: (s) => quotes[s],
    getBeta: (t) => ({ NVDA: 1.6, GOOGL: 1.0, HOOD: 1.9 }[t] ?? null),
    todayIso: "2026-06-27",
  };

  it("builds one leg per position with correct kinds and signs", () => {
    const legs = buildRiskLegs(positions, ctx);
    const byKind = Object.fromEntries(legs.map(l => [l.kind, l]));
    expect(byKind.CSP.sign).toBe(-1);
    expect(byKind.CSP.right).toBe("put");
    expect(byKind.LEAP.sign).toBe(+1);
    expect(byKind.SHARES.ticker).toBe("HOOD");
  });

  it("attaches live IV/delta and applies Blume beta", () => {
    const csp = buildRiskLegs(positions, ctx).find(l => l.kind === "CSP");
    expect(csp.iv).toBe(0.45);
    expect(csp.quoteDelta).toBe(-0.30);
    expect(csp.betaAdj).toBeCloseTo(0.67 * 1.6 + 0.33, 6); // 1.402
    expect(csp.covered).toBe(true);
  });

  it("marks a leg uncovered when IV is missing", () => {
    const noIv = { ...ctx, getQuote: (s) => (s === "NVDA260821P00100000" ? { delta: -0.3 } : quotes[s]) };
    const csp = buildRiskLegs(positions, noIv).find(l => l.kind === "CSP");
    expect(csp.covered).toBe(false);
    expect(csp.uncoveredReason).toBe("no IV");
  });

  it("computeRiskUnits returns aggregate + grid together", () => {
    const out = computeRiskUnits(positions, ctx);
    expect(out.aggregate.coverage.covered).toBeGreaterThan(0);
    expect(out.grid).toHaveLength(DEFAULT_SPX_SHOCKS.length);
    expect(out.legs.length).toBe(3);
  });
});
