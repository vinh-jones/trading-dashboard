# OpenClaw Extensions — Radar Beta Ingest Spec

**Date:** 2026-06-11
**Target app version:** trading-dashboard v1.123.0+
**Owner review:** OpenClaw maintainer

## Context

The Radar tab scans the approved wheel universe for CSP setups. It already
surfaces per-name signals (BB position, IV/IV-rank, trend, P/E). It does **not**
have **beta** — the stock-level measure of how much a name moves relative to the
S&P 500.

Beta is a risk/concentration lens, complementary to the existing signals: a book
full of high-beta names (PLTR, HOOD, etc.) looks diversified by ticker but is
really one leveraged bet on the market — in a broad selloff those CSPs all go
underwater together. It pairs naturally with the VIX deployment framework
(high VIX + high-beta = selling puts on what falls hardest). The `macro.js`
commentary already references "shift to lower-beta names" without having the
number to back it.

Beta is **slow-moving** (it barely changes week to week), so it belongs on the
fundamentals lane, not the ~15-min IV/quote pipeline.

## Non-goals

- No changes to the IV pipeline (`/api/ingest-iv`) or earnings ingest.
- No live/intraday beta. A weekly refresh is plenty.

## Summary of change

| # | Change | Endpoint | Frequency |
|---|---|---|---|
| 1 | Add `beta` to the fundamentals payload | existing `POST /api/ingest` | weekly |

Same auth header the fundamentals ingest already uses
(`X-Ingest-Secret: $MARKET_CONTEXT_INGEST_SECRET`).

## App-side changes (shipping in v1.123.0)

1. Migration `2026-06-11-fundamentals-beta.sql` adds a nullable `beta numeric`
   column to `fundamentals`.
2. `POST /api/ingest` now reads `beta` off each `fundamentals[]` row and upserts
   it (missing/NULL is tolerated — treated as "unknown, no penalty").
3. Radar surfaces it: a `β:` chip on the compact row, a "Market Sensitivity"
   section in the expanded panel (with a plain-English interpretation), and a
   **Beta** sort button.

## Payload diff

The fundamentals array gains one optional field:

```json
{
  "fundamentals": [
    {
      "ticker":     "PLTR",
      "pe_ttm":     220.5,
      "pe_annual":  240.1,
      "eps_ttm":    0.49,
      "eps_annual": 0.45,
      "beta":       1.83
    }
  ]
}
```

### Field semantics

| Field | Required | Notes |
|---|---|---|
| `beta` | ❌ | Number. Trailing market beta vs the S&P 500. Omit (or send `null`) if unavailable — the app leaves any prior value untouched and treats unknown beta as no-penalty. |

## Source — Finnhub `/stock/metric` (recommended)

OpenClaw already holds `FINNHUB_API_KEY`. The "Basic Financials" endpoint
returns beta directly:

```
GET https://finnhub.io/api/v1/stock/metric?symbol=PLTR&metric=all&token=<KEY>
→ { "metric": { "beta": 1.83, "52WeekHigh": ..., ... }, ... }
```

- Free tier (60 req/min), one request per ticker → ~50 calls.
- Run **weekly** (e.g. Sunday). Map `metric.beta` → `fundamentals[].beta`, send
  alongside the P/E values already being pushed.

### Fallback

Yahoo `quoteSummary` `defaultKeyStatistics.beta` — the same Yahoo source
OpenClaw already uses for price/BB and the lazy earnings fallback. Free and
batchable through the residential IPs; slightly more fragile (unofficial), so
use it only if Finnhub's value is missing.

## Recommended cadence

**Once per week.** Beta is stable; a missed week surfaces nothing bad (the app
shows `—` / hides the chip when beta is NULL).

## Failure modes

| Scenario | App behavior |
|---|---|
| `beta` omitted from payload | Prior value left untouched; if never set, Radar hides the chip and the Market Sensitivity section for that ticker. |
| Finnhub + Yahoo both unavailable | No beta written; Radar simply omits it. No error surfaced. |

The design goal matches the existing ingest specs: OpenClaw going quiet doesn't
break Radar — beta is purely additive context.
