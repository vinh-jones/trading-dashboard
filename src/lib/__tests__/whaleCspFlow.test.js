import { describe, it, expect } from "vitest";
import { aggregateWhalePutSells } from "../whaleCspFlow";

const signals = [
  {
    ticker: "NVDA",
    whale_put_sells: [
      { ticker: "NVDA", strike: 215, expiry: "2027-01-15", premium: 4286740, size: 1576, has_sweep: false, underlying: 210.95 },
      { ticker: "NVDA", strike: 200, expiry: "2026-09-18", premium: 3065235, size: 2677, has_sweep: false, underlying: 210.6 },
    ],
  },
  {
    ticker: "PLTR",
    whale_put_sells: [
      { ticker: "PLTR", strike: 150, expiry: "2026-07-17", premium: 1000000, size: 500, has_sweep: true, underlying: 155 },
      { ticker: "PLTR", strike: 140, expiry: "2026-07-17", premium: 40000, size: 20, has_sweep: false, underlying: 155 }, // below floor
    ],
  },
  { ticker: "CDE", whale_put_sells: [] },
  { ticker: "MU" }, // no field
];

describe("aggregateWhalePutSells", () => {
  it("flattens across tickers and sorts by premium desc", () => {
    const rows = aggregateWhalePutSells(signals);
    expect(rows.map((r) => r.premium)).toEqual([4286740, 3065235, 1000000]);
    expect(rows[0].ticker).toBe("NVDA");
    expect(rows[2].ticker).toBe("PLTR");
  });

  it("drops sub-floor premium", () => {
    const rows = aggregateWhalePutSells(signals);
    expect(rows.some((r) => r.strike === 140)).toBe(false);
  });

  it("computes OTM% of the sold put vs the underlying", () => {
    const rows = aggregateWhalePutSells(signals);
    // NVDA 215 with spot 210.95: (210.95 - 215)/210.95 = -1.92% (slightly ITM)
    expect(rows[0].otm_pct).toBeCloseTo(-1.92, 1);
    // NVDA 200 with spot 210.6: (210.6 - 200)/210.6 = +5.03% OTM
    expect(rows[1].otm_pct).toBeCloseTo(5.03, 1);
  });

  it("flags held tickers", () => {
    const rows = aggregateWhalePutSells(signals, { heldTickers: new Set(["PLTR"]) });
    expect(rows.find((r) => r.ticker === "PLTR").held).toBe(true);
    expect(rows.find((r) => r.ticker === "NVDA").held).toBe(false);
  });

  it("accepts a held array and a custom floor", () => {
    const rows = aggregateWhalePutSells(signals, { heldTickers: ["NVDA"], minPremium: 2000000 });
    expect(rows.map((r) => r.premium)).toEqual([4286740, 3065235]);
    expect(rows.every((r) => r.held)).toBe(true);
  });

  it("empty/missing input → empty list", () => {
    expect(aggregateWhalePutSells([])).toEqual([]);
    expect(aggregateWhalePutSells(null)).toEqual([]);
  });
});
