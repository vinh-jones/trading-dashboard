import { describe, it, expect } from "vitest";

import { buildMacroSnapshotRow, MACRO_SPEC_VERSION, SIGNAL_COUNT } from "../_lib/macroSnapshotRow.js";

// Shaped like a real buildMacroPayload() return, trimmed to the fields the row
// builder reads. Values are from the live 2026-08-19 payload.
function payload(overrides = {}) {
  return {
    ok: true,
    posture: {
      posture: "NEUTRAL", avg: 2.8, signalsAvailable: 6, signalsTotal: 7,
      deploymentGuidance: "Selective deployment only.",
      scores: [3, null, 4, 1, 4, 3, 2],
    },
    signals: {
      vix:          { value: 14.89, change: -0.42, vixTrend: { changePts: -1.3 }, score: 3 },
      s5fi:         { value: null, score: null },
      fearGreed:    { value: 56.34, score: 4 },
      fedWatch:     { cutsPricedIn: -1.47, endOfYearImplied: 4.12, currentRate: 3.625, score: 1 },
      spyVsAth:     { value: 769.06, pctFromHigh: -0.013229, score: 4 },
      crudeOil:     { price: 84.4, change: 0.63, score: 3 },
      tenYearYield: { yield: 4.65, change: 0.0312, score: 2 },
    },
    ai_context: "MACRO MARKET CONTEXT — August 19, 2026",
    ...overrides,
  };
}

describe("buildMacroSnapshotRow", () => {
  it("carries all seven signals' raw values", () => {
    const r = buildMacroSnapshotRow(payload(), "2026-08-19");
    expect(r.vix).toBe(14.89);
    expect(r.fear_greed_score).toBe(56.34);
    expect(r.fed_cuts_priced_in).toBe(-1.47);
    expect(r.spy_pct_from_ath).toBe(-0.013229);
    // Crude and the 10-year had no columns at all before this migration.
    expect(r.wti_crude).toBe(84.4);
    expect(r.ust10y).toBe(4.65);
  });

  it("converts the 10-year change from percentage points to bps", () => {
    expect(buildMacroSnapshotRow(payload(), "2026-08-19").ust10y_change_bps).toBe(3.1);
  });

  it("records the 5-session VIX move as its own column", () => {
    expect(buildMacroSnapshotRow(payload(), "2026-08-19").vix_5d_change).toBe(-1.3);
  });

  it("leaves vix_5d_change null when the VIX history fetch failed", () => {
    const p = payload();
    delete p.signals.vix.vixTrend;
    expect(buildMacroSnapshotRow(p, "2026-08-19").vix_5d_change).toBeNull();
  });

  // The point of signal_scores: attribute which signal moved the composite.
  it("stores per-signal scores under fixed keys", () => {
    const r = buildMacroSnapshotRow(payload(), "2026-08-19");
    expect(r.signal_scores).toEqual({
      vix: 3, s5fi: null, fear_greed: 4, fed: 1, spy_ath: 4, oil: 3, rates: 2,
    });
  });

  // The regression that makes stored composites analysable at all.
  it("records an unavailable signal as null, never as a fallback number", () => {
    const r = buildMacroSnapshotRow(payload(), "2026-08-19");
    expect(r.signal_scores.s5fi).toBeNull();
    expect(r.s5fi_pct).toBeNull();
  });

  it("stores the availability count so a partial composite is filterable", () => {
    const r = buildMacroSnapshotRow(payload(), "2026-08-19");
    expect(r.signals_available).toBe(6);
    expect(r.signals_total).toBe(7);
    // 2.8 from six signals must not be compared against 2.8 from seven.
    expect(r.signals_available).not.toBe(r.signals_total);
  });

  it("falls back to the declared signal-set size if the payload omits it", () => {
    const p = payload();
    delete p.posture.signalsTotal;
    expect(buildMacroSnapshotRow(p, "2026-08-19").signals_total).toBe(SIGNAL_COUNT);
  });

  it("stamps provenance on every row", () => {
    const r = buildMacroSnapshotRow(payload(), "2026-08-19");
    expect(r.source).toBe("live");
    expect(r.spec_version).toBe(MACRO_SPEC_VERSION);
    expect(r.snapshot_date).toBe("2026-08-19");
  });

  it("carries the composite and its guidance", () => {
    const r = buildMacroSnapshotRow(payload(), "2026-08-19");
    expect(r.posture).toBe("NEUTRAL");
    expect(r.posture_score).toBe(2.8);
    expect(r.deployment_guidance).toBe("Selective deployment only.");
  });

  it("degrades to nulls rather than throwing on a fully empty payload", () => {
    const r = buildMacroSnapshotRow({}, "2026-08-19");
    expect(r.snapshot_date).toBe("2026-08-19");
    expect(r.vix).toBeNull();
    expect(r.posture).toBeNull();
    expect(r.posture_score).toBeNull();
    expect(r.signal_scores.vix).toBeNull();
    expect(r.signals_total).toBe(SIGNAL_COUNT);
  });

  it("writes no key the macro_snapshots table does not have", () => {
    // A stray key makes the whole upsert fail, and the caller only console.errors.
    const allowed = new Set([
      "snapshot_date", "vix", "vix_change", "vix_5d_change", "s5fi_pct",
      "fear_greed_score", "fed_cuts_priced_in", "fed_implied_eoy_rate",
      "fed_current_rate", "spy_pct_from_ath", "wti_crude", "wti_crude_change",
      "ust10y", "ust10y_change_bps", "signal_scores", "posture", "posture_score",
      "deployment_guidance", "signals_available", "signals_total", "ai_context",
      "spec_version", "source",
    ]);
    for (const k of Object.keys(buildMacroSnapshotRow(payload(), "2026-08-19"))) {
      expect(allowed.has(k), `unexpected column: ${k}`).toBe(true);
    }
  });
});
