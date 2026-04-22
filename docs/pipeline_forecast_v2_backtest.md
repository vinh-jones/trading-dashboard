# Pipeline Forecast v2 — Backtest Analysis

**Date:** 2026-04-22
**Scope:** Calibrate the capture curves in `SPEC_PIPELINE_FORECAST_V2.md` against historical closed trades.
**Data:** 268 closed trades (201 CSP, 67 CC) from 2025-06-26 → 2026-04-17, spanning Public.com + prior brokerage.

---

## TL;DR

- **Two buckets calibrated from data, seeded into `forecast_calibration`:**
  - CSP `profit_60_plus`: spec `0.60` → calibrated **`0.76`** (n=113)
  - CC `profit_80_plus`: spec `0.85` → calibrated **`0.89`** (n=28)
- **All other buckets keep spec starting values.** They cannot be meaningfully calibrated from closed-trade data alone — the methodology is tautological or contaminated (see below).
- **Two new CSP buckets added to patch spec gaps:** `profit_40_60_dte_low` → `0.70`, `profit_20_40_dte_high` → `0.58`. Both marked `uncalibrated, starting estimate`.
- **New table `position_daily_state` created** to capture daily open-position snapshots. This is the structural fix that unlocks proper calibration in 3–6 months.
- **Flag:** CC `dte_very_low` bucket shows evidence of defensive-roll contamination in real data. Spec's `0.92` starting value may be optimistic in practice.

---

## The methodology finding (more important than any single number)

The spec defines capture buckets by **current open-position state** ("position currently at ≥60% profit with DTE > 10 — what will it eventually realize?"). The backtest methodology in §Backtest computes mean capture **per bucket at close time**.

For **cross-threshold buckets** (`profit_60_plus`, `profit_80_plus`) these line up — a trade that ended at 60%+ capture was, at some point, in the "currently ≥60%" state, and the observed final capture is a reasonable estimate of what similar positions realize today.

For **in-band and low-profit buckets**, the two framings collapse:

- "Trades that closed in the 40–60% band" will, by construction, have mean capture in the 40–60% band. That doesn't tell us anything about what a position *currently* at 45% profit will eventually realize.
- "Trades that closed at <20% profit" will always have low/negative mean capture — that's the selection criterion, not a finding.

Observed tautological buckets (keeping spec values):

| Bucket | n | Observed mean | Why not usable |
|---|---|---|---|
| CSP `profit_40_60_dte_high` | 48 | 0.50 | Closed-in-band mean = in band |
| CSP `profit_40_60_dte_low` (new) | 4 | 0.54 | Closed-in-band, also n<5 |
| CSP `profit_20_40_dte_high` (new) | 17 | 0.34 | Closed-in-band |
| CSP `profit_20_plus_dte_low` | 1 | — | Narrowed after new-bucket split; n<5 |
| CSP `profit_low_dte_high` | 16 | −0.02 | Closed-low mean = low |
| CSP `profit_low_dte_low` | 2 | — | n<5 regardless |

**The fix isn't "calibrate what we can and move on" — it's capturing the data needed for proper calibration while using starting values for the rest.** That's what the new `position_daily_state` table is for (§Structural fix below).

---

## Calibrated buckets (usable from closed-trade data)

### CSP `profit_60_plus` — spec `0.60` → **`0.76`** (n=113)

Trades that closed at ≥60% profit captured **76%** on average — substantially more than the spec assumed. The long tail comes from assignments (capture = 1.0) and the fact that most positions that hit 60/60 continue higher before closing.

| Window | n | Mean | Median | Std |
|---|---|---|---|---|
| Full dataset | 113 | **0.764** | 0.702 | 0.158 |
| Q1 2026 (close-date basis) | 29 | 0.790 | 0.756 | 0.176 |
| Q1 2026 (exec-date basis) | 26 | 0.764 | 0.699 | 0.170 |
| Last 2 months | 20 | 0.710 | 0.667 | 0.139 |

**Decision:** use full-dataset mean **0.76**. Q1 numbers are noisier (smaller n); last-2-month drift to 0.71 is thin (n=20) but worth watching — could indicate a behavior shift toward closing closer to 60/60 exactly rather than letting winners run.

### CC `profit_80_plus` — spec `0.85` → **`0.89`** (n=28)

Very stable. Small upward nudge.

| Window | n | Mean | Median | Std |
|---|---|---|---|---|
| Full dataset | 28 | **0.892** | 0.880 | 0.061 |
| Q1 2026 (close-date basis) | 17 | 0.884 | 0.880 | 0.048 |
| Q1 2026 (exec-date basis) | 20 | 0.889 | 0.880 | 0.051 |
| Last 2 months | 21 | 0.874 | 0.857 | 0.045 |

**Decision:** **0.89**. No meaningful drift.

---

## CC `dte_very_low` — not a clean calibration, but a meaningful finding

The bucket includes CCs closed within 3 DTE. Observed mean: **−1.79** (n=13, std 2.72). This is **not** a calibration — it's two populations mixed together:

1. CCs that rode to near-worthless expiry (capture → 1.0)
2. CCs defensively closed because stock blew through strike (capture deeply negative)

Examples of population (2) in the data:

