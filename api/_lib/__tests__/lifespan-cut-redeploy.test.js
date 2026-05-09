import { describe, it, expect } from "vitest";
import { buildLifespan } from "../lifespan.js";

// Tests for the cut-and-redeploy benchmark in buildLifespan, specifically the
// multi-assignment generalization (interpretation B). For single-assignment
// lifespans, the formula reduces to the prior single-assignment math.

const baseline = (rate = 0.00245) => ({
  avg_return_per_capital_day: rate,
  sample_size: 50,
});

const event = (overrides = {}) => ({
  date:                   "2026-02-13",
  triggering_csp_id:      "csp-1",
  strike:                 100,
  csp_premium_collected:  500,
  shares_added:           100,
  capital_added:          10000,
  spot_at_assignment:     90,
  ...overrides,
});

const lifespan = (overrides = {}) => ({
  ticker:               "TEST",
  assignment_events:    [event()],
  cc_history:           [],
  partial_dispositions: [],
  exit_event: {
    date: "2026-04-20",
    exit_type: "called_away",
    exit_price: 100,
    shares_disposed: 100,
    share_disposal_pnl: 0,
    triggering_decision_id: null,
  },
  ...overrides,
});

describe("buildLifespan cut-and-redeploy benchmark", () => {
  it("Test 1: single-assignment with spot — matches prior single-assignment math", () => {
    // 100 shares × $100 strike = $10,000 capital; spot $90 → freed $9,000, loss $1,000
    // Premium $500. Lifespan Feb 13 → Apr 20 = 66 days at rate 0.00245
    // estCspPnl = 9000 × 66 × 0.00245 = $1,455.30
    // netOutcome = 500 (premium) - 1000 (loss) + 1455.30 = $955.30
    const result = buildLifespan(lifespan(), baseline(0.00245), "2026-04-20");
    const cr = result.benchmarks.cut_and_redeploy_baseline;
    expect(cr.requires_spot_at_each_assignment).toBe(true);
    expect(cr.assignment_count).toBe(1);
    expect(cr.total_capital_to_redeploy).toBe(9000);
    expect(cr.total_realized_losses).toBe(1000);
    expect(cr.estimated_csp_pnl_over_lifespan).toBeCloseTo(1455.30, 1);
    expect(cr.net_outcome_if_cut_and_redeploy).toBeCloseTo(955.30, 1);
    expect(cr.assignment_breakdown).toHaveLength(1);
    expect(cr.assignment_breakdown[0].date).toBe("2026-02-13");
    expect(cr.assignment_breakdown[0].capital_freed).toBe(9000);
    expect(cr.assignment_breakdown[0].realized_loss).toBe(1000);
    expect(cr.assignment_breakdown[0].days_remaining).toBe(66);
  });

  it("Test 2: single-assignment without spot — null fields, data_missing verdict", () => {
    const result = buildLifespan(
      lifespan({ assignment_events: [event({ spot_at_assignment: null })] }),
      baseline(),
      "2026-04-20"
    );
    const cr = result.benchmarks.cut_and_redeploy_baseline;
    expect(cr.requires_spot_at_each_assignment).toBe(true);
    expect(cr.assignment_count).toBe(1);
    expect(cr.total_capital_to_redeploy).toBeNull();
    expect(cr.total_realized_losses).toBeNull();
    expect(cr.estimated_csp_pnl_over_lifespan).toBeNull();
    expect(cr.net_outcome_if_cut_and_redeploy).toBeNull();
    expect(cr.vs_actual_pnl).toBeNull();
    expect(cr.verdict).toBe("data_missing");
    expect(cr.assignment_breakdown).toEqual([]);
  });

  it("Test 3 (load-bearing): CRDO-shaped multi-assignment with both spots", () => {
    // Mirrors CRDO: Feb 13 (400 sh @ $135, spot $121.44, premium $2604)
    //               Feb 20 (200 sh @ $135, spot $124.06, premium $1892)
    // Exit: Apr 20 (66 days from Feb 13, 59 from Feb 20)
    // At rate 0.00245:
    //   Cut 1: freed $48,576, loss $5,424, est = 48576 × 66 × 0.00245 = $7,854.74
    //   Cut 2: freed $24,812, loss $2,188, est = 24812 × 59 × 0.00245 = $3,586.57
    //   Totals: freed $73,388, losses $7,612, est $11,441.31
    //   netOutcome = (2604 + 1892) - 7612 + 11441.31 = $8,325.31
    const result = buildLifespan(
      lifespan({
        assignment_events: [
          event({
            date: "2026-02-13", triggering_csp_id: "csp-1",
            strike: 135, csp_premium_collected: 2604,
            shares_added: 400, capital_added: 54000, spot_at_assignment: 121.44,
          }),
          event({
            date: "2026-02-20", triggering_csp_id: "csp-2",
            strike: 135, csp_premium_collected: 1892,
            shares_added: 200, capital_added: 27000, spot_at_assignment: 124.06,
          }),
        ],
        exit_event: {
          date: "2026-04-20", exit_type: "manual_sale", exit_price: 168,
          shares_disposed: 600, share_disposal_pnl: 19950,
          triggering_decision_id: null,
        },
      }),
      baseline(0.00245),
      "2026-04-20"
    );
    const cr = result.benchmarks.cut_and_redeploy_baseline;
    expect(cr.assignment_count).toBe(2);
    expect(cr.total_capital_to_redeploy).toBe(73388);
    expect(cr.total_realized_losses).toBe(7612);
    expect(cr.estimated_csp_pnl_over_lifespan).toBeCloseTo(11441.31, 1);
    expect(cr.net_outcome_if_cut_and_redeploy).toBeCloseTo(8325.31, 1);
    expect(cr.assignment_breakdown).toHaveLength(2);
    expect(cr.assignment_breakdown[0].days_remaining).toBe(66);
    expect(cr.assignment_breakdown[1].days_remaining).toBe(59);
    expect(cr.assignment_breakdown[0].est_csp_pnl).toBeCloseTo(7854.74, 1);
    expect(cr.assignment_breakdown[1].est_csp_pnl).toBeCloseTo(3586.57, 1);
  });

  it("Test 4: multi-assignment with one missing spot — entire benchmark blocked", () => {
    const result = buildLifespan(
      lifespan({
        assignment_events: [
          event({ date: "2026-02-13", spot_at_assignment: 90 }),
          event({ date: "2026-02-20", spot_at_assignment: null }),
        ],
      }),
      baseline(),
      "2026-04-20"
    );
    const cr = result.benchmarks.cut_and_redeploy_baseline;
    expect(cr.assignment_count).toBe(2);
    expect(cr.total_capital_to_redeploy).toBeNull();
    expect(cr.total_realized_losses).toBeNull();
    expect(cr.estimated_csp_pnl_over_lifespan).toBeNull();
    expect(cr.verdict).toBe("data_missing");
  });

  it("Test 5: baseline rate of 0 — losses still computed, est_csp_pnl is 0", () => {
    const result = buildLifespan(
      lifespan({
        assignment_events: [
          event({ date: "2026-02-13", spot_at_assignment: 90 }),
          event({ date: "2026-02-20", spot_at_assignment: 85 }),
        ],
      }),
      baseline(0),
      "2026-04-20"
    );
    const cr = result.benchmarks.cut_and_redeploy_baseline;
    expect(cr.estimated_csp_pnl_over_lifespan).toBe(0);
    expect(cr.assignment_breakdown[0].est_csp_pnl).toBe(0);
    expect(cr.assignment_breakdown[1].est_csp_pnl).toBe(0);
    // Losses are still real:
    expect(cr.total_realized_losses).toBe(1000 + 1500); // (100-90)*100 + (100-85)*100
  });

  it("Test 6: active lifespan (no exit) — uses today as effective_end", () => {
    const result = buildLifespan(
      {
        ticker: "TEST",
        assignment_events: [
          event({ date: "2026-02-13", spot_at_assignment: 90 }),
          event({ date: "2026-02-20", spot_at_assignment: 85 }),
        ],
        cc_history: [],
        partial_dispositions: [],
        exit_event: null,
      },
      baseline(0.00245),
      "2026-05-08"
    );
    const cr = result.benchmarks.cut_and_redeploy_baseline;
    // Feb 13 → May 8 = 84 days, Feb 20 → May 8 = 77 days
    expect(cr.assignment_breakdown[0].days_remaining).toBe(84);
    expect(cr.assignment_breakdown[1].days_remaining).toBe(77);
    // vs_actual_pnl is null because total_lifespan_pnl is null for active lifespans
    expect(cr.vs_actual_pnl).toBeNull();
    expect(cr.verdict).toBe("active");
  });
});
