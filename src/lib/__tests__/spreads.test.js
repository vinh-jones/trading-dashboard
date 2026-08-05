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
    expect(spreadMark({ shortMid: 0.40, longMid: 0.10, is_credit: true })).toBeCloseTo(0.30, 5);
  });
  it("debit spread mark = long_mid - short_mid (what the position is worth)", () => {
    // The long leg is the expensive one on a debit spread, so the credit
    // formula would return a negative mark and flip the sign of G/L.
    expect(spreadMark({ shortMid: 15.97, longMid: 22.28, is_credit: false })).toBeCloseTo(6.31, 5);
  });
  it("defaults to credit geometry when is_credit is unknown", () => {
    expect(spreadMark({ shortMid: 0.40, longMid: 0.10 })).toBeCloseTo(0.30, 5);
  });
  it("null if either leg missing", () => {
    expect(spreadMark({ shortMid: null, longMid: 0.10, is_credit: true })).toBeNull();
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

describe("spreadUnrealized — debit spread (the SPY 750/770 bear put)", () => {
  // Bought the 770 put / sold the 750 put for a 6.15 debit, 5 contracts.
  // Width 20 → max gain (20 - 6.15) x 100 x 5 = 6925. Legs now 15.97 / 22.28.
  const r = spreadUnrealized({
    credit: 6.15, shortMid: 15.97, longMid: 22.28,
    contracts: 5, is_credit: false, max_gain: 6925,
  });
  it("gl_dollars = (mark - debit) x 100 x contracts", () => {
    expect(r.gl_dollars).toBe(80); // (6.31 - 6.15) x 100 x 5
  });
  it("pct_captured works for debit spreads too — share of max gain", () => {
    expect(r.pct_captured).toBeCloseTo(80 / 6925, 6);
  });
  it("is not flagged for the 50% close at 1% captured", () => {
    expect(r.close_50).toBe(false);
  });
  it("goes negative when the spread loses value", () => {
    const loss = spreadUnrealized({
      credit: 6.15, shortMid: 16.50, longMid: 20.00,
      contracts: 5, is_credit: false, max_gain: 6925,
    });
    expect(loss.gl_dollars).toBe(-1325); // (3.50 - 6.15) x 100 x 5
  });
  it("flags the 50% close once half of max gain is captured", () => {
    const win = spreadUnrealized({
      credit: 6.15, shortMid: 10.00, longMid: 24.00,
      contracts: 5, is_credit: false, max_gain: 6925,
    });
    expect(win.gl_dollars).toBe(3925); // (14.00 - 6.15) x 100 x 5
    expect(win.pct_captured).toBeCloseTo(3925 / 6925, 6);
    expect(win.close_50).toBe(true);
  });
  it("pct_captured is null without a max_gain", () => {
    const n = spreadUnrealized({ credit: 6.15, shortMid: 15.97, longMid: 22.28, contracts: 5, is_credit: false, max_gain: null });
    expect(n.gl_dollars).toBe(80);
    expect(n.pct_captured).toBeNull();
  });
});
