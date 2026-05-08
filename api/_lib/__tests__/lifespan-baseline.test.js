import { describe, it, expect } from "vitest";
import { computeCspBaseline } from "../lifespan.js";

// Helpers --------------------------------------------------------------------

const closedCsp = (overrides = {}) => ({
  id: overrides.id ?? "t-close",
  subtype: "Close",
  premium_collected: 50,
  capital_fronted: 5000,
  days_held: 5,
  close_date: "2026-05-01",
  strike: 50,
  contracts: 1,
  spot_at_assignment: null,
  ...overrides,
});

const rollLoss = (overrides = {}) => ({
  ...closedCsp({ id: "t-roll", subtype: "Roll Loss", premium_collected: -500, capital_fronted: 20000, days_held: 7 }),
  ...overrides,
});

const assigned = (overrides = {}) => ({
  ...closedCsp({
    id: "t-assigned",
    subtype: "Assigned",
    premium_collected: 300,
    capital_fronted: 50000,
    days_held: 30,
    strike: 50,
    contracts: 10,
    spot_at_assignment: 48,
  }),
  ...overrides,
});

// Tests ----------------------------------------------------------------------

describe("computeCspBaseline", () => {
  it("Test 1: single closed CSP — rate = premium / (capital × days)", () => {
    const result = computeCspBaseline([
      closedCsp({ premium_collected: 500, capital_fronted: 50000, days_held: 30 }),
    ]);
    // 500 / (50000 * 30) = 500 / 1,500,000 = 0.000333...
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0003333, 7);
    expect(result.sample_size).toBe(1);
    expect(result.dropped_assigned_no_spot).toBe(0);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 2: single assigned CSP with realized loss", () => {
    // strike $50, spot $48, 10 contracts → realizedLoss = (50-48) * 10 * 100 = 2000
    // premium $300, capital $50,000, 30 days
    // pnl = 300 - 2000 = -1700
    // rate = -1700 / 1,500,000 = -0.001133...
    const result = computeCspBaseline([
      assigned({ premium_collected: 300, capital_fronted: 50000, days_held: 30, strike: 50, spot_at_assignment: 48, contracts: 10 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(-0.0011333, 7);
    expect(result.sample_size).toBe(1);
    expect(result.dropped_assigned_no_spot).toBe(0);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 3: assigned CSP with spot equal to strike degenerates to premium-only", () => {
    const result = computeCspBaseline([
      assigned({ premium_collected: 300, capital_fronted: 50000, days_held: 30, strike: 50, spot_at_assignment: 50, contracts: 10 }),
    ]);
    // realizedLoss = 0, pnl = 300, rate = 300 / 1,500,000 = 0.0002
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0002, 7);
    expect(result.sample_size).toBe(1);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 4 (load-bearing): divergent mixed sample — capital-day-weighted, NOT mean of rates", () => {
    // Position A: $50 / ($5,000 × 5d) = 0.002/cap-day, 25,000 cap-days
    // Position B: $750 / ($50,000 × 30d) = 0.0005/cap-day, 1,500,000 cap-days
    //
    // Capital-day-weighted: (50 + 750) / (25,000 + 1,500,000) = 800 / 1,525,000 ≈ 0.000525
    // Mean-of-rates would give: (0.002 + 0.0005) / 2 = 0.00125 (~2.4× different)
    //
    // We assert the capital-day-weighted answer; the test fails under the old aggregation.
    const result = computeCspBaseline([
      closedCsp({ id: "a", premium_collected: 50,  capital_fronted: 5000,  days_held: 5  }),
      closedCsp({ id: "b", premium_collected: 750, capital_fronted: 50000, days_held: 30 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.000525, 6);
    expect(result.sample_size).toBe(2);
  });

  it("Test 5: Roll Loss with negative premium pulls rate down", () => {
    // closed: +$50 over 25,000 cap-days
    // roll loss: -$500 over 140,000 cap-days
    // weighted = (-450) / 165,000 ≈ -0.002727
    const result = computeCspBaseline([
      closedCsp({ id: "a", premium_collected: 50,   capital_fronted: 5000,  days_held: 5 }),
      rollLoss({  id: "b", premium_collected: -500, capital_fronted: 20000, days_held: 7 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(-0.002727, 6);
    expect(result.sample_size).toBe(2);
  });

  it("Test 6: assigned CSP with NULL spot_at_assignment is dropped", () => {
    const result = computeCspBaseline([
      closedCsp({ id: "a", premium_collected: 50, capital_fronted: 5000, days_held: 5 }),
      assigned({  id: "b", spot_at_assignment: null }),
    ]);
    // Only the closed CSP counts: 50 / 25,000 = 0.002
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.002, 6);
    expect(result.sample_size).toBe(1);
    expect(result.dropped_assigned_no_spot).toBe(1);
  });

  it("Test 7: rows with capital ≤ 0 or days ≤ 0 are skipped", () => {
    const result = computeCspBaseline([
      closedCsp({ id: "a", capital_fronted: 0,  days_held: 5 }),
      closedCsp({ id: "b", capital_fronted: 5000, days_held: 0 }),
      closedCsp({ id: "c", capital_fronted: -1, days_held: 5 }),
    ]);
    expect(result.avg_return_per_capital_day).toBe(0);
    expect(result.sample_size).toBe(0);
  });

  it("Test 8: empty array returns rate 0", () => {
    const result = computeCspBaseline([]);
    expect(result.avg_return_per_capital_day).toBe(0);
    expect(result.sample_size).toBe(0);
    expect(result.dropped_assigned_no_spot).toBe(0);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 9: assigned CSP with spot > strike sets data_integrity_flag", () => {
    // strike $50, spot $52 → realizedLoss = (50-52)*10*100 = -2000 (negative)
    // pnl = 300 - (-2000) = 2300; included with flag.
    const result = computeCspBaseline([
      assigned({ premium_collected: 300, capital_fronted: 50000, days_held: 30, strike: 50, spot_at_assignment: 52, contracts: 10 }),
    ]);
    expect(result.data_integrity_flag).toBe(1);
    expect(result.sample_size).toBe(1);
    // 2300 / 1,500,000 ≈ 0.001533
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.001533, 6);
  });
});
