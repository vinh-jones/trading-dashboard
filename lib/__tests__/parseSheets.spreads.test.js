// lib/__tests__/parseSheets.spreads.test.js
import { describe, it, expect } from "vitest";
import { processLeapsShares, buildPositions } from "../parseSheets.js";

// Column layout (see parseSheets.js processLeapsShares):
// 0 ticker | 1 open | 2 close | 3 desc | 4 premium | 5 notes | 6 capital
// 7 txnType | 8 expiry | 9 contracts | 10 strike | 11 entry | 12 exit
//
// REAL row shape: the label lives in the description (col 3) with trailing
// text, the txnType column (col 7) carries a bare "SPREAD", and contracts
// (col 9) arrives as a "$16.00"-style cell. Classification must read the
// description; the parser uses classifySpread(txnType) ?? classifySpread(desc).
const openXspRow = [
  "XSP", "6/24/2026", "", "Bull Put Spread (Max gain $1094)", "", "", "$6,944.00",
  "SPREAD", "7/31/2026", "$16.00", "708/703", "$0.66", "",
];

describe("processLeapsShares — open vertical spread", () => {
  const { openSpreads } = processLeapsShares([openXspRow]);

  it("emits one open spread instead of dropping it", () => {
    expect(openSpreads).toHaveLength(1);
  });
  it("classifies from the description and captures both legs with derived risk/reward", () => {
    const s = openSpreads[0];
    expect(s).toMatchObject({
      ticker: "XSP", type: "Spread", subtype: "Bull Put",
      is_credit: true, right: "put",
      short_strike: 708, long_strike: 703, width: 5,
      contracts: 16, credit: 0.66,
      max_gain: 1056, max_loss: 6944, capital_fronted: 6944,
      premium_collected: 1056, settlement: "cash", assignable: false,
      expiry_date: "2026-07-31", strike: 708,
    });
    expect(s.breakeven).toBeCloseTo(707.34, 2);
  });
});

describe("processLeapsShares — closed Bear-style spread (label in desc, col 7 blank)", () => {
  // Historical closed rows carry the label only in the description, the txnType
  // column blank, with a close date + exit cost set. Must route to closedTrades
  // with the correct subtype and NOT be left open.
  const closedBearRow = [
    "SPY", "5/1/2026", "5/15/2026", "Bear Call Spread (Max gain $800)", "", "", "$4,200.00",
    "", "5/15/2026", "$10.00", "520/525", "$0.50", "0",
  ];
  const { closedTrades, openSpreads } = processLeapsShares([closedBearRow]);
  it("does not leave it open", () => expect(openSpreads).toHaveLength(0));
  it("routes to a closed trade labeled Bear Call (not stuck open, not mislabeled)", () => {
    expect(closedTrades[0]).toMatchObject({ type: "Spread", subtype: "Bear Call" });
  });
});

describe("buildPositions threads open_spreads through", () => {
  const { openSpreads } = processLeapsShares([openXspRow]);
  const built = buildPositions({}, [], [], openSpreads);
  it("returns the spreads array", () => {
    expect(built.openSpreads).toHaveLength(1);
    expect(built.openSpreads[0].ticker).toBe("XSP");
  });
});

describe("closed spread realized P&L", () => {
  it("expired worthless → full credit kept as premium_collected", () => {
    const row = ["XSP","6/24/2026","7/31/2026","Bull Put Spread","","","$6,944.00",
                 "Bull Put Spread","7/31/2026","16","708/703","$0.66","0"];
    const { closedTrades } = processLeapsShares([row]);
    // realized = (0.66 - 0) * 100 * 16 = 1056
    expect(closedTrades[0].premium_collected).toBe(1056);
  });
  it("closed early for a debit → realized nets the buyback", () => {
    const row = ["XSP","6/24/2026","7/10/2026","Bull Put Spread","","","$6,944.00",
                 "Bull Put Spread","7/31/2026","16","708/703","$0.66","0.20"];
    const { closedTrades } = processLeapsShares([row]);
    // realized = (0.66 - 0.20) * 100 * 16 = 736
    expect(closedTrades[0].premium_collected).toBe(736);
  });
});
