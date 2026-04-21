# OpenClaw Extensions — Wheel Radar Ingest Spec

**Date:** 2026-04-21
**Target app version:** trading-dashboard v1.68.0+
**Owner review:** OpenClaw maintainer

## Context

The Radar tab in `trading-dashboard` scans the **approved wheel universe**
(~50 tickers in `wheel_universe.list_type = 'approved'`) for CSP setups. Two
Radar cells were recently wired up but are only partially populated today:

- **EARN column** — days until next earnings + bmo/amc hint
- **% change next to price** — intraday delta vs yesterday's close

OpenClaw already writes `iv` + `iv_rank` for the wheel universe via
`POST /api/ingest-iv` every ~15 min from a residential IP. This spec proposes
two small additions to that pipeline so both cells stay fresh and rich.

## Goals

- Universe-wide earnings dates (currently only held tickers have them, via
  `market_context.positions[].nextEarnings` from the existing OpenClaw flow).
- Bmo/amc hint + EPS/revenue estimates + Finnhub confidence on every earnings
  row, not just held tickers.
- Intraday `last` + `prev_close` on every quote, so Radar change % doesn't lag
  the 2-hour refresh of `/api/bb` (Yahoo-sourced).

## Non-goals

- No changes to how OpenClaw fetches IV (that pipeline stays untouched).
- No changes to `market_context.positions[].nextEarnings`. Held tickers keep
  getting richer per-position data through that path; wheel-universe earnings
  land on the `quotes` table instead.
- No analyst/news/dividends ingestion in this spec. See "Future extensions" at
  the bottom.

## Summary of changes

| # | Change | Endpoint | Frequency |
|---|---|---|---|
| 1 | Add `last` + `prev_close` to IV quote payload | existing `POST /api/ingest-iv` | every IV tick (~15 min) |
| 2 | New earnings ingest for wheel universe + held | new `POST /api/ingest-wheel-earnings` | once per trading day |

Both endpoints share the same auth header (`X-Ingest-Secret:
$MARKET_CONTEXT_INGEST_SECRET`) that OpenClaw already sends.

---

## Change 1 — Add `last` + `prev_close` to IV payload

### Target endpoint (unchanged)
`POST /api/ingest-iv` with existing `X-Ingest-Secret` header.

### Payload diff

Before:
```json
{
  "quotes": [
    { "symbol": "PLTR", "iv": 0.728, "iv_rank": 46.75 }
  ]
}
```

After (both new fields optional; backward-compatible):
```json
{
  "quotes": [
    {
      "symbol":     "PLTR",
      "iv":         0.728,
      "iv_rank":    46.75,
      "last":       108.40,
      "prev_close": 110.74
    }
  ]
}
```

### Field semantics

- `last` — latest regular-session trade price, number.
- `prev_close` — prior regular-session close, number. Does **not** include
  pre/post-market extended-hours activity.

Both are optional — if OpenClaw can't source either, omit them and the app
falls back to `/api/bb`'s Yahoo-sourced values (stale up to 2 h).

### Source suggestion

Tastytrade (the source OpenClaw already uses for IV) returns both fields in
the standard quote response. If not trivially available there, Finnhub's
`/quote` endpoint (`c` = current, `pc` = previous close, `d`/`dp` = change/%)
works and is in the free tier (60 req/min, one request per ticker).

Bulk alternative (one request total): Finnhub `/quote/bulk` (paid tier) or
Yahoo's chart endpoint that OpenClaw can batch through residential IPs.

### Expected app-side behavior

`/api/ingest-iv` now patches `last` + `prev_close` alongside `iv` + `iv_rank`
when they're present in the POST body (v1.68.0). Missing fields are left
untouched, so OpenClaw can send them incrementally.

---

## Change 2 — New wheel-universe earnings ingestion

### Target endpoint (new, shipping in v1.68.0)

`POST /api/ingest-wheel-earnings`

Same auth header as `/api/ingest-iv` (`X-Ingest-Secret:
$MARKET_CONTEXT_INGEST_SECRET`).

### GET contract (which tickers to fetch)

```http
GET /api/ingest-wheel-earnings
X-Ingest-Secret: <secret>
```

Response:
```json
{
  "ok": true,
  "tickers": ["AA", "AMD", "APP", "AVGO", "CCJ", "CDE", ..., "XOM"]
}
```

Returns the **deduped union of** `wheel_universe.list_type='approved'` and
tickers in the current `positions` table. This ensures held tickers that have
dropped off the approved list still get earnings data.

### POST contract (write)

```http
POST /api/ingest-wheel-earnings
Content-Type: application/json
X-Ingest-Secret: <secret>
```

Body:
```json
{
  "earnings": [
    {
      "ticker":           "PLTR",
      "date":             "2026-05-05",
      "hour":             "amc",
      "epsEstimate":      0.18,
      "revenueEstimate":  1200000000,
      "confidence":       "high"
    },
    {
      "ticker": "XOM",
      "date":   null
    }
  ]
}
```

### Field semantics

| Field | Required | Notes |
|---|---|---|
| `ticker` | ✅ | Must match `wheel_universe.ticker`. Case-sensitive. |
| `date` | ✅ (nullable) | `YYYY-MM-DD`. Pass `null` to explicitly clear a stale date. |
| `hour` | ❌ | `"bmo"` \| `"amc"` \| `""`. Rendered in Radar EARN cell. |
| `epsEstimate` | ❌ | Number. Stored for future analyst-drift filter. |
| `revenueEstimate` | ❌ | Number. Stored for future analyst-drift filter. |
| `confidence` | ❌ | `"high"` \| `"medium"` \| `"low"`. Finnhub's own score. |

