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

  it("selects the opening bars by ET minute when pre-market bars are prepended", () => {
    const premarket = [
      { start: "2026-08-04T08:00:00Z", o: 700, h: 705, l: 695, c: 702 }, // 04:00 ET
      { start: "2026-08-04T08:05:00Z", o: 702, h: 706, l: 698, c: 703 }, // 04:05 ET
    ];
    const box = buildBox([...premarket, ...OPENING]);
    expect(box.high).toBe(713.48);
    expect(box.low).toBe(707.59);
  });

  it("returns null when the three ET-minute bars span two different dates", () => {
    const crossDay = [
      OPENING[0],
      OPENING[1],
      { ...OPENING[2], start: "2026-08-05T13:40:00Z" }, // same ET minute, next day
    ];
    expect(buildBox(crossDay)).toBeNull();
  });

  it("builds the box during EST (winter, no DST) using the same ET-minute guard", () => {
    const winterOpening = [
      { start: "2026-01-05T14:30:00Z", o: 500, h: 502, l: 499,   c: 501 }, // 09:30 ET
      { start: "2026-01-05T14:35:00Z", o: 501, h: 503, l: 500,   c: 502 }, // 09:35 ET
      { start: "2026-01-05T14:40:00Z", o: 502, h: 504, l: 500.5, c: 503 }, // 09:40 ET
    ];
    const box = buildBox(winterOpening);
    expect(box).not.toBeNull();
    expect(box.high).toBe(504);
    expect(box.low).toBe(499);
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

  it("qualifies with greyBand at the exact 0.22 boundary", () => {
    const v = evaluateLiquidity(22, 100, ORB_PARAMS);
    expect(v.rangeAtrPct).toBe(0.22);
    expect(v.qualified).toBe(true);
    expect(v.greyBand).toBe(true);
  });

  it("qualifies without greyBand at the exact 0.25 boundary", () => {
    const v = evaluateLiquidity(25, 100, ORB_PARAMS);
    expect(v.rangeAtrPct).toBe(0.25);
    expect(v.qualified).toBe(true);
    expect(v.greyBand).toBe(false);
  });

  it("returns a null verdict when atr is exactly zero", () => {
    const v = evaluateLiquidity(5.89, 0, ORB_PARAMS);
    expect(v.qualified).toBeNull();
    expect(v.greyBand).toBeNull();
  });

  it("returns a null verdict when atr is negative", () => {
    const v = evaluateLiquidity(5.89, -5, ORB_PARAMS);
    expect(v.qualified).toBeNull();
    expect(v.greyBand).toBeNull();
  });

  it("returns a null verdict when range is NaN", () => {
    const v = evaluateLiquidity(NaN, 15, ORB_PARAMS);
    expect(v.qualified).toBeNull();
    expect(v.greyBand).toBeNull();
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
