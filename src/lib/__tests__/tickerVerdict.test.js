import { describe, it, expect } from "vitest";
import { computeLifespanVerdict, verdictThreshold } from "../tickerVerdict.js";

describe("verdictThreshold", () => {
  it("returns $100 when 0.5% of capital is below $100", () => {
    expect(verdictThreshold(10_000)).toBe(100); // 0.5% = $50, floor $100
  });
  it("returns 0.5% of capital when above $100", () => {
    expect(verdictThreshold(50_000)).toBe(250);
  });
  it("returns $100 when capital is null/zero", () => {
    expect(verdictThreshold(null)).toBe(100);
    expect(verdictThreshold(0)).toBe(100);
  });
});

describe("computeLifespanVerdict", () => {
  const base = (overrides = {}) => ({
    lifespan_status: "closed",
    data_quality: "trusted",
    total_capital_committed: 50_000,
    benchmarks: {
      spaxx_baseline: { vs_actual_pnl: 500 },
      cut_and_redeploy_baseline: { vs_actual_pnl: 500 },
    },
    ...overrides,
  });

  it("returns 'suspect' when data_quality is suspect", () => {
    expect(computeLifespanVerdict(base({ data_quality: "suspect" }))).toBe("suspect");
  });

  it("returns 'ahead' when both deltas exceed +threshold ($250 for $50k cap)", () => {
    expect(computeLifespanVerdict(base())).toBe("ahead"); // 500 > 250 on both
  });

  it("returns 'behind' when both deltas fall below -threshold", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: -500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: -500 },
      },
    }))).toBe("behind");
  });

  it("returns 'neutral' when only one delta meets threshold", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: 500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: 50 },
      },
    }))).toBe("neutral");
  });

  it("returns 'neutral' when deltas have mixed signs", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: 500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: -500 },
      },
    }))).toBe("neutral");
  });

  it("returns 'neutral' when active lifespan", () => {
    expect(computeLifespanVerdict(base({ lifespan_status: "active" }))).toBe("neutral");
  });

  it("returns 'neutral' when cut_and_redeploy data missing (null vs_actual_pnl)", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: 500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: null },
      },
    }))).toBe("neutral");
  });
});
