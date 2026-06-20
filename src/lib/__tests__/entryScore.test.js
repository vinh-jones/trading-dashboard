import { describe, it, expect } from "vitest";
import {
  compositeIv, getTrendState, gammaEnvMod, flowMod,
  entryScore, scoreLabel, entryEarningsRisk,
} from "../entryScore";

// Reference case: bb 0.2, iv 0.5, ivr 60, price 100 > ma50 90 > ma200 80, no ivTrend.
// compositeIv = 0.6*0.6 + min(0.5/1.5,1)*0.4 = 0.36 + 0.13333 = 0.49333
// base = (1-0.2)*0.5 + 0.49333*0.5 = 0.4 + 0.246667 = 0.646667
const ref = [0.2, 0.5, 60, 100, 90, 80, null];

describe("compositeIv", () => {
  it("weights IV rank 0.6 and IV 0.4 (IV capped at 1.5)", () => {
    expect(compositeIv(0.5, 60)).toBeCloseTo(0.49333, 4);
    expect(compositeIv(3.0, 100)).toBeCloseTo(1.0, 5); // both maxed
  });
  it("null when inputs missing", () => {
    expect(compositeIv(null, 60)).toBeNull();
    expect(compositeIv(0.5, null)).toBeNull();
  });
});

describe("getTrendState", () => {
  it("uptrend when above both MAs", () => {
    expect(getTrendState(100, 90, 80).modifier).toBe(1.0);
  });
  it("downtrend when below both", () => {
    expect(getTrendState(70, 90, 80).modifier).toBe(0.70);
  });
});

describe("gammaEnvMod / flowMod — null-safe, capped", () => {
  it("null is a no-op", () => {
    expect(gammaEnvMod(null)).toBe(1.0);
    expect(flowMod(null)).toBe(1.0);
  });
  it("gamma: positive boosts +10%, negative damps -15%, clamped", () => {
    expect(gammaEnvMod(1)).toBeCloseTo(1.10, 5);
    expect(gammaEnvMod(-1)).toBeCloseTo(0.85, 5);
    expect(gammaEnvMod(5)).toBeCloseTo(1.10, 5); // clamp
  });
  it("flow: symmetric +/-15%, clamped", () => {
    expect(flowMod(1)).toBeCloseTo(1.15, 5);
    expect(flowMod(-1)).toBeCloseTo(0.85, 5);
    expect(flowMod(-9)).toBeCloseTo(0.85, 5); // clamp
  });
});

describe("entryScore", () => {
  it("matches the legacy scannerScore formula when UW inputs are null", () => {
    expect(entryScore(...ref)).toBeCloseTo(0.646667, 5);
  });
  it("is byte-identical whether UW args are omitted or explicitly null", () => {
    expect(entryScore(...ref, null, null)).toBe(entryScore(...ref));
  });
  it("positive gamma boosts, negative gamma damps", () => {
    expect(entryScore(...ref, 1, null)).toBeCloseTo(0.646667 * 1.10, 5);
    expect(entryScore(...ref, -1, null)).toBeCloseTo(0.646667 * 0.85, 5);
  });
  it("bullish flow boosts the score", () => {
    expect(entryScore(...ref, null, 1)).toBeCloseTo(0.646667 * 1.15, 5);
  });
  it("null when structure or richness is missing", () => {
    expect(entryScore(null, 0.5, 60, 100, 90, 80, null)).toBeNull();
    expect(entryScore(0.2, null, null, 100, 90, 80, null)).toBeNull();
  });
});

describe("scoreLabel", () => {
  it("bands", () => {
    expect(scoreLabel(0.75)).toBe("Strong");
    expect(scoreLabel(0.60)).toBe("Moderate");
    expect(scoreLabel(0.40)).toBe("Neutral");
    expect(scoreLabel(0.10)).toBe("Weak");
    expect(scoreLabel(null)).toBeNull();
  });
  it("a positive-gamma boost can tip Moderate → Strong", () => {
    expect(scoreLabel(entryScore(...ref))).toBe("Moderate");
    expect(scoreLabel(entryScore(...ref, 1, null))).toBe("Strong");
  });
});

describe("entryEarningsRisk", () => {
  const expiry = "2026-07-17", today = "2026-07-01";
  it("flags earnings between today and expiry", () => {
    const r = entryEarningsRisk({ earningsDateIso: "2026-07-10", expiryIso: expiry, todayIso: today });
    expect(r.earningsBeforeExpiry).toBe(true);
    expect(r.earningsDate).toBe("2026-07-10");
  });
  it("ignores earnings after expiry", () => {
    expect(entryEarningsRisk({ earningsDateIso: "2026-07-20", expiryIso: expiry, todayIso: today }).earningsBeforeExpiry).toBe(false);
  });
  it("ignores earnings already passed", () => {
    expect(entryEarningsRisk({ earningsDateIso: "2026-06-20", expiryIso: expiry, todayIso: today }).earningsBeforeExpiry).toBe(false);
  });
  it("false when inputs missing", () => {
    expect(entryEarningsRisk({ expiryIso: expiry }).earningsBeforeExpiry).toBe(false);
    expect(entryEarningsRisk().earningsBeforeExpiry).toBe(false);
  });
});
