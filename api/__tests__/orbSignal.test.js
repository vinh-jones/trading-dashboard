import { describe, it, expect } from "vitest";
import { buildSignal } from "../../src/lib/orb/signal.js";

// The spec's own worked NVDA example.
const NVDA_BOX = { high: 182, low: 176 };

describe("buildSignal", () => {
  it("reproduces the NVDA hammer long from the source doc", () => {
    const bar  = { o: 173.0, h: 175.15, l: 172.50, c: 174.9 };
    const sig  = buildSignal({ pattern: "hammer", side: "long" }, bar, null, NVDA_BOX);
    expect(sig.entry).toBe(175.15);
    expect(sig.stop).toBe(172.50);
    expect(sig.t1).toBe(176);   // near edge
    expect(sig.t2).toBe(182);   // far edge
    expect(sig.risk).toBeCloseTo(2.65, 4);
    // The video quotes ~2.7 R:R — that is T2 only. T1 is far worse.
    expect(sig.rrT2).toBeCloseTo(2.585, 3);
    expect(sig.rrT1).toBeCloseTo(0.321, 3);
    expect(sig.t1Ahead).toBe(true);
  });

  it("uses the prior bar's high as entry for a bullish engulfing", () => {
    const prev = { o: 175.0, h: 175.5, l: 174.0, c: 174.2 };
    const bar  = { o: 174.1, h: 176.0, l: 173.8, c: 175.4 };
    const sig  = buildSignal({ pattern: "bullish_engulfing", side: "long" }, bar, prev, NVDA_BOX);
    expect(sig.entry).toBe(175.5);
    expect(sig.stop).toBe(173.8);
  });

  it("inverts targets for a short above the box", () => {
    const bar = { o: 184.0, h: 185.0, l: 183.0, c: 183.2 };
    const sig = buildSignal({ pattern: "inverted_hammer", side: "short" }, bar, null, NVDA_BOX);
    expect(sig.entry).toBe(183.0);
    expect(sig.stop).toBe(185.0);
    expect(sig.t1).toBe(182);   // near edge for a short is the box HIGH
    expect(sig.t2).toBe(176);
    expect(sig.t1Ahead).toBe(true);
  });

  it("uses the prior bar's low as entry for a bearish engulfing", () => {
    const prev = { o: 183.0, h: 184.5, l: 182.9, c: 184.2 };
    const bar  = { o: 184.3, h: 185.0, l: 183.1, c: 182.9 };
    const sig  = buildSignal({ pattern: "bearish_engulfing", side: "short" }, bar, prev, NVDA_BOX);
    expect(sig.entry).toBe(182.9);
    expect(sig.stop).toBe(185.0);
  });

  it("flags t1Ahead false when a long's entry already sits past the near edge", () => {
    // Closes below the box (175.2 < 176) but the high pokes back above it,
    // so entry 176.5 is already past T1 = 176.
    const bar = { o: 175.5, h: 176.5, l: 174.0, c: 175.2 };
    const sig = buildSignal({ pattern: "hammer", side: "long" }, bar, null, NVDA_BOX);
    expect(sig.entry).toBe(176.5);
    expect(sig.t1).toBe(176);
    expect(sig.t1Ahead).toBe(false);
    expect(sig.t2).toBe(182);
    expect(sig.rrT2).toBeCloseTo(2.2, 4);   // T2 is still a real target
  });

  it("flags t1Ahead false when a short's entry already sits past the near edge", () => {
    const bar = { o: 182.2, h: 183.5, l: 181.5, c: 182.4 };
    const sig = buildSignal({ pattern: "inverted_hammer", side: "short" }, bar, null, NVDA_BOX);
    expect(sig.entry).toBe(181.5);
    expect(sig.t1).toBe(182);
    expect(sig.t1Ahead).toBe(false);
  });

  it("rejects a malformed match where the stop is on the wrong side", () => {
    const bar = { o: 100, h: 101, l: 99, c: 100.5 };
    // A "long" whose stop (h) sits above entry (l) is incoherent.
    expect(buildSignal({ pattern: "bogus", side: "long" }, bar, null, NVDA_BOX)).toBeNull();
  });

  it("returns null for an engulfing with no prior bar", () => {
    const bar = { o: 174.1, h: 176.0, l: 173.8, c: 175.4 };
    expect(buildSignal({ pattern: "bullish_engulfing", side: "long" }, bar, null, NVDA_BOX)).toBeNull();
  });

  it("returns null when risk would be zero", () => {
    const bar = { o: 100, h: 100, l: 100, c: 100 };
    expect(buildSignal({ pattern: "hammer", side: "long" }, bar, null, NVDA_BOX)).toBeNull();
  });

  it("rejects a long whose entry sits above the box entirely", () => {
    const bar = { o: 182.5, h: 183.5, l: 181.0, c: 183.0 };
    expect(buildSignal({ pattern: "hammer", side: "long" }, bar, null, NVDA_BOX)).toBeNull();
  });

  it("rejects a short whose entry sits below the box entirely", () => {
    const bar = { o: 175.5, h: 177.0, l: 174.5, c: 175.0 };
    expect(buildSignal({ pattern: "inverted_hammer", side: "short" }, bar, null, NVDA_BOX)).toBeNull();
  });

  it("still returns a signal when a long's entry sits inside the box (degenerate but not incoherent)", () => {
    // box is 176-182; entry 178 is inside it, not past the far edge.
    const bar = { o: 175.5, h: 178.0, l: 174.0, c: 175.2 };
    const sig = buildSignal({ pattern: "hammer", side: "long" }, bar, null, NVDA_BOX);
    expect(sig).not.toBeNull();
    expect(sig.entry).toBe(178.0);
    expect(sig.t1Ahead).toBe(false);
    expect(sig.rrT2).toBeGreaterThan(0);
  });
});
