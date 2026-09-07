import { describe, it, expect } from "vitest";
import { computeMid, MAX_UNDERLYING_SPREAD_PCT } from "../quotes.js";

describe("computeMid", () => {
  it("refuses the closed-book quote that paged on Labor Day 2026", () => {
    // CDE, 2026-09-07 09:30 ET: a stale one-sided ask against a $21.24 last.
    // (21.20 + 33.00) / 2 = 27.10 — a 29% ITM reading on a 1.1% ITM position.
    expect(computeMid(21.2, 33, "EQUITY")).toBeNull();
  });

  it("refuses every other blown-out underlying book from that morning", () => {
    expect(computeMid(45.9, 61, "EQUITY")).toBeNull();      // DRAM
    expect(computeMid(120, 141, "EQUITY")).toBeNull();      // HOOD
    expect(computeMid(310, 360, "EQUITY")).toBeNull();      // CLS
  });

  it("keeps an ordinary cash-session equity book", () => {
    expect(computeMid(18.13, 18.51, "EQUITY")).toBe(18.32); // SOFI
    expect(computeMid(307, 313.98, "EQUITY")).toBe(310.49); // LRCX
    expect(computeMid(99.61, 100.97, "INDEX")).toBe(100.29);
  });

  it("holds the width threshold exactly where it is documented", () => {
    expect(MAX_UNDERLYING_SPREAD_PCT).toBe(0.10);
    expect(computeMid(100, 110, "EQUITY")).toBe(105);      // exactly 10% wide
    expect(computeMid(100, 110.01, "EQUITY")).toBeNull();  // a hair past it
  });

  it("exempts options, where a wide book is normal", () => {
    expect(computeMid(0.1, 0.2, "OPTION")).toBe(0.15);   // 100% wide, real
    expect(computeMid(0.7, 0.95, "OPTION")).toBe(0.83);  // the CDE 9/11 call
    expect(computeMid(0, 0.05, "OPTION")).toBe(0.03);    // zero bid is quotable
  });

  it("rejects a crossed book for any instrument", () => {
    expect(computeMid(24.02, 23.98, "EQUITY")).toBeNull();
    expect(computeMid(0.2, 0.1, "OPTION")).toBeNull();
  });

  it("rejects a non-positive underlying bid rather than dividing by it", () => {
    expect(computeMid(0, 5, "EQUITY")).toBeNull();
    expect(computeMid(0, 0, "EQUITY")).toBeNull();
  });

  it("returns null for missing or unparseable sides", () => {
    expect(computeMid(null, 10, "EQUITY")).toBeNull();
    expect(computeMid(10, null, "EQUITY")).toBeNull();
    expect(computeMid(undefined, undefined, "OPTION")).toBeNull();
    expect(computeMid(NaN, 10, "EQUITY")).toBeNull();
  });
});
