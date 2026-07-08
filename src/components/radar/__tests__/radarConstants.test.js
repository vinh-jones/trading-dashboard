import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  countActiveFilters,
  filterSummaryLines,
  TREND_FILTER_OPTIONS,
  RSI_FILTER_OPTIONS,
  SCORE_FILTER_OPTIONS,
  GEX_FILTER_OPTIONS,
  IV_TREND_FILTER_OPTIONS,
} from "../radarConstants.js";

describe("DEFAULT_FILTERS new allow-set fields", () => {
  it("includes the five chip-signal arrays, each empty by default", () => {
    expect(DEFAULT_FILTERS.trend_states).toEqual([]);
    expect(DEFAULT_FILTERS.rsi_buckets).toEqual([]);
    expect(DEFAULT_FILTERS.score_buckets).toEqual([]);
    expect(DEFAULT_FILTERS.gex_envs).toEqual([]);
    expect(DEFAULT_FILTERS.iv_trend_states).toEqual([]);
  });
});

describe("countActiveFilters with allow-sets", () => {
  it("counts each non-empty allow-set as one active filter", () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, trend_states: ["uptrend"] })).toBe(1);
    expect(countActiveFilters({
      ...DEFAULT_FILTERS,
      trend_states: ["uptrend"], rsi_buckets: ["oversold"], score_buckets: ["Strong"],
      gex_envs: ["stabilized"], iv_trend_states: ["rising"],
    })).toBe(5);
  });
  it("ignores empty allow-sets", () => {
    expect(countActiveFilters({ ...DEFAULT_FILTERS, trend_states: [] })).toBe(0);
  });
});

describe("filterSummaryLines with allow-sets", () => {
  it("emits one labeled line per non-empty allow-set", () => {
    const lines = filterSummaryLines({
      ...DEFAULT_FILTERS,
      trend_states: ["uptrend", "pullback"],
      score_buckets: ["Strong"],
    });
    expect(lines).toContain("Trend: Uptrend, Pullback");
    expect(lines).toContain("Score: Strong");
  });
});

describe("filter option lists", () => {
  it("expose [value,label] pairs for each dimension", () => {
    expect(TREND_FILTER_OPTIONS).toEqual([
      ["uptrend", "Uptrend"], ["pullback", "Pullback"],
      ["recovering", "Recovering"], ["downtrend", "Downtrend"],
    ]);
    expect(RSI_FILTER_OPTIONS.map(o => o[0])).toEqual(["oversold", "neutral", "overbought"]);
    expect(SCORE_FILTER_OPTIONS.map(o => o[0])).toEqual(["Strong", "Moderate", "Neutral", "Weak"]);
    expect(GEX_FILTER_OPTIONS.map(o => o[0])).toEqual(["stabilized", "choppy", "neutral"]);
    expect(IV_TREND_FILTER_OPTIONS.map(o => o[0])).toEqual(["rising", "spiking", "falling", "collapsing", "stable"]);
  });
});
