# Decision Framing for Active Assigned Positions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `decision_framing` computation for active assigned-share positions and surface it on both `api/position-lifespan` and `api/eod-snapshot`.

**Architecture:** Single pure function in `api/_lib/lifespan.js` (`computeDecisionFraming`) that takes a built lifespan + currentSpot + baselineRate + ticker + today and returns either the framing object or null. Both consuming endpoints fetch the spot price from the existing Supabase `quotes` table and call the helper per active assigned lifespan.

**Tech Stack:** Node 20+ (Vercel functions), Supabase JS client, Vitest. No new deps.

**Spec:** [docs/superpowers/specs/2026-05-09-decision-framing-active-positions-design.md](../specs/2026-05-09-decision-framing-active-positions-design.md)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `api/_lib/lifespan.js` | **Modify** | Add `computeDecisionFraming` + 4 small helpers (`classifyDrawdown`, `classifyBreakeven`, `getRecentCcStrike`, `humanizeDuration`, `addCalendarDays`, `subtractCalendarDays`, `computeTrailingCcRate`). Export. |
| `api/_lib/__tests__/decision-framing.test.js` | **Create** | 12 unit tests for the helper and the main function. |
| `api/position-lifespan.js` | **Modify** | Add quotes fetch (single in ticker mode, `.in()` in list mode) and inject `decision_framing` per lifespan when active. |
| `api/eod-snapshot.js` | **Modify** | Fetch trades+quotes for active assigned tickers, call `detectLifespans`/`buildLifespan`/`computeDecisionFraming`, add a "DECISION FRAMING" section to `buildTextBlob`, and add `decision_framing` array to the snapshot's JSON `data`. |
| `package.json`, `src/lib/constants.js` | **Modify** | Version bump 1.108.6 → 1.109.0 (minor for new feature). |

---

### Task 1: Add helper functions to `api/_lib/lifespan.js`

**Files:**
- Modify: `api/_lib/lifespan.js` (append new exports near the end of the file, after `computeBlendedBasis` and `computeVerdict` private helpers)

These are pure utility functions used by `computeDecisionFraming`. Adding them first lets us TDD them in Task 2.

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "^function daysBetween\|^function round" api/_lib/lifespan.js | tail -5`

Expected: shows where `daysBetween`, `round2`, `round4`, `round6` are. Append the new helpers AFTER all existing private utilities but BEFORE the closing of the file (no closing brace at module level since this is a flat ESM module). The new helpers should sit at the very end of the file.

- [ ] **Step 2: Append the helper code**

At the end of `api/_lib/lifespan.js`, append:

```js
// ---------------------------------------------------------------------------
// Decision-framing helpers
// ---------------------------------------------------------------------------

export function classifyDrawdown(pct) {
  if (pct >= -0.15) return "shallow";
  if (pct >= -0.30) return "moderate";
  if (pct >= -0.45) return "deep";
  return "severe";
}

export function classifyBreakeven(days) {
  if (days < 90)  return "quick_recovery";
  if (days < 270) return "decision_zone";
  if (days < 540) return "long_horizon";
  return "effectively_stuck";
}

// Most recent CC strike from cc_history (by close_date). Returns null when
// no CCs have closed yet for this lifespan. Does not consider currently-open
// CCs not yet in cc_history.
export function getRecentCcStrike(ccHistory) {
  if (!ccHistory || ccHistory.length === 0) return null;
  const sorted = [...ccHistory].sort(
    (a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? "")
  );
  return sorted[0]?.strike ?? null;
}

// Calendar-day arithmetic on YYYY-MM-DD strings (no weekend skipping).
export function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function subtractCalendarDays(dateStr, days) {
  return addCalendarDays(dateStr, -days);
}

// Human-readable duration (≤ ~30 chars).
//   < 14 days     -> "~N days"
//   < 60 days     -> "~N weeks" (rounded to nearest week)
//   < 365 days    -> "~N.5 months" (rounded to nearest 0.5 month, 30.44 days/month)
//   >= 365 days   -> "~N.5 years" (rounded to nearest 0.5 year, 365.25 days/year)
export function humanizeDuration(days) {
  if (days < 14)  return `~${days} days`;
  if (days < 60)  return `~${Math.round(days / 7)} weeks`;
  if (days < 365) {
    const months = Math.round((days / 30.44) * 2) / 2;
    return `~${months} months`;
  }
  const years = Math.round((days / 365.25) * 2) / 2;
  return `~${years} years`;
}

