import { describe, it, expect } from "vitest";
import { mergeRadarRows, getEarningsDaysAway } from "../radarData.js";

const universe = [
  { ticker: "AAA", company: "Alpha", sector: "Technology", price_category: "mid" },
  { ticker: "BBB", company: "Beta",  sector: "Energy",     price_category: "low" },
];

describe("mergeRadarRows", () => {
  it("joins quotes, fundamentals and uw_signals onto the universe", () => {
    const rows = mergeRadarRows({
      universe,
      quotes:       [{ symbol: "AAA", last: 100, iv: 0.5, iv_rank: 80, bb_position: 0.1 }],
      fundamentals: [{ ticker: "AAA", pe_ttm: 25, beta: 1.4 }],
      uwSignals:    [{ ticker: "AAA", gex_env: "stabilized", gamma_env: 0.3 }],
    });
    const aaa = rows.find(r => r.ticker === "AAA");
    expect(aaa).toMatchObject({
      company: "Alpha", last: 100, iv: 0.5, iv_rank: 80,
      bb_position: 0.1, pe_ttm: 25, beta: 1.4,
      gex_env: "stabilized", gamma_env: 0.3,
    });
  });

  it("keeps universe tickers with no quote, nulling their signals", () => {
    // A name can sit in the approved universe before the quote pipeline has
    // touched it — dropping it here would silently shrink the Radar table.
    const rows = mergeRadarRows({ universe, quotes: [], fundamentals: [], uwSignals: [] });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ ticker: "BBB", last: null, iv: null, bb_position: null });
  });

  it("tolerates missing optional tables entirely", () => {
    const rows = mergeRadarRows({ universe, quotes: [{ symbol: "AAA", last: 42 }] });
    expect(rows.find(r => r.ticker === "AAA").last).toBe(42);
    expect(rows.find(r => r.ticker === "AAA").pe_ttm).toBeNull();
  });

  it("returns [] for an empty universe", () => {
    expect(mergeRadarRows({ universe: [] })).toEqual([]);
    expect(mergeRadarRows({})).toEqual([]);
  });
});

describe("getEarningsDaysAway", () => {
  const ctxFor = (date) => ({ positions: [{ ticker: "AAA", nextEarnings: { date } }] });

  it("counts calendar days to the next earnings date", () => {
    const inTen = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    expect(getEarningsDaysAway("AAA", ctxFor(inTen))).toBeGreaterThanOrEqual(9);
    expect(getEarningsDaysAway("AAA", ctxFor(inTen))).toBeLessThanOrEqual(11);
  });

  it("returns null when the ticker is absent, unknown, or context is missing", () => {
    expect(getEarningsDaysAway("ZZZ", ctxFor("2026-12-01"))).toBeNull();
    expect(getEarningsDaysAway("AAA", { positions: [{ ticker: "AAA" }] })).toBeNull();
    expect(getEarningsDaysAway("AAA", null)).toBeNull();
    expect(getEarningsDaysAway("AAA", {})).toBeNull();
  });
});