The app stores `date` in a typed `DATE` column (`quotes.earnings_date`); the
rest goes into `quotes.earnings_meta` JSONB plus a `source: "finnhub"` +
`ingestedAt: ISO8601` stamp.

### Response

```json
{ "ok": true, "updated": 52, "rejected": [] }
```

`rejected` lists rows the server couldn't parse (missing ticker, bad date).
The handler is lenient — invalid rows are skipped, not fatal.

### Recommended cadence

**Once per trading day**, around 05:00 ET (before market open). The app keeps
a 20 h stale window on the lazy Yahoo fallback (`/api/wheel-earnings`), so
missing a day won't surface anything bad — Yahoo picks up the slack.

### Finnhub call pattern (bulk, 1 request)

Instead of looping per-ticker, call Finnhub's bulk calendar endpoint once:

```
GET https://finnhub.io/api/v1/calendar/earnings
    ?from=<today>
    &to=<today+90d>
    &token=<FINNHUB_API_KEY>
```

Response includes `earningsCalendar: [{symbol, date, hour, epsEstimate,
revenueEstimate, year, quarter, ...}]`. Filter to the `tickers` list returned
from `GET /api/ingest-wheel-earnings`, map into the POST payload above, send.

Finnhub's confidence score isn't in `/calendar/earnings` — if you want it,
fall back to the per-symbol `/stock/earnings` endpoint (60 req/min). Optional.

### For tickers with **no** upcoming earnings in the window

Send `{ ticker, date: null }` so the app clears any stale value. Or omit them
entirely — the app treats a missing row as "unknown, don't touch".
Recommended: send `{ date: null }` for tickers we know reported recently (to
explicitly clear), omit tickers with genuinely unknown cadence.

---

## Rollout order

1. **Migration 012 + 013 applied to Supabase** (already in repo —
   `supabase/migration-012-radar-prev-close-earnings.sql`,
   `supabase/migration-013-earnings-meta.sql`). Run these first.
2. **App v1.68.0 deployed** (already shipped). Both endpoints are live but
   tolerate empty data — Yahoo lazy fallback covers until OpenClaw arrives.
3. **OpenClaw Change 1** (add `last`, `prev_close` to IV payload) — deploy
   whenever convenient. Radar change % switches from 2 h stale to ~15 min
   stale automatically.
4. **OpenClaw Change 2** (daily earnings ingest) — deploy whenever
   convenient. Radar EARN column populates for the full universe; the "avoid
   earnings within Xd" filter starts excluding universe tickers, not just
   held ones.

Changes 3 and 4 are independent — ship whichever is ready first.

---

## Failure modes + fallbacks

| Scenario | App behavior |
|---|---|
| `/api/ingest-iv` succeeds but omits `last`/`prev_close` | Existing `/api/bb` cycle keeps these fields warm (2 h stale). |
| `/api/ingest-wheel-earnings` hasn't run in >20 h | Lazy `/api/wheel-earnings` endpoint (Yahoo quoteSummary) fills in. |
| Both OpenClaw + Yahoo fail | EARN column shows `—`; change % shows nothing. No error surfaced. |
| OpenClaw sends a bad row | Server skips it, returns in `rejected[]`. Other rows still written. |

The design goal: **OpenClaw going offline for a day doesn't break Radar**.
Every cell has a Yahoo-sourced lazy fallback. OpenClaw's value is faster
refresh + richer metadata.

---

## Validation checklist

Once deployed, you should see (any Supabase SQL tool):

```sql
-- Change 1 validation: every wheel-universe ticker has prev_close
SELECT count(*) FROM quotes
WHERE symbol IN (SELECT ticker FROM wheel_universe WHERE list_type='approved')
  AND prev_close IS NOT NULL;
-- Expect: ~50 (full universe)

-- Change 2 validation: earnings_meta carries hour + estimates where Finnhub has them
SELECT symbol, earnings_date, earnings_meta
FROM quotes
WHERE earnings_meta IS NOT NULL
ORDER BY earnings_date ASC
LIMIT 10;
-- Expect: source="finnhub", hour in {"bmo","amc",""}, epsEstimate/revenueEstimate numeric
```

In the app: Radar rows with earnings inside 21 days show `Xd HOLD · inside 21d
· bmo` (or `amc`). Prices show `$108.40 +0.8%` with color on the delta.

---

## Future extensions (not in this spec)

These would be valuable follow-ons once Changes 1 and 2 are bedded in. All
could land as new endpoints that write their own columns on `quotes` (or
new tables) without disturbing existing pipelines:

- **Analyst consensus** — `finnhub/stock/recommendation`. Surface a 1-bar
  bullish/bearish bar in the Radar detail panel. Weekly refresh.
- **Ex-dividend dates** — `finnhub/calendar/dividends`. Matters for CC
  assignment risk near ex-div. Daily refresh, ~90 d window.
- **Insider transactions** — `finnhub/stock/insider-transactions`. Surface a
  "recent insider buy" badge. Weekly refresh.
- **Company news** — `finnhub/company-news`. Feed a news drawer on Radar
  detail so big intraday moves get explained. Daily, last-7-day window.
- **Short interest** — `finnhub/stock/short-interest` (paid tier). Useful
  signal for squeeze candidates. Monthly refresh.

None of these block the current work — discuss after a week of living with
Changes 1 and 2 and seeing what's actually missed.
