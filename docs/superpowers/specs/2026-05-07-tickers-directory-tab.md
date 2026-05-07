# Tickers Directory Tab — Design Spec

**Status:** Ready for implementation
**Related:** Builds on the per-ticker detail view shipped in v1.104.0 ([apps#87](https://github.com/vinh-jones/trading-dashboard/pull/87)).

---

## Problem

The per-ticker detail view is reachable from the Positions table or via direct URL (`#/ticker/SYMBOL`), but **idle tickers** — tickers with full trade history but zero current open positions (e.g. a CSP-only ticker like GLW after the last CSP closes) — have no entry point in the UI. The user has to remember the ticker symbol and type the URL.

A directory chip lists every ticker the user has ever traded, with enough at-a-glance info to be useful on its own (last activity, cycle count, lifetime P&L) and one-click navigation into the existing detail view.

---

## Scope

A new **Tickers** chip under Explore, sitting between Positions and Radar:
```
Positions / Tickers / Radar / Earnings / Macro
```

Lists every ticker present in the trades table, sortable, searchable, with click-through to `/#/ticker/SYMBOL`.

---

## Non-goals

- Per-row mini-sparkline of P&L over time → defer to v1.1
- Click-to-filter integration with HistoryTab in Review → defer
- Group-by sector or strategy → defer
- New dedicated API endpoint — leverage existing `/api/data` + `/api/position-lifespan`

---

## UI

### Layout

```
┌─ Tickers ────────────────────────────────────────────────────────────────┐
│  [ Search tickers… ]                                       N tickers     │
│                                                                           │
│  TICKER  STATUS    LAST ACT.     CYCLES   LIFETIME P&L   CAPITAL  HEALTH │
│  IREN    ● Active  May 6 2026    3        +$7,218        $99,000  ● Watch│
│  GLW     ○ Idle    May 6 2026    0        +$4,318        $0       —     │
│  AAPL    ○ Idle    Mar 14 2026   1 (1 sus)+$1,540        $0       —     │
│  ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Top bar

- **Search input** at top-left. Filters rows by ticker prefix (case-insensitive). No submit — filters as you type.
- **Count** at top-right: "12 tickers" (post-filter).

### Columns (left → right)

1. **Ticker** — bold, monospace. Clickable: opens `#/ticker/SYMBOL`. Hover turns it `theme.blue`.
2. **Status** — `● Active` (green dot) when the ticker has at least one open CSP, share lot, or LEAPS. `○ Idle` (muted dot) otherwise.
3. **Last activity** — most recent `close_date` across all trades for this ticker, formatted via `formatExpiry`. `—` if no closed trades.
4. **Cycles** — count of lifespan cycles for this ticker. Suspect cycles excluded; show `N (M suspect)` when M > 0. `0` for CSP-only tickers (no assignment cycles is correct, not missing data).
5. **Lifetime P&L** — sum of `premium_collected` across all closed trades. Green if positive, red if negative, muted if zero. Suspect-data badge `*` appended to the value when any contributing trade is suspect-flagged.
6. **Capital** — current capital deployed for this ticker (CSP `capital_fronted` + assigned-shares `cost_basis_total` + LEAPS `capital_fronted`). `$0` for idle tickers.
7. **Health** — small dot, same logic as the detail-view header:
   - red `● Risk` if any CSP cushion state is `assignment_risk`
   - amber `● Watch` if any CSP cushion state is `approaching`
   - green `● Healthy` otherwise (when there are open positions)
   - `—` when idle

### Sorting

- Click any column header to sort by that column. Click again to reverse direction.
- Default: **Active first** (status sort), then **last activity desc** (most-recent first within each status group).
- Sort indicator (▲ / ▼) appears on the active column.
- Ticker column sorts alphabetically.

### Empty state

"No tickers traded yet." — only renders if the user has zero closed trades. Highly unlikely in practice.

### Loading / error states

- **Loading** (lifespan fetch in flight): show the rows immediately with `Cycles` rendered as `…` placeholders. The other columns can render from `useData()` data which is already loaded.
- **Error** (lifespan fetch failed): show rows with `Cycles` rendered as `?`, plus an inline note at the top: "Cycle counts unavailable: {error}". Don't block the rest of the table.

---

## Data flow

### Sources

- **Trades + open positions**: from existing `useData()` context (already loaded by App on mount).
- **Lifespan summaries**: fetched once via `GET /api/position-lifespan` (no `ticker` query → returns summaries for all tickers) when the Tickers tab mounts. Cached in tab state for the session.

### Aggregation (pure function)

```js
// src/lib/tickerDirectory.js
export function buildTickerDirectory({ trades, positions, lifespans }) {
  // returns array of row objects sorted active-first then last-activity desc
}

// each row:
{
  ticker:        "IREN",
  status:        "active" | "idle",
  lastActivity:  "2026-05-06" | null,    // ISO date string
  cycles:        2,                       // trusted lifespan count
  cyclesSuspect: 1,                       // suspect lifespan count (for footnote)
  lifetimePnl:   7218,                    // sum of all closed trade premium
  includesSuspect: true | false,          // any contributing trade is suspect?
  capital:       99000,                   // currently-deployed capital
  cushionState:  "safe" | "approaching" | "assignment_risk" | null,
                                          // null when idle (no open CSPs)
  hasOpenPositions: true | false,
}
```

The `cushionState` requires per-CSP `iv` from quotes; the existing detail view passes `quoteMap` from `useQuotes()`. The Tickers tab does the same.

### Rendering

`TickersTab` is a pure component over the directory rows + the search/sort state. No fetches inside the table — all heavy lifting in the aggregation hook + the lifespan fetch.

---

## Component structure

```
src/components/
  TickersTab.jsx                    NEW (~250 lines)
src/lib/
  tickerDirectory.js                NEW: buildTickerDirectory (pure)
  __tests__/tickerDirectory.test.js NEW: vitest cases
src/lib/
  tickerHealth.js                   NEW: extracted from TickerHeader
src/components/tickerDetail/
  TickerHeader.jsx                  modify: import from tickerHealth
src/components/
  ExploreView.jsx                   modify: add Tickers chip + render
src/lib/
  modes.js                          modify: add "tickers" to EXPLORE_SUBVIEWS
src/App.jsx                         modify: pass onOpenTickerDetail through to TickersTab too
```

### Reused primitives

- `theme` tokens (everywhere)
- `formatDollars`, `formatDollarsFull`, `formatExpiry` from `src/lib/format.js`
- `computeCushion` from `src/lib/cushionBreach.js`
- The shared health helper extracted from `TickerHeader.jsx` (computes the worst cushion state across an array of CSPs)

### Test coverage

`tickerDirectory.test.js` covers:

- Active vs. idle classification (positions present / absent)
- Last-activity = most-recent close_date
- Cycle counts: trusted only; suspect counts surfaced separately
- Lifetime P&L: includes all closed trades regardless of suspect flag
- `includesSuspect` flag fires when any contributing trade is suspect
- Capital deployed: sums CSP + shares + LEAPS
- Default sort: active-first, then last-activity desc
- Empty input → empty array
- CSP-only ticker (zero lifespans) → idle, cycles 0, lifetime P&L sums correctly

No new tests for `TickersTab.jsx` itself — pure rendering verified via dev server (consistent with the per-ticker detail view shipped in v1.104.0).

---

## Routing

`"tickers"` is added to `EXPLORE_SUBVIEWS` (visible chip — unlike `"ticker-detail"` which is a hidden drill-down). `defaultSubView` for Explore stays `"positions"`.

No URL routing on the Tickers tab itself — only chip-nav navigation. The detail view it links to keeps its existing `#/ticker/SYMBOL` deep link.

---

## Performance

- ~12 tickers in current usage; ~50 max in any reasonable extrapolation. No virtualization needed.
- Single lifespan fetch (already a fast endpoint — same SQL the per-ticker detail view uses) on first tab visit; cached.
- Pure aggregation runs in <1ms for that data size.

---

## Edge cases

- **Brand-new ticker with one trade and no lifespan**: rendered as Idle, cycles 0, lifetime P&L from that trade. No special case.
- **Ticker with only suspect lifespans**: cycles renders `0 (N suspect)`. Lifetime P&L still sums all trades.
- **Ticker with only LEAPS positions, no CSPs/shares**: `Active` status, capital reflects LEAPS, health = `Healthy` (no CSPs to compute cushion against).
- **Quote not available for a ticker**: cushion is `null` → health falls through to `Healthy` if active, `—` if idle.
- **Ticker symbol contains a period (e.g. `BRK.A`)**: search and sort handle it as a string; URL hash already supports it (regex in `App.jsx` allows `.`).

---

## Visual language

Matches the existing detail-view sections:
- Dark surface background, 1px border, 8px radius
- Monospace numerics
- Section title in uppercase muted text with letter-spacing
- Hover turns the ticker cell `theme.blue`
- Status/health dots: 8px filled circles in semantic colors
- 3px left accent border on rows currently held open (subtle "active" cue), no border for idle

---

## Open items for implementation

None — all decisions baked in. Implementation is a single PR.
