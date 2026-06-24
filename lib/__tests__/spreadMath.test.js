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
