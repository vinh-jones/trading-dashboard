# Agentic Factor Shadow — Pre-Registration

**Registered:** 2026-08-19, before any data exists
**Spec:** Macro Persistence + Agentic Factor Shadow (v1), Workstream B
**Schema:** `supabase/migrations/2026-08-19-agentic-shadow-columns.sql`

> ## ⚠ SHADOW ONLY
> Nothing described here may change any entry, exit, size, or gate in the agentic
> account. These are pure instrumentation. No column named here may be read by the
> decision path. If an implementation choice makes it easy to wire one into
> scoring, do not.

---

## Why this file exists

Hypotheses written after seeing the data are not hypotheses, they are descriptions.
This file is committed to git **before collection begins** so its timestamp is
independent of anyone's memory of what they expected. That is the whole point of
it — the git history is the evidence, so **do not edit the hypotheses below once
data starts arriving.**

If a factor turns out interesting in a direction not written here, that is a *new*
hypothesis requiring a fresh pre-registration and a fresh sample. Append it as a
new dated section; do not revise these.

---

## The three factors

Three, not seven. Testing seven factors against the ~25–35 closed CORE positions
expected by year end is noise mining — with that many comparisons something will
look significant whether or not anything is there. These three were chosen for
orthogonality to price, and are frozen.

| Column | Source (UW) | Definition | Refresh |
|---|---|---|---|
| `analyst_net_30d` | `get_analyst_ratings` | upgrades − downgrades, trailing 30d | weekly |
| `short_volume_ratio` | `get_short_volume_ratio_by_ticker` | latest daily ratio | daily |
| `insider_net_90d` | `get_insider_activity_by_ticker` | net $ bought − sold, trailing 90d | weekly |

Captured for the **top 10 by `core_score` only** (`factor_scope = 'top10'`). All
~59 rows/day continue to be written with the existing columns.

---

## Hypotheses

### H1 — `analyst_net_30d`

**CORE entries taken when net revisions are ≤ 0 will have a lower hit rate and
worse mean outcome than those with net revisions > 0.**

*Expected direction:* negative revisions → worse.

*Rationale:* tests whether a `bb`-low print is informative or noise. This is the
CAT question of 2026-08-19, where the scanner bought day two of an ~8% two-session
decline with no idea why. If a low Bollinger print on a name being actively
downgraded performs worse than the same print on a name with stable coverage, then
"cheap" and "falling" are separable and the scanner is currently conflating them.

### H2 — `short_volume_ratio`

**CORE entries in the top quartile of short volume ratio will underperform the
rest.**

*Expected direction:* high ratio → worse.

*Rationale:* distinguishes a passive drift to the lower band from a name being
actively pressed. Both look identical to the scanner today.

### H3 — `insider_net_90d`

**CORE entries with net insider buying will outperform.**

*Expected direction:* net buying → better.

*Rationale:* the slowest-moving and weakest prior of the three, included
deliberately as a **near-control**. If H3 shows a strong effect at small n before
H1 does, treat that as evidence of overfitting rather than of insider signal. That
reading is registered here in advance precisely so it cannot be rationalised away
later.

---

## Decision criteria

**No factor may be promoted to decision authority on fewer than 50 closed CORE
positions.** This is a hard floor, not a guideline.

At the n=25–35 expected by year end, any result is a **directional read only** and
must be reported as such — with the split sizes shown, so that a "finding" resting
on four observations is visibly resting on four observations.

**First review at ~4 weeks of `agentic_factor_snapshots` history**, which lines up
with the existing v9 revisit trigger for its deferred items. Both clocks mature
together.

That first review is a **data-quality review, not a results review**: are the
columns populated, are the `*_as_of` dates honest, do enough tickers recur in the
top 10 to give any factor a usable sample? Reading it as a first look at findings
invites exactly the overfitting H3 exists to catch.

---

## Collection rules

These are part of the registration — changing them mid-collection changes what the
sample means.

- **Scope:** top 10 by `core_score`. `factor_scope` records which rows carry the
  extras; absence on a `'full'` row is by design, not a gap.
- **UW calls must be sequential with retry-on-abort. Never parallel-batch them** —
  the permission stream collapses in headless runs.
- **Daily:** `short_volume_ratio` for the top 10 → ~10 sequential calls.
- **Weekly** (Mondays, or on a ticker's first appearance in the top 10):
  `analyst_net_30d` and `insider_net_90d` → ~20 additional calls, Mondays only.
- **On non-refresh days, carry the last known value forward and write the true
  `*_as_of` date.** Staleness must be visible in the data rather than hidden in a
  NULL. Do not write NULL for a value we have; do not write a stale value without
  its date.
- `analyst_as_of` and `insider_as_of` must never be more than 7 days behind
  `run_at`.
- If a run exceeds its time budget, **drop the weekly factors first and log the
  drop explicitly.** No silent truncation.

---

## Ownership

`agentic_log` and `agentic_factor_snapshots` have **no code in the
trading-dashboard repo** — the agentic runner is external and writes them
directly. This repo has landed the columns and this registration. The runner still
owns:

- populating the three factors and the `*_as_of` / `factor_scope` bookkeeping
- stamping `macro_posture` / `macro_posture_score` onto each `run_summary` row
  (spec A6), read from `macro_snapshots` for the prior close
- spec acceptance criteria **4, 5, 6 and 7**

Acceptance 7 — *"diff the agentic decision path and confirm no new column is read
by it"*, flagged in the spec as the criterion that matters most — **cannot be
satisfied from this repo**, because the decision path does not live here. It must
be re-run against the runner's own source. What *can* be asserted here is the
narrower claim, verified 2026-08-19: no code in trading-dashboard reads any of
these columns, because no code in trading-dashboard touches these tables at all.
