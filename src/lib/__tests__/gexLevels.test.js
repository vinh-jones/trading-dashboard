import { describe, it, expect } from "vitest";
import { computeGexLevels, classifyStrikeVsSupport } from "../gexLevels";

describe("computeGexLevels", () => {
  it("null-safe on empty rows", () => {
    const r = computeGexLevels({ rows: [], spot: 100 });
    expect(r).toEqual({ env: null, netGamma: null, gammaRatio: null, support: null, resistance: null });
  });

  it("null-safe on missing spot", () => {
    const r = computeGexLevels({ rows: [{ strike: 100, gamma: 5 }], spot: null });
    expect(r.env).toBeNull();
  });

  it("net positive gamma → stabilized", () => {
    const r = computeGexLevels({
      rows: [{ strike: 90, gamma: 8 }, { strike: 110, gamma: 6 }, { strike: 100, gamma: -1 }],
      spot: 100,
    });
    expect(r.env).toBe("stabilized");
    expect(r.netGamma).toBe(13);
    expect(r.gammaRatio).toBeGreaterThan(0);
  });

  it("net negative gamma → choppy", () => {
    const r = computeGexLevels({
      rows: [{ strike: 90, gamma: -8 }, { strike: 110, gamma: -6 }, { strike: 100, gamma: 1 }],
      spot: 100,
    });
    expect(r.env).toBe("choppy");
  });

  it("balanced book inside the deadband → neutral", () => {
    const r = computeGexLevels({
      rows: [{ strike: 90, gamma: 5 }, { strike: 110, gamma: -5 }],
      spot: 100,
    });
    expect(r.env).toBe("neutral");
    expect(r.gammaRatio).toBe(0);
  });

  it("picks the dominant positive-gamma wall on each side of spot", () => {
    const r = computeGexLevels({
      rows: [
        { strike: 85, gamma: 3 },
        { strike: 95, gamma: 9 },   // biggest below → support
        { strike: 105, gamma: 4 },
        { strike: 115, gamma: 12 }, // biggest above → resistance
      ],
      spot: 100,
    });
    expect(r.support).toBe(95);
    expect(r.resistance).toBe(115);
  });

  it("ignores negative-gamma strikes when picking walls", () => {
    const r = computeGexLevels({
      rows: [{ strike: 95, gamma: -20 }, { strike: 92, gamma: 4 }, { strike: 108, gamma: -30 }],
      spot: 100,
    });
    expect(r.support).toBe(92);     // 95 is negative gamma, skipped
    expect(r.resistance).toBeNull(); // no positive-gamma strike above spot
  });
});

describe("classifyStrikeVsSupport", () => {
  it("strike at/below the wall is defended", () => {
    expect(classifyStrikeVsSupport(90, 95)).toBe("below_wall");
    expect(classifyStrikeVsSupport(95, 95)).toBe("below_wall");
  });
  it("strike above the wall is less protected", () => {
    expect(classifyStrikeVsSupport(98, 95)).toBe("above_wall");
  });
  it("null-safe", () => {
    expect(classifyStrikeVsSupport(90, null)).toBeNull();
    expect(classifyStrikeVsSupport(null, 95)).toBeNull();
  });
});
