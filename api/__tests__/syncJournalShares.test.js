import { describe, it, expect } from "vitest";
import { isSyntheticShareAcquisition } from "../sync.js";

// Share ACQUISITIONS (direct buys) are written to the trades table with
// close_date = open_date so they surface in the lifespan UI. They are not
// closes. The assigned_shares lots loop already journals them as
// "Shares — Opened", so the trades→journal loop must skip them — otherwise every
// bought/assigned lot also gets a misleading "Shares $X — Closed MM/DD" card.
// Genuine share SALES (subtype 'Sold') are real closes and keep their card.

describe("isSyntheticShareAcquisition", () => {
  it("flags a direct-buy / assigned share acquisition row", () => {
    expect(isSyntheticShareAcquisition({ type: "Shares", subtype: "Assigned" })).toBe(true);
  });

  it("does NOT flag a genuine share sale", () => {
    expect(isSyntheticShareAcquisition({ type: "Shares", subtype: "Sold" })).toBe(false);
  });

  it("does NOT flag option trades", () => {
    expect(isSyntheticShareAcquisition({ type: "CSP", subtype: "Assigned" })).toBe(false);
    expect(isSyntheticShareAcquisition({ type: "CC", subtype: "Close" })).toBe(false);
  });
});
