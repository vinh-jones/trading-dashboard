// src/lib/__tests__/spreads.test.js
import { describe, it, expect } from "vitest";
import { cushionToBreakeven, spreadMark, spreadUnrealized } from "../spreads.js";

describe("cushionToBreakeven", () => {
  it("bull put (bullish): safe ABOVE breakeven → positive cushion, green", () => {
    const r = cushionToBreakeven({ spot: 716, breakeven: 707.34, subtype: "Bull Put" });
    expect(r.distance_pct).toBeCloseTo((716 - 707.34) / 707.34, 5);
    expect(r.state).toBe("safe");
  });
  it("bull put: below breakeven → negative cushion, breached", () => {
    const r = cushionToBreakeven({ spot: 705, breakeven: 707.34, subtype: "Bull Put" });
    expect(r.distance_pct).toBeLessThan(0);
    expect(r.state).toBe("breached");
  });
  it("bear call (bearish): safe BELOW breakeven", () => {
    const r = cushionToBreakeven({ spot: 495, breakeven: 501, subtype: "Bear Call" });
    expect(r.distance_pct).toBeCloseTo((501 - 495) / 501, 5);
    expect(r.state).toBe("safe");
  });
  it("near (within ~1%) → warn", () => {
    const r = cushionToBreakeven({ spot: 708, breakeven: 707.34, subtype: "Bull Put" });
    expect(r.state).toBe("warn");
  });
  it("null spot → null result", () => {
    expect(cushionToBreakeven({ spot: null, breakeven: 707.34, subtype: "Bull Put" })).toBeNull();
  });
});

describe("spreadMark", () => {
  it("credit spread mark = short_mid - long_mid (cost to close)", () => {
    expect(spreadMark({ shortMid: 0.40, longMid: 0.10 })).toBeCloseTo(0.30, 5);
  });
  it("null if either leg missing", () => {
    expect(spreadMark({ shortMid: null, longMid: 0.10 })).toBeNull();
  });
});

describe("spreadUnrealized — credit spread", () => {
  // entered at 0.66 credit, now costs 0.30 to close, 16 contracts, max_gain 1056
  const r = spreadUnrealized({ credit: 0.66, shortMid: 0.40, longMid: 0.10, contracts: 16, is_credit: true, max_gain: 1056 });
  it("gl_dollars = (credit - mark) x 100 x contracts", () => {
    expect(r.gl_dollars).toBeCloseTo((0.66 - 0.30) * 100 * 16, 2); // 576
  });
  it("pct_captured = gl_dollars / max_gain", () => {
    expect(r.pct_captured).toBeCloseTo(576 / 1056, 4);
  });
  it("flags close-at-50% once pct_captured >= 0.5", () => {
    expect(r.close_50).toBe(true);
  });
  it("null mark → null fields, no false close flag", () => {
    const n = spreadUnrealized({ credit: 0.66, shortMid: null, longMid: 0.10, contracts: 16, is_credit: true, max_gain: 1056 });
    expect(n.gl_dollars).toBeNull();
    expect(n.close_50).toBe(false);
  });
});
