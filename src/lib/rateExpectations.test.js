import { describe, it, expect } from "vitest";
import { formatRateMoves } from "./rateExpectations";

describe("formatRateMoves", () => {
  it("formats priced-in cuts (positive) with the 'cuts' label", () => {
    expect(formatRateMoves(1.5)).toBe("1.5 cuts");
  });

  it("formats priced-in hikes (negative) as hikes — not negative cuts", () => {
    // Regression: when the curve prices hikes the card used to render "-1.1 cuts".
    expect(formatRateMoves(-1.12)).toBe("1.1 hikes");
  });

  it("treats a near-zero curve as flat", () => {
    expect(formatRateMoves(-0.04)).toBe("≈ flat");
    expect(formatRateMoves(0)).toBe("≈ flat");
  });

  it("returns null when there is no data", () => {
    expect(formatRateMoves(null)).toBe(null);
    expect(formatRateMoves(undefined)).toBe(null);
  });
});
