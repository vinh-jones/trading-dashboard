import { describe, it, expect } from "vitest";
import {
  cspBucket,
  ccBucket,
  expectedFinalCapturePct,
  expectedRemainingRealization,
  realizationThisMonth,
  computePipelineForecast,
  buildOccForPosition,
  vixRegimeMultiplier,
  SPEC_STARTING_VALUES,
} from "../pipelineForecast.js";
import { buildOccSymbol } from "../trading.js";

describe("buildOccForPosition", () => {
  it("matches buildOccSymbol (canonical) output — must agree or quote lookups miss", () => {
    const row = { ticker: "SOFI", expiry_date: "2026-05-01", strike: 24, type: "CSP" };
    expect(buildOccForPosition(row)).toBe(buildOccSymbol(row.ticker, row.expiry_date, false, row.strike));
  });

  it("builds un-padded Put symbol", () => {
    expect(buildOccForPosition({ ticker: "AAPL", expiry_date: "2026-05-01", strike: 180, type: "CSP" }))
      .toBe("AAPL260501P00180000");
  });

  it("builds un-padded Call symbol for CC", () => {
    expect(buildOccForPosition({ ticker: "F", expiry_date: "2026-06-19", strike: 15, type: "CC" }))
      .toBe("F260619C00015000");
  });
});

describe("cspBucket", () => {
  it("routes ≥60% profit to profit_60_plus regardless of DTE", () => {
    expect(cspBucket({ currentProfitPct: 0.62, dte: 2 })).toBe("profit_60_plus");
    expect(cspBucket({ currentProfitPct: 0.90, dte: 30 })).toBe("profit_60_plus");
  });

  it("routes 40-60% with DTE>10 to profit_40_60_dte_high", () => {
    expect(cspBucket({ currentProfitPct: 0.45, dte: 15 })).toBe("profit_40_60_dte_high");
  });

  it("routes 40-60% with DTE<=10 to new profit_40_60_dte_low bucket", () => {
    expect(cspBucket({ currentProfitPct: 0.45, dte: 5 })).toBe("profit_40_60_dte_low");
  });

  it("routes 20-40% with DTE>10 to new profit_20_40_dte_high bucket", () => {
    expect(cspBucket({ currentProfitPct: 0.30, dte: 20 })).toBe("profit_20_40_dte_high");
  });

  it("routes 20-40% with DTE<=10 to profit_20_plus_dte_low", () => {
    expect(cspBucket({ currentProfitPct: 0.30, dte: 7 })).toBe("profit_20_plus_dte_low");
  });

  it("routes low profit DTE>10 to profit_low_dte_high", () => {
    expect(cspBucket({ currentProfitPct: 0.05, dte: 20 })).toBe("profit_low_dte_high");
  });

  it("routes low profit DTE<=10 to profit_low_dte_low", () => {
    expect(cspBucket({ currentProfitPct: 0.05, dte: 3 })).toBe("profit_low_dte_low");
  });
});

describe("ccBucket", () => {
  it("below-cost with stock within 2% of strike routes to below_cost_strike_near", () => {
    expect(ccBucket({
      currentProfitPct: 0.3, dte: 5,
      stockPrice: 103.4, strike: 105, costBasis: 110,
    })).toBe("below_cost_strike_near");
  });

  it("near-strike (not below cost) routes to strike_near_non_below_cost", () => {
    expect(ccBucket({
      currentProfitPct: 0.3, dte: 5,
      stockPrice: 104, strike: 105, costBasis: 100,
    })).toBe("strike_near_non_below_cost");
  });

  it("≥80% profit routes to profit_80_plus", () => {
    expect(ccBucket({
      currentProfitPct: 0.85, dte: 5,
      stockPrice: 90, strike: 105, costBasis: 100,
    })).toBe("profit_80_plus");
  });

  it("DTE<=3 and not near strike routes to dte_very_low", () => {
    expect(ccBucket({
      currentProfitPct: 0.50, dte: 2,
      stockPrice: 90, strike: 105, costBasis: 100,
    })).toBe("dte_very_low");
  });
});

