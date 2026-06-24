import { describe, it, expect } from "vitest";
import { buildInstruments } from "../quotes.js";
import { buildOccSymbol } from "../_lib/occ.js";

// Locks the OCC index format for both spread legs. The short leg lives in
// `strike`; the long leg + `right` live in the `lots` JSONB blob.
describe("buildInstruments — vertical spreads", () => {
  it("quotes BOTH legs of an XSP put spread", () => {
    const rows = [
      {
        ticker: "XSP",
        type: "Spread",
        strike: 708,
        expiry_date: "2026-07-31",
        position_type: "open_spread",
        lots: { long_strike: 703, right: "put" },
      },
    ];

    const { optionInstruments } = buildInstruments(rows);
    const symbols = optionInstruments.map(i => i.symbol);

    expect(symbols).toContain("XSP260731P00708000"); // short leg
    expect(symbols).toContain("XSP260731P00703000"); // long leg
    expect(symbols).toHaveLength(2);
  });

  it("routes a cash-settled index underlying to an INDEX instrument (not EQUITY)", () => {
    // XSP/SPX/... only quote as INDEX on Public.com — fetching as EQUITY returns
    // UNKNOWN, leaving the cushion column dark. Route them to INDEX so the
    // underlying spot resolves.
    const rows = [
      {
        ticker: "XSP",
        type: "Spread",
        strike: 708,
        expiry_date: "2026-07-31",
        position_type: "open_spread",
        lots: { long_strike: 703, right: "put" },
      },
    ];

    const { equityInstruments, indexInstruments } = buildInstruments(rows);
    expect(indexInstruments).toEqual([{ symbol: "XSP", type: "INDEX" }]);
    expect(equityInstruments).not.toContainEqual({ symbol: "XSP", type: "EQUITY" });
  });

  it("keeps an equity underlying as EQUITY and emits no index instruments", () => {
    const rows = [
      { ticker: "AAPL", type: "CSP", strike: 200, expiry_date: "2026-07-31", position_type: "open_csp" },
    ];
    const { equityInstruments, indexInstruments } = buildInstruments(rows);
    expect(equityInstruments).toContainEqual({ symbol: "AAPL", type: "EQUITY" });
    expect(indexInstruments).toEqual([]);
  });
});

// Belt-and-suspenders: pin the raw OCC index format independent of buildInstruments.
describe("buildOccSymbol — XSP put strikes", () => {
  it("formats the 708 and 703 put strikes per OCC spec", () => {
    expect(buildOccSymbol("XSP", "2026-07-31", false, 708)).toBe("XSP260731P00708000");
    expect(buildOccSymbol("XSP", "2026-07-31", false, 703)).toBe("XSP260731P00703000");
  });
});
