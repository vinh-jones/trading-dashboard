import { describe, it, expect } from "vitest";
import { computeRSI, rsiBucket, RSI_BUCKET_LABELS, RSI_BUCKET_COLORS } from "../rsi.js";

describe("computeRSI", () => {
  it("returns null when there are fewer than period+1 closes", () => {
    expect(computeRSI([1, 2, 3], 14)).toBeNull();
    expect(computeRSI(Array.from({ length: 14 }, (_, i) => i), 14)).toBeNull(); // 14 closes, need 15
    expect(computeRSI(null)).toBeNull();
  });

  it("returns 100 for a monotonically rising series (no losses)", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(computeRSI(closes, 14)).toBe(100);
  });

  it("returns 0 for a monotonically falling series (no gains)", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(computeRSI(closes, 14)).toBe(0);
  });

  it("returns 100 for a flat series (no losses by convention)", () => {
    const closes = Array.from({ length: 30 }, () => 50);
    expect(computeRSI(closes, 14)).toBe(100);
  });

  it("matches a hand-verified Wilder calc (period 2)", () => {
    // closes [10,11,10,11], period 2:
    //   seed deltas +1,-1 → avgGain 0.5, avgLoss 0.5
    //   next delta +1     → avgGain (0.5+1)/2=0.75, avgLoss (0.5+0)/2=0.25
    //   RS=3 → RSI = 100 - 100/4 = 75
    expect(computeRSI([10, 11, 10, 11], 2)).toBe(75);
  });

  it("stays within [0,100] and ignores null gaps", () => {
    const closes = [10, null, 11, 9, 12, 8, 13, 7, 14, 6, 15, 5, 16, 4, 17, 3, 18];
    const rsi = computeRSI(closes, 14);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });
});

describe("rsiBucket", () => {
  it("buckets on the 30/70 thresholds", () => {
    expect(rsiBucket(null)).toBeNull();
    expect(rsiBucket(29.9)).toBe("oversold");
    expect(rsiBucket(30)).toBe("neutral");
    expect(rsiBucket(70)).toBe("neutral");
    expect(rsiBucket(70.1)).toBe("overbought");
  });

  it("has a label and color for every bucket", () => {
    for (const b of ["oversold", "neutral", "overbought"]) {
      expect(RSI_BUCKET_LABELS[b]).toBeTruthy();
      expect(RSI_BUCKET_COLORS[b]).toHaveProperty("bg");
      expect(RSI_BUCKET_COLORS[b]).toHaveProperty("text");
    }
  });
});
