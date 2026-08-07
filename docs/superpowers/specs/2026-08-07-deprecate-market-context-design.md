# Deprecate `market_context`

**Date:** 2026-08-07
**Status:** Approved, ready for implementation plan
**Area:** new `api/uw-macro-events.js` + `macro_events` table, `api/_lib/uwClient.js`,
`api/_lib/loadFocusData.js`, `api/focus-context.js`, `api/ingest.js`, `api/agent-scan.js`,
`src/lib/radarData.js`, `src/lib/focusEngine.js`, `src/components/RadarTab.jsx`,
`src/components/FocusTab.jsx`, `src/hooks/useFocusItems.js`

## Problem

`market_context` was fed by OpenClaw, a residential-IP scraper that pushed to
`POST /api/ingest`. OpenClaw is not coming back — the user has decided not to stand it
up again. The table's last write was **2026-07-01**. Two separate things are broken as a
result, and one of them is worse than a stale feed.

### The earnings half was already dead before the feed stopped

`market_context.positions[]` was supposed to carry a `nextEarnings` object per ticker.
In the final row (2026-07-01), **zero of 14 positions carry a `nextEarnings` key** —
OpenClaw stopped emitting it well before it stopped running, almost certainly when
`api/uw-earnings-dates.js` took over earnings sourcing.

So these have been returning `null` for every ticker for months:

- `getEarningsDaysAway` (`src/lib/radarData.js:134`) — feeds the `earnings_days_min`
  filter, which four of the six curated presets set to `30`
- `getEarningsWarning` (`src/components/RadarTab.jsx:92`) — the ⚠ badge on radar rows
- expanded-panel earnings date (`src/components/RadarTab.jsx:805`)
- `buildEarningsMap` → `ruleEarningsBeforeExpiry` (`src/lib/focusEngine.js:45,421`)

`radarFilter.js:49` treats a `null` days-away as "unknown, don't filter", so
`earnings_days_min: 30` is not merely inert — it is **silently passing earnings-week
names through** presets that advertise excluding them.

Meanwhile `quotes.earnings_date` is fresh and correct: 58 of 61 equities carry
`source: "unusualwhales"`, refreshed daily at 12:00 UTC by the `uw-earnings-dates` cron.
Six other consumers already read it. The fix is to point the remaining four at it too.

(Three ghost rows — UBER, NU, TIGR — still show `source: "finnhub"` with
`earnings_date = NULL`, last touched 2026-06-05. They fell out of the universe, so the
UW cron no longer visits them. Harmless; no action.)

### The macro half renders four-month-old data as if it were current

`macro_events` is the only thing `market_context` uniquely provides. In the final row all
11 events are dated **2026-04-03 → 2026-04-14**.

`MacroCalendar` (`src/components/FocusTab.jsx:78`) deliberately falls back to the most
recent *past* release when no event is future-dated, "so the panel still renders something
useful". Combined with a dead feed, that fallback puts April CPI, PPI and NFP on the Focus
tab today, formatted identically to live data. That is worse than an empty panel.

## Success criteria

- The Radar ⚠ earnings badge fires again, sourced from `quotes.earnings_date`.
- `earnings_days_min: 30` actually excludes earnings-week names from the four curated
  presets that set it.
- `ruleEarningsBeforeExpiry` fires again in Focus.
- `MacroCalendar` shows only genuinely upcoming events, or nothing.
- No code path reads or writes `market_context`.
- `grep -rn "market_context\|marketContext" src api` returns nothing except the
  `MARKET_CONTEXT_INGEST_SECRET` env-var name in `api/ingest.js`, which keeps its name so
  the surviving fundamentals branch does not need a Vercel env change.

## Design

### 1. UW macro-events feed

**`api/_lib/uwClient.js`** — add `fetchMarketEvents(minDate, maxDate)` against UW's
economic-calendar endpoint.

> **Implementation step one is a REST smoke test.** We have been bitten by this exact
> thing before: UW's MCP tool and REST endpoint return *different field names* for the
> same resource (see `reference_uw_mcp_vs_rest` — MCP returned `o/h/l/c/start`, REST
> returned `open/high/low/close/start_time`). The shape sampled during design came from
> the MCP tool. The normalizer must be written against real REST output, not against that
> sample.

Sampled MCP shape, for orientation only:

```json
{ "type": "report", "time": "2026-08-12T12:30:00Z", "event": "Consumer price index",
  "reported_period": "July", "prev": "-0.4%", "forecast": null }
```

Note what is *absent* versus the old TradingView payload: no `eventType` classifier and
no `importance` rank. Both have to be supplied on our side.

**New table `macro_events`** — one row per `(event_date, event_type)`, headline print only:

