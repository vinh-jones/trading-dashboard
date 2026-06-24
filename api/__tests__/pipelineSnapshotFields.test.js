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
    const fields = pipelineSnapshotFields({ forecastV2: FORECAST_V2, openPremiumGross: 14644 });
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

  it("emits open_premium_gross but NOT the retired flat-60% fields", () => {
    const fields = pipelineSnapshotFields({ forecastV2: FORECAST_V2, openPremiumGross: 14644 });
    expect(fields.open_premium_gross).toBe(14644);
    expect("open_premium_expected" in fields).toBe(false);
    expect("pipeline_implied_monthly" in fields).toBe(false);
  });

  it("serializes per-position rows into forecast_per_position", () => {
    const fields = pipelineSnapshotFields({ forecastV2: FORECAST_V2, openPremiumGross: 14644 });
    expect(Array.isArray(fields.forecast_per_position)).toBe(true);
    expect(fields.forecast_per_position).toHaveLength(1);
    expect(fields.forecast_per_position[0].ticker).toBe("SHOP");
    expect(fields.forecast_per_position[0].capture_pct).toBe(0.6);
  });

  it("null-fills every v2 field when forecastV2 is null (computeForecastV2 failed)", () => {
    // Mirrors the computeForecastV2-failed path: v2 fields go null, the snapshot
    // still records the raw open_premium_gross.
    const fields = pipelineSnapshotFields({ forecastV2: null, openPremiumGross: 14644 });
    expect(fields.open_premium_gross).toBe(14644);
    expect(fields.forecast_month_total).toBeNull();
    expect(fields.forward_pipeline_premium).toBeNull();
    expect(fields.forecast_this_month_remaining).toBeNull();
    expect(fields.pipeline_phase).toBeNull();
    expect(fields.forecast_per_position).toBeNull();
  });

  it("treats a missing openPremiumGross as zero", () => {
    const fields = pipelineSnapshotFields({ forecastV2: null });
    expect(fields.open_premium_gross).toBe(0);
  });
});

// Mirrors the pipelinePositions reducer in api/eod-snapshot.js: open credit
// spreads carry premium_collected = max_gain and sum into openPremiumGross;
// debit spreads (premium_collected null) are excluded by the is_credit filter.
describe("pipeline includes open credit spreads", () => {
  it("sums credit-spread premium into openPremiumGross", () => {
    const positions = {
      open_csps: [{ premium_collected: 500 }],
      assigned_shares: [],
      open_spreads: [
        { is_credit: true,  premium_collected: 1056 },
        { is_credit: false, premium_collected: null }, // debit excluded
      ],
    };
    const pipelinePositions = [
      ...(positions.open_csps ?? []),
      ...(positions.assigned_shares ?? []).filter((s) => s.active_cc).map((s) => s.active_cc),
      ...(positions.open_spreads ?? []).filter((s) => s.is_credit),
    ];
    const openPremiumGross = Math.round(pipelinePositions.reduce((s, p) => s + (p.premium_collected || 0), 0));
    expect(openPremiumGross).toBe(1556);
  });
});
