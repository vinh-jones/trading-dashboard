// lib/__tests__/spreadMath.test.js
import { describe, it, expect } from "vitest";
import { parseSpreadStrikes, classifySpread } from "../spreadMath.js";

describe("parseSpreadStrikes", () => {
  it("splits short/long on the slash, short first", () => {
    expect(parseSpreadStrikes("708/703")).toEqual({ short_strike: 708, long_strike: 703 });
  });
  it("handles whitespace and dollar signs", () => {
    expect(parseSpreadStrikes(" $700 / $705 ")).toEqual({ short_strike: 700, long_strike: 705 });
  });
  it("returns null for a single strike or junk", () => {
    expect(parseSpreadStrikes("703")).toBeNull();
    expect(parseSpreadStrikes("")).toBeNull();
  });
});

describe("classifySpread", () => {
  it("maps the four canonical txnType labels", () => {
    expect(classifySpread("Bull Put Spread")).toEqual({ subtype: "Bull Put", is_credit: true, right: "put" });
    expect(classifySpread("Bear Call Spread")).toEqual({ subtype: "Bear Call", is_credit: true, right: "call" });
    expect(classifySpread("Bull Call Spread")).toEqual({ subtype: "Bull Call", is_credit: false, right: "call" });
    expect(classifySpread("Bear Put Spread")).toEqual({ subtype: "Bear Put", is_credit: false, right: "put" });
  });
  it("is case/space tolerant", () => {
    expect(classifySpread("  bull put spread ")).toEqual({ subtype: "Bull Put", is_credit: true, right: "put" });
  });
  it("matches a canonical phrase as a substring (live description shape)", () => {
    expect(classifySpread("Bull Put Spread (Max gain $1094)")).toEqual({ subtype: "Bull Put", is_credit: true, right: "put" });
  });
  it("returns null for non-spread labels", () => {
    expect(classifySpread("LEAPS")).toBeNull();
  });
  it("returns null when no canonical phrase is present (bare SPREAD)", () => {
    expect(classifySpread("SPREAD")).toBeNull();
  });
});

import { normalizeSpreadLegs } from "../spreadMath.js";

// Leg roles are fully determined by the subtype geometry + the two strike
// values, so the order the strikes were typed into the sheet is redundant
// information. These cover both orders for all four subtypes.
describe("normalizeSpreadLegs", () => {
  const cases = [
    { label: "Bull Put (credit put): short is the HIGHER strike",  is_credit: true,  right: "put",  short: 708, long: 703 },
    { label: "Bear Call (credit call): short is the LOWER strike",  is_credit: true,  right: "call", short: 500, long: 505 },
    { label: "Bull Call (debit call): short is the HIGHER strike",  is_credit: false, right: "call", short: 505, long: 500 },
    { label: "Bear Put (debit put): short is the LOWER strike",     is_credit: false, right: "put",  short: 495, long: 500 },
  ];

  for (const c of cases) {
    it(`${c.label} — already in order`, () => {
      expect(normalizeSpreadLegs({ short_strike: c.short, long_strike: c.long, is_credit: c.is_credit, right: c.right }))
        .toEqual({ short_strike: c.short, long_strike: c.long });
    });
    it(`${c.label} — entered reversed, self-corrects`, () => {
      expect(normalizeSpreadLegs({ short_strike: c.long, long_strike: c.short, is_credit: c.is_credit, right: c.right }))
        .toEqual({ short_strike: c.short, long_strike: c.long });
    });
  }

  it("the live SPY 770/750 Bear Put reverses to short 750 / long 770", () => {
    expect(normalizeSpreadLegs({ short_strike: 770, long_strike: 750, is_credit: false, right: "put" }))
      .toEqual({ short_strike: 750, long_strike: 770 });
  });

  it("passes through when a strike is missing or the classification is unknown", () => {
    expect(normalizeSpreadLegs({ short_strike: 770, long_strike: null, is_credit: false, right: "put" }))
      .toEqual({ short_strike: 770, long_strike: null });
    expect(normalizeSpreadLegs({ short_strike: 770, long_strike: 750, is_credit: null, right: null }))
      .toEqual({ short_strike: 770, long_strike: 750 });
  });
});

