# Agentic Trigger Prompt — Additions

**For:** whoever edits the agentic run trigger (`trig_01S721eUQdooVnrfEVVrwBV3`, `30 20 * * 1-5`)
**Why here:** the trigger is a cloud/API trigger, not a `scheduled-tasks` entry on
Vinh's machine, so Claude Code cannot edit it. This file is the authored text,
versioned so the trigger and the schema it writes stay in step.
**Schema:** already applied — `supabase/migrations/2026-08-19-agentic-shadow-columns.sql`
**Hypotheses:** frozen in `docs/agentic-factor-preregistration.md`

> ## ⚠ SHADOW ONLY
> Both additions are instrumentation. Neither may change any entry, exit, size, or
> gate. No column written below may be read by the decision path. If wiring one
> into scoring looks convenient, do not.

---

## 1. Capture the three shadow factors

Paste into the trigger prompt, in the section that writes `agentic_factor_snapshots`.

```
SHADOW FACTOR CAPTURE (instrumentation — must not influence any decision this run)

After the scan produces its rows and before writing agentic_factor_snapshots:

1. Rank the scanned tickers by core_score, descending. The top 10 are the factor
   cohort for this run.

2. Set factor_scope on EVERY row you write:
     - 'top10' for those 10 tickers
     - 'full'  for all other rows
   Never leave it NULL. A NULL is indistinguishable from "we forgot", whereas
   'full' positively records that the extras were not meant to be there.

3. For the top 10 ONLY, capture:

   EVERY RUN — short_volume_ratio
     Tool: get_short_volume_ratio_by_ticker
     Store: the latest daily ratio, in short_volume_ratio
     ~10 calls.

   MONDAYS ONLY, plus any ticker appearing in the top 10 for the first time —
     analyst_net_30d
       Tool: get_analyst_ratings
       Store: (upgrades - downgrades) over the trailing 30 days, in
              analyst_net_30d; put the data's own date in analyst_as_of
     insider_net_90d
       Tool: get_insider_activity_by_ticker
       Store: net dollars bought minus sold over the trailing 90 days, in
              insider_net_90d; put the data's own date in insider_as_of
     ~20 additional calls, Mondays only.

4. CALL DISCIPLINE — issue these sequentially, one at a time, with retry on abort.
   NEVER parallel-batch them: the permission stream collapses in headless runs.
   This is the reason the refresh cadence is split daily/weekly at all.

5. ON NON-REFRESH DAYS, carry the last known analyst_net_30d and insider_net_90d
   forward and write the TRUE analyst_as_of / insider_as_of date from when the
   value was actually read.
     - Do NOT write NULL for a value we already have — that discards information.
     - Do NOT write a stale value without its real date — that is a lie.
   analyst_as_of and insider_as_of must never be more than 7 days behind run_at.
   If one would be, refresh it this run regardless of what day it is.

6. IF THE RUN EXCEEDS ITS TIME BUDGET, drop the weekly factors first (analyst and
   insider), keep short_volume_ratio, and log the drop EXPLICITLY as its own
   agentic_log row. No silent truncation — a missing factor must be visible as a
   decision, not inferred from a gap.

None of these six columns may be read by any entry, exit, sizing, or gating step.
They are recorded and then ignored for at least 50 closed CORE positions.
```

---

## 2. Stamp the macro posture on `run_summary`

Paste into the trigger prompt where the `run_summary` row is written.

```
MACRO POSTURE STAMP (read-only — gates nothing)

On the run_summary row of every run, set:
  macro_posture        <- macro_snapshots.posture
  macro_posture_score  <- macro_snapshots.posture_score

taken from the most recent macro_snapshots row STRICTLY BEFORE today, i.e. the
prior close:

  select posture, posture_score, signals_available, signals_total
  from macro_snapshots
  where snapshot_date < current_date
  order by snapshot_date desc
  limit 1

If no such row exists, write both as NULL. Do not substitute today's row, do not
recompute the posture, and do not call /api/macro — the point is to record what
was knowable BEFORE the run, which is the only version of the number a
counterfactual can use.

This stamp exists so "would a macro gate have changed this entry?" becomes a join
rather than a reconstruction. It must not be read by any decision this run makes.

CAVEAT FOR LATER ANALYSIS, not for the runner: a posture_score is only comparable
across dates when that row had all its signals. Join back to macro_snapshots on
the date and filter signals_available = signals_total before comparing. A 2.8 from
six signals is not the same number as a 2.8 from seven.
```

---

## Notes for whoever applies this

- **Backfill is not possible for the posture stamp.** The 29 existing
  `run_summary` rows span 2026-07-21 → 08-19, and `macro_snapshots` held exactly
  one row (2026-04-22) for that entire window because the write was broken until
  2026-08-19. There is no posture history to join to. These stay NULL; the stamp
  only works forward.
- **`macro_snapshots` is healthy as of 2026-08-20** — one row per weekday, all
  seven signals, `signal_scores` populated. The prior-close read will find data.
- **Spec acceptance 7** — *"diff the agentic decision path and confirm no new
  column is read by it"* — still has to be run against the runner's own source.
  It cannot be checked from trading-dashboard, which does not contain the decision
  path. What is verified here: no code in this repo reads any of these columns,
  and no code in this repo touches these two tables at all.
