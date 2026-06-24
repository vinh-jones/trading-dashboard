import { describe, it, expect } from "vitest";
import { reshapePositions } from "../_lib/reshapePositions.js";

// A Supabase `positions` row as written by lib/syncSheets.js for an open
// vertical spread: the short leg lives in `strike`, the second leg + the
// classification flags live in the `lots` JSONB.
const xspSpreadRow = {
  position_type:     "open_spread",
  ticker:            "XSP",
  type:              "Spread",
  subtype:           "Bull Put",
  strike:            708,
  contracts:         16,
  open_date:         "2026-06-24",
  expiry_date:       "2026-07-31",
  days_to_expiry:    37,
  premium_collected: 1056,
  capital_fronted:   6944,
  entry_cost:        0.66,
  lots: {
    long_strike: 703,
    right:       "put",
    is_credit:   true,
    width:       5,
    breakeven:   707.34,
    settlement:  "cash",
    assignable:  false,
  },
  source: "Ryan",
  notes:  "",
};

describe("reshapePositions — open vertical spreads", () => {
  it("emits an open_spreads array from open_spread rows", () => {
    const out = reshapePositions([xspSpreadRow]);
    expect(out.open_spreads).toHaveLength(1);
  });

  it("reconstructs the full spread entry from the flat row + lots JSONB", () => {
    const [s] = reshapePositions([xspSpreadRow]).open_spreads;
    expect(s).toMatchObject({
      ticker: "XSP", type: "Spread", subtype: "Bull Put",
      is_credit: true, right: "put",
      short_strike: 708, long_strike: 703, strike: 708, width: 5,
      contracts: 16, credit: 0.66,
      open_date: "2026-06-24", expiry_date: "2026-07-31", days_to_expiry: 37,
      max_gain: 1056, max_loss: 6944,
      capital_fronted: 6944, premium_collected: 1056, breakeven: 707.34,
      settlement: "cash", assignable: false,
    });
  });

  it("does not leak spread rows into csp/leaps/assigned buckets", () => {
    const out = reshapePositions([xspSpreadRow]);
    expect(out.open_csps).toHaveLength(0);
    expect(out.open_leaps).toHaveLength(0);
    expect(out.assigned_shares).toHaveLength(0);
  });

  it("returns [] open_spreads when no spread rows are present", () => {
    const out = reshapePositions([
      { position_type: "open_csp", type: "CSP", ticker: "SOFI", strike: 24 },
    ]);
    expect(out.open_spreads).toEqual([]);
  });
});
