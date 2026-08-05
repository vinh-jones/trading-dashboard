import { describe, it, expect } from "vitest";
import { anatomy, detectPattern, isOutsideBox, matchesDirection } from "../../src/lib/orb/patterns.js";
import { ORB_PARAMS } from "../../src/lib/orb/params.js";

const ATR = 15.07;
const BOX = { high: 713.48, low: 707.59 };

// Real QQQ bars, 2026-08-04 09:50 and 09:55 ET.
const BAR_0950 = { start: "2026-08-04T13:50:00Z", o: 713.65,  h: 714.65, l: 713.53, c: 714.62 };
const BAR_0955 = { start: "2026-08-04T13:55:00Z", o: 714.615, h: 714.65, l: 712.8,  c: 713.585 };

describe("anatomy", () => {
  it("decomposes a red candle into body and wicks", () => {
    const a = anatomy(BAR_0955);
    expect(a.red).toBe(true);
    expect(a.body).toBeCloseTo(1.03, 4);
    expect(a.upperWick).toBeCloseTo(0.035, 4);
    expect(a.lowerWick).toBeCloseTo(0.785, 4);
  });
});

describe("detectPattern — engulfing tolerance", () => {
  it("MISSES the 2026-08-04 bearish engulfing with zero tolerance", () => {
    // current open 714.615 < prior close 714.620 — short by half a cent.
    const p = { ...ORB_PARAMS, engulfTolerance: 0 };
    expect(detectPattern(BAR_0955, BAR_0950, ATR, p)).toBeNull();
  });

  it("FIRES the same bar with the default one-cent tolerance", () => {
    const hit = detectPattern(BAR_0955, BAR_0950, ATR, ORB_PARAMS);
    expect(hit).not.toBeNull();
    expect(hit.pattern).toBe("bearish_engulfing");
    expect(hit.side).toBe("short");
  });
});

describe("detectPattern — hammers", () => {
  // range 3.0, body 0.5 (17% — clears the doji guard), body in the top third
  // (floor 100.0), lower wick 2.3 (>= 2x body), upper wick 0.2 (<= 0.5x body).
  const hammer = { start: "x", o: 100.3, h: 101.0, l: 98.0, c: 100.8 };
  it("identifies a hammer: body in the top third, long lower wick", () => {
    const hit = detectPattern(hammer, null, 10, ORB_PARAMS);
    expect(hit.pattern).toBe("hammer");
    expect(hit.side).toBe("long");
  });

  it("identifies an inverted hammer as the mirror", () => {
    // range 2.8, body 0.5, body top 98.9 <= zone ceiling 99.13,
    // upper wick 2.1 (>= 2x body), lower wick 0.2 (<= 0.5x body).
    const inv = { start: "x", o: 98.9, h: 101.0, l: 98.2, c: 98.4 };
    const hit = detectPattern(inv, null, 10, ORB_PARAMS);
    expect(hit.pattern).toBe("inverted_hammer");
    expect(hit.side).toBe("short");
  });

  it("rejects a near-zero body via the doji guard", () => {
    // body 0.001 vs range 2.8 — far under minBodyPctOfRange (10%).
    const doji = { start: "x", o: 100.0, h: 100.8, l: 98.0, c: 100.001 };
    expect(detectPattern(doji, null, 10, ORB_PARAMS)).toBeNull();
  });

  it("rejects a candle whose whole range is noise relative to ATR", () => {
    // Body is a healthy 80% of range, so the doji guard passes and this
    // isolates the noise guard: range 0.05 vs ATR 15 needs to clear 0.75.
    const tiny = { start: "x", o: 100.0, h: 100.05, l: 100.0, c: 100.04 };
    expect(detectPattern(tiny, null, 15, ORB_PARAMS)).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -5],
  ])("rejects an otherwise-matching bar when atr is %s", (_label, atr) => {
    expect(detectPattern(hammer, null, atr, ORB_PARAMS)).toBeNull();
  });
});

describe("isOutsideBox", () => {
  it("uses the close under the default rule", () => {
    expect(isOutsideBox(BAR_0955, BOX, "bearish", ORB_PARAMS)).toBe("close_above");
    expect(isOutsideBox({ ...BAR_0955, c: 710 }, BOX, "bearish", ORB_PARAMS)).toBeNull();
  });

  it("requires a close below the box for a bullish setup", () => {
    expect(isOutsideBox({ ...BAR_0955, c: 700 }, BOX, "bullish", ORB_PARAMS)).toBe("close_below");
  });

  it("treats a close exactly on the edge as inside", () => {
    expect(isOutsideBox({ ...BAR_0955, c: BOX.high }, BOX, "bearish", ORB_PARAMS)).toBeNull();
    expect(isOutsideBox({ ...BAR_0955, c: BOX.low },  BOX, "bullish", ORB_PARAMS)).toBeNull();
  });

  it("throws on an unsupported outside rule rather than guessing", () => {
    expect(() => isOutsideBox(BAR_0955, BOX, "bearish", { ...ORB_PARAMS, outsideRule: "body" }))
      .toThrow(/outsideRule/);
  });

  it("throws on an unrecognized direction rather than reading as inside", () => {
    expect(() => isOutsideBox(BAR_0955, BOX, "sideways", ORB_PARAMS))
      .toThrow(/direction/);
  });
});

describe("matchesDirection", () => {
  it("accepts only shorts for a bearish setup", () => {
    expect(matchesDirection("short", "bearish")).toBe(true);
    expect(matchesDirection("long",  "bearish")).toBe(false);
  });

  it("accepts only longs for a bullish setup", () => {
    expect(matchesDirection("long",  "bullish")).toBe(true);
    expect(matchesDirection("short", "bullish")).toBe(false);
  });
});
