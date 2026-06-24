import { describe, it, expect } from "vitest";
import { resolveBasket, basketTarget, capitalDeployed, realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual, shareCoverageWarnings } from "../strategyBasket";
import { buildOccSymbol } from "../trading";

const openPositions = [
  { ticker: "SOFI", type: "LEAPS", strike: 15,  expiry_date: "2027-01-21", contracts: 20, capital_fronted: 8000, entry_cost: 4.0, open_date: "2026-06-01" },
  { ticker: "COHR", type: "CSP",   strike: 310, expiry_date: "2026-07-02", contracts: 1,  capital_fronted: 31000, entry_cost: 6.0, open_date: "2026-06-01" },
];
const trades = [
  { id: "loss-1", ticker: "SOFI", type: "Shares", subtype: "Sold", strike: null, expiry_date: null, contracts: 3300, open_date: "2026-02-12", close_date: "2026-06-01", premium_collected: -26400, capital_fronted: 85800, entry_cost: 26 },
  { id: "rec-1",  ticker: "COHR", type: "CSP", subtype: "Close", strike: 310, expiry_date: "2026-07-02", contracts: 1, open_date: "2026-05-01", close_date: "2026-05-20", premium_collected: 450, capital_fronted: 31000, entry_cost: 6.0 },
];
const entries = [
  { tags: ["strategy:sofi-makeup", "role:makeup-baseline"], trade_id: "loss-1", ticker: "SOFI", type: "Shares", strike: null, expiry: null },
  { tags: ["strategy:sofi-makeup"], trade_id: null, ticker: "SOFI", type: "LEAPS", strike: 15, expiry: "2027-01-21" },
  { tags: ["strategy:sofi-makeup"], trade_id: null, ticker: "COHR", type: "CSP", strike: 310, expiry: "2026-07-02" },
];

describe("resolveBasket", () => {
  it("splits baseline vs recovery and resolves by trade_id and tuple", () => {
    const members = resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries });
    expect(members).toHaveLength(3);
    const baseline = members.find(m => m.role === "baseline");
    expect(baseline).toMatchObject({ status: "closed", ticker: "SOFI", realized: -26400 });
    const leaps = members.find(m => m.ticker === "SOFI" && m.type === "LEAPS");
    expect(leaps).toMatchObject({ status: "open", role: "recovery", capitalFronted: 8000, entryCost: 4.0, contracts: 20 });
    const cohr = members.find(m => m.ticker === "COHR");
    expect(cohr).toMatchObject({ status: "open", role: "recovery" });
  });

  it("ignores entries that do not carry the tag", () => {
    const extra = [...entries, { tags: ["strategy:other"], trade_id: null, ticker: "AAPL", type: "CSP", strike: 100, expiry: "2026-07-02" }];
    expect(resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries: extra })).toHaveLength(3);
  });

  it("matches a closed recovery trade by tuple when no open position exists", () => {
    const e = [{ tags: ["strategy:x"], trade_id: null, ticker: "COHR", type: "CSP", strike: 310, expiry: "2026-07-02" }];
    const members = resolveBasket("strategy:x", { openPositions: [], trades, entries: e });
    expect(members[0]).toMatchObject({ status: "closed", role: "recovery", realized: 450 });
  });

  it("tuple-matches a closed leg whose normalizeTrade output added an MM/DD `expiry` alongside ISO `expiry_date`", () => {
    // When a tagged OPEN position closes, it becomes a normalized trade carrying
    // BOTH expiry_date (ISO) and expiry (MM/DD). The ISO date must win the match,
    // or the closed leg silently drops out of the basket.
    const closedNorm = [
      { id: "cohr-c", ticker: "COHR", type: "CSP", strike: 310, expiry: "07/02", expiry_date: "2026-07-02", close: "06/02", closeDate: new Date("2026-06-02T12:00:00"), premium: 810, fronted: 31000 },
    ];
    const e = [{ tags: ["strategy:k"], trade_id: null, ticker: "COHR", type: "CSP", strike: 310, expiry: "2026-07-02" }];
    const members = resolveBasket("strategy:k", { openPositions: [], trades: closedNorm, entries: e });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ status: "closed", role: "recovery", realized: 810 });
  });

  it("carries days held, roi, and kept % from the trade for closed legs", () => {
    const t = [{ id: "z", ticker: "ZZ", type: "CSP", strike: 50, expiry_date: "2026-08-01", days_held: 12, roi: 1.45, kept_pct: 0.5, premium_collected: 300, capital_fronted: 5000 }];
    const e = [{ tags: ["strategy:z"], trade_id: "z", ticker: "ZZ", type: "CSP", strike: 50, expiry: "2026-08-01" }];
    const [m] = resolveBasket("strategy:z", { trades: t, entries: e });
    expect(m).toMatchObject({ daysHeld: 12, roi: 1.45, keptPct: 0.5 });
  });

  it("resolves a trade via metadata.trade_id when top-level trade_id is absent", () => {
    const e = [{ tags: ["strategy:m"], trade_id: null, metadata: { trade_id: "rec-1" }, ticker: "COHR", type: "CSP", strike: 999, expiry: "2099-01-01" }];
    const members = resolveBasket("strategy:m", { openPositions: [], trades, entries: e });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ status: "closed", realized: 450 });
  });

  it("reads realized P/L from the app's normalized trade shape (premium/fronted)", () => {
    // normalizeTrade() renames premium_collected→premium, capital_fronted→fronted,
    // and drops the ISO close_date (keeps `close` as MM/DD). The lib must read these.
    // normalizeTrade keeps closeDate as a Date object (the ISO close_date is dropped).
    const normalizedTrades = [
      { id: "loss-n", ticker: "SOFI", type: "Shares", strike: null, expiry_date: null, open_date: "2026-02-12", close: "06/01", closeDate: new Date("2026-06-01T12:00:00"), premium: -26400, fronted: 85800 },
    ];
    const e = [{ tags: ["strategy:n", "role:makeup-baseline"], trade_id: "loss-n", ticker: "SOFI", type: "Shares", strike: null, expiry: null }];
    const members = resolveBasket("strategy:n", { openPositions: [], trades: normalizedTrades, entries: e });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ status: "closed", role: "baseline", realized: -26400, capitalFronted: 85800, closeDate: "2026-06-01" });
    expect(basketTarget(members)).toBe(26400);
  });

  it("resolves an open recovery Shares lot from metadata, ignoring the blended position", () => {
    // A blended 300-share GLW position in the feed must NOT be what the basket counts.
    const blended = [
      { ticker: "GLW", type: "Shares", strike: null, expiry_date: null, contracts: 300, capital_fronted: 54000, entry_cost: 180 },
    ];
    const e = [
      { tags: ["strategy:g"], trade_id: null, ticker: "GLW", type: "Shares", strike: null, expiry: null, entry_date: "2026-06-17", metadata: { shares: 100, basis: 190 } },
    ];
    const members = resolveBasket("strategy:g", { openPositions: blended, trades: [], entries: e });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      status: "open", role: "recovery", ticker: "GLW", type: "Shares",
      contracts: 100, entryCost: 190, capitalFronted: 19000, openDate: "2026-06-17",
    });
  });

  it("baseline Shares (no metadata.shares) still resolves via trade_id, not the declaration path", () => {
    const members = resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries });
    const baseline = members.find(m => m.role === "baseline");
    expect(baseline).toMatchObject({ status: "closed", ticker: "SOFI", realized: -26400 });
  });
});