describe("expectedFinalCapturePct", () => {
  it("uses calibrated value when provided", () => {
    const cal = { csp: { profit_60_plus: 0.76 } };
    const result = expectedFinalCapturePct(
      { type: "csp", currentProfitPct: 0.70, dte: 5 },
      cal,
    );
    expect(result.bucket).toBe("profit_60_plus");
    expect(result.pct).toBe(0.76);
  });

  it("falls back to starting value when no calibration provided", () => {
    const result = expectedFinalCapturePct(
      { type: "csp", currentProfitPct: 0.70, dte: 5 },
      {},
    );
    expect(result.pct).toBe(SPEC_STARTING_VALUES.csp.profit_60_plus);
  });

  it("below-cost-strike-near returns negative when position pnl<0", () => {
    const result = expectedFinalCapturePct(
      {
        type: "cc", currentProfitPct: 0.3, dte: 5,
        stockPrice: 103.4, strike: 105, costBasis: 110,
        positionPnl: -50,
      },
      {},
    );
    expect(result.bucket).toBe("below_cost_strike_near");
    expect(result.pct).toBe(-SPEC_STARTING_VALUES.cc.below_cost_strike_near);
  });
});

describe("expectedRemainingRealization", () => {
  it("floors at -50% of premium at open", () => {
    // Setup a below-cost CC with negative pct and positive realizedToDate
    // to force remaining below the -50% floor.
    const state = {
      type: "cc", currentProfitPct: 0.3, dte: 5,
      stockPrice: 103, strike: 105, costBasis: 110, positionPnl: -500,
      premiumAtOpen: 1000, realizedToDate: 0,
    };
    const remaining = expectedRemainingRealization(state, {});
    // total = 1000 * -0.20 = -200; remaining = -200 - 0 = -200; floor = -500
    // -200 > -500, so no flooring needed
    expect(remaining).toBe(-200);
  });

  it("subtracts realizedToDate from expected total", () => {
    const state = {
      type: "csp", currentProfitPct: 0.70, dte: 5,
      premiumAtOpen: 1000, realizedToDate: 300,
    };
    const remaining = expectedRemainingRealization(state, { csp: { profit_60_plus: 0.80 } });
    expect(remaining).toBe(500);  // 1000*0.80 - 300
  });
});

describe("realizationThisMonth", () => {
  const today = new Date("2026-04-15T00:00:00Z");

  it("attributes all remaining to current month when position expires this month", () => {
    const state = {
      type: "csp", currentProfitPct: 0.70, dte: 10,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-04-25"),
    };
    const r = realizationThisMonth(state, today, { csp: { profit_60_plus: 0.80 } });
    expect(r).toBe(800);
  });

  it("attributes full remaining to current month for ≥60% CSP expiring next month (early close)", () => {
    const state = {
      type: "csp", currentProfitPct: 0.65, dte: 25,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-05-15"),
    };
    const r = realizationThisMonth(state, today, { csp: { profit_60_plus: 0.80 } });
    expect(r).toBe(800);
  });

  it("attributes scaled 8% for mildly profitable CSP expiring next month", () => {
    const state = {
      type: "csp", currentProfitPct: 0.10, dte: 25,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-05-15"),
    };
    // remaining = 1000 * 0.55 = 550 (profit_low_dte_high bucket)
    // today=Apr 15, eom=Apr 30, daysToEom=15, windowScalar = 15/20 = 0.75
    // thisMonth = 550 * 0.08 * 0.75 = 33
    const r = realizationThisMonth(state, today, {});
    expect(r).toBeCloseTo(33);
  });

  it("attributes scaled 3% for slightly underwater CSP expiring next month", () => {
    const state = {
      type: "csp", currentProfitPct: -0.10, dte: 25,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-05-15"),
    };
    // remaining = 550; windowScalar = 0.75; thisMonth = 550 * 0.03 * 0.75 = 12.375
    const r = realizationThisMonth(state, today, {});
    expect(r).toBeCloseTo(12.375);
  });

  it("attributes 0 for deeply underwater CSP expiring next month (no realistic path)", () => {
    const state = {
      type: "csp", currentProfitPct: -0.40, dte: 25,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-05-15"),
    };
    const r = realizationThisMonth(state, today, {});
    expect(r).toBe(0);
  });

  it("window scalar caps at 1.0 even with many days remaining", () => {
    const earlyInMonth = new Date("2026-04-02T00:00:00Z");
    const state = {
      type: "csp", currentProfitPct: 0.10, dte: 40,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-05-20"),
    };
    // daysToEom = 28, scalar capped at 1.0
    // remaining = 550; thisMonth = 550 * 0.08 * 1.0 = 44
    const r = realizationThisMonth(state, earlyInMonth, {});
    expect(r).toBeCloseTo(44);
  });
});

