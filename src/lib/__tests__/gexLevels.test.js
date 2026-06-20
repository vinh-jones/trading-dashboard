import { describe, it, expect } from "vitest";
import { computeGexLevels } from "../gexLevels";

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

  it("resistance = dominant positive-gamma bar above spot", () => {
    const r = computeGexLevels({
      rows: [
        { strike: 105, gamma: 4 },
        { strike: 115, gamma: 12 }, // biggest positive above → resistance
        { strike: 120, gamma: 7 },
      ],
      spot: 100,
    });
    expect(r.resistance).toBe(115);
  });

  it("support = dominant negative-gamma bar below spot", () => {
    const r = computeGexLevels({
      rows: [
        { strike: 95, gamma: -6 },
        { strike: 90, gamma: -14 }, // most negative below → support
        { strike: 85, gamma: -3 },
      ],
      spot: 100,
    });
    expect(r.support).toBe(90);
  });

  it("no positive bar above → resistance null; no negative bar below → support null", () => {
    const r = computeGexLevels({
      rows: [{ strike: 110, gamma: -5 }, { strike: 90, gamma: 8 }],
      spot: 100,
    });
    expect(r.resistance).toBeNull(); // only negative gamma above
    expect(r.support).toBeNull();    // only positive gamma below
  });
});
