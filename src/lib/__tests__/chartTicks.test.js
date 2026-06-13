import { describe, it, expect } from "vitest";
import { niceTicks } from "../chartTicks";

describe("niceTicks", () => {
  it("always includes 0 in the domain and lands ticks on round steps", () => {
    const { ticks, domainMin, domainMax } = niceTicks(-26.4, 9.8);
    expect(domainMin).toBeLessThanOrEqual(-26.4);
    expect(domainMax).toBeGreaterThanOrEqual(9.8);
    expect(ticks).toContain(0);
    const steps = ticks.slice(1).map((t, i) => +(t - ticks[i]).toFixed(6));
    expect(new Set(steps).size).toBe(1); // uniform step
  });

  it("produces a sane tick count (3–8) across scales", () => {
    for (const [lo, hi] of [[-26.4, 9.8], [0, 100], [-3, 2], [12, 87], [-180, -20]]) {
      const { ticks } = niceTicks(lo, hi);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(8);
    }
  });

  it("anchors all-positive and all-negative data to 0", () => {
    expect(niceTicks(12, 87).domainMin).toBeLessThanOrEqual(0);
    expect(niceTicks(-80, -20).domainMax).toBeGreaterThanOrEqual(0);
  });

  it("handles a flat series without a zero step", () => {
    const { ticks, domainMin, domainMax } = niceTicks(42, 42);
    expect(domainMax).toBeGreaterThan(domainMin);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });

  it("handles the flat-at-zero series", () => {
    const { domainMin, domainMax } = niceTicks(0, 0);
    expect(domainMax).toBeGreaterThan(domainMin);
  });
});