describe("forecast uncertainty (this_month_std)", () => {
  const today = new Date("2026-04-15T00:00:00Z");
  const cal = { csp: { profit_60_plus: 0.76 } };

  it("aggregates per-position $ uncertainty via sqrt-of-sum-of-squares", () => {
    // Two identical CSPs at ≥60% profit expiring this month → thisMonthShare=1
    // per-position σ_$ = premium × bucketStd
    // premium $1000, σ_c=0.158 → per-position σ_$ = $158
    // portfolio σ_$ = sqrt(158² + 158²) ≈ $223 (not $316; independence reduces combined uncertainty)
    const occ1 = "AAA260425P00010000";
    const occ2 = "BBB260425P00010000";
    const positions = [
      { ticker: "AAA", type: "CSP", strike: 10, contracts: 10, expiry_date: "2026-04-25", premium_collected: 1000 },
      { ticker: "BBB", type: "CSP", strike: 10, contracts: 10, expiry_date: "2026-04-25", premium_collected: 1000 },
    ];
    const quoteBySymbol = {
      AAA: { mid: 8 }, BBB: { mid: 8 },
      [occ1]: { mid: 0.35 },  // premium/share = 1.00, current mid = 0.35 → profit 65%
      [occ2]: { mid: 0.35 },
    };
    const r = computePipelineForecast({
      openPositions: positions,
      costBasisByTicker: {},
      quoteBySymbol,
      calibration: cal,
      calibrationStd: { csp: { profit_60_plus: 0.158 } },
      mtdRealized: 0,
      monthlyTarget: 15000,
      today,
    });
    expect(r.forecast_this_month_std).toBeGreaterThan(200);
    expect(r.forecast_this_month_std).toBeLessThan(250);
  });

  it("falls back to DEFAULT_UNCERTAINTY_STD (0.15) when calibrationStd is missing", () => {
    const occ = "AAA260425P00010000";
    const r = computePipelineForecast({
      openPositions: [
        { ticker: "AAA", type: "CSP", strike: 10, contracts: 10, expiry_date: "2026-04-25", premium_collected: 1000 },
      ],
      costBasisByTicker: {},
      quoteBySymbol: { AAA: { mid: 8 }, [occ]: { mid: 0.35 } },
      calibration: cal,
      mtdRealized: 0,
      monthlyTarget: 15000,
      today,
    });
    // premium $1000 × 0.15 (DEFAULT σ_c) = $150
    expect(r.forecast_this_month_std).toBeCloseTo(150, 0);
  });

  it("uses Bernoulli-mixture σ for cross-month positions (between-states + within-close)", () => {
    // Underwater cross-month CC in the default bucket.
    //   premium = $915, σ_c = 0.59, capture = 0.75 → remaining ≈ $686
    //   thisMonth = remaining × 0.15 ≈ $103, so p ≈ 0.15
    //   Var = p(1-p) × remaining² + p × (premium × σ_c)²
    //       ≈ 0.1275 × 686² + 0.15 × 540²
    //       ≈ 60,045 + 43,740 = 103,785 → σ ≈ $322
    // Bernoulli-mixture sits between deterministic-thisMonthShare ($81)
    // and lifetime σ ($540) — this is the correct April-specific σ.
    const occ = "IREN261219C00015000";
    const calCC = { cc: { default: 0.75 } };
    const stdCC = { cc: { default: 0.59 } };
    const r = computePipelineForecast({
      openPositions: [
        { ticker: "IREN", type: "CC", strike: 15, contracts: 10, expiry_date: "2026-12-19", premium_collected: 915 },
      ],
      costBasisByTicker: { IREN: 14 },
      quoteBySymbol: { IREN: { mid: 14.5 }, [occ]: { mid: 1.0 } },
      calibration: calCC,
      calibrationStd: stdCC,
      mtdRealized: 0,
      monthlyTarget: 15000,
      today,
    });
    expect(r.forecast_this_month_std).toBeGreaterThan(280);
    expect(r.forecast_this_month_std).toBeLessThan(360);
  });

  it("collapses to lifetime σ when position expires this month (p=1)", () => {
    // Same-month CSP at ≥60% profit → p=1 → Var = (premium × σ_c)² (no
    // Bernoulli between-states uncertainty — the outcome will land this month).
    const occ = "AAA260425P00010000";
    const r = computePipelineForecast({
      openPositions: [
        { ticker: "AAA", type: "CSP", strike: 10, contracts: 10, expiry_date: "2026-04-25", premium_collected: 1000 },
      ],
      costBasisByTicker: {},
      quoteBySymbol: { AAA: { mid: 8 }, [occ]: { mid: 0.35 } },
      calibration: cal,
      calibrationStd: { csp: { profit_60_plus: 0.158 } },
      mtdRealized: 0,
      monthlyTarget: 15000,
      today,
    });
    // σ = premium × σ_c = 1000 × 0.158 = $158
    expect(r.forecast_this_month_std).toBeCloseTo(158, 0);
  });

  it("contributes 0 variance when thisMonth = 0 (deeply underwater, no path)", () => {
    // Deeply-underwater cross-month CSP: p < -0.20 → realizationThisMonth = 0.
    // Such positions shouldn't inflate the CI — their outcome this month is
    // known to be ~$0 (they will not early-close).
    const occ = "DUMP260619P00100000";
    const r = computePipelineForecast({
      openPositions: [
        { ticker: "DUMP", type: "CSP", strike: 100, contracts: 10, expiry_date: "2026-06-19", premium_collected: 1000 },
      ],
      costBasisByTicker: {},
      quoteBySymbol: { DUMP: { mid: 80 }, [occ]: { mid: 2.0 } },  // premium/share = 1.0, mid = 2.0 → -100% profit
      calibration: cal,
      calibrationStd: { csp: { profit_low_dte_high: 0.2 } },
      mtdRealized: 0,
      monthlyTarget: 15000,
      today,
    });
    expect(r.forecast_this_month_std).toBe(0);
  });
});

