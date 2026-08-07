import { describe, it, expect } from "vitest";
import { mergeRadarRows, getEarningsDaysAway, buildEarningsMap } from "../radarData.js";

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

describe("buildEarningsMap", () => {
  it("maps ticker to earnings_date, skipping rows without one", () => {
    const map = buildEarningsMap([
      { ticker: "AAA", earnings_date: "2026-09-01" },
      { ticker: "BBB", earnings_date: null },
      { ticker: "CCC" },
    ]);
    expect(map.get("AAA")).toBe("2026-09-01");
    expect(map.has("BBB")).toBe(false);
    expect(map.has("CCC")).toBe(false);
  });

  it("tolerates junk input", () => {
    expect(buildEarningsMap(null).size).toBe(0);
  });
});

describe("getEarningsDaysAway", () => {
  const iso = (offsetDays) =>
    new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);

  it("returns whole days until the earnings date", () => {
    const map = new Map([["AAA", iso(10)]]);
    expect(getEarningsDaysAway("AAA", map)).toBe(10);
  });

  it("returns null for an unknown ticker — unknown is not zero", () => {
    // radarFilter treats null as "don't filter". Returning 0 here would make
    // every unknown ticker look like it reports today and fail earnings_days_min.
    expect(getEarningsDaysAway("ZZZ", new Map())).toBeNull();
  });

  it("returns null when the map is missing entirely", () => {
    expect(getEarningsDaysAway("AAA", null)).toBeNull();
  });

  it("returns a negative number for a past date", () => {
    const map = new Map([["AAA", iso(-5)]]);
    expect(getEarningsDaysAway("AAA", map)).toBeLessThan(0);
  });
});
