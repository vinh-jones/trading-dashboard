import { describe, it, expect } from "vitest";
import { adaptIntradayCandles, adaptDailyCandles } from "../_lib/uwCandles.js";
import { normalizeBars } from "../../src/lib/orb/bars.js";
import { buildBox } from "../../src/lib/orb/openingRange.js";

describe("adaptIntradayCandles", () => {
  it("adapts the full REST shape (open/high/low/close/start_time/end_time/volume/market_time)", () => {
    const out = adaptIntradayCandles([
      {
        start_time: "2026-08-04T13:30:00Z",
        end_time: "2026-08-04T13:35:00Z",
        open: 708.21,
        high: "711.8",
        low: "707.59",
        close: 711.77,
        volume: 5546830,
        market_time: "r",
      },
    ]);
    expect(out).toEqual([
      {
        start: "2026-08-04T13:30:00Z",
        end: "2026-08-04T13:35:00Z",
        o: 708.21,
        h: "711.8",
        l: "707.59",
        c: 711.77,
        vol: 5546830,
        market: "r",
      },
    ]);
  });

  it("passes the abbreviated shape (o/h/l/c/start/end/vol/market) through unchanged", () => {
    const bar = {
      start: "2026-08-04T13:30:00Z",
      end: "2026-08-04T13:35:00Z",
      o: 708.21,
      h: "711.8",
      l: "707.59",
      c: 711.77,
      vol: 5546830,
      market: "r",
    };
    expect(adaptIntradayCandles([bar])).toEqual([bar]);
  });

  it("prefers the abbreviated field when both shapes are present on the same object", () => {
    const out = adaptIntradayCandles([
      { start: "abbrev-start", start_time: "rest-start", o: 1, open: 2 },
    ]);
    expect(out[0].start).toBe("abbrev-start");
    expect(out[0].o).toBe(1);
  });

  it("returns [] for non-array input", () => {
    expect(adaptIntradayCandles(null)).toEqual([]);
    expect(adaptIntradayCandles(undefined)).toEqual([]);
    expect(adaptIntradayCandles("not-an-array")).toEqual([]);
    expect(adaptIntradayCandles(42)).toEqual([]);
  });

  it("skips non-object elements instead of throwing", () => {
    const bar = { start_time: "2026-08-04T13:30:00Z", open: 1, high: "2", low: "1", close: 1.5, volume: 10, market_time: "r" };
    expect(() => adaptIntradayCandles([null, undefined, "x", 42, bar])).not.toThrow();
    expect(adaptIntradayCandles([null, undefined, "x", 42, bar])).toHaveLength(1);
  });
});

describe("adaptDailyCandles", () => {
  it("adapts the full REST shape (open/high/low/close/volume) with an explicit bare date", () => {
    const out = adaptDailyCandles([
      { date: "2026-08-04", open: 700, high: "705", low: "698", close: 703, volume: 1000 },
    ]);
    expect(out).toEqual([{ date: "2026-08-04", o: 700, h: "705", l: "698", c: 703, vol: 1000 }]);
  });

  it("passes the abbreviated shape (o/h/l/c/vol) through unchanged", () => {
    const bar = { date: "2026-08-04", o: 700, h: "705", l: "698", c: 703, vol: 1000 };
    expect(adaptDailyCandles([bar])).toEqual([bar]);
  });

  it("returns [] for non-array input", () => {
    expect(adaptDailyCandles(null)).toEqual([]);
    expect(adaptDailyCandles(undefined)).toEqual([]);
  });

  it("skips non-object elements instead of throwing", () => {
    const bar = { date: "2026-08-04", o: 1, h: "2", l: "1", c: 1.5, vol: 1 };
    expect(() => adaptDailyCandles([null, undefined, "x", 42, bar])).not.toThrow();
    expect(adaptDailyCandles([null, undefined, "x", 42, bar])).toHaveLength(1);
  });

  it("derives the date from start_time (in ET) when `date` is absent", () => {
    // 2026-08-04T18:00:00Z is 14:00 EDT (UTC-4) on the same day — a
    // non-boundary sanity check before the trickier previous-day case below.
    const out = adaptDailyCandles([
      { start_time: "2026-08-04T18:00:00Z", open: 700, high: "705", low: "698", close: 703, volume: 1000 },
    ]);
    expect(out[0].date).toBe("2026-08-04");
  });

  it("derives the date from a UTC start_time that lands on the PREVIOUS day in ET (does not slice the ISO string)", () => {
    // 2026-08-05T02:00:00Z is 2026-08-04T22:00 EDT (UTC-4) — previous ET day.
    // A naive ISO-string slice would wrongly read "2026-08-05".
    const out = adaptDailyCandles([
      { start_time: "2026-08-05T02:00:00Z", open: 700, high: "705", low: "698", close: 703, volume: 1000 },
    ]);
    expect(out[0].date).toBe("2026-08-04");
  });

  it("also derives from an abbreviated `start` field when `date` is absent", () => {
    const out = adaptDailyCandles([
      { start: "2026-08-05T02:00:00Z", o: 700, h: "705", l: "698", c: 703, vol: 1000 },
    ]);
    expect(out[0].date).toBe("2026-08-04");
  });

  it("reduces a `date` that carries a time component to a bare YYYY-MM-DD via ET, not a naive slice", () => {
    // 2026-08-04T00:00:00Z is 2026-08-03T20:00 EDT (UTC-4) — the previous ET
    // day. A naive slice of the first 10 characters would wrongly read
    // "2026-08-04"; this asserts the reduction actually goes through etDate.
    const out = adaptDailyCandles([
      { date: "2026-08-04T00:00:00Z", open: 700, high: "705", low: "698", close: 703, volume: 1000 },
    ]);
    expect(out[0].date).toBe("2026-08-03");
  });
});

describe("end-to-end: REST-shaped intraday candles -> adapter -> normalizeBars -> buildBox", () => {
  it("produces a real opening-range box from REST-shaped input", () => {
    // Same values as the provider's own native 15m bar documented in
    // src/lib/orb/openingRange.js (o 708.21, h 713.48, l 707.59, c 712.5195).
    const raw = [
      {
        start_time: "2026-08-04T13:30:00Z", end_time: "2026-08-04T13:35:00Z",
        open: 708.21, high: "711.8", low: "707.59", close: 711.77,
        volume: 2000000, market_time: "r",
      },
      {
        start_time: "2026-08-04T13:35:00Z", end_time: "2026-08-04T13:40:00Z",
        open: 711.77, high: "712.5238", low: "711.15", close: 711.98,
        volume: 1800000, market_time: "r",
      },
      {
        start_time: "2026-08-04T13:40:00Z", end_time: "2026-08-04T13:45:00Z",
        open: 712.07, high: "713.48", low: "711.85", close: 712.5195,
        volume: 1900000, market_time: "r",
      },
    ];

    const box = buildBox(normalizeBars(adaptIntradayCandles(raw)));

    expect(box).not.toBeNull();
    expect(box.high).toBe(713.48);
    expect(box.low).toBe(707.59);
    expect(box.open).toBe(708.21);
    expect(box.close).toBe(712.5195);
    expect(box.color).toBe("green");
  });
});