describe("reducers", () => {
  const members = resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries });
  it("basketTarget = abs of baseline realized", () => {
    expect(basketTarget(members)).toBe(26400);
  });
  it("capitalDeployed = sum of open recovery capitalFronted", () => {
    expect(capitalDeployed(members)).toBe(39000);
  });
  it("realizedRecovery = sum of closed recovery realized (zero here, all open)", () => {
    expect(realizedRecovery(members)).toBe(0);
  });
  it("realizedRecovery counts closed recovery members", () => {
    const closedRec = [{ status: "closed", role: "recovery", realized: 450 }, { status: "closed", role: "baseline", realized: -26400 }];
    expect(realizedRecovery(closedRec)).toBe(450);
  });
});

describe("unrealizedCushion", () => {
  const longLeaps  = { status: "open", role: "recovery", ticker: "SOFI", type: "LEAPS", strike: 15,  expiry: "2027-01-21", contracts: 20, entryCost: 4.0 };
  const shortCsp   = { status: "open", role: "recovery", ticker: "COHR", type: "CSP",   strike: 310, expiry: "2026-07-02", contracts: 1,  entryCost: 6.0 };
  const leapsSym = buildOccSymbol("SOFI", "2027-01-21", true,  15);
  const cspSym   = buildOccSymbol("COHR", "2026-07-02", false, 310);

  it("long option gains when mark > entry, short option gains when mark < entry", () => {
    const quoteMap = new Map([
      [leapsSym, { mid: 5.0 }],   // long: (5.0-4.0)*20*100 = 2000
      [cspSym,   { mid: 4.0 }],   // short: (6.0-4.0)*1*100 = 200
    ]);
    const { total, marked, unmarked } = unrealizedCushion([longLeaps, shortCsp], quoteMap);
    expect(total).toBe(2200);
    expect(marked).toBe(2);
    expect(unmarked).toBe(0);
  });

  it("falls back to last, and counts unmarked members without blocking the total", () => {
    const quoteMap = new Map([[leapsSym, { last: 4.5 }]]); // long: (4.5-4.0)*20*100 = 1000; csp unmarked
    const { total, marked, unmarked } = unrealizedCushion([longLeaps, shortCsp], quoteMap);
    expect(total).toBe(1000);
    expect(marked).toBe(1);
    expect(unmarked).toBe(1);
  });

  it("only marks open recovery members", () => {
    const baseline = { status: "closed", role: "baseline", ticker: "SOFI", type: "Shares" };
    const { total, marked } = unrealizedCushion([baseline], new Map());
    expect(total).toBe(0);
    expect(marked).toBe(0);
  });
});

