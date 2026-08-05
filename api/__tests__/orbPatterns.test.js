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

  it("decomposes a green candle into body and wicks", () => {
    const a = anatomy(BAR_0950);
    expect(a.green).toBe(true);
    expect(a.red).toBe(false);
    expect(a.body).toBeCloseTo(0.97, 4);
    expect(a.upperWick).toBeCloseTo(0.03, 4);
    expect(a.lowerWick).toBeCloseTo(0.12, 4);
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

  // Mirror of the BAR_0950/BAR_0955 pair above: a prior red bar and a current
  // green bar whose open sits half a cent ABOVE the prior close, so a
  // zero-tolerance run misses and the default one-cent tolerance fires.
  // The bullish path was previously never exercised end-to-end — only the
  // bearish side had a real-data fixture — so a sign-flip bug in
  // isBullishEngulfing would have sailed through the whole suite.
  const PREV_RED  = { start: "x", o: 714.62, h: 714.65, l: 712.8,  c: 713.585 };
  const CUR_GREEN = { start: "x", o: 713.59, h: 714.65, l: 713.53, c: 714.615 };

  it("MISSES the mirrored bullish engulfing with zero tolerance", () => {
    // current open 713.59 > prior close 713.585 — over by half a cent.
    const p = { ...ORB_PARAMS, engulfTolerance: 0 };
    expect(detectPattern(CUR_GREEN, PREV_RED, ATR, p)).toBeNull();
  });

  it("FIRES the mirrored bar with the default one-cent tolerance", () => {
    const hit = detectPattern(CUR_GREEN, PREV_RED, ATR, ORB_PARAMS);
    expect(hit).not.toBeNull();
    expect(hit.pattern).toBe("bullish_engulfing");
    expect(hit.side).toBe("long");
  });
});

describe("detectPattern — prevWeak (advisory flag, not a filter)", () => {
  it("flags a real bullish engulfing whose prior bar's body is smaller than engulfTolerance", () => {
    // prev body 0.005 < engulfTolerance 0.01 — the tolerance band dominates
    // the comparison rather than the body being engulfed. Same fixture used
    // in orbSignal.test.js's near-doji rejection tests.
    const prev = { start: "x", o: 100.005, h: 100.005, l: 99.99,  c: 100.000 };
    const bar  = { start: "x", o: 100.008, h: 100.03,  l: 100.007, c: 100.02 };
    const hit = detectPattern(bar, prev, 0.2, ORB_PARAMS);
    expect(hit.pattern).toBe("bullish_engulfing");
    expect(hit.prevWeak).toBe(true);
  });

  it("does NOT flag the real 2026-08-04 QQQ bearish engulfing (control)", () => {
    // BAR_0950 as prev has body 0.97 on range 1.12 (86% — nowhere near doji)
    // and is far larger than engulfTolerance. Proves the flag does not fire
    // on a legitimate signal.
    const hit = detectPattern(BAR_0955, BAR_0950, ATR, ORB_PARAMS);
    expect(hit.pattern).toBe("bearish_engulfing");
    expect(hit.prevWeak).toBe(false);
  });

  it("never flags a hammer, which does not read prev", () => {
    const hammer = { start: "x", o: 100.3, h: 101.0, l: 98.0, c: 100.8 };
    const hit = detectPattern(hammer, null, 10, ORB_PARAMS);
    expect(hit.pattern).toBe("hammer");
    expect(hit.prevWeak).toBe(false);
  });

  it("flags a prior bar that is doji-shaped by range even though its body is large in dollar terms", () => {
    // prev: range 100, body 5 -> 5% of range (doji-shaped, under the 10%
    // floor) but $5 is nowhere near engulfTolerance ($0.01). Proves the
    // doji-shaped check and the tolerance-slack check are both live
    // independently, not one masking the other.
    const prev = { start: "x", o: 105, h: 150, l: 50, c: 100 };  // red, body 5
    const bar  = { start: "x", o: 100, h: 106, l: 99,  c: 105 }; // green, engulfs
    const hit = detectPattern(bar, prev, 50, ORB_PARAMS);
    expect(hit.pattern).toBe("bullish_engulfing");
    expect(hit.prevWeak).toBe(true);
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

  it("accepts a doji-guard boundary bar: body exactly minBodyPctOfRange * range", () => {
    // range 10, body 1 (exactly 10%, the doji floor) — hammer shape:
    // bodyBot 9 sits in the top third (floor 6.667), lowerWick 9 (>= 2x
    // body), upperWick 0 (<= 0.5x body). Confirms the doji guard is
    // inclusive (>=) at its own threshold, not exclusive.
    const boundary = { start: "x", o: 9, h: 10, l: 0, c: 10 };
    const hit = detectPattern(boundary, null, 10, ORB_PARAMS);
    expect(hit).not.toBeNull();
    expect(hit.pattern).toBe("hammer");
  });

  it("accepts a noise-guard boundary bar: range exactly minRangePctOfAtr * atr", () => {
    // range 5, atr 100 -> threshold 0.05*100 = 5, so range == threshold
    // exactly. body 1 (20% of range, well clear of the doji guard) in a
    // hammer shape: bodyBot 4 in the top third (floor 3.333), lowerWick 4
    // (>= 2x body), upperWick 0 (<= 0.5x body). Confirms the noise guard is
    // inclusive (>=) at its own threshold, not exclusive.
    const boundary = { start: "x", o: 4, h: 5, l: 0, c: 5 };
    const hit = detectPattern(boundary, null, 100, ORB_PARAMS);
    expect(hit).not.toBeNull();
    expect(hit.pattern).toBe("hammer");
  });

  // Pins the ordering asserted only in a code comment: engulfing is checked
  // before hammers, so a bar that structurally satisfies both definitions
  // must resolve to the engulfing pattern. Without this test, "simplifying"
  // detectPattern's if-chain order would silently flip which pattern wins
  // and no other test would catch it. Fixture built to satisfy both
  // bearish_engulfing and inverted_hammer simultaneously; noise guard needs
  // a small ATR given the tiny (5-cent) range.
  it("resolves a bar matching both bearish_engulfing and inverted_hammer to engulfing (precedence)", () => {
    const prev = { start: "x", o: 100.00, h: 100.05, l: 99.99,  c: 100.01 };
    const cur  = { start: "x", o: 100.01, h: 100.05, l: 99.995, c: 100.00 };
    const hit = detectPattern(cur, prev, 0.5, ORB_PARAMS);
    expect(hit).not.toBeNull();
    expect(hit.pattern).toBe("bearish_engulfing");
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
