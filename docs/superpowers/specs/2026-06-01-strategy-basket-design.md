# Strategy Basket View — Design Spec

**Date:** 2026-06-01
**Status:** Approved design, pending spec review

## Problem

After closing assigned SOFI shares at a realized **−$26,400** loss (selling 3,300 sh @ $26 → $18 on 2026-06-01), the user is redeploying that freed capital into a basket of new positions (SOFI LEAPS + CSPs across SOFI/COHR/VRT) with the goal of recovering the loss faster than waiting for SOFI to round-trip.

These redeployment transactions are tagged in position notes with `strategy:sofi-makeup`. The user wants a page that aggregates everything carrying that tag and shows whether the basket is making progress against the $26,400 hole.

Generalized: **a page that takes any `strategy:*` tag, aggregates the positions/trades carrying it, and shows a transaction log plus progress-against-target summary stats.**

## Goals

- Aggregate all positions and closed trades carrying a given strategy tag into one view.
- Show capital deployed, realized recovery (drives a progress bar against the target), and unrealized cushion.
- Provide a chronological transaction log for the basket.
- Be fully data-driven — nothing about SOFI is hardcoded; the page is parameterized by tag.

## Non-Goals

- No new tagging UI beyond what exists. Tags are applied via the existing position-note flow.
- No automated detection of "makeup" candidates. Membership is explicit via tags.
- No historical time-series chart of recovery (could be a later iteration). v1 is point-in-time + transaction log.

## Current-State Facts (verified 2026-06-01)

- **Tag storage:** `journal_entries` table. `tags` is a `text[]` column. Each entry also carries `ticker`, `type`, `strike`, `expiry`, plus nullable `trade_id` and `position_id`. Tag → position mapping is by the tuple `ticker|type|strike|expiry` (see `entryKey()` / `positionKey()` in `src/lib/tags.js:90`).
- **Existing tag-resolution helper** `groupStrategicTagsByPosition()` (`src/lib/tags.js:107`) matches tags against **open positions only**. It does **not** resolve closed trades — this is the main gap to fill.
- **Members tagged `strategy:sofi-makeup` today** (all open, `trade_id`/`position_id` null):
  - SOFI LEAPS $15 exp 2027-01-21
  - COHR CSP $310 exp 2026-07-02
  - VRT CSP $300 exp 2026-06-26
- **The loss trade** lives in `trades`: id `55bc138b-6b44-4e7f-a72f-181f2dd52aa0`, `type=Shares`, `subtype=Sold`, 3300 contracts(shares), open 2026-02-12, close 2026-06-01, `premium_collected = -26400` (this field holds realized P/L), `capital_fronted = 85800`, `strike = null`.
- **Quotes:** `useQuotes()` (`src/hooks/useQuotes.js`) returns `quoteMap: Map<symbol, { last, bid, ask, mid, iv, ... }>`, refreshed every 15 min by a Vercel cron. Option marks are looked up via `buildOccSymbol(ticker, expiry, isOption, strike)` then `quoteMap.get(sym)?.mid`; underlying via `quoteMap.get(ticker)?.mid` (pattern in `src/components/OpenPositionsTab.jsx:483`).
- **Positions table has no stored current mark** — unrealized values must be computed live from `quoteMap`.
- **Tab registration:** explore sub-views are listed in `EXPLORE_SUBVIEWS` and `SUBVIEW_LABELS` in `src/lib/modes.js`; rendered/lazy-loaded in `src/components/ExploreView.jsx`.

## Design Decisions

### Baseline vs. recovery discrimination

The loss trade and the recovery positions both belong to the basket, but the loss must be the **target**, not counted as "recovery" (or it cancels itself out). Resolution:

- The basket is defined by the strategy tag (e.g. `strategy:sofi-makeup`).
- The single loss member is **additionally** tagged with a role marker: **`role:makeup-baseline`**.
- Rule: within the basket, the member carrying `role:makeup-baseline` is the **target**; every other member is a **recovery** member.
- The target amount is `abs(premium_collected)` of the baseline member's closed trade = $26,400. No hardcoded constant.