import { deriveSpread, debitMaxGain } from "../spreadMath.js";

describe("debitMaxGain", () => {
  it("= (width - debit) x 100 x contracts", () => {
    expect(debitMaxGain({ width: 20, debit: 6.15, contracts: 5 })).toBe(6925);
  });
  it("null when any input is missing", () => {
    expect(debitMaxGain({ width: null, debit: 6.15, contracts: 5 })).toBeNull();
    expect(debitMaxGain({ width: 20, debit: null, contracts: 5 })).toBeNull();
    expect(debitMaxGain({ width: 20, debit: 6.15, contracts: 0 })).toBeNull();
  });
});

describe("deriveSpread — credit put spread (the XSP trade)", () => {
  const d = deriveSpread({
    ticker: "XSP", short_strike: 708, long_strike: 703,
    credit: 0.66, contracts: 16, is_credit: true, right: "put",
  });
  it("derives width", () => expect(d.width).toBe(5));
  it("derives max gain = credit x 100 x contracts", () => expect(d.max_gain).toBe(1056));
  it("derives max loss = (width - credit) x 100 x contracts", () => expect(d.max_loss).toBe(6944));
  it("capital_fronted equals max loss", () => expect(d.capital_fronted).toBe(6944));
  it("premium_collected equals max gain for credit spreads", () => expect(d.premium_collected).toBe(1056));
  it("put-credit breakeven = short - credit", () => expect(d.breakeven).toBeCloseTo(707.34, 2));
  it("XSP is cash-settled and not assignable", () => {
    expect(d.settlement).toBe("cash");
    expect(d.assignable).toBe(false);
  });
});

describe("deriveSpread — credit call spread on an equity (assignable)", () => {
  const d = deriveSpread({
    ticker: "QQQ", short_strike: 500, long_strike: 505,
    credit: 1.00, contracts: 2, is_credit: true, right: "call",
  });
  it("call-credit breakeven = short + credit", () => expect(d.breakeven).toBeCloseTo(501, 2));
  it("QQQ is physically settled and assignable", () => {
    expect(d.settlement).toBe("physical");
    expect(d.assignable).toBe(true);
  });
  it("premium_collected set for credit", () => expect(d.premium_collected).toBe(200));
});

describe("deriveSpread — debit spreads (not premium)", () => {
  it("bull call debit: breakeven on long leg, no premium_collected", () => {
    // short-first: short 505 (sold higher), long 500 (bought lower); 2.00 debit
    const d = deriveSpread({
      ticker: "AAPL", short_strike: 505, long_strike: 500,
      credit: 2.00, contracts: 1, is_credit: false, right: "call",
    });
    expect(d.max_loss).toBe(200);                 // debit paid
    expect(d.max_gain).toBe(300);                 // (5 - 2) x 100
    expect(d.breakeven).toBeCloseTo(502, 2);      // long(500) + debit(2)
    expect(d.premium_collected).toBeNull();
  });

  it("bear put debit: breakeven on long leg below, no premium_collected", () => {
    // short-first: short 495 (sold lower), long 500 (bought higher); 2.00 debit
    const d = deriveSpread({
      ticker: "AAPL", short_strike: 495, long_strike: 500,
      credit: 2.00, contracts: 1, is_credit: false, right: "put",
    });
    expect(d.max_loss).toBe(200);                 // debit paid
    expect(d.max_gain).toBe(300);                 // (5 - 2) x 100
    expect(d.breakeven).toBeCloseTo(498, 2);      // long(500) - debit(2)
    expect(d.premium_collected).toBeNull();
  });
});
