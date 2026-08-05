import { describe, it, expect } from "vitest";
import { normalizeBars, sliceSession } from "../../src/lib/orb/bars.js";

const RAW = [
  { start: "2026-08-04T13:40:00Z", end: "2026-08-04T13:45:00Z", o: 712.07, h: "713.48", l: "711.85", c: 712.5195 },
  { start: "2026-08-04T13:30:00Z", end: "2026-08-04T13:35:00Z", o: 708.21, h: "711.8",  l: "707.59", c: 711.77 },
  { start: "2026-08-04T13:35:00Z", end: "2026-08-04T13:40:00Z", o: 711.77, h: "712.5238", l: "711.15", c: 711.98 },
];

describe("normalizeBars", () => {
  it("sorts ascending by start and coerces h/l to numbers", () => {
    const bars = normalizeBars(RAW);
    expect(bars.map((b) => b.start)).toEqual([
      "2026-08-04T13:30:00Z",
      "2026-08-04T13:35:00Z",
      "2026-08-04T13:40:00Z",
    ]);
    expect(bars[0].h).toBe(711.8);
    expect(typeof bars[0].l).toBe("number");
  });

  it("drops bars with any non-finite OHLC", () => {
    const bars = normalizeBars([...RAW, { start: "2026-08-04T13:45:00Z", o: null, h: "1", l: "1", c: 1 }]);
    expect(bars).toHaveLength(3);
  });
});

describe("sliceSession", () => {
  it("keeps only bars whose start falls on the given ET session date", () => {
    const bars = normalizeBars([
      ...RAW,
      { start: "2026-08-03T13:30:00Z", end: "2026-08-03T13:35:00Z", o: 1, h: "2", l: "1", c: 2 },
    ]);
    expect(sliceSession(bars, "2026-08-04")).toHaveLength(3);
  });
});