| column | type |
|---|---|
| `event_date` | `date` |
| `event_type` | `text` — `CPI`/`PPI`/`NFP`/`FOMC`/`PCE`/`RETAIL_SALES` |
| `event_time` | `timestamptz` |
| `title` | `text` |
| `forecast` | `text` |
| `previous` | `text` |
| `refreshed_at` | `timestamptz` |

Primary key `(event_date, event_type)`. Text rather than numeric for `forecast`/`previous`
because UW returns them pre-formatted and unit-mixed (`"3.5%"`, `"85000"`,
`"12000000000"`); nothing downstream does arithmetic on them.

**New cron `api/uw-macro-events.js`** — daily. DELETE-then-INSERT the whole window so
passed events self-clear rather than accumulating. Self-authenticating, soft no-op when
`UW_API_KEY` is unset, matching `uw-earnings-dates`.

> Needs an entry in `vercel.json` `crons` **and** in the middleware BYPASS list. Vercel
> cron sends `CRON_SECRET`; the middleware checks `APP_SECRET`, so without the bypass it
> 401s before the handler ever runs — a silent failure we have shipped before
> (`feedback_new_cron_needs_middleware_bypass`).

**Classifier** — six whitelisted types. For each type, match UW's *headline* event name
and drop the YoY / core / ex-food variants (UW emits four separate CPI rows for one
release). This is the fragile surface: a UW rename makes a type silently disappear.
Mitigated by a captured-fixture unit test and a per-run log of which types matched.

### 2. The ~8-day horizon is accepted as-is

UW's calendar looks about eight days forward and no further — probing from 2026-08-07,
`08-06 → 08-20` returns events through 08-14, and `08-15 → 09-15` returns empty.

For `MacroCalendar` this is arguably the right window anyway. For `ruleMacroOverlap` it is
a real reduction in capability, and an accepted one: the rule becomes a **near-expiry
warning** ("close or roll before Thursday's CPI") rather than an entry-planning aid. A
45-DTE CSP written today will not be warned that FOMC falls in its window; the alert
surfaces roughly a week before expiry.

Hardcoding the published FOMC calendar would have restored full lookahead for the
highest-impact event, and was considered and declined in favour of keeping the system
fully self-updating with nothing to refresh annually.

### 3. Rewire the macro consumers

- `loadFocusData.loadMarketContext` → `loadMacroEvents`, reading the new table.
- `api/focus-context.js` returns `{ macroEvents }` in place of `{ marketContext }`.
- `focusEngine.getUpcomingMacroEvents` adapts to the new row shape. Its dedupe-by-
  `eventType` collapse is deleted, not ported: the primary key already guarantees one row
  per type per date, and an ~8-day window cannot hold two of the same monthly release.
  The function reduces to a date filter.
- `ruleMacroOverlap` is otherwise unchanged.

**Deliberate behavior change:** `MacroCalendar` loses its most-recent-past-release
fallback. That branch is precisely what surfaced April data. With a live feed, an empty
upcoming set renders nothing.

### 4. Earnings → `quotes.earnings_date`

`radarFilter` calls `ctx.earningsDaysAway(row.ticker)`, so the lookup stays ticker-keyed:

```
getEarningsDaysAway(ticker, marketContext)  →  getEarningsDaysAway(ticker, earningsByTicker)
```

The map is built from the merged radar rows, which `radarData.js:58` already populates
with `earnings_date`. No new query on the Radar path.

`RadarTab`'s ⚠ badge and expanded-panel date read `row.earnings_date` directly.

`focusEngine.buildEarningsMap` builds from `quoteMap` instead of
`marketContext.positions`. `loadQuoteMap` already does `select("*")`, so no new query
there either. `earnings_meta` carries `hour` and `epsEstimate` — a superset of the old
`nextEarnings` shape — so `ruleEarningsBeforeExpiry`'s detail string (which interpolates
a bmo/amc label and an EPS estimate) works unchanged. It also carries `expectedMovePct`,
unused for now.

### 5. Deletions

- `api/ingest.js`: drop the `market_context` insert branch and the `positions` /
  `macroEvents` required-field validation. The `fundamentals` branch stays (see below),
  so the endpoint survives in reduced form rather than being deleted.
- `src/data/market-context.json` and its imports in `RadarTab.jsx:2` and
  `useFocusItems.js:2`.
- `api/agent-scan.js`: the `market_context` fetch and `marketContextAsOf` in the response.
- `src/App.jsx:281`: the `marketContext` prop.

**The `market_context` table itself stays.** 65 rows, no cost, and it is the historical
record. Dropping a table is irreversible and is not required to complete the deprecation.
Drop it in a follow-up once this has run clean for a week.

## Out of scope — the rest of the OpenClaw decay

`market_context` is not the only casualty. Every OpenClaw-fed table was audited on
2026-08-07; findings and UW feasibility below. **None of this is in scope for this
change** — it is recorded here so the next person does not have to re-derive it.