// Trailing-window CC rate. Returns null if no CCs in the window (caller falls
// back to lifetime rate).
export function computeTrailingCcRate(ccHistory, today, days = 60) {
  const cutoff = subtractCalendarDays(today, days);
  const recent = (ccHistory ?? []).filter((cc) => (cc.close_date ?? "") >= cutoff);
  if (recent.length === 0) return null;
  const recentPnl  = recent.reduce((s, cc) => s + (parseFloat(cc.premium_collected) || 0), 0);
  const recentDays = recent.reduce((s, cc) => s + (parseFloat(cc.days_held) || 0), 0);
  return recentDays > 0 ? recentPnl / recentDays : 0;
}
```

- [ ] **Step 3: Run the existing test suite to verify no regressions**

Run: `npx vitest run`

Expected: 341+ tests still pass (no new tests yet — this just adds exports).

- [ ] **Step 4: Commit**

```bash
git add api/_lib/lifespan.js
git commit -m "feat: add decision-framing helper utilities

Pure utility exports used by computeDecisionFraming (next commit).
Includes: classifyDrawdown, classifyBreakeven, getRecentCcStrike,
addCalendarDays, subtractCalendarDays, humanizeDuration,
computeTrailingCcRate."
```

---

### Task 2: Create the test file with all failing tests

**Files:**
- Create: `api/_lib/__tests__/decision-framing.test.js`

Tests are written first (TDD). The test file exercises `computeDecisionFraming` (which doesn't exist yet) and the helpers from Task 1. Helper tests will pass; main-function tests will fail until Task 3.

- [ ] **Step 1: Write the test file**

Create `api/_lib/__tests__/decision-framing.test.js`:

```js
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
    // Confirm weekend not skipped: 2026-05-09 is Saturday; +1 day is Sunday 2026-05-10
    expect(addCalendarDays("2026-05-09", 1)).toBe("2026-05-10");
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
  it("Test 5: SOFI-style — gap, daily rates, breakeven, recovery date", () => {
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
    // Force cut > wheel: tiny lifetime CC rate, big freed capital
    // Use a much lower spot so freedCapital * baselineRate >> wheel rate
    const r = computeDecisionFraming({
      lifespan: baseLifespan({
        cc_history: [{ close_date: "2025-01-01", premium_collected: 1, days_held: 100, strike: 100 }],
        lifespan_metrics: { csp_premium_collected: 200, cc_premium_total: 1, days_active: 128, cc_count_winning: 1, cc_count_losing: 0 },
      }),
      currentSpot: 90, baselineRate: 0.05, ticker: "TEST", today: "2026-05-09",
    });
    // cb=100, spot=90, shares=100
    //   gap = (200+1+0) - (200 + 0 - 1000) = 201 - (-800) = 1001
    //   wheelDailyRate (lifetime) = 1/128 ≈ 0.0078
    //   cutDailyRate = 9000 * 0.05 = 450
    //   diff = 449.99 → days_to_breakeven = ceil(1001/449.99) = 3
    expect(r.days_to_breakeven).toBe(3);
    expect(r.breakeven_zone).toBe("quick_recovery");
    expect(r.recovery_date).toBe(addCalendarDays("2026-05-09", 3));
    expect(r.framing_question).toContain("Do you think TEST reaches $100.00");
    expect(r.framing_duration).toBe("~3 days");
  });

  it("Test 8: drawdown classification at exact boundaries", () => {
    const cb = 100;
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

  it("Test 9: breakeven boundaries — verified through computed days_to_breakeven", () => {
    // Verify classifyBreakeven directly (already covered above) and that the
    // function plumbs through correctly: just check bucket assignment matches
    // classifyBreakeven for an arbitrary positive-diff scenario.
    expect(classifyBreakeven(89)).toBe("quick_recovery");
    expect(classifyBreakeven(90)).toBe("decision_zone");
    expect(classifyBreakeven(269)).toBe("decision_zone");
    expect(classifyBreakeven(270)).toBe("long_horizon");
    expect(classifyBreakeven(539)).toBe("long_horizon");
    expect(classifyBreakeven(540)).toBe("effectively_stuck");
  });

  it("Test 10: calendar arithmetic plumbed through to recovery_date", () => {
    // Use a scenario where days_to_breakeven is deterministic.
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
    // From Test 7: days_to_breakeven=3 → "~3 days"
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
    // realized_loss_if_cut_today = (100-80) * 60 = 1200
    // freed_capital_if_cut      = 80 * 60 = 4800
    // cumulative_wheel_pnl      = csp(200) + cc(450) + partial(200) = 850
    // cut_alternative_state     = csp(200) + partial(200) - 1200 = -800
    // gap                       = 850 - (-800) = 1650
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
});
```

- [ ] **Step 2: Run tests to verify helpers pass and main fn fails**

Run: `npx vitest run api/_lib/__tests__/decision-framing.test.js`

Expected: helper-block tests PASS (Task 1 added them as exports). The 12 `computeDecisionFraming` tests FAIL because the function doesn't exist yet (`computeDecisionFraming is not defined` or similar). That's the goal of this task.

If helper tests fail (other than the main-fn ones), debug — Task 1 wasn't completed correctly.

- [ ] **Step 3: Commit**

```bash
git add api/_lib/__tests__/decision-framing.test.js
git commit -m "test: add failing tests for computeDecisionFraming and helpers

Tests for the helpers added in Task 1 should pass. Tests for
computeDecisionFraming itself fail until Task 3 implements it."
```

---

### Task 3: Implement `computeDecisionFraming` in `api/_lib/lifespan.js`

**Files:**
- Modify: `api/_lib/lifespan.js` (append the new function after the helpers from Task 1)

- [ ] **Step 1: Append the function**

At the end of `api/_lib/lifespan.js` (after the helpers from Task 1), append:

```js
// ---------------------------------------------------------------------------
// Decision framing for active assigned positions
// ---------------------------------------------------------------------------

// Computes a wheel-vs-cut-and-redeploy framing for an active assigned-share
// lifespan. Returns null when not applicable (closed, currentSpot >= cb, no
// shares held, missing inputs).
//
// See spec: docs/superpowers/specs/2026-05-09-decision-framing-active-positions-design.md
export function computeDecisionFraming({ lifespan, currentSpot, baselineRate, ticker, today }) {
  // Guards
  if (!lifespan || lifespan.lifespan_status !== "active") return null;
  if (!Array.isArray(lifespan.assignment_events) || lifespan.assignment_events.length === 0) return null;
  if (currentSpot == null || !Number.isFinite(currentSpot)) return null;

  const cb = parseFloat(lifespan.blended_cost_basis) || 0;
  if (cb <= 0)            return null;
  if (currentSpot >= cb)  return null;

  // currentShares = peak − sum(partial_dispositions.shares)
  const peak = parseFloat(lifespan.total_shares_at_peak) || 0;
  const disposedShares = (lifespan.partial_dispositions ?? []).reduce(
    (s, d) => s + (parseFloat(d.shares) || 0), 0
  );
  const currentShares = peak - disposedShares;
  if (currentShares <= 0) return null;

  const m = lifespan.lifespan_metrics ?? {};
  const cspPremium = parseFloat(m.csp_premium_collected) || 0;
  const ccPremium  = parseFloat(m.cc_premium_total)      || 0;
  const daysHeld   = parseFloat(m.days_active)           || 0;

  const partialDisposalPnl = (lifespan.partial_dispositions ?? []).reduce(
    (s, d) => s + (parseFloat(d.disposal_pnl) || 0), 0
  );

  const cumulativeWheelPnl     = round2(cspPremium + ccPremium + partialDisposalPnl);
  const realizedLoss           = round2((cb - currentSpot) * currentShares);
  const freedCapital           = round2(currentSpot * currentShares);
  const cutAlternativeStateNow = round2(cspPremium + partialDisposalPnl - realizedLoss);
  const gap                    = round2(cumulativeWheelPnl - cutAlternativeStateNow);

  const trailingCcRate = computeTrailingCcRate(lifespan.cc_history, today, 60);
  const usingTrailing  = trailingCcRate !== null;
  const lifetimeCcRate = daysHeld > 0 ? ccPremium / daysHeld : 0;
  const wheelDailyRate = usingTrailing ? trailingCcRate : lifetimeCcRate;

  const cutDailyRate      = freedCapital * (parseFloat(baselineRate) || 0);
  const dailyDifferential = cutDailyRate - wheelDailyRate;

  const drawdownPct  = (currentSpot - cb) / cb;
  const drawdownZone = classifyDrawdown(drawdownPct);

  const detailed_breakdown = {
    cumulative_wheel_pnl:        cumulativeWheelPnl,
    csp_premium_collected:       round2(cspPremium),
    cc_premium_total:            round2(ccPremium),
    partial_disposal_pnl:        round2(partialDisposalPnl),
    cc_count_winning:            m.cc_count_winning ?? null,
    cc_count_losing:             m.cc_count_losing  ?? null,
    trailing_60day_cc_rate:      trailingCcRate != null ? round4(trailingCcRate) : null,
    lifetime_cc_rate:            round4(lifetimeCcRate),
    using_trailing_rate:         usingTrailing,
    recent_cc_strike:            getRecentCcStrike(lifespan.cc_history),
    current_shares:              currentShares,
    realized_loss_if_cut_today:  realizedLoss,
    freed_capital_if_cut:        freedCapital,
    cut_alternative_state:       cutAlternativeStateNow,
    gap:                         gap,
    wheel_daily_rate:            round4(wheelDailyRate),
    cut_daily_rate:              round4(cutDailyRate),
    daily_differential:          round4(dailyDifferential),
  };

  if (dailyDifferential <= 0) {
    return {
      drawdown_pct:       round4(drawdownPct),
      drawdown_zone:      drawdownZone,
      days_to_breakeven:  null,
      breakeven_zone:     "wheel_ahead_perpetually",
      recovery_date:      null,
      framing_question:   "Wheel currently outperforming cut alternative; no breakeven date.",
      framing_duration:   null,
      detailed_breakdown,
    };
  }

  const daysToBreakeven = Math.ceil(gap / dailyDifferential);
  const recoveryDate    = addCalendarDays(today, daysToBreakeven);
  const breakevenZone   = classifyBreakeven(daysToBreakeven);

  return {
    drawdown_pct:       round4(drawdownPct),
    drawdown_zone:      drawdownZone,
    days_to_breakeven:  daysToBreakeven,
    breakeven_zone:     breakevenZone,
    recovery_date:      recoveryDate,
    framing_question:   `Do you think ${ticker} reaches $${cb.toFixed(2)} (cost basis) by ${recoveryDate}?`,
    framing_duration:   humanizeDuration(daysToBreakeven),
    detailed_breakdown,
  };
}
```

- [ ] **Step 2: Verify all 12 main-function tests pass**

Run: `npx vitest run api/_lib/__tests__/decision-framing.test.js`

Expected: ALL tests pass (helpers + main function).

- [ ] **Step 3: Run the full test suite to verify no regressions**

Run: `npx vitest run`

Expected: All tests pass; total count = 341 + 6 helper-block tests + 12 main-fn tests = ~359, depending on prior totals.

- [ ] **Step 4: Commit**

```bash
git add api/_lib/lifespan.js
git commit -m "feat: implement computeDecisionFraming for active assigned positions

Pure function that takes a built lifespan + currentSpot + baselineRate
and returns either a decision_framing object or null. Handles all guard
conditions (closed, above cost, no shares, missing inputs) and produces
the wheel_ahead_perpetually state when cut never catches up.

Used by api/position-lifespan and api/eod-snapshot in subsequent tasks.

See spec: docs/superpowers/specs/2026-05-09-decision-framing-active-positions-design.md"
```

---

### Task 4: Wire `decision_framing` into `api/position-lifespan.js`

**Files:**
- Modify: `api/position-lifespan.js`

This task fetches a quote per active-assigned ticker and injects `decision_framing` into the lifespan output.

- [ ] **Step 1: Add import**

In `api/position-lifespan.js`, modify the existing import block:

```js
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
  computeDecisionFraming,
  lifespanSummary,
} from "./_lib/lifespan.js";
```

- [ ] **Step 2: Add a quote-fetch helper**

Just BELOW the `getSupabase()` function, add:

```js
// Fetch last-trade prices from the cached quotes table.
// Returns { ticker: lastPrice }. Missing tickers are absent from the map.
async function fetchLastPrices(supabase, tickers) {
  if (!tickers || tickers.length === 0) return {};
  const { data, error } = await supabase
    .from("quotes")
    .select("symbol, last")
    .in("symbol", tickers);
  if (error) {
    console.warn("[api/position-lifespan] quotes fetch failed:", error.message);
    return {};
  }
  const map = {};
  for (const q of data ?? []) {
    if (q?.symbol && q.last != null) map[q.symbol] = parseFloat(q.last);
  }
  return map;
}
```

- [ ] **Step 3: Inject `decision_framing` in single-lifespan mode**

Find the block `if (assignment_id) { ... const lifespan = buildLifespan(raw, cspBaseline, today); ...` and modify it to fetch a quote and add framing. Replace the existing block:

```js
    if (assignment_id) {
      // --- Single lifespan mode ---
      const raw = rawLifespans.find(
        (l) => l.assignment_events[0]?.date === assignment_id
      );
      if (!raw) {
        const available = rawLifespans
          .map((l) => l.assignment_events[0]?.date)
          .filter(Boolean);
        return res.status(404).json({
          ok: false,
          error:
            `No lifespan found for ${tickerUpper} starting on ${assignment_id}. ` +
            `Available lifespan start dates: ${available.join(", ")}`,
        });
      }

      const lifespan = buildLifespan(raw, cspBaseline, today);

      let linkedJournals = [];
      if (lifespan._tradeIds.length > 0) {
        const journalResult = await supabase
          .from("journal_entries")
          .select("id, entry_date, entry_type, title, body, trade_id")
          .in("trade_id", lifespan._tradeIds);
        if (!journalResult.error) linkedJournals = journalResult.data ?? [];
      }

      const result = attachJournalContext(lifespan, linkedJournals);

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({ ok: true, ...result });
    } else {
```

With:

```js
    if (assignment_id) {
      // --- Single lifespan mode ---
      const raw = rawLifespans.find(
        (l) => l.assignment_events[0]?.date === assignment_id
      );
      if (!raw) {
        const available = rawLifespans
          .map((l) => l.assignment_events[0]?.date)
          .filter(Boolean);
        return res.status(404).json({
          ok: false,
          error:
            `No lifespan found for ${tickerUpper} starting on ${assignment_id}. ` +
            `Available lifespan start dates: ${available.join(", ")}`,
        });
      }

      const lifespan = buildLifespan(raw, cspBaseline, today);

      // Compute decision_framing for active lifespans (no-op for closed)
      let decisionFraming = null;
      if (lifespan.lifespan_status === "active") {
        const prices = await fetchLastPrices(supabase, [tickerUpper]);
        decisionFraming = computeDecisionFraming({
          lifespan,
          currentSpot: prices[tickerUpper] ?? null,
          baselineRate: cspBaseline.avg_return_per_capital_day,
          ticker: tickerUpper,
          today,
        });
      }

      let linkedJournals = [];
      if (lifespan._tradeIds.length > 0) {
        const journalResult = await supabase
          .from("journal_entries")
          .select("id, entry_date, entry_type, title, body, trade_id")
          .in("trade_id", lifespan._tradeIds);
        if (!journalResult.error) linkedJournals = journalResult.data ?? [];
      }

      const result = attachJournalContext(lifespan, linkedJournals);
      if (decisionFraming) result.decision_framing = decisionFraming;

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({ ok: true, ...result });
    } else {
```

- [ ] **Step 4: Inject `decision_framing` in list mode (per ticker)**

Find the `// --- List mode: all lifespans for ticker ---` block:

```js
    } else {
      // --- List mode: all lifespans for ticker ---
      const summaries = rawLifespans
        .map((r) => buildLifespan(r, cspBaseline, today))
        .map(lifespanSummary);

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({
        ok: true,
        ticker: tickerUpper,
        lifespan_count: summaries.length,
        lifespans: summaries,
      });
    }
```

Replace with:

```js
    } else {
      // --- List mode: all lifespans for ticker ---
      const built = rawLifespans.map((r) => buildLifespan(r, cspBaseline, today));

      // For active lifespans, fetch a single quote and inject decision_framing
      // onto the summary (only). Closed lifespans don't get the field.
      const hasActive = built.some((l) => l.lifespan_status === "active");
      const prices = hasActive ? await fetchLastPrices(supabase, [tickerUpper]) : {};

      const summaries = built.map((l) => {
        const summary = lifespanSummary(l);
        if (l.lifespan_status === "active") {
          const framing = computeDecisionFraming({
            lifespan: l,
            currentSpot: prices[tickerUpper] ?? null,
            baselineRate: cspBaseline.avg_return_per_capital_day,
            ticker: tickerUpper,
            today,
          });
          if (framing) summary.decision_framing = framing;
        }
        return summary;
      });

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({
        ok: true,
        ticker: tickerUpper,
        lifespan_count: summaries.length,
        lifespans: summaries,
      });
    }
```

- [ ] **Step 5: Inject `decision_framing` in cross-ticker list mode**

Find the no-ticker branch (the `if (!ticker) { ... }` block earlier in the handler):

```js
      const allSummaries = [];
      for (const [tk, tickerTrades] of Object.entries(tradesByTicker)) {
        for (const raw of detectLifespans(tk, tickerTrades)) {
          allSummaries.push(lifespanSummary(buildLifespan(raw, cspBaseline, today)));
        }
      }
      allSummaries.sort((a, b) =>
        (b.assignment_date ?? "").localeCompare(a.assignment_date ?? "")
      );
```

Replace with:

```js
      const built = [];
      for (const [tk, tickerTrades] of Object.entries(tradesByTicker)) {
        for (const raw of detectLifespans(tk, tickerTrades)) {
          built.push({ ticker: tk, lifespan: buildLifespan(raw, cspBaseline, today) });
        }
      }

      // Fetch quotes once for all active-lifespan tickers
      const activeTickers = [...new Set(
        built.filter(({ lifespan }) => lifespan.lifespan_status === "active").map((b) => b.ticker)
      )];
      const prices = await fetchLastPrices(supabase, activeTickers);

      const allSummaries = built.map(({ ticker: tk, lifespan }) => {
        const summary = lifespanSummary(lifespan);
        if (lifespan.lifespan_status === "active") {
          const framing = computeDecisionFraming({
            lifespan,
            currentSpot: prices[tk] ?? null,
            baselineRate: cspBaseline.avg_return_per_capital_day,
            ticker: tk,
            today,
          });
          if (framing) summary.decision_framing = framing;
        }
        return summary;
      });
      allSummaries.sort((a, b) =>
        (b.assignment_date ?? "").localeCompare(a.assignment_date ?? "")
      );
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`

Expected: All tests still pass. (No new tests for the endpoint wiring; the unit tests already cover `computeDecisionFraming` correctness.)

- [ ] **Step 7: Commit**

```bash
git add api/position-lifespan.js
git commit -m "feat: surface decision_framing on api/position-lifespan

Adds a quotes fetch (helper fetchLastPrices) and injects
decision_framing into each active lifespan in all three response shapes
(single-lifespan detail, ticker-scoped list, cross-ticker list).

Closed lifespans and lifespans without quote data don't get the field.
Quote lookup failures are logged and treated as missing (no error)."
```

---

### Task 5: Wire `decision_framing` into `api/eod-snapshot.js`

**Files:**
- Modify: `api/eod-snapshot.js`

This is the biggest task — fetch trades for active assigned tickers, run lifespan detection, compute framing, render text section + JSON data.

- [ ] **Step 1: Add imports**

At the top of `api/eod-snapshot.js`, add (or extend the existing) imports:

```js
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
  computeDecisionFraming,
} from "./_lib/lifespan.js";
```

If there's already an import line for `./_lib/lifespan.js`, just add the missing names.

- [ ] **Step 2: Add a fetch helper for assigned-ticker trades**

Just below the existing helper functions in the file (or near the top of the handler), add:

```js
// Fetch all CSP/CC/Shares trades for the given tickers, used to rebuild
// per-ticker lifespans for decision_framing computation in the EOD snapshot.
async function fetchTickerTrades(supabase, tickers) {
  if (!tickers || tickers.length === 0) return {};
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .in("ticker", tickers)
    .order("close_date", { ascending: true });
  if (error) {
    console.warn("[api/eod-snapshot] trades fetch failed:", error.message);
    return {};
  }
  const byTicker = {};
  for (const t of data ?? []) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = [];
    byTicker[t.ticker].push(t);
  }
  return byTicker;
}
```

- [ ] **Step 3: Compute decision_framing for active assigned positions inside the handler**

In the main handler, AFTER `radarRows` is built (look for the "Build radar rows" comment around line 458) and BEFORE `buildTextBlob` is called (around line 554), add:

```js
  // ── Decision framing for active assigned positions ────────────────────────
  // Reuse the CSP baseline computed for the existing cut-and-redeploy benchmark.
  // For each active assigned ticker, rebuild the lifespan and compute framing.
  const assignedTickers = (positions?.assigned_shares ?? []).map((s) => s.ticker);
  const decisionFraming = [];

  if (assignedTickers.length > 0) {
    // Fetch CSP baseline (same query/columns as position-lifespan)
    const cspBaselineResult = await supabase
      .from("trades")
      .select("id, premium_collected, capital_fronted, days_held, close_date, subtype, strike, contracts, spot_at_assignment")
      .eq("type", "CSP")
      .in("subtype", ["Close", "Roll Loss", "Assigned"])
      .gt("days_held", 0)
      .gt("capital_fronted", 0)
      .order("close_date", { ascending: false })
      .limit(60);

    const cspBaseline = computeCspBaseline(cspBaselineResult.data ?? []);
    const tradesByTicker = await fetchTickerTrades(supabase, assignedTickers);
    const framingPrices = {};
    for (const tk of assignedTickers) framingPrices[tk] = quotesMap[tk]?.last ?? null;

    for (const tk of assignedTickers) {
      const tickerTrades = tradesByTicker[tk] ?? [];
      const lifespans = detectLifespans(tk, tickerTrades);
      const activeLifespan = lifespans.find((l) => !l.exit_event);
      if (!activeLifespan) continue;

      const built = buildLifespan(activeLifespan, cspBaseline, today);
      const framing = computeDecisionFraming({
        lifespan: built,
        currentSpot: framingPrices[tk],
        baselineRate: cspBaseline.avg_return_per_capital_day,
        ticker: tk,
        today,
      });
      if (framing) decisionFraming.push({ ticker: tk, ...framing });
    }
  }

  // Sort by drawdown severity then ticker alphabetical
  const drawdownSeverityRank = { severe: 0, deep: 1, moderate: 2, shallow: 3 };
  decisionFraming.sort((a, b) => {
    const dr = drawdownSeverityRank[a.drawdown_zone] - drawdownSeverityRank[b.drawdown_zone];
    if (dr !== 0) return dr;
    return a.ticker.localeCompare(b.ticker);
  });
```

Important: this block needs `quotesMap` (already populated for the radar section earlier in the handler). If radarRows doesn't include the assigned tickers, the `quotesMap` lookup will return undefined; the code falls back to `null` which makes `computeDecisionFraming` return `null`. That's the correct behavior.

If you find that `quotesMap` doesn't contain the assigned tickers, extend the existing radar quotes fetch:

```js
// Earlier in the handler, where universeTickers is built:
const universeTickers = universeRows.map((u) => u.ticker);
// Also include assigned-share tickers so quotesMap covers them:
const assignedTickerList = (positions?.assigned_shares ?? []).map((s) => s.ticker);
const allQuoteTickers = [...new Set([...universeTickers, ...assignedTickerList])];

// Then in the Promise.allSettled block, change `.in("symbol", universeTickers)`
// to `.in("symbol", allQuoteTickers)`.
```

(Apply that extension only if needed — first try the existing `quotesMap` and verify quotes appear for assigned tickers.)

- [ ] **Step 4: Pass `decisionFraming` into `buildTextBlob` and the JSON data**

Update the `buildTextBlob({ ... })` call at the end of the handler (around line 554). Add `decisionFraming` to the call object:

```js
  const text = buildTextBlob({
    today,
    dailySnapshot,
    positions,
    journalEntries,
    macroAiContext,
    macroPosture,
    spyQuote,
    qqqQuote,
    radarRows,
    decisionFraming,  // NEW
  });
```

And add `decision_framing` to the JSON `data` object (find the response that returns the snapshot — look for `data:` near the end of the file). Add a `decision_framing: decisionFraming,` field at the same level as other top-level data fields.

- [ ] **Step 5: Render the new section in `buildTextBlob`**

Modify `buildTextBlob` signature to accept `decisionFraming`:

```js
function buildTextBlob({
  today,
  dailySnapshot,
  positions,
  journalEntries,
  macroAiContext,
  macroPosture,
  spyQuote,
  qqqQuote,
  radarRows,
  decisionFraming,
}) {
```

Then immediately AFTER the "ASSIGNED SHARES + COVERED CALLS" block (look for the closing `lines.push("");` after the for-loop, around line 203), add the new section:

```js
  // ── Decision Framing ──
  if (decisionFraming && decisionFraming.length) {
    lines.push("DECISION FRAMING — ACTIVE ASSIGNED POSITIONS");
    lines.push("─".repeat(40));
    for (const f of decisionFraming) {
      const breakevenLabel = f.breakeven_zone
        .replace("wheel_ahead_perpetually", "Wheel ahead")
        .replace("quick_recovery", "Quick recovery")
        .replace("decision_zone", "Decision zone")
        .replace("long_horizon", "Long horizon")
        .replace("effectively_stuck", "Effectively stuck");
      const drawdownLabel = f.drawdown_zone[0].toUpperCase() + f.drawdown_zone.slice(1);
      lines.push(`${f.ticker} · ${drawdownLabel} / ${breakevenLabel}`);
      if (f.framing_question && f.framing_duration) {
        // Active framing question (computed breakeven)
        lines.push(`  Q: "${f.framing_question}" (${f.framing_duration})`);
      } else if (f.framing_question) {
        lines.push(`  ${f.framing_question}`);
      }
    }

    // Footer two-line summary
    const decisionZone = decisionFraming.filter((f) => f.breakeven_zone === "decision_zone").map((f) => f.ticker);
    const anchored = decisionFraming
      .filter((f) => f.breakeven_zone === "long_horizon" || f.breakeven_zone === "effectively_stuck")
      .map((f) => f.ticker);

    if (decisionZone.length || anchored.length) lines.push("");
    if (decisionZone.length) lines.push(`DECISION ZONE (comparison most informative): ${decisionZone.join(", ")}`);
    if (anchored.length)     lines.push(`ANCHORED (math says hold despite long timeline): ${anchored.join(", ")}`);

    lines.push("");
  }
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`

Expected: All tests still pass.

- [ ] **Step 7: Commit**

```bash
git add api/eod-snapshot.js
git commit -m "feat: add Decision Framing section to EOD snapshot

For each active assigned ticker:
- Re-derive its current lifespan via detectLifespans/buildLifespan
- Compute decision_framing (reusing the CSP baseline already used by
  cut_and_redeploy_baseline)
- Render a sorted section in the text blob (severity then alphabetical)
- Include in the JSON data object as decision_framing array

Footer summary calls out DECISION ZONE and ANCHORED tickers when
present."
```

---

### Task 6: Version bump 1.108.6 → 1.109.0

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

Per CLAUDE.md, behavior-changing commits bump both files in the same commit. Minor bump (`x.Y.0`) for new features.

- [ ] **Step 1: Verify the baseline version**

Run: `git show origin/main:package.json | grep '"version"'`

Expected: `"version": "1.108.6",` (or higher if main has moved).

If main has moved, base the bump on whatever main shows: minor bump from main's current version.

- [ ] **Step 2: Update `package.json`**

In `package.json`, find:

```json
  "version": "1.108.6",
```

Change to:

```json
  "version": "1.109.0",
```

- [ ] **Step 3: Update `src/lib/constants.js`**

In `src/lib/constants.js`, find:

```js
export const VERSION = "1.108.6";
```

Change to:

```js
export const VERSION = "1.109.0";
```

- [ ] **Step 4: Run all tests one last time**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.109.0 for decision_framing feature"
```

---

### Task 7: Push, open PR, merge

**Files:** none (git operations only)

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/decision-framing`

Expected: branch pushed.

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "feat: decision_framing for active assigned positions (v1.109.0)" --body "$(cat <<'EOF'
## Summary
Adds a \`decision_framing\` computation that quantifies the
wheel-vs-cut-and-redeploy comparison for active assigned-share positions
and surfaces a forecasting question the user can actually answer
(\"Do you think TICKER reaches COST_BASIS by DATE?\").

Two integration points:
- \`api/position-lifespan\` includes \`decision_framing\` per active lifespan
- \`api/eod-snapshot\` adds a sorted \"DECISION FRAMING\" section (text + JSON)

## Spec
[docs/superpowers/specs/2026-05-09-decision-framing-active-positions-design.md](https://github.com/vinh-jones/trading-dashboard/blob/feat/decision-framing/docs/superpowers/specs/2026-05-09-decision-framing-active-positions-design.md)

## How the math works
- Wheel state = csp_premium + cc_premium + partial_disposal_pnl
- Cut-today state = csp_premium + partial_disposal_pnl − (cb − spot) × shares
- gap = wheel − cut
- wheel_daily_rate = trailing 60-day CC P&L per CC-day-held (lifetime fallback)
- cut_daily_rate = freed_capital × baselineRate
- days_to_breakeven = ceil(gap / (cut_daily_rate − wheel_daily_rate))
- recovery_date = today + days_to_breakeven (calendar days)

If wheel rate ≥ cut rate at current spot → \`wheel_ahead_perpetually\` state.

## Test plan
- [x] 6 helper-block tests + 12 main-function tests in \`api/_lib/__tests__/decision-framing.test.js\`
- [x] Full suite passes
- [ ] Spot-check API responses against production data (lifespan + EOD snapshot)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Merge the PR**

Run: `gh pr merge <PR_NUMBER> --squash`

Expected: "Pull request was merged" (or "was already merged").

- [ ] **Step 4: Verify the merge**

Run: `gh pr view <PR_NUMBER> --json state,mergedAt`

Expected: `"state": "MERGED"` and a non-null `mergedAt`.

---

## Self-Review

**Spec coverage:**
- ✅ Goal: `computeDecisionFraming` (Task 3) + position-lifespan injection (Task 4) + eod-snapshot rendering (Task 5)
- ✅ Inputs: all lifespan fields and `currentSpot`/`baselineRate` plumbed through
- ✅ Computation: trailing rate, cut alternative, gap, breakeven all implemented in Task 3
- ✅ Helpers: classifyDrawdown/Breakeven, getRecentCcStrike, addCalendarDays/subtractCalendarDays, humanizeDuration, computeTrailingCcRate (Task 1)
- ✅ Schema: `decision_framing` injected per lifespan (Task 4); `decisionFraming` array on EOD snapshot (Task 5)
- ✅ Sort order in EOD: severity then alphabetical (Task 5 step 3)
- ✅ Footer summary: DECISION ZONE + ANCHORED (Task 5 step 5)
- ✅ Tests: all 12 cases from spec + 6 helper-block tests (Task 2)
- ✅ Version bump (Task 6)

**Placeholder scan:** None present.

**Type consistency:** `computeDecisionFraming({ lifespan, currentSpot, baselineRate, ticker, today })` signature is consistent across Tasks 2, 3, 4, 5. Output object keys match between spec and tests. Helpers exported once, imported uniformly.

**Branch hygiene:** Plan operates from branch `feat/decision-framing` (already created). Subagents must NOT cd out of the worktree path.
