import { describe, it, expect } from "vitest";
import { normalizeBars, normalizeDailyBars, sliceSession, etDate, etMinutes } from "../../src/lib/orb/bars.js";

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

  it("drops bars with an empty or whitespace-only string OHLC field (does not fabricate a $0 price)", () => {
    const bars = normalizeBars([
      { start: "2026-08-04T13:30:00Z", end: "2026-08-04T13:35:00Z", o: 700, h: "", l: "700", c: 700.5 },
      { start: "2026-08-04T13:35:00Z", end: "2026-08-04T13:40:00Z", o: 700, h: "701", l: "   ", c: 700.5 },
    ]);
    expect(bars).toHaveLength(0);
  });

  it("drops non-object elements (null, undefined, primitives) instead of throwing", () => {
    expect(() =>
      normalizeBars([...RAW, null, undefined, "not-a-bar", 42])
    ).not.toThrow();
    const bars = normalizeBars([...RAW, null, undefined, "not-a-bar", 42]);
    expect(bars).toHaveLength(3);
  });

  it("drops known extended-hours markers (case-insensitively) but keeps 'r', unknown markers, and bars with no market field", () => {
    const bars = normalizeBars([
      ...RAW.map((b) => ({ ...b, market: "r" })),
      { start: "2026-08-04T09:00:00Z", end: "2026-08-04T09:05:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "pre" },
      { start: "2026-08-04T09:05:00Z", end: "2026-08-04T09:10:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "PRE" },
      { start: "2026-08-04T20:55:00Z", end: "2026-08-04T21:00:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "po" },
      { start: "2026-08-04T21:00:00Z", end: "2026-08-04T21:05:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "post" },
      { start: "2026-08-04T21:05:00Z", end: "2026-08-04T21:10:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "after" },
      { start: "2026-08-04T21:10:00Z", end: "2026-08-04T21:15:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "ah" },
      // An unexpected/unknown label must be KEPT, not dropped — the real UW
      // value set beyond "po" is unconfirmed, and dropping unknowns is what
      // silently emptied a whole session in production.
      { start: "2026-08-04T13:42:00Z", end: "2026-08-04T13:47:00Z", o: 700, h: "701", l: "699", c: 700.5, market: "some-unseen-label" },
    ]);
    // 3 from RAW (market: "r") + 1 unknown label kept — pre/PRE/po/post/after/ah dropped.
    expect(bars).toHaveLength(4);
    expect(bars.filter((b) => b.market === "r")).toHaveLength(3);
    expect(bars.some((b) => b.market === "some-unseen-label")).toBe(true);

    // Bars with no `market` field at all (existing fixtures/tests) still pass.
    const noMarketField = normalizeBars(RAW);
    expect(noMarketField).toHaveLength(3);
  });
});

describe("normalizeDailyBars", () => {
  const RAW_DAILY = [
    { date: "2026-08-03", o: 700, h: "705", l: "698", c: 703, vol: 1000 },
    { date: "2026-08-01", o: 690, h: "695", l: "688", c: 693, vol: 900 },
    { date: "2026-08-04", o: 703, h: "710", l: "701", c: 708, vol: 1100 },
  ];

  it("sorts ascending by date and coerces string h/l to numbers", () => {
    const bars = normalizeDailyBars(RAW_DAILY);
    expect(bars.map((b) => b.date)).toEqual(["2026-08-01", "2026-08-03", "2026-08-04"]);
    expect(bars[0].h).toBe(695);
    expect(typeof bars[0].l).toBe("number");
  });

  it("drops rows with a malformed or missing date", () => {
    const bars = normalizeDailyBars([
      ...RAW_DAILY,
      { date: "08/04/2026", o: 1, h: "2", l: "1", c: 1.5, vol: 1 },
      { o: 1, h: "2", l: "1", c: 1.5, vol: 1 },
      { date: null, o: 1, h: "2", l: "1", c: 1.5, vol: 1 },
    ]);
    expect(bars).toHaveLength(3);
  });

  it("drops rows with non-finite OHLC", () => {
    const bars = normalizeDailyBars([
      ...RAW_DAILY,
      { date: "2026-08-05", o: null, h: "2", l: "1", c: 1.5, vol: 1 },
      { date: "2026-08-06", o: 1, h: "", l: "1", c: 1.5, vol: 1 },
    ]);
    expect(bars).toHaveLength(3);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeDailyBars(null)).toEqual([]);
    expect(normalizeDailyBars(undefined)).toEqual([]);
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

describe("etDate / etMinutes DST boundary", () => {
  // 2026-03-08 is the US spring-forward date (2am EST -> 3am EDT). By 13:30Z
  // the transition has already happened, so ET is UTC-4 (EDT).
  it("treats 13:30Z as 09:30 ET on the spring-forward date (EDT, UTC-4)", () => {
    expect(etMinutes("2026-03-08T13:30:00Z")).toBe(9 * 60 + 30);
    expect(etDate("2026-03-08T13:30:00Z")).toBe("2026-03-08");
  });

  // 2026-11-01 is the US fall-back date (2am EDT -> 1am EST). By 13:30Z the
  // transition has already happened, so ET is UTC-5 (EST) — one hour earlier
  // than the EDT case above despite the same UTC clock time.
  it("treats 13:30Z as 08:30 ET on the fall-back date (EST, UTC-5)", () => {
    expect(etMinutes("2026-11-01T13:30:00Z")).toBe(8 * 60 + 30);
    expect(etDate("2026-11-01T13:30:00Z")).toBe("2026-11-01");
  });
});
