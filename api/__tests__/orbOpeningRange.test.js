import { describe, it, expect } from "vitest";
import { buildBox, evaluateLiquidity, seekDirection } from "../../src/lib/orb/openingRange.js";
import { ORB_PARAMS } from "../../src/lib/orb/params.js";

// The real first three QQQ bars of 2026-08-04.
const OPENING = [
  { start: "2026-08-04T13:30:00Z", o: 708.21,   h: 711.8,    l: 707.59, c: 711.77 },
  { start: "2026-08-04T13:35:00Z", o: 711.77,   h: 712.5238, l: 711.15, c: 711.98 },
  { start: "2026-08-04T13:40:00Z", o: 712.07,   h: 713.48,   l: 711.85, c: 712.5195 },
];

describe("buildBox", () => {
  it("boxes the first three 5-minute bars into a 15-minute candle", () => {
    const box = buildBox(OPENING);
    expect(box.high).toBe(713.48);
    expect(box.low).toBe(707.59);
    expect(box.range).toBeCloseTo(5.89, 6);
    expect(box.open).toBe(708.21);
    expect(box.close).toBe(712.5195);
    expect(box.color).toBe("green");
  });

  it("marks a lower close as a red candle", () => {
    const red = [OPENING[0], OPENING[1], { ...OPENING[2], c: 700 }];
    expect(buildBox(red).color).toBe("red");
  });

  it("treats an exactly-flat candle as green (documented tie-break)", () => {
    const flat = [OPENING[0], OPENING[1], { ...OPENING[2], c: 708.21 }];
    expect(buildBox(flat).color).toBe("green");
  });

  it("returns null when fewer than three bars are present", () => {
    expect(buildBox(OPENING.slice(0, 2))).toBeNull();
  });

  it("rejects bars that are not the 09:30/09:35/09:40 ET sequence", () => {
    const late = OPENING.map((b) => ({ ...b, start: b.start.replace("13:", "14:") }));
    expect(buildBox(late)).toBeNull();
  });
});

describe("evaluateLiquidity", () => {
  it("qualifies 2026-08-04 at ~39% of ATR", () => {
    const v = evaluateLiquidity(5.89, 15.0731, ORB_PARAMS);
    expect(v.rangeAtrPct).toBeCloseTo(0.3908, 3);
    expect(v.qualified).toBe(true);
    expect(v.greyBand).toBe(false);
    expect(v.threshold).toBeCloseTo(3.768, 3);
  });

  it("flags the 22-25% band as qualified-but-grey", () => {
    const v = evaluateLiquidity(0.23 * 15, 15, ORB_PARAMS);
    expect(v.qualified).toBe(true);
    expect(v.greyBand).toBe(true);
  });

  it("fails below the grey band", () => {
    const v = evaluateLiquidity(0.19 * 15, 15, ORB_PARAMS);
    expect(v.qualified).toBe(false);
    expect(v.greyBand).toBe(false);
  });

  it("returns a null verdict when ATR is unavailable", () => {
    expect(evaluateLiquidity(5.89, null, ORB_PARAMS).qualified).toBeNull();
  });
});

describe("seekDirection", () => {
  it("fades a green opening candle by seeking a bearish reversal", () => {
    expect(seekDirection("green")).toBe("bearish");
  });

  it("fades a red opening candle by seeking a bullish reversal", () => {
    expect(seekDirection("red")).toBe("bullish");
  });
});
