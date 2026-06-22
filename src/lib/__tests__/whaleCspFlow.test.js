import { describe, it, expect } from "vitest";
import { aggregateWhalePutSells, summarizeWhaleFlowByTicker, mergeWhalePutSells, whalePrintKey } from "../whaleCspFlow";

const signals = [
  {
    ticker: "NVDA", flow_sentiment: 0.32,
    whale_put_sells: [
      { ticker: "NVDA", strike: 215, expiry: "2027-01-15", premium: 4286740, has_sweep: false, underlying: 210.95 },
      { ticker: "NVDA", strike: 200, expiry: "2026-09-18", premium: 3065235, has_sweep: false, underlying: 210.6 },
    ],
  },
  {
    ticker: "PLTR", flow_sentiment: -0.1,
    whale_put_sells: [
      { ticker: "PLTR", strike: 150, expiry: "2026-07-17", premium: 1000000, has_sweep: true, underlying: 155 },
      { ticker: "PLTR", strike: 140, expiry: "2026-07-17", premium: 40000, has_sweep: false, underlying: 155 }, // below floor
    ],
  },
  { ticker: "CDE", whale_put_sells: [] },
];

describe("aggregateWhalePutSells (flat)", () => {
  it("flattens, drops sub-floor, sorts by premium, computes OTM%", () => {
    const rows = aggregateWhalePutSells(signals);
    expect(rows.map((r) => r.premium)).toEqual([4286740, 3065235, 1000000]);
    expect(rows[0].otm_pct).toBeCloseTo(-1.92, 1); // 215 vs 210.95 → slightly ITM
    expect(rows.some((r) => r.strike === 140)).toBe(false);
  });
  it("flags held tickers", () => {
    const rows = aggregateWhalePutSells(signals, { heldTickers: ["PLTR"] });
    expect(rows.find((r) => r.ticker === "PLTR").held).toBe(true);
  });
  it("empty/missing → []", () => {
    expect(aggregateWhalePutSells(null)).toEqual([]);
  });
});

// Deterministic DTE via a fixed `today`.
const today = "2026-06-20";
const filterSigs = [
  {
    ticker: "AAA", flow_sentiment: 0.5, gamma_env: 0.28,
    whale_put_sells: [
      { ticker: "AAA", strike: 90,  underlying: 100, premium: 1000000, expiry: "2026-07-20" }, // dte 30, OTM
      { ticker: "AAA", strike: 80,  underlying: 100, premium: 500000,  expiry: "2026-07-20" }, // dte 30, OTM
      { ticker: "AAA", strike: 120, underlying: 100, premium: 2000000, expiry: "2026-07-20" }, // ITM → otmOnly drops
    ],
  },
  {
    ticker: "BBB", flow_sentiment: -0.3,
    whale_put_sells: [
      { ticker: "BBB", strike: 45, underlying: 50, premium: 800000, expiry: "2027-01-15" }, // dte ~209 → maxDte drops
      { ticker: "BBB", strike: 48, underlying: 50, premium: 600000, expiry: "2026-07-10" }, // dte 20, OTM
    ],
  },
];

describe("aggregateWhalePutSells (filters)", () => {
  it("OTM-only drops in-the-money put sales", () => {
    const rows = aggregateWhalePutSells(filterSigs, { today, otmOnly: true });
    expect(rows.some((r) => r.ticker === "AAA" && r.strike === 120)).toBe(false);
  });
  it("DTE window drops long-dated legs", () => {
    const rows = aggregateWhalePutSells(filterSigs, { today, minDte: 7, maxDte: 65 });
    expect(rows.some((r) => r.ticker === "BBB" && r.strike === 45)).toBe(false);
    expect(rows.some((r) => r.ticker === "BBB" && r.strike === 48)).toBe(true);
  });
});

