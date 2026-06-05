import { describe, it, expect } from "vitest";
import { AI_BASKETS, ALL_BASKET_TICKERS } from "../aiBaskets.js";

// Contract: the approved wheel universe (wheel_universe.list_type = 'approved')
// as of migration-024 (2026-06). When Ryan changes the approved list, update the
// DB migration, this list, AND aiBaskets.js together. This guard fails CI if the
// basket config drifts from the universe so a new name can't silently vanish from
// the exposure math.
const APPROVED_UNIVERSE = [
  "AA", "AAPL", "ADI", "AMAT", "AMD", "AMZN", "ANET", "APH", "APP", "AVGO",
  "AXP", "CAT", "CCJ", "CCL", "CDE", "CEG", "CLS", "COHR", "CRDO", "CSCO",
  "DELL", "DRAM", "EQT", "ETHA", "FCX", "FTNT", "FUTU", "GE", "GLW", "GOOGL",
  "HL", "HOOD", "IBIT", "INOD", "INTC", "IREN", "JPM", "KTOS", "LRCX", "META",
  "MSFT", "MU", "NBIS", "NEM", "NVDA", "PLTR", "RTX", "SHOP", "SMH", "SOFI",
  "STX", "TSLA", "TSM", "VRT", "WDC",
];

describe("AI_BASKETS config", () => {
  it("assigns every approved ticker to exactly one basket", () => {
    expect([...ALL_BASKET_TICKERS].sort()).toEqual([...APPROVED_UNIVERSE].sort());
  });

  it("has no ticker in more than one basket", () => {
    const seen = new Set();
    const dupes = [];
    for (const t of ALL_BASKET_TICKERS) {
      if (seen.has(t)) dupes.push(t);
      seen.add(t);
    }
    expect(dupes).toEqual([]);
  });

  it("gives every basket a unique id, a name, ≥1 ticker, and a valid display", () => {
    const ids = new Set();
    for (const b of AI_BASKETS) {
      expect(b.id).toBeTruthy();
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
      expect(b.name).toBeTruthy();
      expect(b.tickers.length).toBeGreaterThan(0);
      expect(["on-thesis", "summary-only"]).toContain(b.display);
    }
  });

  it("renders exactly 10 on-thesis detail cards", () => {
    expect(AI_BASKETS.filter(b => b.display === "on-thesis")).toHaveLength(10);
  });
});
