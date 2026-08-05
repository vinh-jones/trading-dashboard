import { describe, it, expect } from "vitest";
import { trueRange, wilderAtr } from "../../src/lib/orb/atr.js";

// QQQ daily bars, oldest first. 07-14 is the seed's prior close.
const DAILY = [
  { start: "2026-07-14", o: 720.22, h: 722.29,   l: 714.34,   c: 719.69 },
  { start: "2026-07-15", o: 723.85, h: 724.36,   l: 710.23,   c: 717.74 },
  { start: "2026-07-16", o: 712.01, h: 713.599,  l: 702.61,   c: 705.94 },
  { start: "2026-07-17", o: 691.65, h: 702.30,   l: 686.76,   c: 695.33 },
  { start: "2026-07-20", o: 702.16, h: 705.80,   l: 695.51,   c: 696.06 },
  { start: "2026-07-21", o: 706.57, h: 710.05,   l: 702.80,   c: 708.97 },
  { start: "2026-07-22", o: 703.62, h: 709.65,   l: 703.62,   c: 705.35 },
  { start: "2026-07-23", o: 694.67, h: 698.66,   l: 687.79,   c: 691.96 },
  { start: "2026-07-24", o: 690.41, h: 692.63,   l: 682.48,   c: 684.23 },
  { start: "2026-07-27", o: 691.68, h: 692.30,   l: 675.945,  c: 682.12 },
  { start: "2026-07-28", o: 676.23, h: 679.40,   l: 667.88,   c: 675.49 },
  { start: "2026-07-29", o: 675.505,h: 680.05,   l: 661.14,   c: 661.73 },
  { start: "2026-07-30", o: 674.76, h: 685.12,   l: 673.30,   c: 683.55 },
  { start: "2026-07-31", o: 692.11, h: 695.77,   l: 680.0512, c: 687.99 },
  { start: "2026-08-03", o: 688.30, h: 701.59,   l: 685.82,   c: 700.07 },
];

describe("trueRange", () => {
  it("is high-low when the prior close sits inside the bar", () => {
    expect(trueRange({ h: 724.36, l: 710.23 }, 719.69)).toBeCloseTo(14.13, 4);
  });

  it("uses the gap when the prior close sits outside the bar", () => {
    // 07-30: prior close 661.73 is far below the bar's low.
    expect(trueRange({ h: 685.12, l: 673.30 }, 661.73)).toBeCloseTo(23.39, 4);
  });

  it("falls back to high-low with no prior close", () => {
    expect(trueRange({ h: 10, l: 4 }, null)).toBe(6);
  });
});

describe("wilderAtr", () => {
  it("seeds with the simple mean of the first `period` true ranges", () => {
    // Exactly 14 TRs available -> the result is their arithmetic mean.
    expect(wilderAtr(DAILY, 14)).toBeCloseTo(15.0731, 3);
  });

  it("returns null when there are fewer than period+1 bars", () => {
    expect(wilderAtr(DAILY.slice(0, 10), 14)).toBeNull();
  });

  it("smooths forward once past the seed window", () => {
    // With 15 TRs the last value is seed + (tr - seed)/period, not a flat mean.
    const bars = [{ start: "2026-07-13", o: 717.72, h: 718.74, l: 710.08, c: 711.74 }, ...DAILY];
    const atr = wilderAtr(bars, 14);
    expect(atr).not.toBeCloseTo(15.0731, 3);
    expect(atr).toBeCloseTo(14.7767, 3);
  });
});
