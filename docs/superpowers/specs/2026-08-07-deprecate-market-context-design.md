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

## Out of scope — flagged

**`fundamentals` is frozen at 2026-07-01**, the same OpenClaw death, a different table.
Radar's P/E column (`radarData.js:107`) and `useRiskUnits`' per-ticker beta
(`useRiskUnits.js:29`) are both running on five-week-old data right now. This is a real
problem and a separate one; this change does not address it. It is also the reason
`api/ingest.js` is reduced rather than deleted.

The same question applies to `api/ingest-wheel-earnings.js`, `api/ingest-fedwatch.js`,
`api/ingest-iv.js` and `api/ingest-s5fi.js` — all OpenClaw-fed, all presumably dead, none
audited here. Worth a sweep after this lands.

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
