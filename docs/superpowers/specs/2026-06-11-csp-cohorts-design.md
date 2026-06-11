# CSP Cohorts — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorm w/ Vinh, visual companion session)
**Builds on:** CSP selection calculator (v1.124.0, `docs/superpowers/specs/2026-06-11-csp-selection-calculator-design.md`)

## Problem

Vinh saves a selection of CSPs (e.g. "everything I deployed into the Jun 26 dip") and wants to come back to it later. Primary question: **"where does this group stand right now?"** — member-by-member roster of open/closed/assigned with capture stats. Secondary: a scoreboard (did the bet pay) and an evolution view (how capture developed over time) to inform how the group should change.

## Decisions (settled in brainstorm)

| Question | Decision |
|---|---|
| Primary view | Roster (member-by-member status); scoreboard header; evolution chart included in v1 |
| Membership | Fixed snapshot at save. Manual adds happen via the existing + Tag flow or backend edits; a bulk membership UI is future work if it recurs |
| Rolls | NOT auto-followed. A rolled position's replacement is not a member unless manually tagged |
| Lifecycle | Cohorts live forever; manual delete; active-first sort. No auto-archive |
| Storage | Tag-based — `cohort:<slug>` journal entries, riding the strategy-basket resolution pattern. No new table |
| Entry point | 4th pill `Cohorts (n)` in the Open Positions card |
| Detail layout | Roster-forward: scoreboard strip → roster → evolution chart |
| Evolution data | Reconstructed from `daily_snapshots.forecast_per_position` (no new snapshotting) |
| Scope | CSPs only, like the calculator |

## Data model

A cohort **is** the set of positions whose journal entries carry a `cohort:<slug>` tag.

