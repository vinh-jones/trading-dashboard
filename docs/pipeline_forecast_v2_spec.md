# Spec: Pipeline Forecast v2

> **Note (2026-04-22):** This spec has been patched with two new CSP bucket
> branches that close gaps in the original `cspCaptureCurve()`. Two buckets
> (CSP `profit_60_plus`, CC `profit_80_plus`) have also been calibrated from
> 268 historical closed trades. See [`pipeline_forecast_v2_backtest.md`](./pipeline_forecast_v2_backtest.md)
> for methodology, limitations, and the calibrated values. The calibrated
> values are seeded into the `forecast_calibration` table (see migration
> `supabase/migrations/2026-04-22-forecast-v2-scaffold.sql`); the v2
> implementation should read from that table at render time rather than
> hard-coding the values from the curves below.

## Context

The current pipeline forecast uses a flat 60% capture assumption applied to remaining premium across all open positions regardless of DTE, position type, or position state. This works in the first week of a calendar month but produces increasingly inaccurate forecasts as the month progresses because it conflates two distinct questions:

1. **How much premium will this position realize eventually?** (position-lifetime question)
2. **How much of that realization will land in the current calendar month?** (calendar-timing question)

The flat 60% answers neither question accurately. It overcounts cross-month positions (May expirations won't realize in April unless they hit 60/60 early) and undercounts positions that will ride to expiry (expected capture ~93%, not 60%).

This spec replaces the flat capture assumption with a position-type-aware expected-final-capture function, layered with calendar-month timing logic. Also adds a Pipeline Detail page for mid-month check-ins and end-of-month review.

---

## Scope

**In scope:**
- Position-type-aware capture curves (CSP + CC)
- Calendar-month realization-timing logic
- Below-cost CC handling (possibility of negative expected capture)
- Main dashboard summary: 6-number layout
- New Pipeline Detail page with three breakdown blocks
- Backtest methodology to calibrate starting-point numbers against actual trading history
- Data model updates to `daily_snapshots`

**Out of scope:**
- Aggregate win-rate projections (false precision, not built)
- Historical pipeline trend charts (noise, not built)
- Per-ticker pipeline breakdowns (lives on Positions tab)
- Probabilistic confidence intervals on the forecast (v3 if at all)

---

## Position capture curves

### CSP capture curve

```js
function cspCaptureCurve(position) {
  const { currentProfitPct, dte } = position;

  // Already past 60/60 threshold — will close at 60/60
  // Calibrated 2026-04-22: observed 0.76 across 113 closed trades (was 0.60)
  if (currentProfitPct >= 0.60) return 0.60;

  // In the 40-60% profit band with DTE still meaningful — might hit 60/60
  if (currentProfitPct >= 0.40 && dte > 10) return 0.65;

  // In the 40-60% profit band near expiry — rides to 60/60 or cleanup
  // NEW (spec gap patched 2026-04-22): uncalibrated, starting estimate
  if (currentProfitPct >= 0.40 && dte <= 10) return 0.70;

  // Moderate profit, getting close to expiry — likely rides to cleanup
  if (currentProfitPct >= 0.20 && dte <= 10) return 0.90;

  // Moderate profit with time — may hit 60/60 or decay further
  // NEW (spec gap patched 2026-04-22): uncalibrated, starting estimate
  if (currentProfitPct >= 0.20 && dte > 10) return 0.58;

  // Low profit or underwater, getting close to expiry — rides to cleanup or assignment
  if (currentProfitPct < 0.20 && dte <= 10) return 0.93;

  // Low profit, DTE still meaningful — uncertain, could rally and hit 60/60
  if (currentProfitPct < 0.20 && dte > 10) return 0.55;

  // Default fallback
  return 0.60;
}
```

### CC capture curve

```js
function ccCaptureCurve(position) {
  const { currentProfitPct, dte, stockPrice, strike, costBasis, positionPnl } = position;
  const distanceToStrike = (strike - stockPrice) / strike;
  const isBelowCost = strike < costBasis;

  // Below-cost CC with stock approaching strike — defensive roll territory
  // Expected capture can go negative if closing for a debit
  if (isBelowCost && distanceToStrike < 0.02) {
    return positionPnl < 0 ? -0.20 : 0.20;
  }

  // Any CC with stock very close to strike — defensive close likely
  if (distanceToStrike < 0.015) {
    return 0.50;
  }

  // Already past 80% profit threshold — will close at standard CC threshold
  if (currentProfitPct >= 0.80) return 0.85;

  // Near expiry with meaningful profit — will close at threshold before expiry
  if (currentProfitPct >= 0.60 && dte <= 5) return 0.85;

  // Very close to expiry — ride out, small cleanup or call-away
  if (dte <= 3) return 0.92;

  // Default — moderate profit, moderate DTE
  return 0.75;
}
```

### Dispatcher

```js
function expectedFinalCapturePct(position) {
  if (position.type === 'csp') return cspCaptureCurve(position);
  if (position.type === 'cc')  return ccCaptureCurve(position);
  return 0.60; // fallback for unknown types
}
```

### Expected realization (lifetime)

```js
function expectedTotalRealization(position) {
  const finalCapturePct = expectedFinalCapturePct(position);
  return position.premiumAtOpen * finalCapturePct;
}

function expectedRemainingRealization(position) {
  const expectedTotal = expectedTotalRealization(position);
  const alreadyRealized = position.realizedToDate || 0;
  return Math.max(expectedTotal - alreadyRealized, position.premiumAtOpen * -0.50); // floor at -50% of premium
}
```

The floor prevents runaway negative forecasts from below-cost CC scenarios. A CC can realize negative premium on a roll, but not arbitrarily negative.

---

## Calendar-month timing logic

Expected realization is separated from when that realization lands. For each open position:

```js
function realizationThisMonth(position, today) {
  const endOfMonth = getEndOfMonth(today);
  const expectedRemaining = expectedRemainingRealization(position);

  // Position expires in current calendar month
  if (position.expiry <= endOfMonth) {
    return expectedRemaining; // All of it lands this month
  }

  // Position expires in next calendar month
  // Only the portion that closes early (at 60/60 for CSPs, 80-90% for CCs) lands this month
  if (position.type === 'csp') {
    // CSP in current month via 60/60 early close
    if (position.currentProfitPct >= 0.60) return expectedRemaining; // Will close now
    if (position.currentProfitPct >= 0.40) return expectedRemaining * 0.55; // Might close early
    if (position.currentProfitPct >= 0.20) return expectedRemaining * 0.20; // Less likely
    return expectedRemaining * 0.05; // Unlikely to close in current month
  }

  if (position.type === 'cc') {
    // CCs expiring next month are rare (weekly cycle) but possible
    if (position.currentProfitPct >= 0.80) return expectedRemaining; // Will close now
    if (position.currentProfitPct >= 0.60) return expectedRemaining * 0.60;
    return expectedRemaining * 0.15;
  }

  return 0;
}
```

---

## Main dashboard summary

Six numbers, two blocks. No charts, no per-position breakdowns.

```
┌─ APRIL INCOME ────────────────────┐  ┌─ PIPELINE HEALTH ─────────────────┐
│                                   │  │                                   │
│  Realized            $6,895      │  │  Forward premium        $4,200   │
│  Expected this month $1,550      │  │  CSP / CC split        60% / 40% │
│  ──────────────────────────       │  │  Phase                 Flexible  │
│  April forecast      $8,445      │  │                                   │
│  vs $15k target      ↓ $6,555    │  │  [Pipeline Detail →]             │
│                                   │  │                                   │
└───────────────────────────────────┘  └───────────────────────────────────┘
```

### Phase classification

- **Flexible:** CSP premium makes up >55% of forward pipeline
- **Constraint:** CC premium makes up >55% of forward pipeline (post-assignment phase, February's structural lesson)
- **Mixed:** neither exceeds 55%

### Target comparison

The `vs target` line uses the monthly baseline target ($15k per memory context). When forecast ≥ target, shows `✓ on track`. When below, shows arrow + gap amount. Avoid framing as percentage — the dollar gap is more actionable.

---

## Pipeline Detail page

Dedicated page accessed from the main dashboard via `[Pipeline Detail →]` link. Three blocks.

### Block 1: Current month realization

```
CURRENT MONTH — APRIL 2026

  Realized to date                    $6,895
  
  High-confidence remaining           $1,200
    Positions expiring April, ≥60% profit
    3 positions (KTOS $38p, CDE $22 CC, HOOD $100 CC)
  
  Moderate-confidence remaining       $350
    Positions near 60/60 threshold in May
    2 positions (CLS $360p, GLW May 1)
  
  ────────────────────────────────────────
  April forecast total                $8,445
  April target                       $15,000
  Gap                                ($6,555)
```

Clicking any confidence bucket expands to show the positions contributing to it.

### Block 2: Forward pipeline (next month+)

```
NEXT MONTH — MAY 2026

  Expected realization May            $2,650
  (positions expiring May, net of early closes)
  
  Of these, positions that may close in April  $450
  (60/60 early close probability)


FURTHER OUT

  Positions expiring June+            $550
    1 LEAP-hedged position, 2 long-dated CSPs
```

### Block 3: By position type

```
BY POSITION TYPE

  CSP pipeline                        $2,520   (60% of forward)
    Active deployment premium
    12 open positions
  
  CC pipeline                         $1,680   (40% of forward)
    Post-assignment premium
    7 open positions
    Of which below-cost              $420
    
  Below-cost roll risk                Watch
    HOOD $105 CC (stock $103.40 — within 1.5%)
    Action: if stock hits $105, close and roll to $110 per framework
```

The below-cost roll risk callout surfaces positions that meet the "stock within $1-2 of CC strike" trigger from your below-cost CC framework. This isn't a forecast number — it's an action flag.

---

## Data model

### Modified table: `daily_snapshots`

Add fields for the new forecast structure:

```sql
ALTER TABLE daily_snapshots
  ADD COLUMN forecast_realized_to_date NUMERIC,
  ADD COLUMN forecast_this_month_remaining NUMERIC,
  ADD COLUMN forecast_month_total NUMERIC,
  ADD COLUMN forecast_target_gap NUMERIC,
  ADD COLUMN forward_pipeline_premium NUMERIC,
  ADD COLUMN csp_pipeline_premium NUMERIC,
  ADD COLUMN cc_pipeline_premium NUMERIC,
  ADD COLUMN below_cost_cc_premium NUMERIC,
  ADD COLUMN pipeline_phase TEXT; -- 'flexible' | 'constraint' | 'mixed'
```

The existing `forecast_60pct` or similar flat-assumption field should be kept for backward compatibility during transition, then deprecated in v2.1.

### New helper table: `forecast_calibration`

Stores calibrated capture rates from the backtest:

```sql
CREATE TABLE forecast_calibration (
  id SERIAL PRIMARY KEY,
  position_type TEXT NOT NULL,  -- 'csp' | 'cc'
  bucket TEXT NOT NULL,          -- e.g., 'profit_60_plus', 'profit_40_60_dte_high'
  calibrated_capture NUMERIC NOT NULL,
  sample_size INTEGER NOT NULL,
  calibration_date DATE NOT NULL,
  notes TEXT
);
```

The capture curves default to the starting-point values in this spec, but are overridden by calibrated values from this table when available. This allows the algorithm to improve over time as data accumulates.

---

## Backtest methodology

**Claude Code has access to the trades table and should run this backtest as part of v2 implementation, populating `forecast_calibration` with calibrated capture rates.**

### Goal

Replace the starting-point capture rates in this spec with empirical values derived from actual closed trades. This calibrates the algorithm to user's actual trading behavior.

### Data requirements

- `trades` table with closed CSPs and CCs (already exists)
- For each closed trade: open date, close date, expiry date, strike, premium at open, premium at close, outcome (closed / assigned / called away / expired worthless), position type

### Methodology

For each closed trade, compute:

```
final_capture_pct = (premium_at_open - premium_at_close) / premium_at_open
```

For expired-worthless and assigned/called-away trades, `premium_at_close` is effectively $0, so capture is 100%.

Then bucket trades by the conditions used in the capture curves:

**CSP buckets:**
- `profit_60_plus` — trades where profit crossed 60% before close
- `profit_40_60_dte_high` — trades closing in the 40-60% profit range with DTE > 10 at close
- `profit_20_plus_dte_low` — trades closing at 20%+ profit with DTE ≤ 10
- `profit_low_dte_low` — trades closing below 20% profit with DTE ≤ 10 (including assignments)
- `profit_low_dte_high` — trades closing below 20% with DTE > 10

**CC buckets:**
- `below_cost_strike_near` — below-cost CCs that closed with stock within 2% of strike
- `strike_near_non_below_cost` — any CC that closed with stock within 1.5% of strike
- `profit_80_plus` — CCs closing at 80%+ profit
- `profit_60_plus_dte_low` — CCs closing at 60%+ profit with DTE ≤ 5
- `dte_very_low` — CCs closing with DTE ≤ 3
- `default` — everything else

For each bucket, compute mean capture rate across all trades in that bucket. Require minimum sample size of 5 trades per bucket; if below, fall back to the starting-point value in this spec and flag the bucket as "uncalibrated, n<5."

### Output

Write one row per bucket to `forecast_calibration` with:
- `position_type`, `bucket`, `calibrated_capture` (mean), `sample_size`, `calibration_date` (today), `notes` (e.g., "n=7, std=0.08")

### Limitations to document

- **4 months of data is thin** for some buckets. Buckets with n<5 should keep starting-point values.
- **Behavior may be changing.** If your trading style has evolved (faster closes in Q1 vs. held longer in early days), recent trades are more representative. Consider weighting the last 2 months heavier, or computing calibrations on just Q1 2026 data and noting this.
- **Recalibration cadence:** re-run the backtest monthly as part of review hygiene. Add a "last calibrated: YYYY-MM-DD" indicator on the Pipeline Detail page so stale calibration is visible.

### Implementation approach

Claude Code should write this as a standalone script (`scripts/calibrate_forecast.js` or equivalent) that can be re-run on demand. The main dashboard and Pipeline Detail page query `forecast_calibration` at render time to apply calibrated values.

---

## Implementation notes for Claude Code

1. **Run the backtest first, before building UI.** The backtest output informs the starting-point capture values. Building UI against uncalibrated defaults and then swapping in calibrated ones later invites inconsistency.

2. **Position type detection.** The `trades` and `positions` tables should have a `type` field indicating CSP vs. CC. If the current schema doesn't distinguish clearly, a derivation may be needed (puts with positive collateral = CSP; calls against existing shares = CC). Verify before implementation.

3. **Handle positions with partial realizations.** Some positions have multiple rolls — the `realizedToDate` for an open position should include all closed legs of the sequence. Worth verifying how rolls are currently represented in the trades table.

4. **`positionPnl` for below-cost CCs.** The CC capture curve references `positionPnl` (current unrealized P&L on the CC leg). This needs to be computed from current mark vs. entry, which means quote data is required. If quote data isn't reliably available for every position, fall back to a conservative assumption (treat ambiguous below-cost CCs as 0.20 expected capture, not negative).

5. **`daily_snapshots` write logic.** The cron that writes daily_snapshots at 4:30 PM ET should populate the new fields using the v2 algorithm. Ensure it reads calibrated values from `forecast_calibration` if present.

6. **Main dashboard layout matters.** The 6-number layout is tight. On mobile, it should stack vertically with clear separation between the two blocks. Don't let the `[Pipeline Detail →]` link become a hamburger-buried secondary nav; it should be clickable and visible at the block level.

7. **Pipeline Detail page is opened deliberately.** It's okay for it to be information-dense. Users landing here are in "think about the pipeline" mode, not "glance and move on" mode. Resist the urge to simplify.

8. **Below-cost roll risk flagging.** The "Watch HOOD $105 CC" callout is an action-oriented alert, not a forecast metric. It should be visually distinct from the forecast numbers — consider a subtle amber accent to signal "this needs attention" without screaming.

9. **Backward compatibility during transition.** Keep the old flat-60% field on `daily_snapshots` populated for at least 30 days after v2 ships, so historical comparisons still work. Deprecate in a follow-up.

10. **Don't build phase-history tracking.** The phase classification is a current-state metric. Do not add "phase over time" charts — that was explicitly listed as out of scope.

---

## Acceptance criteria

### Algorithm
- [ ] `cspCaptureCurve()` implemented with all 5 buckets
- [ ] `ccCaptureCurve()` implemented with all 6 buckets including below-cost handling
- [ ] `expectedFinalCapturePct()` dispatcher correctly routes by position type
- [ ] `realizationThisMonth()` correctly handles current-month vs. next-month positions
- [ ] Below-cost CC with stock within 2% of strike produces expected capture ≤ 0.20
- [ ] Negative expected capture capped at -50% of premium at open

### Backtest
- [ ] Backtest script runs against `trades` table without errors
- [ ] Populates `forecast_calibration` with one row per bucket per position type
- [ ] Buckets with n<5 are flagged as uncalibrated
- [ ] Output includes sample size and standard deviation in notes field
- [ ] Script is re-runnable (doesn't fail on existing calibration rows)

### Main dashboard
- [ ] April Income block shows 4 rows: realized, expected remaining, total forecast, vs target
- [ ] Pipeline Health block shows 3 rows plus drill-down link
- [ ] Phase classification correctly identifies flexible / constraint / mixed
- [ ] Target comparison shows dollar gap, not percentage
- [ ] On track state renders as `✓ on track` not arrow + negative gap
- [ ] Mobile layout stacks the two blocks vertically with clear separation

### Pipeline Detail page
- [ ] Current Month block shows realized, high-confidence, moderate-confidence, total, target, gap
- [ ] Confidence buckets are clickable and expand to show contributing positions
- [ ] Next Month block shows expected realization + early-close portion
- [ ] Further Out block shows 2+ month positions
- [ ] By Position Type block shows CSP / CC split with percentages
- [ ] Below-cost roll risk callout appears when any CC has stock within 2% of strike
- [ ] Below-cost roll risk is visually distinct (amber accent)

### Data model
- [ ] `daily_snapshots` has all new fields added
- [ ] `forecast_calibration` table created and seeded via backtest
- [ ] Legacy flat-60% field retained for 30 days
- [ ] 4:30 PM ET cron populates new fields using calibrated values when available
- [ ] Last-calibrated date visible on Pipeline Detail page

### Integration
- [ ] Pipeline Detail page accessible from main dashboard drill-down
- [ ] Clicking below-cost roll risk callout navigates to the affected position
- [ ] Manual backtest re-run button or documented script location for monthly re-calibration

---

## Open questions

1. **Phase threshold — 55%?** The flexible/constraint split is defined at 55% of forward pipeline. Worth validating against actual historical months — was February's constraint phase above 55% CC? If the threshold is wrong in either direction, classification is misleading. Claude Code should flag if the backtest suggests a different threshold.

2. **Target on non-calendar-month basis?** The monthly $15k target is calendar-month-based, but the wheel doesn't respect calendar boundaries. A position opened March 28 expiring April 25 is "an April trade" by realization but "a March decision" by deployment. Worth considering whether a trailing-28-day view is useful alongside calendar-month — but this is a v3 thought, not a v2 requirement.

3. **Forecast precision display.** The examples above show forecasts to the nearest dollar. Given the starting-point calibration uncertainty, this is false precision. Round to nearest $50 on display? Nearest $100? The algorithm can compute precisely; the display should match confidence level. Suggest $50 rounding on forecast numbers, exact on realized numbers.

---

## Dependencies

- **Prerequisite:** None. Can be built independently.
- **Downstream:** Monthly review tooling will consume `forecast_calibration` to analyze forecast accuracy over time ("how close did April forecast end up to actual April realization"). That's a v2.1 monthly review enhancement.
- **Framework cross-reference:** `below_cost_cc_framework.md` for the "stock within $1-2 of CC strike" defensive close trigger.

---

## What NOT to build (v2)

- Probabilistic confidence intervals ("75% confidence forecast is $8k-$9k")
- Multi-month forecast projections beyond current + next + 2+ bucket
- Per-ticker pipeline views (belongs on Positions tab)
- Forecast accuracy tracking UI (v2.1 monthly review concern)
- Phase-over-time trend charts (noise)
- Probability-of-hitting-target metric (false precision)
- Pipeline alerts / notifications (v3 if at all)
- Automatic recalibration cron (manual re-run is fine for v2)
