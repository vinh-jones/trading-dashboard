import { describe, it, expect } from "vitest";
import { findLinkedTrade } from "../journalHelpers";

// Two share lots of the same ticker sold on the same day produce the identical
// journal title ("Shares — Closed 08/14") — the title carries no basis and
// share trades have no strike. Only trade_id tells them apart.
const LOT_350 = {
  id: "trade-350", ticker: "COHR", type: "Shares", strike: null,
  entry_cost: 350, exit_cost: 300, premium: -5000,
  closeDate: new Date("2026-08-14T12:00:00"), open_date: "2026-07-17",
};
const LOT_246 = {
  id: "trade-246", ticker: "COHR", type: "Shares", strike: null,
  entry_cost: 246, exit_cost: 300, premium: 5400,
  closeDate: new Date("2026-08-14T12:00:00"), open_date: "2026-07-30",
};

const closedEntry = (overrides = {}) => ({
  entry_type: "trade_note",
  ticker: "COHR",
  entry_date: "2026-08-14",
  title: "Shares — Closed 08/14",
  trade_id: null,
  ...overrides,
});

describe("findLinkedTrade", () => {
  it("resolves same-day lots by trade_id, not by array order", () => {
    const trades = [LOT_350, LOT_246];

    // The $246 lot sorts second — the title heuristic alone would hand both
    // entries the $350 lot's numbers.
    expect(findLinkedTrade({ entry: closedEntry({ trade_id: "trade-246" }), trades }))
      .toBe(LOT_246);
    expect(findLinkedTrade({ entry: closedEntry({ trade_id: "trade-350" }), trades }))
      .toBe(LOT_350);
  });

  it("falls back to the title heuristic when the entry has no trade_id", () => {
    const linked = findLinkedTrade({ entry: closedEntry(), trades: [LOT_350, LOT_246] });
    expect(linked).toBe(LOT_350);
  });

  it("falls back to the heuristic when the trade_id isn't in the loaded window", () => {
    const linked = findLinkedTrade({
      entry: closedEntry({ trade_id: "trade-outside-window" }),
      trades: [LOT_350],
    });
    expect(linked).toBe(LOT_350);
  });

  it("routes an 'Opened' entry to open positions, not to a same-day close", () => {
    const openCsp = { id: "pos-1", ticker: "GLW", type: "CSP", strike: 130, open_date: "2026-08-14" };
    const closedCsp = {
      id: "trade-1", ticker: "GLW", type: "CSP", strike: 130,
      closeDate: new Date("2026-08-14T12:00:00"),
    };
    const entry = {
      entry_type: "trade_note", ticker: "GLW", entry_date: "2026-08-14",
      title: "CSP $130 — Opened", trade_id: null,
    };
    expect(findLinkedTrade({ entry, trades: [closedCsp], openTrades: [openCsp] })).toBe(openCsp);
  });

  it("returns null for non-trade entries", () => {
    expect(findLinkedTrade({ entry: { entry_type: "eod_update", ticker: "COHR" }, trades: [LOT_350] }))
      .toBeNull();
  });
});
