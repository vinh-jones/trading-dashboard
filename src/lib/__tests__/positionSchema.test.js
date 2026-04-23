import { describe, it, expect } from "vitest";
import {
  getOpenCSPs,
  getAssignedShares,
  getOpenCCs,
  getOpenLEAPs,
  getOpenShorts,
  getShareLots,
  getTotalShareCount,
  getTotalFronted,
  getCostBasisPerShare,
} from "../positionSchema.js";

const fixture = {
  open_csps: [
    { ticker: "AAPL", strike: 180, premium_collected: 100 },
    { ticker: "SOFI", strike: 24,  premium_collected: 50 },
  ],
  open_leaps: [
    { ticker: "NVDA", strike: 100 },
  ],
  assigned_shares: [
    {
      ticker: "F",
      positions: [
        { description: "(100, $11.00)", fronted: 1100 },
        { description: "(200, $10.00)", fronted: 2000 },
      ],
      active_cc: { strike: 12, premium_collected: 200, contracts: 3 },
      open_leaps: [
        { strike: 8 },                                // inherits ticker
        { ticker: "F", strike: 9 },                   // already has ticker
      ],
    },
    {
      ticker: "HOOD",
      positions: [{ description: "(100, $50.00)", fronted: 5000 }],
      active_cc: null,
      open_leaps: [],
    },
  ],
};

describe("getOpenCSPs", () => {
  it("returns the top-level CSP array", () => {
    expect(getOpenCSPs(fixture)).toHaveLength(2);
  });
  it("returns [] for missing key", () => {
    expect(getOpenCSPs({})).toEqual([]);
    expect(getOpenCSPs(null)).toEqual([]);
  });
});

describe("getOpenCCs", () => {
  it("injects parent ticker onto each active CC", () => {
    const ccs = getOpenCCs(fixture);
    expect(ccs).toHaveLength(1);
    expect(ccs[0].ticker).toBe("F");
    expect(ccs[0].strike).toBe(12);
  });
  it("skips share blocks without active_cc", () => {
    expect(getOpenCCs(fixture).map(c => c.ticker)).not.toContain("HOOD");
  });
});

describe("getOpenLEAPs", () => {
  it("merges top-level and nested LEAPs", () => {
    const leaps = getOpenLEAPs(fixture);
    expect(leaps).toHaveLength(3);
  });
  it("nested LEAPs inherit parent share block's ticker when missing", () => {
    const leaps = getOpenLEAPs(fixture);
    expect(leaps.every(l => l.ticker)).toBe(true);
    const fLeaps = leaps.filter(l => l.ticker === "F");
    expect(fLeaps).toHaveLength(2);
  });
});

describe("getOpenShorts", () => {
  it("combines CSPs and active CCs", () => {
    expect(getOpenShorts(fixture)).toHaveLength(3);
  });
});

describe("assigned-share helpers", () => {
  const share = fixture.assigned_shares[0];

  it("getShareLots returns the lot array", () => {
    expect(getShareLots(share)).toHaveLength(2);
  });

  it("getTotalShareCount parses share counts across lots", () => {
    expect(getTotalShareCount(share)).toBe(300);
  });

  it("getTotalFronted sums lot fronted amounts", () => {
    expect(getTotalFronted(share)).toBe(3100);
  });

  it("getCostBasisPerShare averages fronted across shares", () => {
    expect(getCostBasisPerShare(share)).toBeCloseTo(3100 / 300, 6);
  });

  it("getCostBasisPerShare returns null when no shares", () => {
    expect(getCostBasisPerShare({ positions: [] })).toBeNull();
  });
});
