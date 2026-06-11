import { describe, it, expect } from "vitest";
import { computeHoldYield } from "../holdYield.js";

// Base green CSP. profit_pct is driven by optionMid:
//   glPct = (premiumCollected - optionMid*100*contracts) / premiumCollected
// With premiumCollected=1000, contracts=1: optionMid = (1 - profit_pct) * 10.
// days_held = open→today; here 2026-05-25 → 2026-06-04 = 10. original_dte = 10 + 20 = 30.
function inp(extra = {}) {
  return {
    premiumCollected: 1000,   // GROSS premium at open
    optionMid: 8.0,           // → profit_pct 0.2, premium_remaining 800
    contracts: 1,
    capitalFronted: 10000,
    daysToExpiry: 20,
    openDate: "2026-05-25",
    today: "2026-06-04",
    cushionState: "safe",
    benchmark: 0.3,
    ...extra,
  };
}

describe("computeHoldYield — core math", () => {
  it("computes forward_yield_ann, ratio, dte fraction and gate", () => {
    const r = computeHoldYield(inp());
    // premium_remaining 800 → (800/10000)/20*365 = 1.46
    expect(r.forward_yield_ann).toBeCloseTo(1.46, 2);
    expect(r.ratio).toBeCloseTo(1.46 / 0.3, 2);
    expect(r.dte_fraction_remaining).toBeCloseTo(20 / 30, 4);
    expect(r.gate_passed).toBe(true);
    expect(r.capital).toBe(10000);
    expect(r.avg_csp_entry_yield_ann).toBe(0.3);
  });

  it("reports realized_yield_ann as context (premium_captured over days held)", () => {
    const r = computeHoldYield(inp());
    // premium_captured 200 → (200/10000)/10*365 = 0.73
    expect(r.realized_yield_ann).toBeCloseTo(0.73, 2);
  });
});

describe("computeHoldYield — state bands (gated in)", () => {
  it("fairly_paid when forward ≥ benchmark", () => {
    const r = computeHoldYield(inp({ benchmark: 0.3 })); // ratio ~4.9
    expect(r.hold_yield_state).toBe("fairly_paid");
    expect(r.priority).toBe("none");
  });

  it("below_average when ratio in [0.5, 1.0)", () => {
    const r = computeHoldYield(inp({ benchmark: 2.0 })); // ratio 0.73
    expect(r.hold_yield_state).toBe("below_average");
    expect(r.priority).toBe("none");
  });

  it("underpaid_to_hold + HIGH when ratio < 0.5 AND near the strike", () => {
    const r = computeHoldYield(inp({ benchmark: 4.0, cushionState: "assignment_risk" })); // ratio 0.365
    expect(r.hold_yield_state).toBe("underpaid_to_hold");
    expect(r.priority).toBe("HIGH");
  });

  it("underpaid_to_hold + HIGH also when cushion is 'approaching'", () => {
    const r = computeHoldYield(inp({ benchmark: 4.0, cushionState: "approaching" }));
    expect(r.priority).toBe("HIGH");
  });

  it("underpaid_to_hold + LOW when underpaid but safe (miles OTM)", () => {
    const r = computeHoldYield(inp({ benchmark: 4.0, cushionState: "safe" }));
    expect(r.hold_yield_state).toBe("underpaid_to_hold");
    expect(r.priority).toBe("LOW");
  });
});

describe("computeHoldYield — DTE gate", () => {
  it("late_cycle_let_ride when days_remaining below the absolute floor (7)", () => {
    const r = computeHoldYield(inp({ daysToExpiry: 5, benchmark: 4.0, cushionState: "assignment_risk" }));
    expect(r.gate_passed).toBe(false);
    expect(r.hold_yield_state).toBe("late_cycle_let_ride");
    expect(r.priority).toBe("none"); // no shed signal regardless of ratio
  });

  it("late_cycle_let_ride when fractional DTE below 0.33 even if abs floor met", () => {
    // days_remaining 7 (>=7), days_held 20 → original 27, 7/27 = 0.259 < 0.33
    const r = computeHoldYield(inp({ daysToExpiry: 7, openDate: "2026-05-15", benchmark: 4.0 }));
    expect(r.gate_passed).toBe(false);
    expect(r.hold_yield_state).toBe("late_cycle_let_ride");
  });
});

describe("computeHoldYield — terminal & skip states", () => {
  it("skips underwater positions", () => {
    const r = computeHoldYield(inp({ optionMid: 11.0 })); // buyback 1100 > 1000 → profit_pct < 0
    expect(r.skipped).toBe("underwater");
  });

  it("skips when the current option mark is missing", () => {
    const r = computeHoldYield(inp({ optionMid: null }));
    expect(r.skipped).toBe("missing_mid");
  });

  it("fully_captured when profit_pct ≥ 1 (nothing left at stake)", () => {
    const r = computeHoldYield(inp({ optionMid: 0 })); // glPct 100% → profit_pct 1.0
    expect(r.hold_yield_state).toBe("fully_captured");
    expect(r.forward_yield_ann).toBe(0);
    expect(r.priority).toBe("none");
  });

  it("no_benchmark when benchmark is null — never fabricated", () => {
    const r = computeHoldYield(inp({ benchmark: null }));
    expect(r.hold_yield_state).toBe("no_benchmark");
    expect(r.ratio).toBeNull();
    expect(r.priority).toBe("none");
  });

  it("opened today: realized_yield_ann null, forward + state still computed", () => {
    const r = computeHoldYield(inp({ openDate: "2026-06-04", benchmark: 0.3 }));
    expect(r.realized_yield_ann).toBeNull();
    expect(r.forward_yield_ann).toBeCloseTo(1.46, 2);
    expect(r.hold_yield_state).toBe("fairly_paid");
  });
});