describe("memberUnrealized", () => {
  const longLeaps = { status: "open", role: "recovery", ticker: "SOFI", type: "LEAPS", strike: 15,  expiry: "2027-01-21", contracts: 20, entryCost: 4.0 };
  const shortCsp  = { status: "open", role: "recovery", ticker: "COHR", type: "CSP",   strike: 310, expiry: "2026-07-02", contracts: 1,  entryCost: 6.0 };
  const leapsSym = buildOccSymbol("SOFI", "2027-01-21", true,  15);
  const cspSym   = buildOccSymbol("COHR", "2026-07-02", false, 310);

  it("returns per-member P/L for a marked open recovery option", () => {
    const quoteMap = new Map([[leapsSym, { mid: 5.0 }], [cspSym, { mid: 4.0 }]]);
    expect(memberUnrealized(longLeaps, quoteMap)).toBe(2000); // (5-4)*20*100
    expect(memberUnrealized(shortCsp, quoteMap)).toBe(200);   // (6-4)*1*100
  });

  it("returns null when unmarked (no quote)", () => {
    expect(memberUnrealized(shortCsp, new Map())).toBe(null);
  });

  it("returns null for closed or baseline members", () => {
    const baseline = { status: "closed", role: "baseline", ticker: "SOFI", type: "Shares" };
    expect(memberUnrealized(baseline, new Map())).toBe(null);
  });

  it("aggregate cushion equals the sum of per-member marks", () => {
    const quoteMap = new Map([[leapsSym, { mid: 5.0 }], [cspSym, { mid: 4.0 }]]);
    const members = [longLeaps, shortCsp];
    const summed = members.reduce((s, m) => s + (memberUnrealized(m, quoteMap) ?? 0), 0);
    expect(unrealizedCushion(members, quoteMap).total).toBe(summed);
  });
});

describe("Shares marking", () => {
  const sharesLot = { status: "open", role: "recovery", ticker: "GLW", type: "Shares", strike: null, expiry: null, contracts: 100, entryCost: 190 };

  it("marks a Shares lot off the equity ticker quote with a x1 multiplier", () => {
    const quoteMap = new Map([["GLW", { mid: 176.92 }]]);
    expect(memberUnrealized(sharesLot, quoteMap)).toBeCloseTo((176.92 - 190) * 100, 6); // -1308
  });

  it("falls back to last, and is unmarked without a ticker quote", () => {
    expect(memberUnrealized(sharesLot, new Map([["GLW", { last: 180 }]]))).toBeCloseTo((180 - 190) * 100, 6);
    expect(memberUnrealized(sharesLot, new Map())).toBe(null);
  });

  it("unrealizedCushion includes the Shares lot in total and marked count", () => {
    const quoteMap = new Map([["GLW", { mid: 200 }]]);
    const { total, marked, unmarked } = unrealizedCushion([sharesLot], quoteMap);
    expect(total).toBeCloseTo((200 - 190) * 100, 6); // 1000
    expect(marked).toBe(1);
    expect(unmarked).toBe(0);
  });
});

describe("holdCounterfactual", () => {
  const baseline = { role: "baseline", status: "closed", ticker: "SOFI", type: "Shares", exitCost: 18, contracts: 3300 };

  it("computes (current - exit) * shares", () => {
    expect(holdCounterfactual(baseline, 18.56)).toBeCloseTo(1848, 6);
  });

  it("is negative when current is below the exit price", () => {
    expect(holdCounterfactual(baseline, 17)).toBeCloseTo(-3300, 6);
  });

  it("returns null when the baseline or price data is missing", () => {
    expect(holdCounterfactual(baseline, null)).toBe(null);
    expect(holdCounterfactual({ exitCost: null, contracts: 3300 }, 18)).toBe(null);
    expect(holdCounterfactual({ exitCost: 18, contracts: null }, 18)).toBe(null);
    expect(holdCounterfactual(null, 18)).toBe(null);
  });
});

