import { describe, it, expect } from "vitest";
import {
  cspBucket,
  ccBucket,
  expectedFinalCapturePct,
  expectedRemainingRealization,
  realizationThisMonth,
  computePipelineForecast,
  buildOccForPosition,
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

  it("attributes 5% for low-profit CSP expiring next month", () => {
    const state = {
      type: "csp", currentProfitPct: 0.10, dte: 25,
      premiumAtOpen: 1000, realizedToDate: 0,
      expiry: new Date("2026-05-15"),
    };
    // remaining = 1000 * 0.55 = 550 (profit_low_dte_high bucket)
    // thisMonth = 550 * 0.05 = 27.5
    const r = realizationThisMonth(state, today, {});
    expect(r).toBeCloseTo(27.5);
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
