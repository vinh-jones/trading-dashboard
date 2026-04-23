import { describe, it, expect } from "vitest";
import {
  shortOptionGlDollars,
  shortOptionGlPct,
  leapGlDollars,
  leapGlPct,
  dtePctRemaining,
} from "../positionMetrics.js";

describe("shortOptionGlDollars", () => {
  it("returns premium − (mid × contracts × 100)", () => {
    // collected $500, mid $1.00, 3 contracts → 500 − 300 = 200
    expect(shortOptionGlDollars({ premiumCollected: 500, optionMid: 1.00, contracts: 3 })).toBe(200);
  });

  it("goes negative when buyback cost exceeds premium", () => {
    expect(shortOptionGlDollars({ premiumCollected: 100, optionMid: 2.00, contracts: 1 })).toBe(-100);
  });

  it("returns null for missing inputs", () => {
    expect(shortOptionGlDollars({ premiumCollected: 0, optionMid: 1, contracts: 1 })).toBeNull();
    expect(shortOptionGlDollars({ premiumCollected: 100, optionMid: null, contracts: 1 })).toBeNull();
    expect(shortOptionGlDollars({ premiumCollected: 100, optionMid: 1, contracts: 0 })).toBeNull();
  });
});

describe("shortOptionGlPct", () => {
  it("returns dollars / premium × 100", () => {
    expect(shortOptionGlPct({ premiumCollected: 500, optionMid: 1.00, contracts: 3 })).toBe(40);
  });

  it("returns null for missing inputs", () => {
    expect(shortOptionGlPct({ premiumCollected: null, optionMid: 1, contracts: 1 })).toBeNull();
  });
});

describe("leapGlDollars", () => {
  it("returns (mid × contracts × 100) − capital fronted", () => {
    // fronted $2000, mid $25, 1 contract → 2500 − 2000 = 500
    expect(leapGlDollars({ capitalFronted: 2000, optionMid: 25, contracts: 1 })).toBe(500);
  });

  it("goes negative when mark is below cost", () => {
    expect(leapGlDollars({ capitalFronted: 2000, optionMid: 15, contracts: 1 })).toBe(-500);
  });

  it("returns null for missing inputs", () => {
    expect(leapGlDollars({ capitalFronted: 0, optionMid: 1, contracts: 1 })).toBeNull();
    expect(leapGlDollars({ capitalFronted: 100, optionMid: null, contracts: 1 })).toBeNull();
  });
});

describe("leapGlPct", () => {
  it("returns dollars / fronted × 100", () => {
    expect(leapGlPct({ capitalFronted: 2000, optionMid: 25, contracts: 1 })).toBe(25);
  });
});

describe("dtePctRemaining", () => {
  it("computes fraction of total window remaining", () => {
    // 30-day window, 10 days left → 33.33%
    const out = dtePctRemaining({ openDateIso: "2026-01-01", expiryDateIso: "2026-01-31", dte: 10 });
    expect(out).toBeCloseTo(33.33, 1);
  });

  it("returns 100 at open", () => {
    const out = dtePctRemaining({ openDateIso: "2026-01-01", expiryDateIso: "2026-01-31", dte: 30 });
    expect(out).toBe(100);
  });

  it("returns 0 at expiry", () => {
    const out = dtePctRemaining({ openDateIso: "2026-01-01", expiryDateIso: "2026-01-31", dte: 0 });
    expect(out).toBe(0);
  });

  it("returns null for missing inputs", () => {
    expect(dtePctRemaining({ openDateIso: null, expiryDateIso: "2026-01-31", dte: 10 })).toBeNull();
    expect(dtePctRemaining({ openDateIso: "2026-01-01", expiryDateIso: null, dte: 10 })).toBeNull();
    expect(dtePctRemaining({ openDateIso: "2026-01-01", expiryDateIso: "2026-01-31", dte: null })).toBeNull();
  });
});