| Table | State | UW replacement |
|---|---|---|
| `fundamentals` | Stale 2026-07-01, live consumers | Yes, P/E derived |
| `s5fi` | Stale 2026-07-01, **feeds a live score** | No practical path |
| `fedwatch` | **0 rows — never worked** | Partial only |
| `quotes.iv` (via `ingest-iv`) | Fresh — already superseded | N/A, done |

### `fundamentals` — UW covers it

Frozen at 2026-07-01. Radar's P/E column (`radarData.js:107`) and `useRiskUnits`'
per-ticker beta (`useRiskUnits.js:29`) are both live on five-week-old data. This is why
`api/ingest.js` is reduced rather than deleted.

- **`beta`** — direct field on UW `get_company_info` (CEG: `beta: "1.3503"`). Drop-in.
- **EPS / P/E** — derivable from `get_fundamental_breakdown`, which returns ~19 rows of
  quarterly `earnings_per_share`. Verified the rows are **period-scoped, not cumulative**:
  CEG's 10-K row for 2025-12-31 reports net income 2,319M while Q1–Q3 already total
  2,962M, so the annual filing row carries Q4 alone. Therefore `eps_ttm` = sum of the
  trailing four rows (CEG: 2.98 + 1.37 + 4.49 + 1.42 = 10.26) and `pe_ttm` = current price
  ÷ that (265.08 / 10.26 ≈ 25.8, sane for CEG).

P/E becomes a derived number rather than a vendor figure, so the edge cases are ours:
negative EPS, non-December fiscal years, mid-year share-count changes. Cost is two calls
per ticker — ~67s for 61 equities at the 550ms gate, so it needs a raised `maxDuration`
and a weekly schedule, since filings only move quarterly.

### `s5fi` — no UW path, and it is serving wrong numbers today

29 rows, frozen at 2026-07-01. `fetchS5fi` (`api/macro.js:457`) takes the newest row
**with no recency check** and passes it to `labelS5fi`, whose score lands in
`computePosture` alongside six other signals (`api/macro.js:981`) and in the EOD snapshot
(`api/snapshot.js:374`). The Macro tab is presenting five-week-old breadth as a current
reading and it is moving the composite posture score — the same failure mode as the
`MacroCalendar` fallback this spec removes.

The `scrapeS5fiFinviz()` fallback does not save it: it only fires when *no* row exists,
and its own comment notes it 403s on Vercel.

UW has no equivalent. Deriving "% of S&P 500 above the 50-day MA" needs a 50-day MA per
constituent — roughly 500 `get_ticker_indicator_series` calls, about 4.6 minutes at the
rate gate, past the 300s function ceiling. Not viable as a single cron.

**Recommended to do first, independent of sourcing:** add a staleness guard to
`fetchS5fi` so a row older than ~3 trading days degrades to the existing `score: 3`
"Unavailable" branch instead of being served as live. Small, and it stops a wrong number
reaching a score you act on, whether or not the feed is ever restored.

### `fedwatch` — never worked; partial UW cover

The table has **zero rows**, so `fetchFedWatch` has always fallen through to the direct
fetch, which 403s on Vercel. The signal has been scoring a neutral 3 since it shipped.
Not a regression — an unlanded feature.

UW's `get_central_bank_rates` returns the Fed's current rate (3.75) and next meeting
date (2026-09-16), but **not** the CME probability distribution across rate buckets.
`computeFedWatch` is built on `todayRows` / `weekAgoRows` probability sets, so the signal
as designed cannot be reproduced. UW would support a different, simpler tile.

### `ingest-iv` — already resolved

`quotes.refreshed_at` was 2026-08-07 12:31 at audit time; the `uw-iv` cron superseded this
path. `api/ingest-iv.js` is dead code with nothing to replace. `api/ingest-wheel-earnings.js`
is likewise superseded by `uw-earnings-dates`. Both can be deleted in the same sweep.

## Testing

- Unit: classifier against a captured UW REST fixture, including the four-CPI-rows case
  and an unmatched-event case.
- Unit: `getEarningsDaysAway` with a populated map, an absent ticker (must return `null`,
  not `0`), and a past date.
- Unit: `getUpcomingMacroEvents` with an empty table — must return `[]`, and
  `MacroCalendar` must render nothing rather than falling back.
- Unit: `buildEarningsMap` from a `quoteMap`, asserting the `hour`/`epsEstimate`
  passthrough that `ruleEarningsBeforeExpiry`'s detail string depends on.
- Existing `agent-scan` and `radarData` suites must pass with the signature change.
- Manual: hit `/api/uw-macro-events` once, confirm six-or-fewer event types land and the
  Focus panel shows the real upcoming week.

Local dev does not serve `api/*` (no Vite proxy), so the API-driven panels cannot be
browser-verified locally — vitest plus a build, then verify on the deployment.
