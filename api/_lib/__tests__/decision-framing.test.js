import { describe, it, expect } from "vitest";
import {
  computeDecisionFraming,
  classifyDrawdown,
  classifyBreakeven,
  getRecentCcStrike,
  addCalendarDays,
  subtractCalendarDays,
  humanizeDuration,
  computeTrailingCcRate,
} from "../lifespan.js";

// ---------------------------------------------------------------------------
// Helper tests
// ---------------------------------------------------------------------------

describe("classifyDrawdown", () => {
  it("boundary values", () => {
    expect(classifyDrawdown(0)).toBe("shallow");
    expect(classifyDrawdown(-0.15)).toBe("shallow");
    expect(classifyDrawdown(-0.1500001)).toBe("moderate");
    expect(classifyDrawdown(-0.30)).toBe("moderate");
    expect(classifyDrawdown(-0.3000001)).toBe("deep");
    expect(classifyDrawdown(-0.45)).toBe("deep");
    expect(classifyDrawdown(-0.4500001)).toBe("severe");
    expect(classifyDrawdown(-0.99)).toBe("severe");
  });
});

describe("classifyBreakeven", () => {
  it("boundary values", () => {
    expect(classifyBreakeven(89)).toBe("quick_recovery");
    expect(classifyBreakeven(90)).toBe("decision_zone");
    expect(classifyBreakeven(269)).toBe("decision_zone");
    expect(classifyBreakeven(270)).toBe("long_horizon");
    expect(classifyBreakeven(539)).toBe("long_horizon");
    expect(classifyBreakeven(540)).toBe("effectively_stuck");
    expect(classifyBreakeven(2000)).toBe("effectively_stuck");
  });
});

describe("getRecentCcStrike", () => {
  it("returns null on empty/missing history", () => {
    expect(getRecentCcStrike([])).toBeNull();
    expect(getRecentCcStrike(null)).toBeNull();
    expect(getRecentCcStrike(undefined)).toBeNull();
  });
  it("returns strike of most recent close_date", () => {
    const history = [
      { close_date: "2026-04-01", strike: 50 },
      { close_date: "2026-05-01", strike: 55 },
      { close_date: "2026-03-01", strike: 45 },
    ];
    expect(getRecentCcStrike(history)).toBe(55);
  });
});

