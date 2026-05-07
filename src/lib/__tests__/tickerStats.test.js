import { describe, it, expect } from "vitest";
import { computeTickerStats } from "../tickerStats";

const trade = (overrides) => ({
  id: "t1",
  ticker: "ABC",
  type: "CSP",
  subtype: "Close",
  strike: 50,
  premium_collected: 100,
  capital_fronted: 5000,
  days_held: 10,
  open_date: "2026-01-01",
  close_date: "2026-01-11",
  data_quality: "trusted",
  ...overrides,
});

const lifespan = (overrides) => ({
  ticker: "ABC",
  assignment_id: "2026-01-15",
  lifespan_status: "closed",
  data_quality: "trusted",
  total_capital_committed: 10_000,
  total_shares_at_peak: 200,
  blended_cost_basis: 50,
  exit_date: "2026-02-10",
  exit_event: { exit_type: "called_away" },
  cc_history: [],
  lifespan_metrics: {
    days_active: 26,
    csp_premium_collected: 100,
    cc_premium_total: 50,
    share_disposal_pnl: 200,
    total_lifespan_pnl: 350,
  },
  ...overrides,
});

describe("computeTickerStats — basic shape", () => {
  it("returns null-safe defaults for empty inputs", () => {
    const r = computeTickerStats({ trades: [], lifespans: [] });
    expect(r.realizedPnl).toBe(0);
    expect(r.premiumCollected).toBe(0);
    expect(r.wheelsCompleted).toBe(0);
    expect(r.bestTrade).toBeNull();
    expect(r.worstTrade).toBeNull();
    expect(r.belowCostCcAbsorption).toBe(0);
  });
});

describe("computeTickerStats — realizedPnl includes suspect with flag", () => {
  it("sums all realized P&L across closed trades regardless of data_quality", () => {
    const r = computeTickerStats({
      trades: [
        trade({ id: "t1", premium_collected: 100, data_quality: "trusted" }),
        trade({ id: "t2", premium_collected: 200, data_quality: "suspect" }),
      ],
      lifespans: [],
    });
    expect(r.realizedPnl).toBe(300);
    expect(r.includesSuspectData).toBe(true);
  });
});

describe("computeTickerStats — premium collected", () => {
  it("sums CSP + CC premium_collected (not LEAPS or Shares)", () => {
    const r = computeTickerStats({
      trades: [
        trade({ id: "t1", type: "CSP", premium_collected: 100 }),
        trade({ id: "t2", type: "CC",  premium_collected: 50 }),
        trade({ id: "t3", type: "LEAPS", premium_collected: 999 }),
        trade({ id: "t4", type: "Shares", premium_collected: 999 }),
      ],
      lifespans: [],
    });
    expect(r.premiumCollected).toBe(150);
  });
});

describe("computeTickerStats — wheels completed excludes suspect", () => {
  it("counts closed lifespans where exit_type === 'called_away', excluding suspect", () => {
    const r = computeTickerStats({
      trades: [],
      lifespans: [
        lifespan({ data_quality: "trusted", exit_event: { exit_type: "called_away" } }),
        lifespan({ data_quality: "suspect", exit_event: { exit_type: "called_away" } }),
        lifespan({ data_quality: "trusted", exit_event: { exit_type: "manual_sale" } }),
      ],
    });
    expect(r.wheelsCompleted).toBe(1);
    expect(r.wheelsSuspectExcluded).toBe(1);
  });
});

describe("computeTickerStats — assignments and called away counts exclude suspect", () => {
  it("counts assignment events from non-suspect lifespans only", () => {
    const r = computeTickerStats({
      trades: [],
      lifespans: [
        lifespan({ data_quality: "trusted", assignment_events: [{ date: "2026-01-15" }, { date: "2026-02-15" }] }),
        lifespan({ data_quality: "suspect", assignment_events: [{ date: "2025-08-01" }] }),
      ],
    });
    expect(r.assignmentsTaken).toBe(2);
    expect(r.timesCalledAway).toBe(1); // only the trusted called_away lifespan
  });
});

