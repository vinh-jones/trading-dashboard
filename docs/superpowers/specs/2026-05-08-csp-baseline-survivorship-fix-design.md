# CSP Baseline — Survivorship Fix

**Date:** 2026-05-08
**Status:** Draft → awaiting user review
**Scope:** Backend-only fix to `computeCspBaseline` and its query. No UI changes.
**Related:** PR #98 (Issue 1 — apples-to-apples), this spec covers Issue 2 (survivorship + weighting).

## Problem

The `avg_csp_return_per_capital_day` rate that powers the cut-and-redeploy benchmark is computed from a survivor-only sample, using an unweighted mean of per-trade rates. Both choices inflate the rate.

**Survivorship.** [api/position-lifespan.js:43-51](../../api/position-lifespan.js) filters CSPs to `subtype = 'Close'` only. CSPs that ended in assignment (`subtype = 'Assigned'`) or were rolled at a loss (`subtype = 'Roll Loss'`) are excluded. The baseline therefore represents "average return of CSPs that didn't get assigned" — a curated subset no real strategy can replicate in steady state.

**Weighting.** [api/_lib/lifespan.js:524-540](../../api/_lib/lifespan.js) computes `mean(premium_i / (capital_i × days_i))`. A small short-duration CSP weighs equally with a large long-duration one, so portfolio-realized rate is misrepresented.

**Concrete impact (current state).** IREN lifespan baseline reports 0.0054/cap-day (~197% annualized). That is implausibly high for a wheel and traces directly to these two issues.

## Goals

1. Survivorship-corrected baseline that includes all closed CSP outcomes (`Close`, `Roll Loss`, `Assigned`).
2. Capital-day-weighted aggregation so the rate reflects portfolio-realized P&L, not arithmetic mean of per-trade rates.
3. Cut-framing for assignments: an assigned CSP's contribution uses `premium − realized_loss_at_assignment` where `realized_loss_at_assignment = (strike − spot_at_assignment) × shares`. This matches how the cut-and-redeploy benchmark already values the assignment loss in [api/_lib/lifespan.js:308-309](../../api/_lib/lifespan.js).
4. Transparent handling of missing data: assigned CSPs without `spot_at_assignment` are dropped from the sample with a counter, never silently treated as breakeven.

## Non-goals

- Issue 3 (idle-capital utilization). Hypothesis: fixing #2 absorbs most of the rate inflation. Re-evaluate after deploy. If verdicts still feel off, add a utilization factor in a follow-up.
- Backfilling historical `spot_at_assignment` for pre-2026-04-29 assignments. The column was added then; older rows are NULL and will be skipped.
- UI changes. The lifespan view already renders `vs_actual_pnl` and `avg_csp_return_per_capital_day`; their values just shift.
- Mark-to-market or "next-day-open" framings for assigned CSPs. User authorized cut-at-assignment-day-spot for simplicity.

## Design

### Layer 1 — Query (data layer)

Two callers fetch the baseline today: [api/position-lifespan.js:43-51](../../api/position-lifespan.js) and [api/ticker-detail.js:67](../../api/ticker-detail.js). Both must change identically.

Replace:

```js
.from("trades")
.select("id, premium_collected, capital_fronted, days_held, close_date")
.eq("type", "CSP")
.eq("subtype", "Close")
.gt("days_held", 0)
.gt("capital_fronted", 0)
.order("close_date", { ascending: false })
.limit(60);
```

With:

```js
.from("trades")
.select("id, subtype, premium_collected, capital_fronted, days_held, close_date, strike, contracts, spot_at_assignment")
.eq("type", "CSP")
.in("subtype", ["Close", "Roll Loss", "Assigned"])
.gt("days_held", 0)
.gt("capital_fronted", 0)
.order("close_date", { ascending: false })
.limit(60);
```

**Rationale for `limit=60`.** Recent regime matters for a contrarian strategy. The wider subtype net more than compensates for any per-bucket sample shrinkage. If sample size becomes a problem in practice, raise it in a follow-up.

### Layer 2 — Compute (`computeCspBaseline`)

Replace [api/_lib/lifespan.js:524-540](../../api/_lib/lifespan.js):

```js
export function computeCspBaseline(cspTrades) {
  let totalPnl = 0;
  let totalCapDays = 0;
  let included = 0;
  let droppedAssignedNoSpot = 0;

  for (const t of cspTrades) {
    const premium = parseFloat(t.premium_collected) || 0;
    const capital = parseFloat(t.capital_fronted)   || 0;
    const days    = parseFloat(t.days_held)         || 0;
    if (capital <= 0 || days <= 0) continue;

    let pnl;
    if (t.subtype === "Assigned") {
      const spot      = parseFloat(t.spot_at_assignment);
      const strike    = parseFloat(t.strike) || 0;
      const contracts = parseFloat(t.contracts) || 0;
      if (!Number.isFinite(spot)) {
        droppedAssignedNoSpot++;
        continue;
      }
      const realizedLoss = (strike - spot) * contracts * 100; // positive when ITM
      pnl = premium - realizedLoss;
    } else {
      pnl = premium; // Close / Roll Loss
    }

    totalPnl     += pnl;
    totalCapDays += capital * days;
    included++;
  }

  const avg = totalCapDays > 0 ? totalPnl / totalCapDays : 0;

  return {
    avg_return_per_capital_day: avg,
    sample_size: included,
    dropped_assigned_no_spot: droppedAssignedNoSpot,
  };
}
```

