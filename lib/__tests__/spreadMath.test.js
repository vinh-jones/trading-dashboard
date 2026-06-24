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
  it("returns null for non-spread labels", () => {
    expect(classifySpread("LEAPS")).toBeNull();
  });
});

import { deriveSpread } from "../spreadMath.js";

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
});
