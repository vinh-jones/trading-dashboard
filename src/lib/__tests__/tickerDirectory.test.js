import { describe, it, expect } from "vitest";
import { buildTickerDirectory } from "../tickerDirectory";

const trade = (overrides) => ({
  id: "t1",
  ticker: "ABC",
  type: "CSP",
  subtype: "Close",
  premium_collected: 100,
  close_date: "2026-01-15",
  data_quality: "trusted",
  ...overrides,
});

const lifespan = (overrides) => ({
  ticker: "ABC",
  data_quality: "trusted",
  ...overrides,
});

const csp = (overrides) => ({
  ticker: "ABC",
  strike: 50,
  capital_fronted: 5000,
  ...overrides,
});

const sharesEntry = (overrides) => ({
  ticker: "ABC",
  cost_basis_total: 10_000,
  positions: [{ description: "lot 1", fronted: 10_000 }],
  active_cc: null,
  open_leaps: [],
  ...overrides,
});

const leap = (overrides) => ({
  ticker: "ABC",
  capital_fronted: 2000,
  ...overrides,
});

const POSITIONS_EMPTY = { open_csps: [], assigned_shares: [], open_leaps: [] };

describe("buildTickerDirectory — empty input", () => {
  it("returns empty array when no trades", () => {
    expect(buildTickerDirectory({ trades: [], positions: POSITIONS_EMPTY, lifespans: [] })).toEqual([]);
  });
});

describe("buildTickerDirectory — basic row shape", () => {
  it("creates one row per distinct ticker", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", premium_collected: 100, close_date: "2026-01-10" }),
        trade({ ticker: "ABC", premium_collected: 200, close_date: "2026-02-10" }),
        trade({ ticker: "XYZ", premium_collected: 50,  close_date: "2026-03-01" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.length).toBe(2);
    const tickers = rows.map((r) => r.ticker).sort();
    expect(tickers).toEqual(["ABC", "XYZ"]);
  });
});

describe("buildTickerDirectory — status detection", () => {
  it("marks ticker active when it has any open position", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: { open_csps: [csp({ ticker: "ABC" })], assigned_shares: [], open_leaps: [] },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").status).toBe("active");
    expect(rows.find((r) => r.ticker === "ABC").hasOpenPositions).toBe(true);
  });

  it("marks ticker idle when it has no open positions", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").status).toBe("idle");
    expect(rows.find((r) => r.ticker === "ABC").hasOpenPositions).toBe(false);
  });

  it("marks ticker active when only LEAPS are open", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: { open_csps: [], assigned_shares: [], open_leaps: [leap({ ticker: "ABC" })] },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").status).toBe("active");
  });
});

describe("buildTickerDirectory — last activity", () => {
  it("returns the most recent close_date across all trades", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", close_date: "2026-01-10" }),
        trade({ ticker: "ABC", close_date: "2026-03-15" }),
        trade({ ticker: "ABC", close_date: "2026-02-01" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").lastActivity).toBe("2026-03-15");
  });

  it("returns null when no closed trades", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC", close_date: null })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC")?.lastActivity).toBe(null);
  });
});

describe("buildTickerDirectory — cycle counts", () => {
  it("counts trusted lifespans only; surfaces suspect count separately", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: POSITIONS_EMPTY,
      lifespans: [
        lifespan({ ticker: "ABC", data_quality: "trusted" }),
        lifespan({ ticker: "ABC", data_quality: "trusted" }),
        lifespan({ ticker: "ABC", data_quality: "suspect" }),
      ],
    });
    const r = rows.find((r) => r.ticker === "ABC");
    expect(r.cycles).toBe(2);
    expect(r.cyclesSuspect).toBe(1);
  });

  it("returns zero cycles for CSP-only ticker", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "GLW" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "GLW").cycles).toBe(0);
    expect(rows.find((r) => r.ticker === "GLW").cyclesSuspect).toBe(0);
  });
});

describe("buildTickerDirectory — lifetime P&L", () => {
  it("sums premium_collected across all closed trades regardless of suspect", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", premium_collected: 100, data_quality: "trusted" }),
        trade({ ticker: "ABC", premium_collected: 200, data_quality: "suspect" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    const r = rows.find((r) => r.ticker === "ABC");
    expect(r.lifetimePnl).toBe(300);
    expect(r.includesSuspect).toBe(true);
  });

  it("includesSuspect is false when no suspect trades or lifespans", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC", data_quality: "trusted" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").includesSuspect).toBe(false);
  });

  it("includesSuspect is true when only a suspect lifespan exists", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC", data_quality: "trusted" })],
      positions: POSITIONS_EMPTY,
      lifespans: [lifespan({ ticker: "ABC", data_quality: "suspect" })],
    });
    expect(rows.find((r) => r.ticker === "ABC").includesSuspect).toBe(true);
  });

  it("excludes trades that aren't closed (no close_date)", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", close_date: "2026-01-10", premium_collected: 100 }),
        trade({ ticker: "ABC", close_date: null,         premium_collected: 999 }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").lifetimePnl).toBe(100);
  });
});

describe("buildTickerDirectory — capital deployed", () => {
  it("sums CSP capital + shares cost basis + LEAPS capital for active ticker", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: {
        open_csps: [csp({ ticker: "ABC", capital_fronted: 5000 })],
        assigned_shares: [sharesEntry({ ticker: "ABC", cost_basis_total: 10_000 })],
        open_leaps: [leap({ ticker: "ABC", capital_fronted: 2000 })],
      },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").capital).toBe(17_000);
  });

  it("returns 0 for idle ticker", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").capital).toBe(0);
  });

  it("falls through to summing lot.fronted when cost_basis_total is missing", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: {
        open_csps: [],
        assigned_shares: [{
          ticker: "ABC",
          cost_basis_total: null,
          positions: [{ fronted: 4000 }, { fronted: 1500 }],
          active_cc: null,
          open_leaps: [],
        }],
        open_leaps: [],
      },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").capital).toBe(5500);
  });
});

describe("buildTickerDirectory — default sort", () => {
  it("places active tickers before idle tickers", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "AAA", close_date: "2026-04-01" }),
        trade({ ticker: "ZZZ", close_date: "2026-05-01" }),
      ],
      positions: { open_csps: [csp({ ticker: "AAA" })], assigned_shares: [], open_leaps: [] },
      lifespans: [],
    });
    expect(rows[0].ticker).toBe("AAA");
    expect(rows[1].ticker).toBe("ZZZ");
  });

  it("within same status, sorts by lastActivity descending", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "AAA", close_date: "2026-01-01" }),
        trade({ ticker: "BBB", close_date: "2026-05-01" }),
        trade({ ticker: "CCC", close_date: "2026-03-01" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.map((r) => r.ticker)).toEqual(["BBB", "CCC", "AAA"]);
  });
});
