// src/lib/__tests__/positionSchema.spreads.test.js
import { describe, it, expect } from "vitest";
import { getOpenSpreads } from "../positionSchema.js";
import { positionKey } from "../tags.js";

describe("getOpenSpreads", () => {
  it("returns the array, tolerating absence", () => {
    expect(getOpenSpreads({ open_spreads: [{ ticker: "XSP" }] })).toHaveLength(1);
    expect(getOpenSpreads({})).toEqual([]);
    expect(getOpenSpreads(null)).toEqual([]);
  });
});

describe("positionKey for a spread", () => {
  it("keys on ticker|Spread|short_strike|expiry", () => {
    const k = positionKey({ ticker: "XSP", type: "Spread", strike: 708, expiry_date: "2026-07-31" });
    expect(k).toBe("XSP|Spread|708|2026-07-31");
  });
});
