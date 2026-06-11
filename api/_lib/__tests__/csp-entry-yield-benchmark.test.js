import { describe, it, expect } from "vitest";
import {
  entryYieldAnn,
  computeCspEntryYieldBenchmark,
} from "../cspEntryYieldBenchmark.js";

// A 365-day trade makes the annualization factor exactly 1, so
// entry_yield = gross / capital — hand-computable.
function yr(extra = {}) {
  return {
    type: "CSP",
    subtype: "Close",
    capital_fronted: 10000,
    open_date: "2025-06-04",
    expiry_date: "2026-06-04", // 365 days
    close_date: "2026-05-15",  // inside a 90d window ending 2026-06-04
    ...extra,
  };
}

describe("entryYieldAnn", () => {
  it("reconstructs gross from net/kept_pct and annualizes (365d → factor 1)", () => {
    // gross = 5000/1.0 = 5000; (5000/10000)/365*365 = 0.5
    expect(entryYieldAnn(yr({ premium_collected: 5000, kept_pct: 1.0 }))).toBeCloseTo(0.5, 6);
  });

  it("reconstructs gross when premium was partially given back (kept_pct < 1)", () => {
    // gross = 2500/0.5 = 5000 → 0.5
    expect(entryYieldAnn(yr({ premium_collected: 2500, kept_pct: 0.5 }))).toBeCloseTo(0.5, 6);
  });

  it("returns a correct POSITIVE gross for a loss close (neg net ÷ neg kept_pct)", () => {
    // gross = -300/-0.6 = 500 → (500/10000) = 0.05
    expect(entryYieldAnn(yr({ premium_collected: -300, kept_pct: -0.6 }))).toBeCloseTo(0.05, 6);
  });

  it("parses string-typed numeric columns (Supabase returns kept_pct as text)", () => {
    expect(entryYieldAnn(yr({ premium_collected: 5000, kept_pct: "1.0", capital_fronted: "10000" }))).toBeCloseTo(0.5, 6);
  });

  it("floors original DTE at 1 day when open == expiry (no divide-by-zero)", () => {
    const y = entryYieldAnn(yr({ premium_collected: 10, kept_pct: 1.0, open_date: "2026-05-15", expiry_date: "2026-05-15" }));
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeCloseTo((10 / 10000) / 1 * 365, 6);
  });
});

describe("computeCspEntryYieldBenchmark", () => {
  const opts = { today: "2026-06-04", windowDays: 90, minTrades: 3 };

  it("returns the MEDIAN entry yield over eligible closed CSPs", () => {
    const rows = [
      yr({ premium_collected: 4000, kept_pct: 1.0 }), // 0.4
      yr({ premium_collected: 5000, kept_pct: 1.0 }), // 0.5
      yr({ premium_collected: 6000, kept_pct: 1.0 }), // 0.6
    ];
    const b = computeCspEntryYieldBenchmark(rows, opts);
    expect(b.avg_csp_entry_yield_ann).toBeCloseTo(0.5, 6);
    expect(b.trade_count).toBe(3);
    expect(b.window_days).toBe(90);
    expect(b.benchmark_immature).toBe(false);
  });

  it("excludes assignments, non-CSP types, zero/negative capital, and kept_pct of 0 or null", () => {
    const rows = [
      yr({ premium_collected: 4000, kept_pct: 1.0 }),              // 0.4 — kept
      yr({ premium_collected: 6000, kept_pct: 1.0 }),              // 0.6 — kept
      yr({ subtype: "Assigned", premium_collected: 9000, kept_pct: 1.0 }),       // excluded
      yr({ type: "CC", premium_collected: 9000, kept_pct: 1.0 }),               // excluded
      yr({ premium_collected: 9000, kept_pct: 1.0, capital_fronted: 0 }),       // excluded
      yr({ premium_collected: 9000, kept_pct: 0 }),                            // excluded
      yr({ premium_collected: 9000, kept_pct: null }),                         // excluded
    ];
    const b = computeCspEntryYieldBenchmark(rows, opts);
    expect(b.trade_count).toBe(2);
    expect(b.avg_csp_entry_yield_ann).toBeCloseTo(0.5, 6); // median of [0.4, 0.6]
  });

  it("KEEPS loss closes in the population", () => {
    const rows = [
      yr({ premium_collected: 4000, kept_pct: 1.0 }),    // 0.4
      yr({ premium_collected: 6000, kept_pct: 1.0 }),    // 0.6
      yr({ premium_collected: -300, kept_pct: -0.6 }),   // 0.05 (loss close)
    ];
    const b = computeCspEntryYieldBenchmark(rows, opts);
    expect(b.trade_count).toBe(3);
    expect(b.avg_csp_entry_yield_ann).toBeCloseTo(0.4, 6); // median of [0.05, 0.4, 0.6]
  });

  it("ignores trades whose close_date is outside the trailing window", () => {
    const rows = [
      yr({ premium_collected: 4000, kept_pct: 1.0 }),
      yr({ premium_collected: 5000, kept_pct: 1.0 }),
      yr({ premium_collected: 6000, kept_pct: 1.0 }),
      yr({ premium_collected: 99000, kept_pct: 1.0, close_date: "2026-01-01" }), // pre-window outlier
    ];
    const b = computeCspEntryYieldBenchmark(rows, opts);
    expect(b.trade_count).toBe(3);
    expect(b.avg_csp_entry_yield_ann).toBeCloseTo(0.5, 6);
    expect(b.window_days).toBe(90);
  });

  it("falls back to lifetime when the window is too thin, marking window_days=null", () => {
    const rows = [
      yr({ premium_collected: 5000, kept_pct: 1.0 }), // in-window
      yr({ premium_collected: 4000, kept_pct: 1.0, close_date: "2026-01-01" }), // out of window
      yr({ premium_collected: 6000, kept_pct: 1.0, close_date: "2025-12-01" }), // out of window
    ];
    // window n=1 < minTrades(3) → widen to lifetime (n=3, mature)
    const b = computeCspEntryYieldBenchmark(rows, opts);
    expect(b.trade_count).toBe(3);
    expect(b.window_days).toBeNull();
    expect(b.benchmark_immature).toBe(false);
    expect(b.avg_csp_entry_yield_ann).toBeCloseTo(0.5, 6);
  });

  it("flags immature when even lifetime has fewer than minTrades, but still returns the median", () => {
    const rows = [
      yr({ premium_collected: 4000, kept_pct: 1.0 }),
      yr({ premium_collected: 6000, kept_pct: 1.0 }),
    ];
    const b = computeCspEntryYieldBenchmark(rows, opts); // minTrades=3, only 2 total
    expect(b.trade_count).toBe(2);
    expect(b.benchmark_immature).toBe(true);
    expect(b.avg_csp_entry_yield_ann).toBeCloseTo(0.5, 6);
  });

  it("returns a null benchmark (immature) when there are no eligible trades", () => {
    const b = computeCspEntryYieldBenchmark([], opts);
    expect(b.trade_count).toBe(0);
    expect(b.avg_csp_entry_yield_ann).toBeNull();
    expect(b.benchmark_immature).toBe(true);
  });
});