- **Save** writes one small journal entry per selected member (ticker/type/strike/expiry from the position, tag attached) through the existing journal API.
- **Resolution** mirrors `resolveBasket` (`src/lib/strategyBasket.js`): tuple-match entries against open positions AND closed trades on ticker/type/strike/expiry (ISO `expiry_date` preferred over `expiry` — see strategyBasket's `tupleMatch` comment for the normalizeTrade MM/DD gotcha). Members keep resolving after close.
- **Row chips:** the `cohort:` prefix is not in `NON_STRATEGIC_TAG_PREFIXES` (`src/lib/tags.js`), so chips surface on member rows automatically. Clicking a cohort chip opens that cohort's detail view (same wiring pattern as `strategy:` chips → `onOpenBasket`).
- **Delete cohort** = remove the tag from (or delete) its entries.
- **Created date** = earliest member entry `created_at`.
- **Name:** the slug IS the name. Input is slugified on save (`Jun 26 batch` → `cohort:jun-26-batch`) and displayed everywhere as the slug (matching how `strategy:` tags display today). No separate display-name storage. Saving with an existing cohort's name **adds members to it** (tag semantics) — this is intentional and doubles as the manual-add path.
- **No `tag_vocabulary` involvement.** `POST /api/journal-entry` inserts tags free-form (verified — no vocabulary validation); vocabulary only feeds the + Tag picker UI. v1 does not register cohort tags in the vocabulary. Consequence: cohort tags won't appear in the + Tag picker — acceptable, since later member adds are a deferred backend operation anyway.

## Save flow

In `CspSelectionBar` (the reserved right-side slot, before ✕ clear):

1. `Save as cohort` button appears when ≥1 row selected.
2. Click → inline text field in the bar (placeholder "cohort name"), autofocused. Enter saves; Escape cancels.
3. Save: slugify name → create one journal entry per selected position with tag `cohort:<slug>` → clear selection → chips render on rows via the existing strategic-tags refresh.
4. Failures (journal API error) surface as a small inline error in the bar; selection is NOT cleared on failure.

## Cohort list (4th pill)

- `Cohorts (n)` pill appended to the CSPs/CCs/LEAPs row in the Open Positions card; `n` = number of distinct `cohort:` tags found in journal entries.
- Selecting it swaps the table area for the cohort list (no PositionsTable, no selection bar).
- Each line: cohort name, status badge (`4 open · 1 closed`, or `closed` when all members closed), capture % (weighted, see Math), captured $. Click → detail view.
- Sort: cohorts with ≥1 open member first (newest created first within group), fully-closed after.

## Detail view (roster-forward)

Header: breadcrumb `Open Positions ▸ Cohorts ▸ <name>`, created date, `✕ delete` (confirm before deleting; removes tag from all member entries).

**Scoreboard strip** (single row of labeled stats, same visual language as the selection bar):
- Members — count, with open count (`5 (4 open)`)
- Collateral — $ and % of account, **open members only** (closed collateral is freed)
- Max premium — Σ premium collected, all members
- Captured — $ and %, realized (closed members) + unrealized (open members)

**Roster** (one row per member):
- Ticker, strike, expiry
- Status badge: `open` / `closed <date>` (assigned shows as closed with its outcome per the trade record)
- Premium collected
- Capture %: open members from live option marks (same `glPct` math as the positions table); closed members from realized kept premium
- Unresolved members (entry tuple matches no position or trade) render with an `unresolved` badge instead of crashing.

**Evolution chart** (below roster):
- Inline SVG line (hand-rolled, like the allocation chart — no chart library): cohort capture % over time.
- Series from `api/cohort-history.js` (new endpoint): for each `daily_snapshots` row, pull each member's `current_profit_pct` (mark-to-market capture fraction: (premium at open − current mid) ÷ premium at open) and `premium_at_open` from `forecast_per_position` (tuple-matched; stored `type` is lowercase `csp` — match case-insensitively). NOT `capture_pct`, which is the forecast model's *expected final* capture, not actual progress. Cohort value for the day = premium-weighted mean. After a member closes, it contributes its final realized capture (`kept_pct`, flatline). Days where a member has no snapshot entry and isn't closed yet are skipped for that member.
- Days before the v2 snapshot wiring began simply don't plot. Empty series → "no history yet" placeholder.

## Math (pure module `src/lib/cohorts.js`)

- `resolveCohort(tag, {openPositions, trades, entries})` → `{members: [{status, ticker, type, strike, expiry, openDate, closeDate, contracts, premiumCollected, realized}], unresolved: [...]}`
- `cohortScoreboard(members, quoteMap, accountValue)` → `{memberCount, openCount, collateral, collateralPct, maxPremium, captured, capturePct}` — open-member unrealized math consistent with `computeCspAggregates` / `positionMetrics`; closed-member realized from trade record.
- `cohortCaptureSeries(members, perPositionHistory)` → `[{date, capturePct}]` — premium-weighted, closed members flatlined at final realized capture.
- Shared tuple-matching: reuse/extract from `strategyBasket.js` rather than duplicating (implementation may lift `tupleMatch` into a shared helper both import — single pattern, per house rules).

## API

`api/cohort-history.js` (GET, `?tag=cohort:<slug>`): resolves the cohort's member tuples **server-side** (journal entries with the tag — no client-supplied member list, keeping the endpoint self-contained and uncheatable), queries `daily_snapshots` for `snapshot_date, forecast_per_position`, filters each day's array to those tuples, returns `[{date, members: [{ticker, type, strike, expiry, current_profit_pct, premium_at_open}]}]`. Keeps `daily_snapshots` internals server-side, consistent with other `api/*` aggregation endpoints. Vercel Pro: no function-count concern.

## Edge cases

- Cohort with zero resolving members (all unresolved) → list line + detail render with unresolved roster, no crash.
- Same position in two cohorts → fine; two tags on the entry/entries.
- Duplicate save into existing cohort name → members merge (documented behavior, not an error).
- Journal entries for members deleted by hand → member silently leaves the cohort (tags are the source of truth).
- No snapshot history overlap with cohort lifetime → chart placeholder, roster unaffected.
- Mobile: list and detail are single-column cards; chart full-width; no horizontal scroll requirements beyond the existing table behavior.

## Testing & verification

- Vitest on `src/lib/cohorts.js`: resolution (open/closed/unresolved/mixed, MM/DD-vs-ISO expiry gotcha), scoreboard math (open-only collateral, realized+unrealized capture), capture series (weighting, flatline-after-close, missing days).
- Fixtures test for `api/cohort-history.js` handler logic in `api/_lib/__tests__/` style if logic is extracted to `api/_lib/`.
- `npm run build`. Browser verification post-deploy (positions + snapshots come from `/api/*`, not served locally).

## Out of scope (future work, explicitly noted)

- Bulk cohort membership editor (add/remove/move UI) — revisit if manual backend edits recur
- Mark-to-market $ timeline (v1 charts capture % only)
- Auto-follow on rolls
- Cohorts over CCs/LEAPs
- Rename (workaround: retag via backend)

## Ship checklist

- Minor version bump from `origin/main` baseline (`package.json` + `const VERSION` in `src/lib/constants.js`).
