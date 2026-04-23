import { describe, it, expect } from "vitest";
import {
  RISK_FREE_RATE,
  normCDF,
  bsPutPrice,
  bsCallPrice,
  impliedVol,
  findStockPriceForTargetMid,
  computePriceTargets,
} from "../blackScholes.js";

describe("RISK_FREE_RATE", () => {
  it("is pinned at 0.045 (≈ T-bill)", () => {
    expect(RISK_FREE_RATE).toBe(0.045);
  });
});

describe("normCDF", () => {
  it("returns 0.5 at x=0", () => {
    expect(normCDF(0)).toBeCloseTo(0.5, 5);
  });

  it("approaches 0 for large negative x", () => {
    expect(normCDF(-5)).toBeLessThan(1e-5);
  });

  it("approaches 1 for large positive x", () => {
    expect(normCDF(5)).toBeGreaterThan(1 - 1e-5);
  });

  it("is symmetric about 0", () => {
    expect(normCDF(1.5) + normCDF(-1.5)).toBeCloseTo(1, 5);
  });

  it("matches known z-table values", () => {
    expect(normCDF(1)).toBeCloseTo(0.8413, 3);
    expect(normCDF(-1)).toBeCloseTo(0.1587, 3);
    expect(normCDF(1.96)).toBeCloseTo(0.975, 3);
  });
});

// Put-call parity: C - P = S - K·e^(-rT)
describe("put-call parity", () => {
  it("holds for ATM options", () => {
    const S = 100, K = 100, T = 30 / 365, r = 0.045, iv = 0.30;
    const C = bsCallPrice(S, K, T, r, iv);
    const P = bsPutPrice(S, K, T, r, iv);
    const parity = C - P;
    const expected = S - K * Math.exp(-r * T);
    expect(parity).toBeCloseTo(expected, 4);
  });

  it("holds for ITM puts / OTM calls", () => {
    const S = 90, K = 100, T = 60 / 365, r = 0.045, iv = 0.40;
    const C = bsCallPrice(S, K, T, r, iv);
    const P = bsPutPrice(S, K, T, r, iv);
    expect(C - P).toBeCloseTo(S - K * Math.exp(-r * T), 4);
  });
});

describe("bsPutPrice", () => {
  it("returns intrinsic at expiry (T=0)", () => {
    expect(bsPutPrice(90, 100, 0, 0.045, 0.30)).toBe(10);   // ITM put
    expect(bsPutPrice(110, 100, 0, 0.045, 0.30)).toBe(0);   // OTM put
  });

  it("increases with IV (vega > 0)", () => {
    const p1 = bsPutPrice(100, 100, 30 / 365, 0.045, 0.20);
    const p2 = bsPutPrice(100, 100, 30 / 365, 0.045, 0.40);
    expect(p2).toBeGreaterThan(p1);
  });

  it("decreases as stock price rises", () => {
    const p1 = bsPutPrice(95, 100, 30 / 365, 0.045, 0.30);
    const p2 = bsPutPrice(105, 100, 30 / 365, 0.045, 0.30);
    expect(p2).toBeLessThan(p1);
  });
});

describe("bsCallPrice", () => {
  it("returns intrinsic at expiry (T=0)", () => {
    expect(bsCallPrice(110, 100, 0, 0.045, 0.30)).toBe(10);
    expect(bsCallPrice(90, 100, 0, 0.045, 0.30)).toBe(0);
  });

  it("increases with IV", () => {
    const c1 = bsCallPrice(100, 100, 30 / 365, 0.045, 0.20);
    const c2 = bsCallPrice(100, 100, 30 / 365, 0.045, 0.40);
    expect(c2).toBeGreaterThan(c1);
  });

  it("increases as stock price rises", () => {
    const c1 = bsCallPrice(95, 100, 30 / 365, 0.045, 0.30);
    const c2 = bsCallPrice(105, 100, 30 / 365, 0.045, 0.30);
    expect(c2).toBeGreaterThan(c1);
  });
});

describe("impliedVol", () => {
  it("back-solves an IV that reproduces the input price", () => {
    const trueIV = 0.35;
    const marketMid = bsPutPrice(100, 100, 30 / 365, 0.045, trueIV);
    const iv = impliedVol(marketMid, 100, 100, 30 / 365, 0.045, "put");
    expect(iv).toBeCloseTo(trueIV, 3);
  });

  it("works for calls too", () => {
    const trueIV = 0.50;
    const marketMid = bsCallPrice(105, 100, 45 / 365, 0.045, trueIV);
    const iv = impliedVol(marketMid, 105, 100, 45 / 365, 0.045, "call");
    expect(iv).toBeCloseTo(trueIV, 3);
  });

  it("returns null when marketMid is outside solvable range", () => {
    // price way above any reasonable IV (>500%) for a reasonable setup
    expect(impliedVol(10000, 100, 100, 30 / 365, 0.045, "put")).toBeNull();
  });

  it("returns null at T=0 or marketMid<=0", () => {
    expect(impliedVol(1, 100, 100, 0, 0.045, "put")).toBeNull();
    expect(impliedVol(0, 100, 100, 30 / 365, 0.045, "put")).toBeNull();
  });
});

