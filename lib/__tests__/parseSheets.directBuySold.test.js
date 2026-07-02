// lib/__tests__/parseSheets.directBuySold.test.js
import { describe, it, expect } from "vitest";
import { buildDirectBuyShareTradesFromSold } from "../parseSheets.js";

// A direct-buy share lot only carries a synthetic acquisition event while OPEN.
// Once sold it becomes a Shares/Sold row and its acquisition evaporates, leaving
// the lifespan engine with an unbalanced ledger. buildDirectBuyShareTradesFromSold
// re-emits the acquisition for sold direct-buy lots (and only those).

const soldLot = (ticker, openDate, contracts, description) => ({
  ticker, type: "Shares", subtype: "Sold",
  open_date: openDate, close_date: "2026-07-02",
  contracts, description,
});
const cspAssigned = (ticker, strike, contracts) => ({
  ticker, type: "CSP", subtype: "Assigned", strike, contracts,
});

describe("buildDirectBuyShareTradesFromSold", () => {
  it("synthesizes an acquisition for a sold direct-buy lot (no matching CSP strike)", () => {
    const out = buildDirectBuyShareTradesFromSold(
      [soldLot("HOOD", "2026-05-11", 400, "Shares (400, $80.21)")],
      [], // no CSP assignments
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ticker: "HOOD", type: "Shares", subtype: "Assigned",
      strike: 80.21, contracts: 400,
      open_date: "2026-05-11", close_date: "2026-05-11",
      capital_fronted: Math.round(80.21 * 400),
      notes: "Direct share purchase",
    });
  });

  it("skips a sold lot whose price matches a CSP-assigned strike (acquisition already exists)", () => {
    const out = buildDirectBuyShareTradesFromSold(
      [soldLot("HOOD", "2026-01-16", 400, "Shares ($130, 400)")],
      [cspAssigned("HOOD", 130, 4)],
    );
    expect(out).toHaveLength(0);
  });

  it("skips an AGGREGATED sold lot spanning multiple same-strike CSP assignments", () => {
    // CRDO/IREN pattern: 400+200 @ $135 consolidated into one 600-share sale.
    // A count-keyed match would miss this and fabricate a duplicate acquisition;
    // the price-level match must skip it.
    const out = buildDirectBuyShareTradesFromSold(
      [soldLot("CRDO", "2026-02-13", 600, "Shares (600, $135)")],
      [cspAssigned("CRDO", 135, 4), cspAssigned("CRDO", 135, 2)],
    );
    expect(out).toHaveLength(0);
  });

  it("ignores a count-less P&L-adjustment row ('Shares ($38)')", () => {
    const out = buildDirectBuyShareTradesFromSold(
      [{ ...soldLot("HIMS", "2025-11-21", null, "Shares ($38)") }],
      [],
    );
    expect(out).toHaveLength(0);
  });

  it("uses the description count when the contracts column is NULL", () => {
    const out = buildDirectBuyShareTradesFromSold(
      [soldLot("IREN", "2025-12-26", null, "Shares (200, $43)")],
      [cspAssigned("IREN", 52, 3)], // different strike → not a match
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ contracts: 200, strike: 43, open_date: "2025-12-26" });
  });
});