**Key invariants:**
- For an assigned CSP whose spot equals strike (assigned at-the-money), `realizedLoss = 0` and `pnl = premium` — degenerates correctly to the closed-CSP case.
- For an assigned CSP whose spot is above strike (assigned but ITM for the put writer — rare), `realizedLoss` is negative, `pnl > premium`. Correctly counts the bonus.
- The aggregator is `Σ pnl / Σ (capital × days)`, the portfolio-realized rate.

### Layer 3 — Warning surface

In `buildLifespan` ([api/_lib/lifespan.js:332-339](../../api/_lib/lifespan.js)), append to warnings when rows were dropped:

```js
if (cspBaseline.dropped_assigned_no_spot > 0)
  warnings.push(
    `CSP baseline dropped ${cspBaseline.dropped_assigned_no_spot} assigned CSP(s) ` +
    `with missing spot_at_assignment data; baseline may slightly understate downside`
  );
```

This surfaces in the existing `data_completeness.warnings` array so users see when data gaps are pulling the rate up.

### Layer 4 — Tests

Create new file `api/_lib/__tests__/lifespan-baseline.test.js` (no existing test file for `computeCspBaseline`).

Cases:

| # | Input | Expected |
|---|-------|----------|
| 1 | Single closed CSP: $500 premium, $50,000 capital, 30 days | rate = 500 / 1,500,000 = 0.000333 |
| 2 | Single assigned CSP: strike $50, spot $48, 10 contracts, $300 premium, $50,000 capital, 30 days | realizedLoss = (50−48) × 10 × 100 = $2,000; pnl = 300 − 2,000 = −$1,700; rate = −1,700 / 1,500,000 = −0.001133 |
| 3 | Assigned CSP with spot equal to strike | rate equals premium / capital_days (degenerate case) |
| 4 | Mixed sample: 2 closed + 1 assigned-with-loss | matches `Σ pnl / Σ cap_days`, NOT the mean of per-trade rates |
| 5 | Roll Loss with negative premium | included; pulls rate down |
| 6 | Assigned CSP with NULL `spot_at_assignment` | skipped; `dropped_assigned_no_spot = 1`; `sample_size` excludes it |
| 7 | All rows have `capital ≤ 0` or `days ≤ 0` | sample_size = 0, rate = 0 |
| 8 | Empty array | rate = 0, sample_size = 0 |

Test 4 is the load-bearing one — it proves we switched from mean-of-rates to capital-day-weighting.

## Expected behavior change

The 0.54%/cap-day baseline rate (≈197% annualized) will drop. By how much depends on the assignment frequency in the user's last-60 sample. We should expect:

- If ~10% of recent CSPs were assigned and average cut-loss is meaningful, rate likely lands in 0.20–0.35%/cap-day range (≈73–128% annualized).
- Cut-and-redeploy `vs_actual_pnl` numbers across all closed lifespans will shift. Some "outperformed" verdicts may flip to "even" or "underperformed".
- This is a deliberate correction, not a regression. The new rate is a more honest baseline.

We will not touch the `verdict` thresholds. Verdict logic stays at `vs_actual_pnl > 0 → outperformed` etc.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| User loses trust in past verdicts that flip | Acknowledge in commit message: this corrects a known overstatement bug; verdicts that flip were never reliable to begin with. |
| Sample size shrinks below 10 → existing low-confidence warning fires | Existing warning already handles this. |
| Many legacy `Assigned` rows with NULL spot → big `dropped_assigned_no_spot` count → warning noise | Acceptable; warning is informational. Backfill is a separate task. |
| Roll Loss data interpretation differs from monthly-review | Spot-check against [monthly-review.js:613](../../api/monthly-review.js) — both treat Roll Loss as a closed CSP leg. Consistent. |

## Out of scope

- Issue 3 (utilization). Tracked separately; revisit after this lands.
- Backfill historical `spot_at_assignment`.
- Switching `limit=60` to a time window.
- Per-ticker baselines (currently global).

## Versioning

Patch bump: `1.108.2 → 1.108.3` per CLAUDE.md (fix, not feature). Bump `package.json` and `src/lib/constants.js#VERSION` in the same commit.

## Acceptance criteria

1. `computeCspBaseline` returns capital-day-weighted rate with mixed subtypes.
2. Both API endpoints (`position-lifespan`, `ticker-detail`) pass through the widened query.
3. New test file passes all 8 cases.
4. Existing tests (including `tickerVerdict.test.js`) still pass.
5. Manual spot-check on IREN lifespan: rate is materially lower than 0.0054, verdict text updates accordingly.
6. Version bumped, committed, pushed, PR merged.
