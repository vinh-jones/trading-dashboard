import { describe, it, expect } from "vitest";
import { computeFedWatch } from "../macro.js";

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
