import { describe, it, expect } from "vitest";
import { getVixBand, getVxnBand } from "../vixBand";

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

  it("returns 15–18 band (narrowed Slight Fear)", () => {
    expect(getVixBand(16)).toEqual({ label: "15–18", sentiment: "Slight Fear",   floorPct: 0.20, ceilingPct: 0.25 });
    expect(getVixBand(18)).toEqual({ label: "15–18", sentiment: "Slight Fear",   floorPct: 0.20, ceilingPct: 0.25 });
  });

  it("returns 18–20 transition band", () => {
    expect(getVixBand(19)).toEqual({ label: "18–20", sentiment: "Transition",    floorPct: 0.15, ceilingPct: 0.20 });
    expect(getVixBand(20)).toEqual({ label: "18–20", sentiment: "Transition",    floorPct: 0.15, ceilingPct: 0.20 });
  });

  it("returns 20–25 band (Fear starts at 20)", () => {
    expect(getVixBand(20.67)).toEqual({ label: "20–25", sentiment: "Fear",       floorPct: 0.10, ceilingPct: 0.15 });
    expect(getVixBand(23)).toEqual({ label: "20–25", sentiment: "Fear",          floorPct: 0.10, ceilingPct: 0.15 });
    expect(getVixBand(25)).toEqual({ label: "20–25", sentiment: "Fear",          floorPct: 0.10, ceilingPct: 0.15 });
  });

  it("returns 25–30 band", () => {
    expect(getVixBand(28)).toEqual({ label: "25–30", sentiment: "Very Fearful",  floorPct: 0.05, ceilingPct: 0.10 });
  });

  it("returns ≥30 band for high VIX", () => {
    expect(getVixBand(35)).toEqual({ label: "≥30",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 });
    expect(getVixBand(80)).toEqual({ label: "≥30",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 });
  });
});

describe("getVxnBand", () => {
  it("returns null when VXN is missing", () => {
    expect(getVxnBand(null)).toBeNull();
    expect(getVxnBand(undefined)).toBeNull();
  });

  it("returns Complacency below 15", () => {
    expect(getVxnBand(12)).toEqual({ label: "<15",   sentiment: "Complacency",  floorPct: 0.40, ceilingPct: 0.50 });
    expect(getVxnBand(14.99)).toEqual({ label: "<15", sentiment: "Complacency", floorPct: 0.40, ceilingPct: 0.50 });
  });

  it("returns Grind Zone for 15–19", () => {
    expect(getVxnBand(15)).toEqual({ label: "15–19", sentiment: "Grind Zone",   floorPct: 0.30, ceilingPct: 0.40 });
    expect(getVxnBand(18.99)).toEqual({ label: "15–19", sentiment: "Grind Zone", floorPct: 0.30, ceilingPct: 0.40 });
  });

  it("returns Slight Fear for 19–25", () => {
    expect(getVxnBand(19)).toEqual({ label: "19–25", sentiment: "Slight Fear",  floorPct: 0.20, ceilingPct: 0.30 });
    expect(getVxnBand(24.77)).toEqual({ label: "19–25", sentiment: "Slight Fear", floorPct: 0.20, ceilingPct: 0.30 });
  });

  it("returns Fear for 25–30", () => {
    expect(getVxnBand(25)).toEqual({ label: "25–30", sentiment: "Fear",         floorPct: 0.10, ceilingPct: 0.20 });
    expect(getVxnBand(29.99)).toEqual({ label: "25–30", sentiment: "Fear",      floorPct: 0.10, ceilingPct: 0.20 });
  });

  it("returns Very Fearful for 30–35", () => {
    expect(getVxnBand(30)).toEqual({ label: "30–35", sentiment: "Very Fearful", floorPct: 0.05, ceilingPct: 0.10 });
    expect(getVxnBand(35)).toEqual({ label: "30–35", sentiment: "Very Fearful", floorPct: 0.05, ceilingPct: 0.10 });
  });

  it("returns Extreme Fear above 35", () => {
    expect(getVxnBand(35.01)).toEqual({ label: ">35", sentiment: "Extreme Fear", floorPct: 0.00, ceilingPct: 0.05 });
    expect(getVxnBand(60)).toEqual({ label: ">35",   sentiment: "Extreme Fear",  floorPct: 0.00, ceilingPct: 0.05 });
  });

  // Boundaries land the opposite way from getVixBand — Ryan's published chart
  // reads "VXN < 15" / "15–19", so 15 is Grind Zone. Locking that in so a later
  // "consistency" cleanup can't silently re-map his table.
  it("is lower-inclusive at boundaries, unlike getVixBand", () => {
    expect(getVxnBand(15).sentiment).toBe("Grind Zone");
    expect(getVxnBand(25).sentiment).toBe("Fear");
    expect(getVixBand(15).sentiment).toBe("Greed");        // upper-inclusive
    expect(getVixBand(25).sentiment).toBe("Fear");
  });

  // Regression guard for the observed regime: VXN ran ~10pts over VIX through
  // July 2026, which puts the two frameworks in different zones on most days.
  it("disagrees with the VIX band at the July 2026 spread", () => {
    expect(getVixBand(16.5).sentiment).toBe("Slight Fear");  // 20–25% cash
    expect(getVxnBand(25.48).sentiment).toBe("Fear");        // 10–20% cash
  });
});
