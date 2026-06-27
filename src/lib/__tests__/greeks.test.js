import { describe, it, expect } from "vitest";
import { normPDF, normCDF } from "../normal.js";
import { bsGreeks, assignmentProb } from "../greeks.js";

// ── Gate B canonical case (Risk-Unit v2 spike) ──────────────────────────────
// Input: S=100, K=100, T=1.0, iv=0.20, r=0.05. Targets cross-checked against
// reference Black-Scholes values; must match to ±0.001.
const G = { S: 100, K: 100, T: 1.0, iv: 0.20, r: 0.05 };

describe("normPDF", () => {
  it("φ(0) = 1/√(2π)", () => {
    expect(normPDF(0)).toBeCloseTo(0.39894, 4);
  });
  it("is symmetric", () => {
    expect(normPDF(0.35)).toBeCloseTo(normPDF(-0.35), 10);
  });
});

describe("bsGreeks — canonical CALL", () => {
  const g = bsGreeks({ ...G, right: "call" });
  it("d1 = 0.3500, d2 = 0.1500", () => {
    expect(g.d1).toBeCloseTo(0.35, 3);
    expect(g.d2).toBeCloseTo(0.15, 3);
  });
  it("delta = 0.6368", () => expect(g.delta).toBeCloseTo(0.6368, 3));
  it("gamma = 0.0188", () => expect(g.gamma).toBeCloseTo(0.0188, 3));
  it("vega = 0.3752 (per +1 IV point)", () => expect(g.vega).toBeCloseTo(0.3752, 3));
  it("theta = −0.0176 (per day)", () => expect(g.theta).toBeCloseTo(-0.0176, 3));
});

describe("bsGreeks — canonical PUT", () => {
  const g = bsGreeks({ ...G, right: "put" });
  it("delta = −0.3632", () => expect(g.delta).toBeCloseTo(-0.3632, 3));
  it("gamma identical to call (0.0188)", () => expect(g.gamma).toBeCloseTo(0.0188, 3));
  it("vega identical to call (0.3752)", () => expect(g.vega).toBeCloseTo(0.3752, 3));
});

describe("assignmentProb — N(d2) vs raw delta", () => {
  it("PUT assignment prob = N(−d2) = 0.4404", () => {
    expect(assignmentProb({ ...G, right: "put" })).toBeCloseTo(0.4404, 3);
  });
  it("CALL assignment prob = N(d2) = 0.5596", () => {
    expect(assignmentProb({ ...G, right: "call" })).toBeCloseTo(0.5596, 3);
  });

  // The research-flagged direction of the delta↔N(d2) gap. NOTE: the spike doc
  // expected the PUT assignment prob to be *less* than |delta| — that is the
  // call-case intuition. For a put the inequality FLIPS: |put delta| = N(−d1) <
  // N(−d2) = assignment prob, so raw delta UNDERstates a short put's assignment
  // odds. These assertions pin the correct, sign-checked direction.
  it("CALL: raw delta OVERstates ITM odds (delta > N(d2))", () => {
    const { delta } = bsGreeks({ ...G, right: "call" });
    expect(delta).toBeGreaterThan(assignmentProb({ ...G, right: "call" }));
  });
  it("PUT: raw delta UNDERstates ITM odds (|delta| < N(−d2))", () => {
    const { delta } = bsGreeks({ ...G, right: "put" });
    expect(Math.abs(delta)).toBeLessThan(assignmentProb({ ...G, right: "put" }));
  });
});

// ── Deep-ITM long-dated call (LEAP regime) ──────────────────────────────────
// Synthetic stand-in for the Gate-A live reconciliation (CLS/SOFI LEAP delta vs
// Public's returned delta), which needs Public.com creds this env lacks. This
// confirms the module produces sane deep-ITM LEAP deltas in the right range.
describe("bsGreeks — deep-ITM long-dated call (LEAP)", () => {
  const g = bsGreeks({ S: 420, K: 360, T: 1.15, iv: 0.70, right: "call" });
  it("delta is high but < 1 (≈0.6–0.85 expected for a deep-ITM LEAP)", () => {
    expect(g.delta).toBeGreaterThan(0.6);
    expect(g.delta).toBeLessThan(0.9);
  });
  it("vega and gamma are positive and finite", () => {
    expect(g.vega).toBeGreaterThan(0);
    expect(g.gamma).toBeGreaterThan(0);
    expect(Number.isFinite(g.theta)).toBe(true);
  });
});

// ── Degenerate inputs never produce NaN ─────────────────────────────────────
describe("bsGreeks — null-safety", () => {
  it("T=0 → zero sensitivities, no NaN", () => {
    const g = bsGreeks({ S: 100, K: 100, T: 0, iv: 0.2, right: "call" });
    expect(g).toEqual({ delta: 0, gamma: 0, vega: 0, theta: 0, d1: null, d2: null });
  });
  it("iv=0 → zero sensitivities", () => {
    const g = bsGreeks({ S: 100, K: 100, T: 1, iv: 0, right: "put" });
    expect(g.gamma).toBe(0);
    expect(g.vega).toBe(0);
  });
  it("missing input → null", () => {
    expect(bsGreeks({ S: 100, K: null, T: 1, iv: 0.2, right: "call" })).toBeNull();
    expect(assignmentProb({ S: 100, K: 100, T: 1, iv: null, right: "call" })).toBeNull();
  });
  it("settled at expiry: ITM put → prob 1, OTM put → prob 0", () => {
    expect(assignmentProb({ S: 90, K: 100, T: 0, iv: 0.2, right: "put" })).toBe(1);
    expect(assignmentProb({ S: 110, K: 100, T: 0, iv: 0.2, right: "put" })).toBe(0);
  });
});
