import { describe, it, expect } from "vitest";
import { CURATED_PRESETS, CURATED_ICON } from "../curatedPresets.js";
import {
  DEFAULT_FILTERS,
  TREND_FILTER_OPTIONS, RSI_FILTER_OPTIONS, SCORE_FILTER_OPTIONS,
  GEX_FILTER_OPTIONS, IV_TREND_FILTER_OPTIONS,
} from "../radarConstants.js";

const ALLOW_SETS = {
  trend_states:    TREND_FILTER_OPTIONS.map(o => o[0]),
  rsi_buckets:     RSI_FILTER_OPTIONS.map(o => o[0]),
  score_buckets:   SCORE_FILTER_OPTIONS.map(o => o[0]),
  gex_envs:        GEX_FILTER_OPTIONS.map(o => o[0]),
  iv_trend_states: IV_TREND_FILTER_OPTIONS.map(o => o[0]),
};

describe("CURATED_PRESETS", () => {
  it("has the six expected presets, all builtin with unique ids", () => {
    const names = CURATED_PRESETS.map(p => p.name);
    expect(names).toEqual([
      "Prime Setup", "Oversold Bounce", "Juiced Premium",
      "Fresh & Calm", "Pinned & Paid", "Write Zone",
    ]);
    expect(CURATED_PRESETS.every(p => p.builtin === true)).toBe(true);
    expect(CURATED_PRESETS.every(p => p.id.startsWith("builtin:"))).toBe(true);
    expect(new Set(CURATED_PRESETS.map(p => p.id)).size).toBe(CURATED_PRESETS.length);
    expect(CURATED_ICON).toBe("✦");
  });

  it("every filter key is a real DEFAULT_FILTERS field", () => {
    const valid = new Set(Object.keys(DEFAULT_FILTERS));
    for (const p of CURATED_PRESETS) {
      for (const k of Object.keys(p.filters)) {
        expect(valid.has(k), `${p.name}.${k}`).toBe(true);
      }
    }
  });

  it("every allow-set value is a known bucket", () => {
    for (const p of CURATED_PRESETS) {
      for (const [field, allowed] of Object.entries(ALLOW_SETS)) {
        for (const v of (p.filters[field] ?? [])) {
          expect(allowed.includes(v), `${p.name}.${field}=${v}`).toBe(true);
        }
      }
    }
  });

  it("uses no action-imperative / safety names (naming discipline)", () => {
    const banned = /\b(entry|buy|enter|safe)\b/i;
    for (const p of CURATED_PRESETS) {
      expect(banned.test(p.name), p.name).toBe(false);
    }
  });

  it("pins the agreed thresholds", () => {
    const by = id => CURATED_PRESETS.find(p => p.id === id).filters;
    expect(by("builtin:juiced-premium")).toMatchObject({ iv_rank_min: 50, raw_iv_min: 0.50 });
    expect(by("builtin:fresh-calm")).toMatchObject({ bb_position_max: 0.60 });
    expect(by("builtin:write-zone")).toMatchObject({ ownership: "held" });
    for (const p of CURATED_PRESETS) {
      if ("earnings_days_min" in p.filters) expect(p.filters.earnings_days_min).toBe(30);
    }
  });
});