describe("shareCoverageWarnings", () => {
  it("warns when tagged CC contracts exceed declared shares", () => {
    const members = [
      { status: "open", role: "recovery", ticker: "GLW", type: "Shares", contracts: 100 },
      { status: "open", role: "recovery", ticker: "GLW", type: "CC", contracts: 2 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([
      { ticker: "GLW", declaredShares: 100, ccContracts: 2, coveredShares: 200 },
    ]);
  });

  it("no warning when CCs are covered by declared shares", () => {
    const members = [
      { status: "open", role: "recovery", ticker: "GLW", type: "Shares", contracts: 200 },
      { status: "open", role: "recovery", ticker: "GLW", type: "CC", contracts: 2 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([]);
  });

  it("warns when a CC is tagged before any shares are declared", () => {
    const members = [
      { status: "open", role: "recovery", ticker: "GLW", type: "CC", contracts: 1 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([
      { ticker: "GLW", declaredShares: 0, ccContracts: 1, coveredShares: 100 },
    ]);
  });

  it("ignores closed and baseline members", () => {
    const members = [
      { status: "closed", role: "recovery", ticker: "GLW", type: "CC", contracts: 5 },
      { status: "open", role: "baseline", ticker: "GLW", type: "Shares", contracts: 0 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([]);
  });
});

describe("vertical spreads", () => {
  // Open-spread position shape as it arrives from useData (parseSheets open_spreads):
  // carries `credit` (not entry_cost), `long_strike`, `right`, `is_credit`.
  const spreadPos = {
    ticker: "XSP", type: "Spread", strike: 708, long_strike: 703, right: "put",
    is_credit: true, credit: 0.66, capital_fronted: 6944, contracts: 16,
    expiry_date: "2026-07-31", open_date: "2026-06-24",
  };
  const spreadEntry = { tags: ["strategy:sofi-makeup"], trade_id: null, ticker: "XSP", type: "Spread", strike: 708, expiry: "2026-07-31" };
  const shortSym = buildOccSymbol("XSP", "2026-07-31", false, 708);
  const longSym  = buildOccSymbol("XSP", "2026-07-31", false, 703);

  it("resolveBasket tuple-matches an open spread and carries both legs + credit as entryCost", () => {
    const members = resolveBasket("strategy:sofi-makeup", { openPositions: [spreadPos], trades: [], entries: [spreadEntry] });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      status: "open", role: "recovery", ticker: "XSP", type: "Spread",
      strike: 708, longStrike: 703, right: "put", isCredit: true,
      entryCost: 0.66, capitalFronted: 6944, contracts: 16,
    });
  });

  it("memberUnrealized marks a credit spread from BOTH legs: (credit - (shortMid - longMid)) x 100 x contracts", () => {
    const member = { status: "open", role: "recovery", ticker: "XSP", type: "Spread", strike: 708, longStrike: 703, right: "put", isCredit: true, entryCost: 0.66, contracts: 16, expiry: "2026-07-31" };
    // mark = 5.53 - 4.86 = 0.67 → (0.66 - 0.67) * 100 * 16 = -16
    const quoteMap = new Map([[shortSym, { mid: 5.53 }], [longSym, { mid: 4.86 }]]);
    expect(memberUnrealized(member, quoteMap)).toBe(-16);
  });

  it("is unmarked (null) when a spread leg has no quote", () => {
    const member = { status: "open", role: "recovery", ticker: "XSP", type: "Spread", strike: 708, longStrike: 703, right: "put", isCredit: true, entryCost: 0.66, contracts: 16, expiry: "2026-07-31" };
    expect(memberUnrealized(member, new Map([[shortSym, { mid: 5.53 }]]))).toBe(null);
  });

  it("capitalDeployed and unrealizedCushion include the open spread", () => {
    const members = resolveBasket("strategy:sofi-makeup", { openPositions: [spreadPos], trades: [], entries: [spreadEntry] });
    expect(capitalDeployed(members)).toBe(6944);
    const quoteMap = new Map([[shortSym, { mid: 5.53 }], [longSym, { mid: 4.86 }]]);
    const { total, marked } = unrealizedCushion(members, quoteMap);
    expect(total).toBe(-16);
    expect(marked).toBe(1);
  });

  it("a closed credit spread contributes its realized credit to realizedRecovery", () => {
    const closedSpreadTrade = { id: "xsp-c", ticker: "XSP", type: "Spread", subtype: "Bull Put", strike: 708, expiry_date: "2026-07-31", contracts: 16, premium_collected: 1056, close_date: "2026-07-31" };
    const e = [{ tags: ["strategy:x"], trade_id: "xsp-c", ticker: "XSP", type: "Spread", strike: 708, expiry: "2026-07-31" }];
    const members = resolveBasket("strategy:x", { openPositions: [], trades: [closedSpreadTrade], entries: e });
    expect(members[0]).toMatchObject({ status: "closed", role: "recovery", realized: 1056 });
    expect(realizedRecovery(members)).toBe(1056);
  });
});
