import { describe, it, expect } from "vitest";
import { resolveBasket, basketTarget, capitalDeployed, realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual } from "../strategyBasket";
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
