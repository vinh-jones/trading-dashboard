import { describe, it, expect } from "vitest";
import { rowMatchesFilters } from "../radarFilter.js";
import { DEFAULT_FILTERS } from "../../components/radar/radarConstants.js";

// A permissive ctx: nothing held, no earnings, no IV-trend, no sector constraints.
const baseCtx = {
  isHeld: () => false,
  earningsDaysAway: () => null,
  ivTrend: () => null,
  includeSectors: [],
  excludeSectors: [],
};

// A row that, with DEFAULT_FILTERS, passes everything.
function makeRow(over = {}) {
  return {
    ticker: "AAA", sector: "Technology",
    last: 100, ma_50: 90, ma_200: 80,          // price above both MAs → uptrend
    bb_position: 0.10, iv: 0.60, iv_rank: 80,   // cheap + rich → Strong-ish
    rsi_14: 25,                                 // oversold
    gex_env: "stabilized",
    gamma_env: null, flow_tape_ema: null,
    pe_ttm: 20,
    ...over,
  };
}

describe("rowMatchesFilters — passthrough", () => {
  it("passes a normal row under DEFAULT_FILTERS", () => {
    expect(rowMatchesFilters(makeRow(), DEFAULT_FILTERS, baseCtx)).toBe(true);
  });
});

describe("rowMatchesFilters — existing numeric/ownership/earnings preserved", () => {
  it("excludes on bb_position_max", () => {
    expect(rowMatchesFilters(makeRow({ bb_position: 0.5 }), { ...DEFAULT_FILTERS, bb_position_max: 0.20 }, baseCtx)).toBe(false);
  });
  it("lets unknown P/E pass a pe_min filter", () => {
    expect(rowMatchesFilters(makeRow({ pe_ttm: null }), { ...DEFAULT_FILTERS, pe_min: 10 }, baseCtx)).toBe(true);
  });
  it("ownership is symmetric (held / not_held)", () => {
    const heldCtx = { ...baseCtx, isHeld: () => true };
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, ownership: "held" }, heldCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, ownership: "held" }, baseCtx)).toBe(false);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, ownership: "not_held" }, heldCtx)).toBe(false);
  });
  it("earnings_days_min excludes a near-earnings row but passes unknown", () => {
    const soon = { ...baseCtx, earningsDaysAway: () => 10 };
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, earnings_days_min: 30 }, soon)).toBe(false);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, earnings_days_min: 30 }, baseCtx)).toBe(true);
  });
});

describe("rowMatchesFilters — trend_states", () => {
  it("matches an uptrend row, excludes when only downtrend allowed", () => {
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, trend_states: ["uptrend", "pullback", "recovering"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, trend_states: ["downtrend"] }, baseCtx)).toBe(false);
  });
  it("excludes a row with null trend inputs under an active trend filter", () => {
    expect(rowMatchesFilters(makeRow({ last: null }), { ...DEFAULT_FILTERS, trend_states: ["uptrend"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — rsi_buckets", () => {
  it("matches oversold, excludes overbought-only, excludes null RSI", () => {
    expect(rowMatchesFilters(makeRow({ rsi_14: 25 }), { ...DEFAULT_FILTERS, rsi_buckets: ["oversold"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow({ rsi_14: 25 }), { ...DEFAULT_FILTERS, rsi_buckets: ["overbought"] }, baseCtx)).toBe(false);
    expect(rowMatchesFilters(makeRow({ rsi_14: null }), { ...DEFAULT_FILTERS, rsi_buckets: ["oversold"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — gex_envs", () => {
  it("matches membership, excludes non-member and null", () => {
    expect(rowMatchesFilters(makeRow({ gex_env: "stabilized" }), { ...DEFAULT_FILTERS, gex_envs: ["stabilized", "neutral"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow({ gex_env: "choppy" }), { ...DEFAULT_FILTERS, gex_envs: ["stabilized", "neutral"] }, baseCtx)).toBe(false);
    expect(rowMatchesFilters(makeRow({ gex_env: null }), { ...DEFAULT_FILTERS, gex_envs: ["stabilized"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — iv_trend_states", () => {
  it("matches ctx-supplied state, excludes non-member and null", () => {
    const rising = { ...baseCtx, ivTrend: () => ({ state: "rising", modifier: 1.10 }) };
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, iv_trend_states: ["rising"] }, rising)).toBe(true);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, iv_trend_states: ["falling"] }, rising)).toBe(false);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, iv_trend_states: ["rising"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — score_buckets", () => {
  it("passes only when the row's real score label is in the allow-set", () => {
    const row = makeRow(); // bb 0.10 + iv 0.60 + ivr 80 + uptrend → score ~0.77 → "Strong"
    expect(rowMatchesFilters(row, { ...DEFAULT_FILTERS, score_buckets: ["Strong"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(row, { ...DEFAULT_FILTERS, score_buckets: ["Weak"] }, baseCtx)).toBe(false);
  });
  it("excludes a row whose score is null (null bb_position) under an active score filter", () => {
    const allBuckets = ["Strong", "Moderate", "Neutral", "Weak"];
    expect(rowMatchesFilters(makeRow({ bb_position: null }), { ...DEFAULT_FILTERS, score_buckets: allBuckets }, baseCtx)).toBe(false);
  });
});
