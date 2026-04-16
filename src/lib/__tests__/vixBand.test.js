import { describe, it, expect } from "vitest";
import { getVixBand } from "../vixBand";

describe("getVixBand", () => {
  it("returns null when VIX is missing", () => {
    expect(getVixBand(null)).toBeNull();
    expect(getVixBand(undefined)).toBeNull();
  });

  it("returns ≤12 band for very low VIX", () => {
    expect(getVixBand(10)).toEqual({ label: "≤12",   sentiment: "Extreme Greed", floorPct: 0.40, ceilingPct: 0.50 });
    expect(getVixBand(12)).toEqual({ label: "≤12",   sentiment: "Extreme Greed", floorPct: 0.40, ceilingPct: 0.50 });
  });

  it("returns 12–15 band", () => {
    expect(getVixBand(13)).toEqual({ label: "12–15", sentiment: "Greed",         floorPct: 0.30, ceilingPct: 0.40 });
    expect(getVixBand(15)).toEqual({ label: "12–15", sentiment: "Greed",         floorPct: 0.30, ceilingPct: 0.40 });
  });

  it("returns 15–20 band", () => {
    expect(getVixBand(18)).toEqual({ label: "15–20", sentiment: "Slight Fear",   floorPct: 0.20, ceilingPct: 0.25 });
  });

  it("returns 20–25 band", () => {
    expect(getVixBand(22)).toEqual({ label: "20–25", sentiment: "Fear",          floorPct: 0.10, ceilingPct: 0.15 });
  });

  it("returns 25–30 band", () => {
    expect(getVixBand(28)).toEqual({ label: "25–30", sentiment: "Very Fearful",  floorPct: 0.05, ceilingPct: 0.10 });
  });

  it("returns ≥30 band for high VIX", () => {
    expect(getVixBand(35)).toEqual({ label: "≥30",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 });
    expect(getVixBand(80)).toEqual({ label: "≥30",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 });
  });
});