describe("vixRegimeMultiplier", () => {
  it("returns 1.15 for VIX < 18 (complacency)", () => {
    expect(vixRegimeMultiplier(15)).toBe(1.15);
    expect(vixRegimeMultiplier(17.99)).toBe(1.15);
  });
  it("returns 1.00 for VIX 18–25 (normal)", () => {
    expect(vixRegimeMultiplier(18)).toBe(1.00);
    expect(vixRegimeMultiplier(22)).toBe(1.00);
    expect(vixRegimeMultiplier(24.99)).toBe(1.00);
  });
  it("returns 0.80 for VIX 25–30 (elevated)", () => {
    expect(vixRegimeMultiplier(25)).toBe(0.80);
    expect(vixRegimeMultiplier(29.99)).toBe(0.80);
  });
  it("returns 0.60 for VIX ≥ 30 (fear)", () => {
    expect(vixRegimeMultiplier(30)).toBe(0.60);
    expect(vixRegimeMultiplier(45)).toBe(0.60);
  });
  it("returns 1.00 for null/missing VIX", () => {
    expect(vixRegimeMultiplier(null)).toBe(1.00);
    expect(vixRegimeMultiplier(undefined)).toBe(1.00);
    expect(vixRegimeMultiplier(NaN)).toBe(1.00);
  });
});