**Tagging the loss trade:** create a `journal_entries` row for the loss trade with `tags = ['strategy:sofi-makeup', 'role:makeup-baseline']` and `trade_id = 55bc138b-...` (preferred — direct link, since the Shares/Sold trade has `strike = null` and can't be matched by the `ticker|type|strike|expiry` tuple). This is a one-time data action, done as part of rollout, not code.

### Tag → member resolution (the new bit)

For each `journal_entries` row carrying the basket tag, resolve its target in priority order:
1. If `trade_id` is set → the closed trade with that id.
2. Else if `position_id` is set → that open position.
3. Else match the tuple `ticker|type|strike|expiry` against open positions; if no open match, match against `trades` (closed).

A member resolves to either an **open position** (has a live mark) or a **closed trade** (has realized P/L). A new helper `resolveBasket(tag, { positions, trades, entries })` returns a normalized member list:

```
{
  status: 'open' | 'closed',
  role: 'baseline' | 'recovery',
  ticker, type, strike, expiry,
  openDate, closeDate,
  capitalFronted,        // from capital_fronted
  realized,              // closed: premium_collected; open: null
  // open members get marked live at render time, not here
}
```

This helper lives in `src/lib/strategyBasket.js` (new), pure and unit-tested. It does **not** depend on `quoteMap` — live marking happens in the component so the helper stays pure (consistent with `positionMetrics.js`).

### Metrics

- **Target to recover:** `abs(baseline.realized)` → $26,400.
- **Capital deployed:** Σ `capitalFronted` over **open recovery** members (CSP collateral + LEAPS cost).
- **Realized recovery:** Σ `realized` over **closed recovery** members. Drives the progress bar: `realizedRecovery / target`.
- **Unrealized cushion (separate line):** Σ over **open recovery** members of `(mark − entry basis) × multiplier`, where the mark comes from `quoteMap` (`mid`, with `last` fallback). Options: `(mid − entry_cost) × contracts × 100`. Shares/underlying: `(mid − costBasis) × shares`. Members whose mark is absent from `quoteMap` contribute nothing and are flagged in the row as "—" rather than blocking the total. If **every** open member is unmarkable, the cushion line renders "—".

Progress bar shows realized only (honest, locked-in). Unrealized cushion is a secondary line beneath it, explicitly labeled as mark-to-market and not counted toward the bar.

### Placement & navigation

- New **explore** sub-view, key `baskets`, label "Baskets". Registered in `src/lib/modes.js` and rendered in `src/components/ExploreView.jsx` (lazy-loaded `StrategyBasketTab`).
- The tab needs to know **which** tag to show. v1: the tab lists all distinct `strategy:*` tags found across journal entries as selectable chips; selecting one renders that basket. Defaults to the first (or only) strategy tag.
- **Deep-link from tag chips:** clicking a `strategy:` chip on a position row navigates to the Baskets sub-view with that tag pre-selected. Wiring: the chip's existing click path sets the active explore sub-view to `baskets` and passes the selected tag (same mechanism `ticker-detail` uses to receive a target ticker).

Rationale for explore over review: mechanically this is a filtered position/transaction aggregation, same family as Positions/Tickers/Radar. (Considered review for its progress-tracking framing; explore wins on mechanical kinship and chip-deep-link ergonomics.)

## Components

- `src/lib/strategyBasket.js` (new) — `resolveBasket()` and metric reducers (`capitalDeployed`, `realizedRecovery`). Pure, unit-tested.
- `src/components/StrategyBasketTab.jsx` (new) — the page. Consumes `DataContext` (positions + trades), `useQuotes()`, and the journal entries for tag resolution. Renders: tag selector chips, summary cards, progress bar, unrealized cushion line, transaction log table.
- Reuse for summary cards: the `SummaryBlock` / Slot patterns already used in `PipelineDetailPanel.jsx` / `PersistentHeader.jsx`. Reuse `buildOccSymbol` (`src/lib/trading.js`) and `TYPE_COLORS` (`src/lib/constants.js`). All colors via `theme`.

## Data Flow

1. `StrategyBasketTab` reads `positions` + `trades` from `DataContext`, plus journal entries carrying `strategy:*` tags (via `listJournalEntries({ tag })` / existing journal API).
2. `resolveBasket(selectedTag, { positions, trades, entries })` → normalized member list (pure).
3. Component computes target, capital deployed, realized recovery from the member list.
4. Component marks open members live via `quoteMap` for the unrealized cushion line.
5. Renders summary + transaction log.

## Error / Edge Handling

- **No baseline member:** if no member carries `role:makeup-baseline`, target is unknown → show target as "—" and render the basket without a progress bar (still show capital/realized/log). Surface a small hint: "tag the loss trade with `role:makeup-baseline` to set a target."
- **Multiple baseline members:** sum their `abs(realized)` as the target (supports multi-trade losses); not expected for SOFI but defined behavior.
- **Stale/missing quotes:** unrealized cushion degrades to "—" per member; never blocks realized progress.
- **Tag with zero members:** empty state ("no positions tagged `X` yet").

## Testing

- Unit tests for `src/lib/strategyBasket.js`: baseline vs. recovery split, trade_id resolution, tuple-matching fallback (open then closed), capital/realized reducers, missing-baseline behavior, multiple-baseline summation.
- Manual verification in browser via dev server: load Baskets sub-view, select `strategy:sofi-makeup`, confirm target = $26,400, the three open recovery members appear with capital deployed, realized = $0 pre-any-close, unrealized cushion marks live (or "—" off-hours), and the chip deep-link from a SOFI/COHR/VRT position row lands on the right basket.

## Rollout (one-time data action, not code)

1. Insert a `journal_entries` row linking the loss trade (`trade_id = 55bc138b-...`) with `tags = ['strategy:sofi-makeup', 'role:makeup-baseline']`.
2. Add `role:makeup-baseline` to `tag_vocabulary` (category e.g. `role`) so it's a recognized tag.

## Open Questions

None blocking. Future iterations could add a recovery-over-time chart and let the basket target be a manual override when no closed loss trade exists.
