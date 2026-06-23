import { describe, it, expect } from "vitest";
import { pipelineSnapshotFields } from "../_lib/computeForecastV2.js";

// A representative v2 forecast result, shaped like computePipelineForecast's return.
const FORECAST_V2 = {
  forecast_realized_to_date:     2633,
  forecast_this_month_remaining: 1250,
  forecast_this_month_std:       869,
  forecast_month_total:          3883,
  forecast_target_gap:           -11117,
  forward_pipeline_premium:      10405,
  csp_pipeline_premium:          9099,
  cc_pipeline_premium:           1306,
  below_cost_cc_premium:         0,
  pipeline_phase:                "Flexible",
  per_position: [
    {
      ticker: "SHOP", type: "CSP", strike: 118, expiry: "2026-06-26",
      bucket: "default", capturePct: 0.6, remaining: 600, thisMonth: 600, state: {},
    },
  ],
};

describe("pipelineSnapshotFields", () => {
  it("carries the v2 forecast numbers (the ones the dashboard reads) through verbatim", () => {
    const fields = pipelineSnapshotFields({
      forecastV2: FORECAST_V2,
      openPremiumGross: 14644,
      mtdPremium: 2633,
    });
    expect(fields.forecast_month_total).toBe(3883);
    expect(fields.forward_pipeline_premium).toBe(10405);
    expect(fields.forecast_this_month_remaining).toBe(1250);
    expect(fields.forecast_this_month_std).toBe(869);
    expect(fields.forecast_realized_to_date).toBe(2633);
    expect(fields.forecast_target_gap).toBe(-11117);
    expect(fields.csp_pipeline_premium).toBe(9099);
    expect(fields.cc_pipeline_premium).toBe(1306);
    expect(fields.below_cost_cc_premium).toBe(0);
    expect(fields.pipeline_phase).toBe("Flexible");
  });

  it("retains the legacy flat-60% fields alongside the v2 fields", () => {
    const fields = pipelineSnapshotFields({
      forecastV2: FORECAST_V2,
      openPremiumGross: 14644,
      mtdPremium: 2633,
    });
    expect(fields.open_premium_gross).toBe(14644);
    expect(fields.open_premium_expected).toBe(Math.round(14644 * 0.6)); // 8786
    expect(fields.pipeline_implied_monthly).toBe(2633 + 8786);          // 11419
  });

  it("serializes per-position rows into forecast_per_position", () => {
    const fields = pipelineSnapshotFields({
      forecastV2: FORECAST_V2,
      openPremiumGross: 14644,
      mtdPremium: 2633,
    });
    expect(Array.isArray(fields.forecast_per_position)).toBe(true);
    expect(fields.forecast_per_position).toHaveLength(1);
    expect(fields.forecast_per_position[0].ticker).toBe("SHOP");
    expect(fields.forecast_per_position[0].capture_pct).toBe(0.6);
  });

  it("null-fills every v2 field when forecastV2 is null but still computes legacy fields", () => {
    // Mirrors the computeForecastV2-failed path: v2 fields go null, the snapshot
    // still writes the legacy flat-60% pipeline numbers.
    const fields = pipelineSnapshotFields({
      forecastV2: null,
      openPremiumGross: 14644,
      mtdPremium: 2633,
    });
    expect(fields.forecast_month_total).toBeNull();
    expect(fields.forward_pipeline_premium).toBeNull();
    expect(fields.forecast_this_month_remaining).toBeNull();
    expect(fields.pipeline_phase).toBeNull();
    expect(fields.forecast_per_position).toBeNull();
    // legacy fields still present
    expect(fields.open_premium_expected).toBe(8786);
    expect(fields.pipeline_implied_monthly).toBe(11419);
  });

  it("treats a missing mtdPremium as zero", () => {
    const fields = pipelineSnapshotFields({
      forecastV2: null,
      openPremiumGross: 1000,
      mtdPremium: undefined,
    });
    expect(fields.open_premium_expected).toBe(600);
    expect(fields.pipeline_implied_monthly).toBe(600);
  });
});
