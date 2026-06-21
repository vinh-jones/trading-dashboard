import { describe, it, expect } from "vitest";
import { computeGexLevels, describeStrikeVsGex } from "../gexLevels";

describe("computeGexLevels", () => {
  it("null-safe on empty rows", () => {
    const r = computeGexLevels({ rows: [], spot: 100 });
    expect(r).toEqual({ env: null, netGamma: null, gammaRatio: null, support: null, resistance: null, airPocket: null });
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

  it("support = dominant POSITIVE-gamma shelf below spot (defended floor)", () => {
    const r = computeGexLevels({
      rows: [
        { strike: 95, gamma: 6 },
        { strike: 90, gamma: 14 },  // biggest positive below → support shelf
        { strike: 85, gamma: 3 },
      ],
      spot: 100,
    });
    expect(r.support).toBe(90);
  });

  it("airPocket = dominant NEGATIVE-gamma bar below spot (acceleration)", () => {
    const r = computeGexLevels({
      rows: [
        { strike: 95, gamma: -6 },
        { strike: 88, gamma: -14 }, // most negative below → air pocket
        { strike: 92, gamma: 5 },   // a positive shelf also exists → support
      ],
      spot: 100,
    });
    expect(r.airPocket).toBe(88);
    expect(r.support).toBe(92);
  });

  it("support and air pocket coexist below spot and are distinct", () => {
    const r = computeGexLevels({
      rows: [{ strike: 96, gamma: 10 }, { strike: 90, gamma: -8 }],
      spot: 100,
    });
    expect(r.support).toBe(96);    // positive shelf
    expect(r.airPocket).toBe(90);  // negative pocket
  });

  it("no positive shelf below → support null; no negative pocket below → airPocket null", () => {
    const r = computeGexLevels({
      rows: [{ strike: 90, gamma: 8 }, { strike: 110, gamma: -5 }],
      spot: 100,
    });
    expect(r.support).toBe(90);       // positive shelf below
    expect(r.airPocket).toBeNull();   // no negative bar below
    expect(r.resistance).toBeNull();  // only negative gamma above
  });
});

describe("describeStrikeVsGex", () => {
  it("exposed when strike is at/below the air pocket (danger-first)", () => {
    const d = describeStrikeVsGex({ strike: 88, support: 95, airPocket: 90 });
    expect(d.tone).toBe("exposed");
    expect(d.level).toBe(90);
  });

  it("defended when strike is at/below the positive shelf and clear of the pocket", () => {
    const d = describeStrikeVsGex({ strike: 92, support: 95, airPocket: 85 });
    expect(d.tone).toBe("defended");
    expect(d.level).toBe(95);
  });

  it("neutral when strike sits above both walls", () => {
    const d = describeStrikeVsGex({ strike: 99, support: 95, airPocket: 90 });
    expect(d.tone).toBe("neutral");
  });

  it("null-safe", () => {
    expect(describeStrikeVsGex({ strike: null, support: 95, airPocket: 90 })).toBeNull();
    expect(describeStrikeVsGex({ strike: 92, support: null, airPocket: null }).tone).toBe("neutral");
  });
});