describe("summarizeWhaleFlowByTicker (CSP shortlist)", () => {
  const scoreByTicker = new Map([
    ["AAA", { label: "Strong", ivRank: 70 }],
    ["BBB", { label: "Neutral", ivRank: 35 }],
  ]);

  it("groups by ticker, ranks by total premium, joins flow + score", () => {
    const rows = summarizeWhaleFlowByTicker(filterSigs, {
      today, minDte: 7, maxDte: 65, otmOnly: true, scoreByTicker,
    });
    expect(rows.map((r) => r.ticker)).toEqual(["AAA", "BBB"]); // 1.5M > 0.6M

    const aaa = rows[0];
    expect(aaa.total_premium).toBe(1_500_000);   // 120 strike excluded (ITM)
    expect(aaa.trade_count).toBe(2);
    expect(aaa.top_strike).toBe(90);             // 90 carries more premium than 80
    expect(aaa.top_strike_otm).toBeCloseTo(10, 5);
    expect(aaa.flow_sentiment).toBe(0.5);
    expect(aaa.gamma_env).toBe(0.28);
    expect(aaa.score_label).toBe("Strong");
    expect(aaa.iv_rank).toBe(70);

    const bbb = rows[1];
    expect(bbb.total_premium).toBe(600_000);     // long-dated leg excluded
    expect(bbb.trade_count).toBe(1);
  });

  it("floats candidates above bigger non-candidates", () => {
    const sigs = [
      { ticker: "BIG", flow_sentiment: 0.0, whale_put_sells: [
        { ticker: "BIG", strike: 90, underlying: 100, premium: 5_000_000, expiry: "2026-07-20" }, // huge, but flat flow
      ]},
      { ticker: "CAND", flow_sentiment: 0.4, flow_ema: 0.4, flow_streak: 3, whale_put_sells: [
        { ticker: "CAND", strike: 90, underlying: 100, premium: 300_000, expiry: "2026-07-20" }, // small, but candidate
        { ticker: "CAND", strike: 88, underlying: 100, premium: 250_000, expiry: "2026-07-18" }, // repeat print (≥2)
      ]},
    ];
    const score = new Map([["BIG", { label: "Neutral", ivRank: 20 }], ["CAND", { label: "Strong", ivRank: 70 }]]);
    const rows = summarizeWhaleFlowByTicker(sigs, { today, otmOnly: true, scoreByTicker: score });
    expect(rows[0].ticker).toBe("CAND");         // candidate first despite less premium
    expect(rows[0].is_candidate).toBe(true);
    expect(rows[1].is_candidate).toBe(false);
  });

  it("a Moderate setup is NOT a candidate even with confirmed flow + repeat prints (Strong-only gate)", () => {
    const sigs = [{ ticker: "MOD", flow_sentiment: 0.4, flow_ema: 0.4, flow_streak: 2, whale_put_sells: [
      { ticker: "MOD", strike: 90, underlying: 100, premium: 300_000, expiry: "2026-07-20" },
      { ticker: "MOD", strike: 88, underlying: 100, premium: 250_000, expiry: "2026-07-18" },
    ]}];
    const score = new Map([["MOD", { label: "Moderate", ivRank: 55 }]]);
    const rows = summarizeWhaleFlowByTicker(sigs, { today, otmOnly: true, scoreByTicker: score });
    expect(rows[0].is_candidate).toBe(false);
  });

  it("a one-off print is NOT a candidate even with a Strong setup + confirmed flow (repeat-activity gate)", () => {
    const sigs = [{ ticker: "ONE", flow_sentiment: 0.4, flow_ema: 0.4, flow_streak: 2, whale_put_sells: [
      { ticker: "ONE", strike: 90, underlying: 100, premium: 300_000, expiry: "2026-07-20" }, // single trade
    ]}];
    const score = new Map([["ONE", { label: "Strong", ivRank: 70 }]]);
    const rows = summarizeWhaleFlowByTicker(sigs, { today, otmOnly: true, scoreByTicker: score });
    expect(rows[0].trade_count).toBe(1);
    expect(rows[0].is_candidate).toBe(false);
  });

  it("UNconfirmed flow (bullish print but streak too short) is NOT a candidate", () => {
    const sigs = [{ ticker: "RAW", flow_sentiment: 0.4, flow_ema: 0.4, flow_streak: 1, whale_put_sells: [
      { ticker: "RAW", strike: 90, underlying: 100, premium: 300_000, expiry: "2026-07-20" },
      { ticker: "RAW", strike: 88, underlying: 100, premium: 250_000, expiry: "2026-07-18" },
    ]}];
    const score = new Map([["RAW", { label: "Strong", ivRank: 70 }]]);
    const rows = summarizeWhaleFlowByTicker(sigs, { today, otmOnly: true, scoreByTicker: score });
    expect(rows[0].is_candidate).toBe(false); // Strong + repeat trades, but flow streak < 2
  });

  it("accepts a plain-object score map and exposes drill-down trades", () => {
    const rows = summarizeWhaleFlowByTicker(filterSigs, {
      today, otmOnly: true, scoreByTicker: { AAA: { label: "Moderate", ivRank: 55 } },
    });
    const aaa = rows.find((r) => r.ticker === "AAA");
    expect(aaa.score_label).toBe("Moderate");
    expect(Array.isArray(aaa.trades)).toBe(true);
    expect(aaa.trades.length).toBe(2);
  });
});

describe("mergeWhalePutSells — rolling window", () => {
  const now = Date.parse("2026-06-21T16:00:00Z");
  const day = 86400000;
  const print = (over) => ({ ticker: "MU", strike: 1000, expiry: "2026-07-31", premium: 3_250_000, size: 100, underlying: 1188, ...over });

  it("stamps fresh prints with first-seen and keeps them", () => {
    const merged = mergeWhalePutSells([], [print()], { nowMs: now });
    expect(merged).toHaveLength(1);
    expect(merged[0].seen_at).toBe(new Date(now).toISOString());
  });

  it("dedupes a print that reappears in a later snapshot (keeps original seen_at)", () => {
    const first = mergeWhalePutSells([], [print()], { nowMs: now });
    const later = mergeWhalePutSells(first, [print()], { nowMs: now + day });
    expect(later).toHaveLength(1);
    expect(later[0].seen_at).toBe(new Date(now).toISOString()); // not re-stamped
  });

  it("accumulates distinct prints and sorts by premium desc", () => {
    const a = print({ strike: 1000, premium: 3_250_000 });
    const b = print({ strike: 980, premium: 5_000_000 });
    const merged = mergeWhalePutSells([a], [b], { nowMs: now });
    expect(merged.map((p) => p.strike)).toEqual([980, 1000]);
  });

  it("prunes prints older than the window", () => {
    const old = { ...print(), seen_at: new Date(now - 15 * day).toISOString() };
    const fresh = print({ strike: 990 });
    const merged = mergeWhalePutSells([old], [fresh], { nowMs: now, windowDays: 14 });
    expect(merged.map((p) => p.strike)).toEqual([990]); // 15-day-old dropped
  });

  it("back-fills seen_at on transition (prior prints without a stamp)", () => {
    const legacy = print(); // no seen_at
    const merged = mergeWhalePutSells([legacy], [], { nowMs: now });
    expect(merged[0].seen_at).toBe(new Date(now).toISOString());
  });

  it("key is stable across snapshots for the same print", () => {
    expect(whalePrintKey(print())).toBe(whalePrintKey(print()));
    expect(whalePrintKey(print({ strike: 990 }))).not.toBe(whalePrintKey(print()));
  });
});
