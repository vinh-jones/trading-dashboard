import { describe, it, expect } from "vitest";
import { computeCspBaseline } from "../lifespan.js";

// Pure-Option-B baseline: capital-day-weighted gross premium across all CSP
// holding periods. Realized losses are NOT in the rate — they're modeled
// deterministically at the consuming layer. See doc-block on computeCspBaseline.

const csp = (overrides = {}) => ({
  id: overrides.id ?? "t",
  subtype: "Close",
  premium_collected: 50,
  capital_fronted: 5000,
  days_held: 5,
  close_date: "2026-05-01",
  ...overrides,
});

describe("computeCspBaseline", () => {
  it("single closed CSP — rate = premium / (capital × days)", () => {
    const result = computeCspBaseline([
      csp({ premium_collected: 500, capital_fronted: 50000, days_held: 30 }),
    ]);
    // 500 / (50000 * 30) = 500 / 1,500,000 = 0.000333...
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0003333, 7);
    expect(result.sample_size).toBe(1);
  });

  it("assigned CSP contributes premium only (loss is NOT in the rate)", () => {
    // Even though this CSP assigned with a $2,000 cut loss in the consuming
    // model, its rate contribution here is just premium / cap-days.
    const result = computeCspBaseline([
      csp({ subtype: "Assigned", premium_collected: 300, capital_fronted: 50000, days_held: 30 }),
    ]);
    // 300 / 1,500,000 = 0.0002
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0002, 7);
    expect(result.sample_size).toBe(1);
  });

  it("Roll Loss with negative premium pulls rate down", () => {
    // closed: +$50 over 25,000 cap-days
    // roll loss: -$500 over 140,000 cap-days
    // weighted = (50 - 500) / (25,000 + 140,000) = -450 / 165,000 ≈ -0.002727
    const result = computeCspBaseline([
      csp({ id: "a", premium_collected: 50,   capital_fronted: 5000,  days_held: 5 }),
      csp({ id: "b", subtype: "Roll Loss", premium_collected: -500, capital_fronted: 20000, days_held: 7 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(-0.002727, 6);
    expect(result.sample_size).toBe(2);
  });

  it("load-bearing: divergent capital-days — capital-day-weighted, NOT mean of rates", () => {
    // Position A: $50 / ($5,000 × 5d) = 0.002/cap-day, 25,000 cap-days
    // Position B: $750 / ($50,000 × 30d) = 0.0005/cap-day, 1,500,000 cap-days
    //
    // Capital-day-weighted: (50 + 750) / (25,000 + 1,500,000) = 800 / 1,525,000 ≈ 0.000525
    // Mean-of-rates would give: (0.002 + 0.0005) / 2 = 0.00125 (~2.4× different)
    const result = computeCspBaseline([
      csp({ id: "a", premium_collected: 50,  capital_fronted: 5000,  days_held: 5  }),
      csp({ id: "b", premium_collected: 750, capital_fronted: 50000, days_held: 30 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.000525, 6);
    expect(result.sample_size).toBe(2);
  });

  it("mixed three subtypes aggregate as Σ premium / Σ cap-days", () => {
    // Close:     +$500   over 1,500,000 cap-days
    // Roll Loss: -$200   over   100,000 cap-days
    // Assigned:  +$300   over   500,000 cap-days  (loss not in rate)
    // Total: $600 / 2,100,000 ≈ 0.0002857
    const result = computeCspBaseline([
      csp({ id: "a", subtype: "Close",     premium_collected: 500, capital_fronted: 50000, days_held: 30 }),
      csp({ id: "b", subtype: "Roll Loss", premium_collected: -200, capital_fronted: 10000, days_held: 10 }),
      csp({ id: "c", subtype: "Assigned",  premium_collected: 300, capital_fronted: 25000, days_held: 20 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0002857, 6);
    expect(result.sample_size).toBe(3);
  });

  it("rows with capital ≤ 0 or days ≤ 0 are skipped", () => {
    const result = computeCspBaseline([
      csp({ id: "a", capital_fronted: 0,    days_held: 5 }),
      csp({ id: "b", capital_fronted: 5000, days_held: 0 }),
      csp({ id: "c", capital_fronted: -1,   days_held: 5 }),
    ]);
    expect(result.avg_return_per_capital_day).toBe(0);
    expect(result.sample_size).toBe(0);
  });

  it("empty array returns rate 0", () => {
    const result = computeCspBaseline([]);
    expect(result.avg_return_per_capital_day).toBe(0);
    expect(result.sample_size).toBe(0);
  });
});
