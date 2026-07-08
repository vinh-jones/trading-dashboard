# Income Breakdown for the History view

**Date:** 2026-07-08
**Status:** Approved, ready for implementation plan
**Area:** `src/components/HistoryTab.jsx` (+ new `src/components/IncomeBreakdown.jsx`)

## Problem

The History view (Review → History) shows a grid of per-ticker cards
(CLS $3.4k / 3 trades / sparkline, APP $3.4k, …). That already answers
"which names paid me," but only as absolute amounts in card form. It does
not show **composition** — each name's *share* of the window's income — and
it can't be re-sliced by trade type without reading the separate type chips.

The user wants a "where did my income come from" view for whatever date
range is active: a ranked breakdown, flippable between name and type.

## Success criteria

- In the History view, the ticker-card region can toggle between **Cards**
  and **Breakdown**.
- Breakdown renders ranked horizontal bars for the active date range,
  flippable between **Name** and **Type**.
- Each bar shows the group label, a proportional bar, the signed dollar
  amount, and its share of the window total. Negative groups render red.
- Clicking a bar filters the trades table (and the rest of the view) exactly
  as clicking a card / type chip does today; clicking again clears.
- Name mode caps at the top 10 groups plus a rolled-up "Other" bar; a large
  loss is never hidden inside Other.
- No regression to existing Cards behavior, the type chips, the hold-duration
  histogram, or the trades table.

## Non-goals (YAGNI)

- No pie/donut/treemap. Bars were chosen deliberately: they stay legible with
  many groups and are the only shape that cleanly shows a *losing* group.
- No new charting dependency. Pure divs + inline theme tokens, matching the
  existing hold-duration bars.
- No new data fetching or API changes. All data already exists in HistoryTab.
- No stacked "name split by type" bars. Type breakdown lives behind the
  Name/Type toggle, not within a single bar.
- No persistence of toggle state across sessions (in-memory only for now).

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Group by | Toggle: **Name / Type** |
| Chart shape | **Ranked horizontal bars** |
| Placement | **Toggle inside the cards region** (Cards ↔ Breakdown) — no duplication |
| Bar click | **Filters** to that name/type (reuses existing selection), click again clears |
| Many groups | **Top 10 + "Other"** roll-up bar (Name mode only) |
| Architecture | **Extract** a self-contained `IncomeBreakdown.jsx` |
| Default view | **Cards** (Breakdown is one click away) |

## Architecture

### New component: `src/components/IncomeBreakdown.jsx`

A presentational component. It owns no data fetching and no filter state —
HistoryTab passes everything in.

**Props:**

- `mode` — `"name" | "type"` (the active sub-toggle)
- `onModeChange(mode)` — flip Name/Type
- `tickerSummary` — existing array `[{ ticker, trades, premium, byType }]`,
  already sorted by premium desc
- `typeSummary` — existing array `[{ type, count, premium }]`, sorted desc
- `selectedTicker`, `selectedType` — current selection (for highlight)
- `onSelectTicker(ticker)`, `onSelectType(type)` — toggle selection
- `total` — window net realized (denominator for share %); see edge cases

**What it does:**

1. Pick the group list from `mode` (tickerSummary → key `ticker`, label
   ticker; typeSummary → key `type`, label type).
2. In Name mode, if more than 10 groups: keep the top 10 **by absolute
   premium** (so a big loss stays visible), roll the remainder into a single
   `{ label: "Other (N names)", premium: Σ, isOther: true }`. Display the kept
   rows sorted by premium **descending**, with the "Other" row pinned **last**.
   Type mode is never capped (≤ ~5 groups).
3. Render the toggle header (`Name | Type`) + one bar row per group.

**Bar row layout** (grid, mirrors the mockup):
`[label 52px] [track flex] [ $amount + share% ]`

- Bar width = `|premium| / maxAbsPremium * 100%` where `maxAbsPremium` is the
  max over shown rows.
- Color: **green/red in both modes** — `premium >= 0` → green
  (`theme.green` / `theme.gradient.gain`), `< 0` → red (`theme.red` /
  `theme.gradient.loss`). Chosen over `TYPE_COLORS` for Type mode so the
  loss signal is preserved consistently; the type identity is already carried
  by the row label and the chips above.
