# Multi-Assignment Cut-and-Redeploy Benchmark Fix

**Date:** 2026-05-08
**Status:** Approved, ready to implement
**Scope:** Backend-only fix to the cut-and-redeploy benchmark in `buildLifespan`.
**Related:** PRs #98, #99, #100 (prior fixes to the same benchmark)

## Problem

For multi-assignment lifespans, the cut-and-redeploy benchmark uses only `firstAssignment` to compute realized loss, freed capital, and the CSP premium credited back. But the wheel side (`total_lifespan_pnl`) aggregates *all* CSP premiums across `assignment_events`. That asymmetry inflates wheel outperformance.

CRDO concrete impact (verified against trades table):
- Wheel side `total_lifespan_pnl` = $10,463 (includes both Feb 13 and Feb 20 CSP premiums)
- Cut side `vs_actual_pnl` = +$5,428 — but only Feb 13 was modeled

For single-assignment lifespans (IREN), no asymmetry exists; current behavior is correct.

## Approved framing: Interpretation B

The cut-and-redeploy alternative writes the same CSPs the user actually wrote (because spot price doesn't care which scenario), takes assignment on the same ones, but cuts at each assignment instead of holding. Each cut produces:
- A realized loss at that assignment's spot
- A freed capital pool that redeploys at the baseline rate for the remaining-lifespan window

Rejected: Interpretation A ("cut and walk away from this name") would also require stripping subsequent CSPs and CCs from the wheel side to be apples-to-apples. That's counterfactual surgery.

## Formula

```
netOutcome = Σ csp_premium_collected_i
           − Σ realized_loss_i
           + Σ (freed_capital_i × baseline_rate × days_remaining_after_assignment_i)

where, for each assignment event i:
  freed_capital_i  = spot_at_assignment_i × shares_added_i
  realized_loss_i  = capital_added_i − freed_capital_i
  days_remaining_i = effective_end − assignment_date_i
```

`effective_end` = exit date (closed lifespans) or today (active lifespans).

## Degenerate case

For single-assignment lifespans, this reduces *exactly* to the current single-assignment formula. No regression for IREN-style lifespans.

## Known limitation: small inter-assignment double-count

When a freed pool from cut #1 is partly absorbed as collateral for the next CSP (which is itself in `cspPremiumTotal`), we count both the next CSP's premium specifically AND the freed capital × rate × inter-assignment days. The double-count is bounded by roughly one CSP premium per intermediate gap.

For CRDO (7-day gap, $48,576 freed at 0.00245/cap-day): ~$833 overlap on a $1,892 next-CSP premium. ~44% overlap on that specific premium, ~$833 absolute.

Tolerable. Modeling each freed pool's actual deployment status (in a named CSP vs. abstract) is a lot of bookkeeping for sub-$1k precision when the baseline rate is itself an average estimate. Documented in code; not solved.

## Output schema changes

The current cut-and-redeploy object has singular per-assignment fields that pretend only one assignment matters. Restructure:

```js
// BEFORE
{
  requires_spot_at_first_assignment,
  sell_at_assignment_recovery,        // first only
  realized_loss_at_assignment,        // first only
  capital_to_redeploy,                // first only
  avg_csp_return_per_capital_day,
  sample_size_csps_used,
  estimated_csp_pnl_over_lifespan,
  net_outcome_if_cut_and_redeploy,
  vs_actual_pnl,
  verdict,
}

// AFTER
{
  requires_spot_at_each_assignment,   // bool: true if all events have spot
  assignment_count,                   // int: number of assignment events
  total_capital_to_redeploy,          // sum of freed pools across events
  total_realized_losses,              // sum of cut losses across events
  avg_csp_return_per_capital_day,     // unchanged
  sample_size_csps_used,              // unchanged
  estimated_csp_pnl_over_lifespan,    // sum of (freed × rate × days_remaining)
  net_outcome_if_cut_and_redeploy,    // same meaning; computed from sums
  vs_actual_pnl,                      // unchanged shape
  verdict,                            // unchanged shape
  assignment_breakdown: [             // NEW: per-event transparency
    {
      date,
      capital_added,                  // strike × shares
      capital_freed,                  // spot × shares
      realized_loss,                  // capital_added − capital_freed
      days_remaining,                 // effective_end − date
      est_csp_pnl,                    // capital_freed × rate × days_remaining
    },
    ...
  ],
}
```

External consumers:
- `src/components/tickerDetail/TickerLifespanHistory.jsx` reads `vs_actual_pnl` only ✓ unchanged
- `src/lib/tickerVerdict.js` reads `vs_actual_pnl` only ✓ unchanged
- All other singular fields are JSON-output transparency; not consumed by code

## Missing-spot handling

If ANY assignment event lacks `spot_at_assignment`:
- `requires_spot_at_each_assignment = false`
- All numeric fields → `null`
- Verdict → `data_missing`
- Existing missing-spot warning in `data_completeness.warnings` still fires (already covers the partial-data case for single-assignment; will need updating to mention "any" event)

## Tests

Create `api/_lib/__tests__/lifespan-cut-redeploy.test.js` (no existing test file for this logic). Cases:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Single-assignment lifespan, has spot | Matches the current single-assignment math; `assignment_count: 1`, `assignment_breakdown` has one entry |
| 2 | Single-assignment lifespan, missing spot | `requires_spot_at_each_assignment: false`, all numeric null, verdict `data_missing` |
| 3 | Multi-assignment (CRDO-like): two events both with spot | `total_realized_losses` = sum, `estimated_csp_pnl_over_lifespan` = sum of per-event `freed × rate × days_remaining`, `assignment_breakdown.length === 2` |
| 4 | Multi-assignment with one event missing spot | `requires_spot_at_each_assignment: false`, all numeric null |
| 5 | Multi-assignment, baseline rate = 0 | `est_csp_pnl` per event = 0, sum = 0; `realized_losses` still computed |
| 6 | Active lifespan (no exit), multi-assignment | Uses `today` as `effective_end`, formula works |

Test 3 is load-bearing for the multi-assignment fix. CRDO-like fixture: two assignments at $135 strike, spots $121.44 and $124.06, exits 66 days after first.

## Acceptance criteria

1. `buildLifespan` cut-and-redeploy block iterates over `assignment_events`, not just `firstAssignment`
2. New output schema with `assignment_breakdown` for per-event transparency
3. New test file with all 6 cases passing
4. Existing tests still pass
5. CRDO production data: `vs_actual_pnl` shifts from ~+$5.4k to ~+$2.1k (verified by spot-check after deploy)
6. IREN production data: unchanged (single-assignment degenerate case)
7. Version bumped to 1.108.5

## Out of scope

- Resolving the inter-assignment double-count (documented limitation)
- Changes to `total_lifespan_pnl` computation (wheel side stays as-is)
- UI changes to render the new `assignment_breakdown` array (separate task if wanted)
