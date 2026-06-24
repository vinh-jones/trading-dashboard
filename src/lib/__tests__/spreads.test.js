// src/lib/__tests__/spreads.test.js
import { describe, it, expect } from "vitest";
import { cushionToBreakeven } from "../spreads.js";

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