- Label + amount styling reuses the card typography (`theme.size.md`,
  `theme.font.mono` for the dollar value).
- Selected row gets the same highlight treatment cards use
  (`theme.bg.elevated` bg, `theme.blue` accent).

**Interaction:**

- Row click → `onSelectTicker(ticker)` (Name) or `onSelectType(type)` (Type),
  toggling off if already selected. The "Other" row is **not** clickable and
  has no hover/pointer affordance.
- Hover tint on clickable rows, matching existing hover patterns.

### Changes to `HistoryTab.jsx`

- New in-memory state: `breakdownView` (`"cards" | "breakdown"`, default
  `"cards"`) and `breakdownMode` (`"name" | "type"`, default `"name"`).
- Wrap the existing cards-grid region (lines ~173–251) with a small header row
  containing the `Cards | Breakdown` toggle.
- When `breakdownView === "cards"`, render the existing grid unchanged.
- When `breakdownView === "breakdown"`, render `<IncomeBreakdown … />`, passing
  the existing `tickerSummary` / `typeSummary` and the existing
  `selectedTicker` / `selectedType` + their setters (with toggle semantics).
- `total` = sum of `premium` over the active groups (equivalently the window
  net realized already shown in the summary line). Reuse the existing filtered
  total logic rather than recomputing divergently.

The two toggles reuse the existing pill/segmented styling already in the file
(the type-chip buttons and the ALL pill are the reference).

## Data flow

```
useData() → TRADES_ALL
  → (date range filter) TRADES
    → tickerSummary  ─┐
    → typeSummary   ─┤→ IncomeBreakdown (mode picks which list)
  selectedTicker/Type ┘   → click → setSelectedTicker/Type
                              → re-filters TRADES table + histogram (unchanged)
```

No new derived data is required; `tickerSummary` and `typeSummary` already
exist and already respect the active type/duration cross-filters.

## Edge cases

- **All groups positive** (common): shares sum to 100%, bars all green.
- **A group is net negative** (e.g. a month where HOOD shares sold at a loss):
  red bar, signed amount (`-$3,300`), share shown as a negative share of net
  total (reads as "dragged net down by X%"). Kept out of Other by the
  magnitude-based top-10 cut.
- **Window net total near zero**: share % denominator can get unstable. If
  `|total|` is below a small floor, suppress the % (show amount only) rather
  than printing wild percentages. Amounts are always shown.
- **Empty window** (0 trades): Breakdown shows the same empty state the cards
  region shows today (no bars).
- **Single group**: one full-width bar at 100%.
- **Type mode with a selected ticker**: `typeSummary` already narrows to that
  ticker; bars reflect it. Consistent with current chip behavior.

## Testing

Follows the repo's vitest pattern (logic is unit-testable; API-driven panels
can't be browser-verified locally, so lean on unit tests + build).

Extract the grouping/rollup into a pure helper (e.g. `buildBreakdownRows(list,
{ key, mode, cap })`) and unit-test:

- Sorts descending by premium.
- Name mode with > 10 groups produces exactly 10 + one "Other"; Other premium
  equals the sum of the rolled-up groups.
- A large negative group survives the cut (magnitude-based) instead of landing
  in Other.
- Share % sums to ~100% when all positive; % suppressed when `|total|` < floor.
- Type mode never rolls up.
- Bar width normalization uses max absolute premium.

Component-level: a couple of render tests (React Testing Library if already in
use) that a bar click calls the right `onSelect*` and that "Other" is inert.
Verify the production build passes.

## Files

- **New:** `src/components/IncomeBreakdown.jsx`
- **New:** helper + test (e.g. `src/lib/breakdown.js` + `breakdown.test.js`)
  — location to match existing lib/test conventions.
- **Edit:** `src/components/HistoryTab.jsx` (toggles + conditional render).
- Version bump per CLAUDE.md: minor (`x.Y.0`, new feature) in `package.json`
  and `const VERSION` in `src/lib/constants.js`, baselined off `origin/main`.
