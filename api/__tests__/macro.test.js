import { describe, it, expect } from "vitest";
import { computeFedWatch, computePosture, isCacheFresh } from "../macro.js";

// Meeting dates generated relative to "now" so the 12-month window includes them
// regardless of when the suite runs (avoids coupling to the calendar).
function isoFromNow(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

const row = (meeting_iso, num_moves, is_cut, implied) => ({
  meeting_iso,
  num_moves,
  num_moves_is_cut: is_cut,
  implied_rate_post_meeting: implied,
  prob_move_pct: 10,
  prob_is_cut: is_cut,
});

describe("computeFedWatch", () => {
  it("reports hikes as a negative cutsPricedIn on a rising curve", () => {
    const todayRows = [
      row(isoFromNow(20), 0.1, false, 3.65),
      row(isoFromNow(80), 0.8, false, 3.85),
    ];
    const out = computeFedWatch({ currentRate: 3.625, todayRows, weekAgoRows: null });
    expect(out.cutsPricedIn).toBe(-0.8); // last in-window meeting, hikes → negative
    expect(out.curveDirection).toBe("rising");
    expect(out.currentRate).toBe(3.625);
  });

  it("reports cuts as a positive cutsPricedIn on a declining curve", () => {
    const todayRows = [
      row(isoFromNow(20), 0.5, true, 3.50),
      row(isoFromNow(80), 1.5, true, 3.20),
    ];
    const out = computeFedWatch({ currentRate: 3.625, todayRows, weekAgoRows: null });
    expect(out.cutsPricedIn).toBe(1.5);
    expect(out.curveDirection).toBe("declining");
  });

  it("throws when there are no rows (so the caller can fall back)", () => {
    expect(() => computeFedWatch({ currentRate: 3.6, todayRows: [], weekAgoRows: null })).toThrow();
  });
});

describe("isCacheFresh — S5FI/FedWatch cache reads are age-bounded", () => {
  const now = Date.UTC(2026, 7, 19, 12, 0, 0); // 2026-08-19T12:00Z
  const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

  it("accepts a same-day row", () => {
    expect(isCacheFresh(daysAgo(0), now)).toBe(true);
  });

  it("accepts a 4-day-old row — a Tuesday read after a Monday holiday", () => {
    expect(isCacheFresh(daysAgo(4), now)).toBe(true);
  });

  it("rejects a 5-day-old row", () => {
    expect(isCacheFresh(daysAgo(5), now)).toBe(false);
  });

  // The regression this gate exists for: s5fi froze at 2026-07-01 and the
  // unbounded read kept serving it as the current breadth reading for 7 weeks.
  it("rejects the frozen 2026-07-01 S5FI row", () => {
    expect(isCacheFresh("2026-07-01T19:59:01.232931+00:00", now)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as not fresh", () => {
    expect(isCacheFresh(null, now)).toBe(false);
    expect(isCacheFresh(undefined, now)).toBe(false);
    expect(isCacheFresh("not-a-date", now)).toBe(false);
  });
});

describe("computePosture — unavailable signals are excluded, not scored 3", () => {
  it("averages only the available signals", () => {
    // Same numbers with one signal missing: a fallback 3 would have pulled the
    // average toward neutral and hidden the fact that a feed was dead.
    const out = computePosture([5, 5, 5, null, 5, 5, 5]);
    expect(out.avg).toBe(5);
    expect(out.signalsAvailable).toBe(6);
    expect(out.signalsTotal).toBe(7);
  });

  it("keeps the full scores array so the missing slot stays visible", () => {
    expect(computePosture([4, null, 2]).scores).toEqual([4, null, 2]);
  });

  it("still averages all seven when nothing is missing", () => {
    const out = computePosture([3, 4, 4, 1, 4, 3, 2]);
    expect(out.avg).toBe(3);
    expect(out.signalsAvailable).toBe(7);
  });

  it("reports UNAVAILABLE with a null avg when every signal is missing", () => {
    const out = computePosture([null, null, null]);
    expect(out.posture).toBe("UNAVAILABLE");
    expect(out.avg).toBeNull();
    expect(out.signalsAvailable).toBe(0);
  });
});
