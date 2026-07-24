// lib/__tests__/sourceAttribution.test.js
//
// Covers the source-attribution fix:
//   1. Open positions parse as "Self" (the user's own book); closed/ledger
//      rows keep "Ryan". (parseSheets)
//   2. reconcileSourceOverrides re-applies the journal's Ryan/Self after the
//      positions table is wiped + rebuilt, so a "flip to Ryan" survives syncs.
import { describe, it, expect } from "vitest";
import { processCSP, processLeapsShares } from "../parseSheets.js";
import { reconcileSourceOverrides } from "../syncSheets.js";

// CSP tab layout (see processCSP): 0 ticker | 1 txn (Call→CC) | 2 open |
// 3 expiry | 4 earlyClose | 6 contracts | 8 strike | 23 action.
// Open ⇔ no earlyClose AND no action.
function cspRow(fields) {
  const r = new Array(24).fill("");
  return Object.assign(r, fields);
}

describe("parseSheets — open positions default to Self", () => {
  it("stamps an open CC as Self (the LRCX $330 bug case)", () => {
    const { openCCs } = processCSP([
      cspRow({ 0: "LRCX", 1: "Call", 2: "7/24/2026", 3: "8/1/2026", 6: "1", 8: "330" }),
    ]);
    expect(openCCs).toHaveLength(1);
    expect(openCCs[0].source).toBe("Self");
  });

  it("stamps an open CSP as Self", () => {
    const { openCSPs } = processCSP([
      cspRow({ 0: "IREN", 1: "Put", 2: "7/24/2026", 3: "8/1/2026", 6: "4", 8: "45" }),
    ]);
    expect(openCSPs).toHaveLength(1);
    expect(openCSPs[0].source).toBe("Self");
  });

  it("keeps a CLOSED trade tagged Ryan (history is not reattributed)", () => {
    const { closedTrades } = processCSP([
      cspRow({ 0: "LRCX", 1: "Call", 2: "7/1/2026", 3: "7/18/2026", 4: "7/18/2026", 6: "1", 8: "320" }),
    ]);
    expect(closedTrades).toHaveLength(1);
    expect(closedTrades[0].source).toBe("Ryan");
  });

  it("stamps an open LEAPS as Self", () => {
    // LEAPS/Shares tab: 0 ticker | 1 open | 2 close | 3 desc | 7 txnType |
    // 8 expiry | 9 contracts | 10 strike. Open ⇔ no close date.
    const { openLeaps } = processLeapsShares([
      ["NVDA", "1/2/2026", "", "NVDA LEAPS", "", "", "5000", "LEAPS", "1/15/2027", "1", "100", "50", ""],
    ]);
    expect(openLeaps).toHaveLength(1);
    expect(openLeaps[0].source).toBe("Self");
  });
});

describe("reconcileSourceOverrides", () => {
  const pos = (over = {}) => ({
    id: "p1", ticker: "LRCX", type: "CC", strike: 330, expiry_date: "2026-08-01",
    source: "Self", ...over,
  });
  const entry = (over = {}) => ({
    ticker: "LRCX", type: "CC", strike: 330, expiry: "2026-08-01",
    source: "Ryan", entry_date: "2026-07-24", created_at: "2026-07-24T20:00:00Z", ...over,
  });

  it("flips a Self position to Ryan when the journal says Ryan", () => {
    const buckets = reconcileSourceOverrides([entry()], [pos()]);
    expect(buckets).toEqual({ Ryan: ["p1"] });
  });

  it("is a no-op when the journal source already matches the row", () => {
    // journal Self, position already Self → nothing to update
    const buckets = reconcileSourceOverrides([entry({ source: "Self" })], [pos()]);
    expect(buckets).toEqual({});
  });

  it("matches on the field-name skew: journal.expiry vs positions.expiry_date", () => {
    const buckets = reconcileSourceOverrides(
      [entry({ expiry: "2026-08-01" })],
      [pos({ expiry_date: "2026-08-01" })],
    );
    expect(buckets).toEqual({ Ryan: ["p1"] });
  });

  it("latest entry per position wins", () => {
    const older = entry({ source: "Ryan", entry_date: "2026-07-20", created_at: "2026-07-20T20:00:00Z" });
    const newer = entry({ source: "Self", entry_date: "2026-07-24", created_at: "2026-07-24T21:00:00Z" });
    // newest says Self, position is Self → no change
    expect(reconcileSourceOverrides([older, newer], [pos()])).toEqual({});
    // reverse the recency → newest says Ryan → flip
    const older2 = entry({ source: "Self", entry_date: "2026-07-20", created_at: "2026-07-20T20:00:00Z" });
    const newer2 = entry({ source: "Ryan", entry_date: "2026-07-24", created_at: "2026-07-24T21:00:00Z" });
    expect(reconcileSourceOverrides([older2, newer2], [pos()])).toEqual({ Ryan: ["p1"] });
  });

  it("ignores bare ticker-level / EOD entries (no type) so they can't hijack attribution", () => {
    const eod = { ticker: "LRCX", type: null, strike: null, expiry: null, source: "Ryan", entry_date: "2026-07-24", created_at: "2026-07-24T22:00:00Z" };
    expect(reconcileSourceOverrides([eod], [pos()])).toEqual({});
  });

  it("does not touch positions with no matching journal entry", () => {
    const buckets = reconcileSourceOverrides(
      [entry({ ticker: "AAPL" })],
      [pos()],
    );
    expect(buckets).toEqual({});
  });

  it("matches assigned shares on ticker+type with null strike/expiry", () => {
    const shares = { id: "s1", ticker: "IREN", type: "Shares", strike: null, expiry_date: null, source: "Self" };
    const shareEntry = { ticker: "IREN", type: "Shares", strike: null, expiry: null, source: "Ryan", entry_date: "2026-07-24", created_at: "2026-07-24T20:00:00Z" };
    expect(reconcileSourceOverrides([shareEntry], [shares])).toEqual({ Ryan: ["s1"] });
  });

  it("buckets multiple positions by target source", () => {
    const p1 = pos({ id: "p1" });
    const p2 = { id: "p2", ticker: "COHR", type: "CC", strike: 350, expiry_date: "2026-08-01", source: "Self" };
    const buckets = reconcileSourceOverrides(
      [entry({ source: "Ryan" }), entry({ ticker: "COHR", strike: 350, source: "Ryan" })],
      [p1, p2],
    );
    expect(buckets.Ryan.sort()).toEqual(["p1", "p2"]);
  });
});