describe("computeTickerStats — avg days CSP/CC", () => {
  it("averages days_held across closed CSPs (Close subtype)", () => {
    const r = computeTickerStats({
      trades: [
        trade({ type: "CSP", subtype: "Close", days_held: 10 }),
        trade({ type: "CSP", subtype: "Close", days_held: 20 }),
        trade({ type: "CSP", subtype: "Assigned", days_held: 999 }), // excluded
      ],
      lifespans: [],
    });
    expect(r.avgDaysCsp).toBe(15);
  });

  it("averages days_held across closed CCs", () => {
    const r = computeTickerStats({
      trades: [
        trade({ type: "CC", subtype: "Close", days_held: 4 }),
        trade({ type: "CC", subtype: "Close", days_held: 14 }),
      ],
      lifespans: [],
    });
    expect(r.avgDaysCc).toBe(9);
  });
});

describe("computeTickerStats — best/worst trade skip suspect", () => {
  it("returns highest premium_collected trade ignoring suspect-flagged", () => {
    const r = computeTickerStats({
      trades: [
        trade({ id: "t1", premium_collected: 1000, data_quality: "suspect" }),
        trade({ id: "t2", premium_collected: 500,  data_quality: "trusted" }),
        trade({ id: "t3", premium_collected: -300, data_quality: "trusted" }),
      ],
      lifespans: [],
    });
    expect(r.bestTrade.id).toBe("t2");
    expect(r.bestTrade.premium_collected).toBe(500);
    expect(r.worstTrade.id).toBe("t3");
    expect(r.worstTrade.premium_collected).toBe(-300);
  });
});

describe("computeTickerStats — below-cost CC absorption", () => {
  it("sums negative premium_collected from CCs with relative_to_assignment === 'below'", () => {
    const r = computeTickerStats({
      trades: [],
      lifespans: [
        lifespan({
          cc_history: [
            { premium_collected: -200, relative_to_assignment: "below" },
            { premium_collected: -100, relative_to_assignment: "below" },
            { premium_collected: -500, relative_to_assignment: "above" }, // not absorption
            { premium_collected: 300,  relative_to_assignment: "below" }, // positive, not absorption
          ],
        }),
      ],
    });
    expect(r.belowCostCcAbsorption).toBe(-300);
  });
});

describe("computeTickerStats — capital efficiency", () => {
  it("returns realized_pnl / avg_capital_deployed annualized when data present", () => {
    // realized $1000, avg capital $50,000, days span 365 → 2% annualized
    const r = computeTickerStats({
      trades: [
        trade({ premium_collected: 1000, close_date: "2026-01-15", data_quality: "trusted" }),
      ],
      lifespans: [
        lifespan({
          total_capital_committed: 50_000,
          lifespan_metrics: { days_active: 365, total_lifespan_pnl: 1000, csp_premium_collected: 0, cc_premium_total: 0, share_disposal_pnl: 0 },
        }),
      ],
    });
    expect(r.capitalEfficiencyPct).toBeCloseTo(2.0, 1);
  });

  it("returns null when no lifespan capital", () => {
    const r = computeTickerStats({
      trades: [trade({ premium_collected: 100 })],
      lifespans: [],
    });
    expect(r.capitalEfficiencyPct).toBeNull();
  });
});

describe("computeTickerStats — avg kept_pct", () => {
  it("averages kept_pct on closed CSPs (skip null)", () => {
    const r = computeTickerStats({
      trades: [
        trade({ type: "CSP", subtype: "Close", kept_pct: 60 }),
        trade({ type: "CSP", subtype: "Close", kept_pct: 80 }),
        trade({ type: "CSP", subtype: "Close", kept_pct: null }),
      ],
      lifespans: [],
    });
    expect(r.avgKeptPct).toBe(70);
  });
});
