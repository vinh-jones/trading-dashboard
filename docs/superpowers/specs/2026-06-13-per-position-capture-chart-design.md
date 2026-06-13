# Per-Position Capture Chart — Design Spec

**Date:** 2026-06-13
**Status:** Approved (terminal brainstorm w/ Vinh)
**Builds on:** Cohort evolution chart (v1.126.x). Reuses `EvolutionChart`, `cohortCaptureSeries`, `chartTicks`, `buildCohortHistory`.
**Scope:** Show the capture-over-time chart inside the expand panel of individual CSP and CC positions. Minor/patch bump.

## Problem

The cohort evolution chart turned out useful; the same capture-%-over-time line would help when looking at a single position (is it grinding up steadily or whipsawing?). The expand dropdown on CSP/CC rows is the natural home.

## Decisions (settled in brainstorm)

| Question | Decision |
|---|---|
| Position types | CSPs + CCs (both expand and carry `current_profit_pct` in snapshots). LEAPs excluded (no expand, different math). |
| Minimum history | `MIN_HISTORY_POINTS = 5` (~1 trading week). Below it, render nothing. |
| Below-threshold UI | No panel, no note — keep young positions' expand clean. |
| Fetch strategy | Lazy per-expand (panel mounts on expand → fetch fires then). No preload. Refetch on re-expand is acceptable (DB cost not a concern). |

## Architecture

**Reuse — no new math.** A single position's series is `cohortCaptureSeries([member], history)`. With one member the premium-weighting collapses to that position's own `current_profit_pct × 100` per snapshot day. The "all-closed trim/flatline" branch never triggers because the member is open (it's in the open-positions table).

**Refactor: extract `EvolutionChart`.** Move it out of `src/components/CohortsPanel.jsx` into its own `src/components/EvolutionChart.jsx` (with its small local `labelStyle`), exported. `CohortsPanel` imports it instead of defining it. No behavior change to the cohort chart. This avoids `OpenPositionsTab` cross-importing from `CohortsPanel`.

**New endpoint `api/position-history.js`.** `GET ?ticker=&type=&strike=&expiry=` → validates the four params, scans `daily_snapshots` (non-null `forecast_per_position`, ascending), and returns `[{date, members:[{ticker,type,strike,expiry,current_profit_pct,premium_at_open}]}]` via the already-tested `buildCohortHistory(snaps, [tuple])`. Auth covered by `middleware.js` (`/api/:path*`). Supabase client via the same `getSupabase()` env chain as `cohort-history.js`. Validation: ticker `^[A-Z.]{1,8}$`, type ∈ {CSP, CC} (case-insensitive), strike numeric, expiry `^\d{4}-\d{2}-\d{2}$`; 400 on bad input, 405 on non-GET.

**New `PositionHistoryPanel`** (`src/components/PositionHistoryPanel.jsx`). Props: the position (`{ticker, type, strike, expiry_date, premium_collected}`). On mount (= row expanded), fetches `/api/position-history` for its tuple, builds a single open `member`, computes `series = cohortCaptureSeries([member], history)`. Renders `<EvolutionChart series={series} />` only when `series.length >= MIN_HISTORY_POINTS`; otherwise renders `null` (also null while loading and on error — silent, since this is a secondary panel). Uses a `cancelled` flag for unmount safety, keyed on the position tuple.

**Wiring in `OpenPositionsTab`.** In the expanded-row `<td>`, render `<PositionHistoryPanel position={pos} />` after the existing panels (Cushion / Hold-yield / Price-target). Both CSP and CC expanded rows reach this; LEAPs never expand.

## Member object shape (built in the panel)

```
{ status: "open", ticker, type, strike, expiry: expiry_date,
  closeDate: null, keptPct: null, premiumCollected: premium_collected, contracts: contracts ?? 1 }
```
Only `ticker/type/strike/expiry` (for `snapMatch`) and the open status matter for the series; premium/contracts are along for the ride.

## Edge cases

- New position with <5 snapshot days → panel renders nothing (no note).
- Position predating the v2-snapshot wiring → series starts mid-life; if that still yields ≥5 points it shows, otherwise hidden. Acceptable.
- Endpoint error / fetch failure → panel renders nothing (secondary content; the rest of the expand is unaffected).
- CC positions: `forecast_per_position` stores them as type `cc`; `snapMatch`/`tupleMatches` already compare case-insensitively, so the `CC` row tuple matches.

## Testing

- `src/lib/__tests__/cohorts.test.js`: add a test that `cohortCaptureSeries([singleOpenMember], history)` returns that member's own `current_profit_pct × 100` per day (locks the single-member reuse).
- `EvolutionChart` extraction is behavior-preserving — full suite + build must stay green (the existing cohort path exercises it).
- Endpoint is thin glue over the already-tested `buildCohortHistory`; param-validation isn't separately unit-tested (consistent with how `cohort-history.js` was handled).
- `npm run build`. Visual verification post-deploy (positions + snapshots come from `/api/*`, not served locally).

## Out of scope

- Preloading/caching history across expands (lazy refetch is fine per decision).
- LEAPs.
- G/L $ over time (capture % only, matching the cohort chart).
- Any x-axis range control (same derived range as the cohort chart).

## Ship checklist

- Bump `package.json` + `VERSION` in `src/lib/constants.js` from the `origin/main` baseline (new feature → minor bump).