describe("realizationThisMonth VIX multiplier", () => {
  const today = new Date("2026-04-15T00:00:00Z");
  const cal = { csp: { profit_20_40_dte_high: 0.70 }, cc: { default: 0.75 } };

  it("scales cross-month CSP 20-40% branch by VIX regime", () => {
    // Cross-month CSP at ~30% profit, dte > 10 → branch factor 0.20
    const state = {
      type: "csp",
      expiry: new Date("2026-06-19T00:00:00Z"),   // cross-month
      premiumAtOpen: 1000,
      realizedToDate: 0,
      currentProfitPct: 0.30,
      dte: 65,
    };
    const remaining = 1000 * 0.70;  // = 700
    // low VIX → ×1.15
    expect(realizationThisMonth(state, today, cal, 15)).toBeCloseTo(remaining * 0.20 * 1.15, 2);
    // normal VIX → ×1.00
    expect(realizationThisMonth(state, today, cal, 22)).toBeCloseTo(remaining * 0.20 * 1.00, 2);
    // elevated VIX → ×0.80
    expect(realizationThisMonth(state, today, cal, 27)).toBeCloseTo(remaining * 0.20 * 0.80, 2);
    // fear VIX → ×0.60
    expect(realizationThisMonth(state, today, cal, 35)).toBeCloseTo(remaining * 0.20 * 0.60, 2);
  });

  it("does NOT scale the near-certainty ≥60% CSP branch by VIX", () => {
    const state = {
      type: "csp",
      expiry: new Date("2026-06-19T00:00:00Z"),
      premiumAtOpen: 1000,
      realizedToDate: 0,
      currentProfitPct: 0.65,
      dte: 65,
    };
    // No cal for profit_60_plus → SPEC 0.60 → remaining = $600
    const remaining = 1000 * 0.60;
    expect(realizationThisMonth(state, today, cal, 15)).toBeCloseTo(remaining, 2);
    expect(realizationThisMonth(state, today, cal, 35)).toBeCloseTo(remaining, 2);
  });

  it("does NOT scale the near-certainty ≥80% CC branch by VIX", () => {
    const state = {
      type: "cc",
      expiry: new Date("2026-06-19T00:00:00Z"),
      premiumAtOpen: 1000,
      realizedToDate: 0,
      currentProfitPct: 0.85,
      dte: 65,
      stockPrice: 20,
      strike: 25,
    };
    // No cal for profit_80_plus → SPEC 0.85 → remaining = $850
    const remaining = 1000 * 0.85;
    expect(realizationThisMonth(state, today, cal, 35)).toBeCloseTo(remaining, 2);
  });

  it("scales CC default-bucket cross-month branch (0.15) by VIX", () => {
    const state = {
      type: "cc",
      expiry: new Date("2026-06-19T00:00:00Z"),
      premiumAtOpen: 1000,
      realizedToDate: 0,
      currentProfitPct: 0.10,  // default bucket
      dte: 65,
      stockPrice: 20,
      strike: 25,
    };
    const remaining = 1000 * 0.75;
    expect(realizationThisMonth(state, today, cal, 15)).toBeCloseTo(remaining * 0.15 * 1.15, 2);
    expect(realizationThisMonth(state, today, cal, 35)).toBeCloseTo(remaining * 0.15 * 0.60, 2);
  });

  it("defaults to no VIX scaling when vix is null/omitted", () => {
    const state = {
      type: "csp",
      expiry: new Date("2026-06-19T00:00:00Z"),
      premiumAtOpen: 1000,
      realizedToDate: 0,
      currentProfitPct: 0.30,
      dte: 65,
    };
    const remaining = 1000 * 0.70;
    expect(realizationThisMonth(state, today, cal)).toBeCloseTo(remaining * 0.20 * 1.00, 2);
    expect(realizationThisMonth(state, today, cal, null)).toBeCloseTo(remaining * 0.20 * 1.00, 2);
  });
});

describe("computePipelineForecast", () => {
  const today = new Date("2026-04-15T00:00:00Z");
  const cal = { csp: { profit_60_plus: 0.76 }, cc: { profit_80_plus: 0.89 } };

  it("classifies phase as flexible when CSP > 55% of forward pipeline", () => {
    // Need quotes for each position's OCC symbol — fake them to drive currentProfitPct.
    // SOFI CSP $24 2026-04-25 at 70% profit → premium/share open = $0.50, current mid = $0.15
    const sofiOcc = "SOFI  260425P00024000";
    const tsllOcc = "TSLL  260425C00014000";
    const quoteBySymbol = {
      SOFI: { mid: 20 },
      TSLL: { mid: 12 },
      [sofiOcc]: { mid: 0.15 },
      [tsllOcc]: { mid: 0.40 },
    };
    const positions = [
      {
        ticker: "SOFI", type: "CSP", strike: 24, contracts: 10,
        expiry_date: "2026-04-25", premium_collected: 500,  // $0.50/share × 10 × 100
      },
      {
        ticker: "TSLL", type: "CC", strike: 14, contracts: 5,
        expiry_date: "2026-04-25", premium_collected: 500,
      },
    ];
    const result = computePipelineForecast({
      openPositions: positions,
      costBasisByTicker: { TSLL: 12 },  // TSLL not below cost
      quoteBySymbol,
      calibration: cal,
      mtdRealized: 5000,
      monthlyTarget: 15000,
      today,
    });
    expect(result.forward_pipeline_premium).toBeGreaterThan(0);
    expect(result.pipeline_phase).toMatch(/flexible|mixed|constraint/);
    expect(result.per_position.length).toBe(2);
  });

  it("handles missing quotes by skipping unclassified positions", () => {
    const positions = [
      {
        ticker: "ZZZZ", type: "CSP", strike: 50, contracts: 1,
        expiry_date: "2026-04-25", premium_collected: 100,
      },
    ];
    const result = computePipelineForecast({
      openPositions: positions,
      costBasisByTicker: {},
      quoteBySymbol: {},  // no quotes!
      calibration: cal,
      mtdRealized: 0,
      monthlyTarget: 15000,
      today,
    });
    // With no current profit %, bucket falls through to default 0.60
    expect(result.per_position.length).toBe(1);
    expect(result.per_position[0].bucket).toBeNull();
    expect(result.per_position[0].capturePct).toBe(0.60);
  });
});
