// lib/__tests__/syncSheets.mergeDuplicates.test.js
import { describe, it, expect } from "vitest";
import { mergeDuplicateTradeRows } from "../syncSheets.js";

// Regression for: "Trades upsert failed: ON CONFLICT DO UPDATE command cannot
// affect row a second time". Triggered when one position is split into two legs
// that are byte-identical on the DB unique key
// (ticker, type, open_date, close_date, strike, contracts) — e.g. an IREN $30
// CSP recorded as two ×4 rows that close the same way. Postgres refuses to
// update one conflict target twice in a single upsert, so the sync must collapse
// such legs into their combined trade before upserting.

const leg = (over = {}) => ({
  ticker: "IREN", type: "CSP", subtype: "Close",
  strike: 30, contracts: 4,
  open_date: "2026-07-27", close_date: "2026-08-21", expiry_date: "2026-08-21",
  days_held: 25, premium_collected: 960, kept_pct: 1, capital_fronted: 12000,
  ...over,
});

describe("mergeDuplicateTradeRows", () => {
  it("merges two identical-key legs into one combined trade, summing additive fields", () => {
    const { rows, merged } = mergeDuplicateTradeRows([leg(), leg()]);
    expect(merged).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticker: "IREN", type: "CSP", strike: 30,
      contracts: 8,            // 4 + 4
      premium_collected: 1920, // 960 + 960
      capital_fronted: 24000,  // 12000 + 12000
    });
  });

  it("produces a batch with no duplicate conflict keys (the invariant Postgres needs)", () => {
    const { rows } = mergeDuplicateTradeRows([leg(), leg(), leg({ strike: 55 })]);
    const keys = rows.map(r => `${r.ticker}|${r.type}|${r.open_date}|${r.close_date}|${r.strike}|${r.contracts}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves split legs with different outcomes untouched (distinct close_date → distinct key)", () => {
    const { rows, merged } = mergeDuplicateTradeRows([leg(), leg({ close_date: "2026-08-14" })]);
    expect(merged).toBe(0);
    expect(rows).toHaveLength(2);
  });

  it("does not conflate different strikes or contract counts", () => {
    const { rows, merged } = mergeDuplicateTradeRows([leg(), leg({ strike: 55 }), leg({ contracts: 5 })]);
    expect(merged).toBe(0);
    expect(rows).toHaveLength(3);
  });

  it("handles an empty batch", () => {
    expect(mergeDuplicateTradeRows([])).toEqual({ rows: [], merged: 0 });
  });
});
