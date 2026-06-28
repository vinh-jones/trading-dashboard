import { describe, it, expect } from "vitest";
import {
  effectiveBeta, deltaNarrative, vegaNarrative, thetaNarrative,
  bookSummary, familyDivergence,
} from "../riskNarrative.js";

describe("effectiveBeta", () => {
  it("+$10.7k/1% SPX on ~$892k ≈ 1.2× the market", () => {
    expect(effectiveBeta(10700, 892000)).toBeCloseTo(1.2, 1);
  });
  it("null account → null", () => expect(effectiveBeta(100, 0)).toBeNull());
});

describe("deltaNarrative", () => {
  it("net long, market-like for ~1.2×", () => {
    const n = deltaNarrative(10700, 892000);
    expect(n.label).toContain("net long");
    expect(n.plain).toContain("gains");
    expect(n.plain).toContain("1.2×");
  });
  it("strongly net short / high-beta for large negative beta", () => {
    const n = deltaNarrative(-5000, 100000); // effective beta −5
    expect(n.label).toContain("strongly net short");
    expect(n.label).toContain("high-beta");
    expect(n.plain).toContain("loses");
  });
  it("near-zero → market-neutral", () => {
    expect(deltaNarrative(0.5, 100000).label).toBe("≈ market-neutral");
  });
});

describe("vegaNarrative — flips with sign", () => {
  it("net long vega: LONG-vol language + cushion note", () => {
    const n = vegaNarrative(852, 19);
    expect(n.label).toContain("net long vega");
    expect(n.plain).toContain("Net LONG volatility");
    expect(n.plain).toContain("cushioned");
    expect(n.plain).toContain("Transition"); // VIX 19 band
  });
  it("net short vega: SHORT-vol language + against-the-book note", () => {
    const n = vegaNarrative(-2000, 25);
    expect(n.label).toContain("strongly net short vega");
    expect(n.plain).toContain("Net SHORT volatility");
    expect(n.plain).toContain("against the book");
  });
  it("small magnitude → vega-neutral", () => {
    expect(vegaNarrative(20, 18).label).toBe("≈ vega-neutral");
  });
});

describe("thetaNarrative", () => {
  it("positive → collecting, with per-day and per-month", () => {
    const n = thetaNarrative(351);
    expect(n.label).toBe("collecting decay");
    expect(n.plain).toContain("/day");
    expect(n.plain).toContain("/mo");
  });
  it("negative → paying decay", () => {
    expect(thetaNarrative(-120).label).toBe("paying decay");
  });
});

describe("bookSummary", () => {
  it("derives the one-liner from the three signs", () => {
    expect(bookSummary({ netBetaWeightedDelta: 10700, netVega: 852, netTheta: 351 }))
      .toBe("Long the market, long vol, collecting theta.");
    expect(bookSummary({ netBetaWeightedDelta: -10, netVega: -900, netTheta: -5 }))
      .toBe("Short the market, short vol, paying theta.");
    expect(bookSummary({ netBetaWeightedDelta: 100, netVega: 10, netTheta: 1 }))
      .toBe("Long the market, vega-neutral, collecting theta.");
  });
});

describe("familyDivergence", () => {
  it("risk on ~no capital → risk-dense", () => {
    expect(familyDivergence(0.313, 0.001)).toContain("risk-dense");
  });
  it("risk share >> capital share → risk-dense with ratio", () => {
    expect(familyDivergence(0.31, 0.05)).toContain("more risk than capital");
  });
  it("capital >> risk → capital-heavy, risk-light", () => {
    expect(familyDivergence(0.171, 0.354)).toContain("capital-heavy");
  });
  it("balanced", () => {
    expect(familyDivergence(0.10, 0.10)).toContain("balanced");
  });
});
