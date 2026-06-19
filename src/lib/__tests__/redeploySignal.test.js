import { describe, it, expect } from "vitest";
import { computeRedeploySignal } from "../redeploySignal";

// Helper: entry premium 10.00/share, 1 contract → $1000 gross premium.
const base = (overrides) => ({
  premiumCollected: 1000,
  optionMid: 5.0,
  contracts: 1,
  daysToExpiry: 15,
  openDate: "2026-06-01",
  today: "2026-06-16", // 15 days held → originalDte 30
  ...overrides,
});

describe("computeRedeploySignal — ratio math", () => {
  it("ratio = (1 - kept%) / fracTimeLeft", () => {
    // kept 70% (mid 3.0 on entry 10), 3 days held of 30 → fracTimeLeft 0.9
    const r = computeRedeploySignal(base({ optionMid: 3.0, daysToExpiry: 27, today: "2026-06-04" }));
    expect(r.kept_pct).toBeCloseTo(0.7, 5);
    expect(r.frac_time_left).toBeCloseTo(0.9, 5);
    expect(r.ratio).toBeCloseTo(0.333, 2); // 0.3 / 0.9
    expect(r.redeploy_state).toBe("redeploy");
  });

  it("trigger mark = CLOSE_THRESHOLD × entry × fracTimeLeft", () => {
    const r = computeRedeploySignal(base({ optionMid: 3.0, daysToExpiry: 27, today: "2026-06-04" }));
    // 0.5 × 10.00 × 0.9 = 4.50
    expect(r.trigger_mark).toBeCloseTo(4.5, 5);
    expect(r.current_mark).toBe(3.0);
  });
});

describe("computeRedeploySignal — state bands", () => {
  it("watch when leftover pays 0.5–0.8 of fresh (the 60/40 case)", () => {
    // kept 60% (mid 4.0), 12 of 30 days held → fracTimeLeft 0.6 → ratio 0.667
    const r = computeRedeploySignal(base({ optionMid: 4.0, daysToExpiry: 18, today: "2026-06-13" }));
    expect(r.ratio).toBeCloseTo(0.667, 2);
    expect(r.redeploy_state).toBe("watch");
  });

  it("hold when leftover keeps pace with a fresh trade", () => {
    // kept 10% (mid 9.0), 3 of 30 days → fracTimeLeft 0.9 → ratio 1.0
    const r = computeRedeploySignal(base({ optionMid: 9.0, daysToExpiry: 27, today: "2026-06-04" }));
    expect(r.ratio).toBeCloseTo(1.0, 5);
    expect(r.redeploy_state).toBe("hold");
  });

  it("underwater when the mark is above entry (a roll decision, not redeploy)", () => {
    const r = computeRedeploySignal(base({ optionMid: 12.0 }));
    expect(r.kept_pct).toBeLessThan(0);
    expect(r.redeploy_state).toBe("underwater");
  });
});

describe("computeRedeploySignal — skips", () => {
  it("skips when the option mark is missing", () => {
    expect(computeRedeploySignal(base({ optionMid: null })).skipped).toBe("missing_mark");
  });

  it("skips an expired / same-day-expiry position", () => {
    expect(computeRedeploySignal(base({ daysToExpiry: 0 })).skipped).toBe("expired");
  });
});

describe("computeRedeploySignal — threshold is configurable", () => {
  it("respects a custom close threshold", () => {
    // ratio 0.667; with a 0.7 close line it becomes a redeploy
    const r = computeRedeploySignal(
      base({ optionMid: 4.0, daysToExpiry: 18, today: "2026-06-13" }),
      { CLOSE_THRESHOLD: 0.7, WATCH_THRESHOLD: 0.9 }
    );
    expect(r.redeploy_state).toBe("redeploy");
  });
});