describe("calendar day arithmetic", () => {
  it("addCalendarDays adds whole days, no weekend skip", () => {
    expect(addCalendarDays("2026-05-09", 1)).toBe("2026-05-10");
    expect(addCalendarDays("2026-05-09", 320)).toBe("2027-03-25");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("subtractCalendarDays goes the other way", () => {
    expect(subtractCalendarDays("2026-05-09", 60)).toBe("2026-03-10");
  });
});

describe("humanizeDuration", () => {
  it("days bucket (< 14)", () => {
    expect(humanizeDuration(1)).toBe("~1 days");
    expect(humanizeDuration(13)).toBe("~13 days");
  });
  it("weeks bucket (14..59)", () => {
    expect(humanizeDuration(14)).toBe("~2 weeks");
    expect(humanizeDuration(35)).toBe("~5 weeks");
    expect(humanizeDuration(59)).toBe("~8 weeks");
  });
  it("months bucket (60..364), rounded to 0.5", () => {
    expect(humanizeDuration(60)).toBe("~2 months");
    expect(humanizeDuration(320)).toBe("~10.5 months");
    expect(humanizeDuration(364)).toBe("~12 months");
  });
  it("years bucket (>= 365), rounded to 0.5", () => {
    expect(humanizeDuration(365)).toBe("~1 years");
    expect(humanizeDuration(550)).toBe("~1.5 years");
    expect(humanizeDuration(730)).toBe("~2 years");
  });
});

describe("computeTrailingCcRate", () => {
  it("returns null when nothing in window", () => {
    const history = [{ close_date: "2025-01-01", premium_collected: 100, days_held: 5 }];
    expect(computeTrailingCcRate(history, "2026-05-09", 60)).toBeNull();
  });
  it("returns null on empty/missing history", () => {
    expect(computeTrailingCcRate([], "2026-05-09", 60)).toBeNull();
    expect(computeTrailingCcRate(null, "2026-05-09", 60)).toBeNull();
  });
  it("computes total_pnl / total_days_held over window", () => {
    // today=2026-05-09, window=60d → cutoff = 2026-03-10
    const history = [
      { close_date: "2026-04-01", premium_collected: 200, days_held: 10 }, // in
      { close_date: "2026-04-15", premium_collected: 300, days_held: 20 }, // in
      { close_date: "2026-02-01", premium_collected: 999, days_held: 99 }, // out
    ];
    const rate = computeTrailingCcRate(history, "2026-05-09", 60);
    // (200 + 300) / (10 + 20) = 500 / 30 = 16.6666...
    expect(rate).toBeCloseTo(16.6667, 4);
  });
});

// ---------------------------------------------------------------------------
// computeDecisionFraming tests
// ---------------------------------------------------------------------------

const baseLifespan = (overrides = {}) => ({
  ticker: "TEST",
  lifespan_status: "active",
  blended_cost_basis: 100,
  total_shares_at_peak: 100,
  partial_dispositions: [],
  assignment_events: [
    {
      date: "2026-01-01", triggering_csp_id: "csp-1",
      strike: 100, csp_premium_collected: 200,
      shares_added: 100, capital_added: 10000, spot_at_assignment: 95,
    },
  ],
  cc_history: [
    { close_date: "2026-04-15", premium_collected: 150, days_held: 7, strike: 100 },
    { close_date: "2026-04-22", premium_collected: 180, days_held: 7, strike: 100 },
    { close_date: "2026-04-29", premium_collected: 120, days_held: 7, strike: 100 },
  ],
  lifespan_metrics: {
    csp_premium_collected: 200,
    cc_premium_total: 450,
    days_active: 128,
    cc_count_winning: 3,
    cc_count_losing: 0,
  },
  ...overrides,
});

describe("computeDecisionFraming guards", () => {
  it("Test 1: closed lifespan returns null", () => {
    expect(computeDecisionFraming({
      lifespan: baseLifespan({ lifespan_status: "closed" }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    })).toBeNull();
  });

  it("Test 2: currentSpot >= cost basis returns null", () => {
    expect(computeDecisionFraming({
      lifespan: baseLifespan(), currentSpot: 100, // == cb
      baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    })).toBeNull();
    expect(computeDecisionFraming({
      lifespan: baseLifespan(), currentSpot: 110,
      baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    })).toBeNull();
  });

  it("Test 3: current shares = 0 returns null", () => {
    expect(computeDecisionFraming({
      lifespan: baseLifespan({
        partial_dispositions: [{ shares: 100, disposal_pnl: 0 }],
      }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    })).toBeNull();
  });

  it("Test 4: currentSpot null returns null", () => {
    expect(computeDecisionFraming({
      lifespan: baseLifespan(), currentSpot: null,
      baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    })).toBeNull();
  });

  it("returns null when assignment_events is empty", () => {
    expect(computeDecisionFraming({
      lifespan: baseLifespan({ assignment_events: [] }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    })).toBeNull();
  });
});

describe("computeDecisionFraming math", () => {
  it("Test 5: SOFI-style — gap, daily rates, breakeven", () => {
    // CB=100, spot=80, shares=100, csp=200, cc=450
    //   currentShares = 100 - 0 = 100
    //   cumulativeWheelPnl = 200 + 450 + 0 = 650
    //   realizedLoss      = (100 - 80) * 100 = 2000
    //   freedCapital      = 80 * 100 = 8000
    //   cutAlternativeNow = 200 + 0 - 2000 = -1800
    //   gap               = 650 - (-1800) = 2450
    //   trailingCcRate (60d window from 2026-05-09 → cutoff 2026-03-10):
    //     all 3 ccs in: (150+180+120)/(7+7+7) = 450/21 ≈ 21.4286
    //   wheelDailyRate    = 21.4286
    //   cutDailyRate      = 8000 * 0.00245 = 19.60
    //   dailyDifferential = 19.60 - 21.4286 = -1.8286 → wheel_ahead_perpetually
    const r = computeDecisionFraming({
      lifespan: baseLifespan(), currentSpot: 80,
      baselineRate: 0.00245, ticker: "SOFI", today: "2026-05-09",
    });
    expect(r).not.toBeNull();
    expect(r.drawdown_zone).toBe("moderate");      // (80-100)/100 = -0.20
    expect(r.breakeven_zone).toBe("wheel_ahead_perpetually");
    expect(r.days_to_breakeven).toBeNull();
    expect(r.detailed_breakdown.gap).toBe(2450);
    expect(r.detailed_breakdown.realized_loss_if_cut_today).toBe(2000);
    expect(r.detailed_breakdown.freed_capital_if_cut).toBe(8000);
    expect(r.detailed_breakdown.using_trailing_rate).toBe(true);
  });

  it("Test 6: no CCs in trailing 60d → uses lifetime rate fallback", () => {
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        cc_history: [{ close_date: "2025-01-01", premium_collected: 999, days_held: 99, strike: 100 }],
      }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "TEST", today: "2026-05-09",
    });
    expect(r.detailed_breakdown.using_trailing_rate).toBe(false);
    // lifetime_cc_rate = 450 / 128 ≈ 3.5156
    expect(r.detailed_breakdown.lifetime_cc_rate).toBeCloseTo(3.5156, 4);
    expect(r.detailed_breakdown.wheel_daily_rate).toBeCloseTo(3.5156, 4);
  });

  it("Test 7: cut rate > wheel rate at current spot → real breakeven date", () => {
    // Force cut > wheel: tiny lifetime CC rate, high baseline rate, spot far below cb
    // cb=100, spot=90, shares=100
    //   csp=200, cc=1, days=128 → lifetime rate ≈ 0.0078
    //   gap = (200+1+0) - (200 + 0 - 1000) = 201 - (-800) = 1001
    //   cutDailyRate = (90*100)*0.05 = 450
    //   diff = 449.99 → days_to_breakeven = ceil(1001/449.99) = 3
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        cc_history: [{ close_date: "2025-01-01", premium_collected: 1, days_held: 100, strike: 100 }],
        lifespan_metrics: { csp_premium_collected: 200, cc_premium_total: 1, days_active: 128, cc_count_winning: 1, cc_count_losing: 0 },
      }),
      currentSpot: 90, baselineRate: 0.05, ticker: "TEST", today: "2026-05-09",
    });
    expect(r.days_to_breakeven).toBe(3);
    expect(r.breakeven_zone).toBe("quick_recovery");
    expect(r.recovery_date).toBe(addCalendarDays("2026-05-09", 3));
    expect(r.framing_question).toContain("Do you think TEST reaches $100.00");
    expect(r.framing_duration).toBe("~3 days");
  });

  it("Test 8: drawdown classification at exact boundaries", () => {
    const make = (spot) => computeDecisionFraming({
      lifespan: baseLifespan(), currentSpot: spot,
      baselineRate: 0.00245, ticker: "T", today: "2026-05-09",
    });
    expect(make(85.0001).drawdown_zone).toBe("shallow");      // -0.149999
    expect(make(85).drawdown_zone).toBe("shallow");           // exact -0.15
    expect(make(84.9999).drawdown_zone).toBe("moderate");     // -0.150001
    expect(make(70).drawdown_zone).toBe("moderate");          // exact -0.30
    expect(make(69.9999).drawdown_zone).toBe("deep");
    expect(make(55).drawdown_zone).toBe("deep");              // exact -0.45
    expect(make(54.9999).drawdown_zone).toBe("severe");
  });

  it("Test 9: breakeven boundaries via classifyBreakeven helper", () => {
    expect(classifyBreakeven(89)).toBe("quick_recovery");
    expect(classifyBreakeven(90)).toBe("decision_zone");
    expect(classifyBreakeven(269)).toBe("decision_zone");
    expect(classifyBreakeven(270)).toBe("long_horizon");
    expect(classifyBreakeven(539)).toBe("long_horizon");
    expect(classifyBreakeven(540)).toBe("effectively_stuck");
  });

  it("Test 10: calendar arithmetic plumbed through to recovery_date", () => {
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        cc_history: [{ close_date: "2025-01-01", premium_collected: 1, days_held: 100, strike: 100 }],
        lifespan_metrics: { csp_premium_collected: 200, cc_premium_total: 1, days_active: 128, cc_count_winning: 1, cc_count_losing: 0 },
      }),
      currentSpot: 90, baselineRate: 0.05, ticker: "T", today: "2026-05-09",
    });
    expect(r.recovery_date).toBe(addCalendarDays("2026-05-09", r.days_to_breakeven));
  });

  it("Test 11: humanizeDuration plumbed through to framing_duration", () => {
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        cc_history: [{ close_date: "2025-01-01", premium_collected: 1, days_held: 100, strike: 100 }],
        lifespan_metrics: { csp_premium_collected: 200, cc_premium_total: 1, days_active: 128, cc_count_winning: 1, cc_count_losing: 0 },
      }),
      currentSpot: 90, baselineRate: 0.05, ticker: "T", today: "2026-05-09",
    });
    expect(r.framing_duration).toBe("~3 days");
  });

  it("Test 12: partial dispositions reduce currentShares and add to cumulative_wheel_pnl", () => {
    // 100 peak, 40 disposed at +$200 disposal_pnl → currentShares=60
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        partial_dispositions: [{ shares: 40, disposal_pnl: 200 }],
      }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "T", today: "2026-05-09",
    });
    expect(r.detailed_breakdown.current_shares).toBe(60);
    expect(r.detailed_breakdown.partial_disposal_pnl).toBe(200);
    expect(r.detailed_breakdown.cumulative_wheel_pnl).toBe(850);
    expect(r.detailed_breakdown.realized_loss_if_cut_today).toBe(1200);
    expect(r.detailed_breakdown.freed_capital_if_cut).toBe(4800);
    expect(r.detailed_breakdown.gap).toBe(1650);
  });

  it("Test 13: trailing_rate_immature is true when days_held < 30", () => {
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        lifespan_metrics: { csp_premium_collected: 200, cc_premium_total: 50, days_active: 14, cc_count_winning: 1, cc_count_losing: 0 },
      }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "T", today: "2026-05-09",
    });
    expect(r.detailed_breakdown.trailing_rate_immature).toBe(true);
  });

  it("Test 14: trailing_rate_immature is false at days_held = 30", () => {
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        lifespan_metrics: { csp_premium_collected: 200, cc_premium_total: 50, days_active: 30, cc_count_winning: 1, cc_count_losing: 0 },
      }),
      currentSpot: 80, baselineRate: 0.00245, ticker: "T", today: "2026-05-09",
    });
    expect(r.detailed_breakdown.trailing_rate_immature).toBe(false);
  });
});
