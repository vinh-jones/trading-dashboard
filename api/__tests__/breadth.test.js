import { describe, it, expect } from "vitest";

import { sma, evaluateTicker, summarizeBreadth, asOfForSession, detectPriceGaps, SMA_PERIOD } from "../_lib/breadth.js";

// Ascending daily bars, oldest first — the shape normalizeDailyBars produces.
// Real sequential calendar dates so the last bar's date is a date, not a string
// that merely looks like one.
function bars(closes, endDate = "2026-08-19") {
  const end = new Date(`${endDate}T00:00:00Z`);
  return closes.map((c, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (closes.length - 1 - i));
    return { date: d.toISOString().slice(0, 10), o: c, h: c, l: c, c, vol: 0 };
  });
}
const flat = (n, v) => Array(n).fill(v);

describe("sma", () => {
  it("averages the last `period` values, ignoring earlier ones", () => {
    expect(sma([999, ...flat(50, 10)], 50)).toBe(10);
  });

  it("returns null when there is not enough history", () => {
    expect(sma(flat(49, 10), 50)).toBeNull();
  });

  it("returns null if any value in the window is not finite", () => {
    expect(sma([...flat(49, 10), NaN], 50)).toBeNull();
  });
});

describe("evaluateTicker", () => {
  it("marks a close above its 50-day mean as above", () => {
    const out = evaluateTicker(bars([...flat(49, 10), 12]));
    expect(out.above).toBe(true);
    expect(out.sessionDate).toBe("2026-08-19"); // the last bar
  });

  it("marks a close below its 50-day mean as below", () => {
    expect(evaluateTicker(bars([...flat(49, 10), 8])).above).toBe(false);
  });

  it("treats a close exactly at the mean as not above", () => {
    expect(evaluateTicker(bars(flat(50, 10))).above).toBe(false);
  });

  // A recent listing has no 50-day history. It must not be counted as "below" —
  // that would drag breadth down with names that simply cannot be judged.
  it("returns null rather than false when history is too short", () => {
    expect(evaluateTicker(bars(flat(SMA_PERIOD - 1, 10)))).toBeNull();
    expect(evaluateTicker([])).toBeNull();
  });
});

describe("summarizeBreadth", () => {
  const verdict = (above, sessionDate = "2026-08-19") => ({ sessionDate, close: 1, sma: 1, above });

  it("computes the percentage over the resolved, in-session set", () => {
    const out = summarizeBreadth([...Array(60).fill(verdict(true)), ...Array(40).fill(verdict(false))]);
    expect(out.ok).toBe(true);
    expect(out.pct).toBe(60);
    expect(out.above).toBe(60);
    expect(out.total).toBe(100);
    expect(out.sessionDate).toBe("2026-08-19");
  });

  it("tolerates unresolved tickers inside the coverage floor", () => {
    // 95 resolved of 100 → 95% coverage, above the 90% floor.
    const out = summarizeBreadth([...Array(50).fill(verdict(true)), ...Array(45).fill(verdict(false)), ...Array(5).fill(null)]);
    expect(out.ok).toBe(true);
    expect(out.total).toBe(95);
    expect(out.coverage).toBeCloseTo(0.95);
  });

  // The guard that matters: whichever tickers fail are not missing at random, so
  // a thin census is biased rather than noisy. Better to write nothing.
  it("refuses to report when coverage falls below the floor", () => {
    const out = summarizeBreadth([...Array(80).fill(verdict(true)), ...Array(20).fill(null)]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/coverage/);
  });

  it("counts unresolved slots against the requested universe, not the resolved one", () => {
    const out = summarizeBreadth(Array(50).fill(verdict(true)), { requested: 500 });
    expect(out.ok).toBe(false);
    expect(out.coverage).toBeCloseTo(0.1);
  });

  // If the cron fires before daily candles settle, tickers straddle two sessions.
  // Averaging across that mix blends two days into one number.
  it("refuses to report when the universe straddles two sessions", () => {
    const out = summarizeBreadth([
      ...Array(50).fill(verdict(true, "2026-08-19")),
      ...Array(50).fill(verdict(false, "2026-08-18")),
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/unsettled/);
  });

  it("excludes a few stragglers when the modal session still clears the floor", () => {
    const out = summarizeBreadth([
      ...Array(60).fill(verdict(true, "2026-08-19")),
      ...Array(35).fill(verdict(false, "2026-08-19")),
      ...Array(5).fill(verdict(true, "2026-08-18")),
    ]);
    expect(out.ok).toBe(true);
    expect(out.sessionDate).toBe("2026-08-19");
    expect(out.total).toBe(95);
    expect(out.above).toBe(60);
  });

  it("reports not-ok on an empty universe instead of dividing by zero", () => {
    const out = summarizeBreadth([]);
    expect(out.ok).toBe(false);
    expect(out.pct).toBeUndefined();
  });

  it("produces a percentage on the same 0-100 scale the S5FI thresholds use", () => {
    // Ryan's buckets are read off this number directly, so it must stay a
    // percentage of members, not a fraction.
    const out = summarizeBreadth([...Array(543).fill(verdict(true)), ...Array(457).fill(verdict(false))]);
    expect(out.pct).toBeGreaterThan(50);
    expect(out.pct).toBeLessThan(60);
  });
});

describe("asOfForSession", () => {
  // Stamping from the session (not the clock) is what makes the write idempotent
  // and makes api/macro.js's freshness gate measure data age, not job age.
  it("derives a stable stamp from the session date", () => {
    expect(asOfForSession("2026-08-19")).toBe("2026-08-19T21:00:00.000Z");
    expect(asOfForSession("2026-08-19")).toBe(asOfForSession("2026-08-19"));
  });

  it("parses as a real timestamp", () => {
    expect(Number.isFinite(new Date(asOfForSession("2026-08-19")).getTime())).toBe(true);
  });
});

describe("detectPriceGaps — unadjusted corporate actions in the SMA window", () => {
  const mk = (closes) => closes.map((c, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, c }));

  // The worked example: IBM 4:3 on 2026-07-14 left it reading 0.66% BELOW its
  // mean where the adjusted series puts it 6.21% ABOVE.
  it("flags a 4:3 split", () => {
    const gaps = detectPriceGaps(mk([290.23, 217.07, 218, 219]));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].ratio).toBeCloseTo(0.7479, 3);
  });

  it("flags a reverse split too — the gap is symmetric in log space", () => {
    expect(detectPriceGaps(mk([10, 100, 101]))).toHaveLength(1);
  });

  it("ignores ordinary volatility, including a hard earnings gap", () => {
    expect(detectPriceGaps(mk([100, 108, 95, 102]))).toHaveLength(0);
    expect(detectPriceGaps(mk([100, 88, 89]))).toHaveLength(0); // -12%, real move
  });

  it("only looks inside the SMA window, not the whole fetched history", () => {
    // A split 60 sessions ago no longer affects a 50-day mean.
    const old = [290, 217, ...Array(60).fill(220)];
    expect(detectPriceGaps(mk(old), 50)).toHaveLength(0);
  });

  it("tolerates short, empty, and non-finite input", () => {
    expect(detectPriceGaps([])).toEqual([]);
    expect(detectPriceGaps(mk([100]))).toEqual([]);
    expect(detectPriceGaps(mk([100, NaN, 102]))).toEqual([]);
  });
});