| Ticker | Strike | Premium/share | Buy-to-close | Capture |
|---|---|---|---|---|
| HOOD | $79 | $0.21 | −$1.99 | **−8.47x** |
| CRDO | $114 | $0.35 | −$2.16 | −5.17x |
| APP | $450 | $1.47 | −$8.78 | −4.97x |
| SHOP | $124 | $0.42 | −$1.56 | −2.71x |

**Action:** Keep spec's `0.92` starting value for `dte_very_low`, but note in `forecast_calibration.notes` that the bucket is contaminated by defensive rolls and the true value is likely lower. Proper separation requires stock-price-at-close — not available historically, but captured going forward via `position_daily_state`.

Same contamination in `default` CC (n=22, mean 0.25) — kept at spec `0.75` for now.

---

## Spec gaps patched

`cspCaptureCurve()` in the spec doesn't cover two states:

- `profit ∈ [0.20, 0.40)` with `DTE > 10` — 17 trades fell through to "unclassified" in the initial bucketing
- `profit ∈ [0.40, 0.60)` with `DTE ≤ 10` — 4 trades that were previously swept into `profit_20_plus_dte_low`

New buckets added with starting estimates:

| Bucket | Condition | Starting estimate | Reasoning |
|---|---|---|---|
| `profit_40_60_dte_low` | `profit ∈ [0.40, 0.60) ∧ DTE ≤ 10` | **0.70** | Near expiry with decent profit — rides to 60/60 or cleanup; sits between `profit_40_60_dte_high` (0.65) and `profit_20_plus_dte_low` (0.90). |
| `profit_20_40_dte_high` | `profit ∈ [0.20, 0.40) ∧ DTE > 10` | **0.58** | Moderate profit, time-decay opportunity — might hit 60/60 or ride to expiry; sits between `profit_low_dte_high` (0.55) and `profit_40_60_dte_high` (0.65). |

Both flagged `uncalibrated, starting estimate` in `forecast_calibration.notes`. Update `cspCaptureCurve()` when the v2 algorithm is implemented:

```js
if (currentProfitPct >= 0.40 && currentProfitPct < 0.60 && dte <= 10) return 0.70; // NEW
if (currentProfitPct >= 0.20 && currentProfitPct < 0.40 && dte > 10)  return 0.58; // NEW
```

---

## Structural fix: `position_daily_state` table

The backtest surfaced a limitation that no amount of calibration can fix from closed-trade data alone: **we need to observe positions while they are open, in various states**, not just at their terminal state.

New table `position_daily_state` (created in this migration) captures the inputs that the spec's capture curves depend on, once per market day per open position:

- `ticker`, `position_type`, `strike`, `expiry`, `contracts`, `premium_at_open`
- `current_profit_pct`, `dte`, `stock_price` (all state fields)
- `cost_basis`, `is_below_cost`, `position_pnl`, `distance_to_strike_pct` (CC state)
- `position_key` — stable identifier (`ticker|type|strike|expiry`) so one position's trajectory can be reconstructed

**Re-run `scripts/calibrate_forecast.js` in 3–6 months against this table** (not the closed-trades sheet) to answer the question the spec actually asks: *of positions observed in state X, what fraction ended at capture Y?*

Until then, closed-trade calibrations are the best we have for cross-threshold buckets, and spec starting values stand for everything else.

---

## Seeded `forecast_calibration` rows

One row per bucket per position type, `calibration_date = 2026-04-22`. Included in the migration.

| position_type | bucket | calibrated_capture | sample_size | source |
|---|---|---|---|---|
| csp | profit_60_plus | **0.76** | 113 | CALIBRATED (full dataset) |
| csp | profit_40_60_dte_high | 0.65 | 48 | spec start (tautological) |
| csp | profit_40_60_dte_low | 0.70 | 4 | NEW spec gap, uncalibrated estimate |
| csp | profit_20_plus_dte_low | 0.90 | 1 | spec start (narrowed after split) |
| csp | profit_20_40_dte_high | 0.58 | 17 | NEW spec gap, uncalibrated estimate |
| csp | profit_low_dte_low | 0.93 | 2 | spec start (n<5) |
| csp | profit_low_dte_high | 0.55 | 16 | spec start (tautological) |
| cc | profit_80_plus | **0.89** | 28 | CALIBRATED (full dataset) |
| cc | profit_60_plus_dte_low | 0.85 | 4 | spec start (n<5) |
| cc | dte_very_low | 0.92 | 13 | spec start (CONTAMINATED — likely optimistic) |
| cc | default | 0.75 | 22 | spec start (contaminated) |
| cc | below_cost_strike_near | 0.20 | 0 | spec start (needs close-time state) |
| cc | strike_near_non_below_cost | 0.50 | 0 | spec start (needs close-time state) |

---

## Re-running

`scripts/calibrate_forecast.js` runs this backtest from the raw CSVs. Monthly cadence: download the Public.com sheet export, drop into `scripts/data/`, re-run. The script upserts into `forecast_calibration` with the current date, preserving history.

Once `position_daily_state` has ≥3 months of data, switch the script's data source from the closed-trades sheet to the table — see comments in the script.

---

## Out of scope for this backtest

- Wiring `forecast_calibration` into `api/snapshot.js` (currently uses the flat-60% at `api/snapshot.js:152`). That's v2 implementation, not calibration.
- Building the Pipeline Detail page.
- Adding the phase classification.
- Writing `position_daily_state` rows from the daily cron. The table exists; the write logic comes with v2 implementation.
