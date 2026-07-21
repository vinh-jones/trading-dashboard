import { describe, it, expect } from "vitest";
import { computeIvTrend, ivTrendsFromSnapshots } from "../ivTrend.js";

// Snapshots are consumed newest-first (the query orders captured_at desc).
function snap(ticker, daysAgo, iv, iv_rank) {
  return {
    ticker, iv, iv_rank,
    captured_at: new Date(Date.now() - daysAgo * 864e5).toISOString(),
  };
}

describe("computeIvTrend", () => {
  it("needs at least three points before calling a trend", () => {
    expect(computeIvTrend([])).toBeNull();
    expect(computeIvTrend([snap("A", 0, 0.5, 50), snap("A", 1, 0.5, 50)]))
      .toMatchObject({ state: "insufficient", dataPoints: 2 });
  });

  it("calls a rise only when raw IV moved too", () => {
    const rising = computeIvTrend([
      snap("A", 0, 0.60, 80), snap("A", 2, 0.55, 72), snap("A", 5, 0.45, 60),
    ]);
    expect(rising).toMatchObject({ state: "rising", modifier: 1.10 });
  });

  it("treats an IVR jump with flat raw IV as stable, not rising", () => {
    // The 52-week denominator rolled — not a vol event. This gate is why the
    // scanner score does not get fooled by window artifacts.
    const drifted = computeIvTrend([
      snap("A", 0, 0.50, 80), snap("A", 2, 0.50, 70), snap("A", 5, 0.49, 60),
    ]);
    expect(drifted.state).toBe("stable");
    expect(drifted.modifier).toBe(1.00);
  });

  it("flags window drift as context alongside the state", () => {
    const drifted = computeIvTrend([
      snap("A", 0, 0.50, 40), snap("A", 2, 0.50, 55), snap("A", 5, 0.49, 75),
    ]);
    expect(drifted.drift).toMatchObject({ detected: true, direction: "deflated" });
  });
});

describe("ivTrendsFromSnapshots", () => {
  it("groups rows per ticker and drops ones with no usable trend", () => {
    const map = ivTrendsFromSnapshots([
      snap("AAA", 0, 0.60, 80), snap("AAA", 2, 0.55, 72), snap("AAA", 5, 0.45, 60),
      snap("BBB", 0, 0.30, 40),
    ]);
    expect(map.get("AAA").state).toBe("rising");
    expect(map.get("BBB").state).toBe("insufficient");
  });

  it("returns an empty map for empty or missing input", () => {
    expect(ivTrendsFromSnapshots([]).size).toBe(0);
    expect(ivTrendsFromSnapshots(null).size).toBe(0);
  });
});