describe("findStockPriceForTargetMid", () => {
  it("finds the stock price that reproduces a target put mid", () => {
    // Target mid at S=95, K=100, 30 DTE, IV=0.30
    const S = 95, K = 100, iv = 0.30;
    const targetMid = bsPutPrice(S, K, 30 / 365, 0.045, iv);
    const found = findStockPriceForTargetMid(targetMid, K, 30, 0.045, iv, "put", 100);
    expect(found).toBeCloseTo(S, 1);
  });

  it("finds the stock price for a target call mid", () => {
    const S = 105, K = 100, iv = 0.30;
    const targetMid = bsCallPrice(S, K, 30 / 365, 0.045, iv);
    const found = findStockPriceForTargetMid(targetMid, K, 30, 0.045, iv, "call", 100);
    expect(found).toBeCloseTo(S, 1);
  });

  it("returns null when target is outside ±50% search bounds", () => {
    // Put worth much more than any value in [50, 150] range
    const found = findStockPriceForTargetMid(100, 100, 30, 0.045, 0.30, "put", 100);
    expect(found).toBeNull();
  });
});

describe("computePriceTargets", () => {
  const now = new Date();
  const toIso = d => d.toISOString().slice(0, 10);
  const addDays = (base, n) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d;
  };

  const makeCspPosition = (openOffsetDays, expiryOffsetDays, premium = 200) => ({
    type: "CSP",
    strike: 100,
    contracts: 1,
    open_date:   toIso(addDays(now, openOffsetDays)),
    expiry_date: toIso(addDays(now, expiryOffsetDays)),
    premium_collected: premium,
  });

  it("uses the 50% profit tier when >80% DTE remains", () => {
    // Opened today, expires in 30 days → dtePct = 100
    const pos = makeCspPosition(0, 30);
    const result = computePriceTargets(pos, 0.30, 100, 1.00, null);
    expect(result.targetProfitPct).toBe(50);
  });

  it("uses the 60% profit tier between 41–80% DTE remaining", () => {
    // Opened 20 days ago, expires in 20 days → dtePct = 50
    const pos = makeCspPosition(-20, 20);
    const result = computePriceTargets(pos, 0.30, 100, 1.00, null);
    expect(result.targetProfitPct).toBe(60);
  });

  it("uses the 80% profit tier when ≤40% DTE remains", () => {
    // Opened 40 days ago, expires in 10 days → dtePct = 20
    const pos = makeCspPosition(-40, 10);
    const result = computePriceTargets(pos, 0.30, 100, 1.00, null);
    expect(result.targetProfitPct).toBe(80);
  });

  it("computes currentProfitPct from currentMid vs premium per share", () => {
    // premium = 200 on 1 contract → $2/share. Mid=1.00 → 50% profit remaining taken.
    const pos = makeCspPosition(-10, 20);
    const result = computePriceTargets(pos, 0.30, 100, 1.00, null);
    expect(result.currentProfitPct).toBe(50);
  });

  it("marks isLosing when currentProfitPct < 0", () => {
    // Mid=3.00 vs premium/share=2.00 → -50%
    const pos = makeCspPosition(-10, 20);
    const result = computePriceTargets(pos, 0.30, 100, 3.00, null);
    expect(result.isLosing).toBe(true);
  });

  it("marks isOnTrack when current profit is at least half of target", () => {
    // target = 60 at dtePct=50; half = 30. currentProfitPct=35 → on track.
    const pos = makeCspPosition(-20, 20);
    const result = computePriceTargets(pos, 0.30, 100, 1.30, null);
    expect(result.isOnTrack).toBe(true);
  });

  it("returns empty targets array when IV and stock price are missing", () => {
    const pos = makeCspPosition(-10, 20);
    const result = computePriceTargets(pos, null, null, null, null);
    expect(result.targets).toEqual([]);
  });

  it("prefers optionIVFromGreeks over back-solved IV", () => {
    const pos = makeCspPosition(-10, 20);
    const result = computePriceTargets(pos, 0.30, 100, 1.00, 0.55);
    expect(result.iv).toBe(0.55);
  });

  it("produces up to two Friday target rows", () => {
    const pos = makeCspPosition(-10, 30);
    const result = computePriceTargets(pos, 0.30, 100, 1.00, null);
    expect(result.targets.length).toBeGreaterThan(0);
    expect(result.targets.length).toBeLessThanOrEqual(2);
  });
});
