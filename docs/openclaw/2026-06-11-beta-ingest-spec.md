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
- No live/intraday beta. Daily-or-slower is plenty.
- No separate cron. Beta rides the **existing** fundamentals generator (which
  already calls Finnhub `/stock/metric` for P/E and EPS), so it's emitted
  whenever that payload runs. See "Cadence" below.

## Summary of change

| # | Change | Endpoint | Frequency |
|---|---|---|---|
| 1 | Add `beta` to the existing fundamentals payload | existing `POST /api/ingest` | whatever the fundamentals generator already runs at |

Same auth header the fundamentals ingest already uses
(`X-Ingest-Secret: $MARKET_CONTEXT_INGEST_SECRET`).

## App-side changes (shipped, v1.125.1)

1. Migration `2026-06-11-fundamentals-beta.sql` adds a nullable `beta numeric`
   column to `fundamentals`.
2. `POST /api/ingest` reads `beta` off each `fundamentals[]` row. **Beta is
   applied as a separate, non-null-only update** — a row that omits beta (or
   sends `null`) leaves any existing beta untouched. It can NOT clobber a
   previously-good value. (The base fields — P/E, EPS — are still a full
   overwrite, since the generator always emits them.)
3. Radar surfaces it: a `β:` chip on the compact row, a "Market Sensitivity"
   section in the expanded panel (with a plain-English interpretation), and a
   **Beta** sort button.

## Answers to the implementation questions

- **Existing generator vs separate weekly path?** Use the **existing**
  fundamentals generator. Add beta next to the P/E/EPS it already pulls from
  Finnhub and send it in the same payload. No new cron, no "weekly" framing —
  the app's non-clobber upsert makes frequency a non-issue, and beta barely
  moves day to day.
- **Missing beta — omit or `null`?** **Omit the field.** It's the cleaner
  contract. (The server now also treats an explicit `null` as no-op, so either
  is safe — but omit is preferred.)
- **Yahoo fallback scope?** Optional, and only worth it for tickers Finnhub
  *persistently* lacks beta on. On a Finnhub request failure / rate-limit, just
  **omit beta for that run** — the next run refreshes it and nothing was lost.
  Don't add fallback complexity to cover transient errors.

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
| `beta` | ❌ | Number. Trailing market beta vs the S&P 500. **Omit when unavailable** (preferred); an explicit `null` is also tolerated. Either way the app leaves any prior value untouched — it never clobbers a good beta with a missing one. |

## Source — Finnhub `/stock/metric` (recommended)

OpenClaw already holds `FINNHUB_API_KEY`. The "Basic Financials" endpoint
returns beta directly:

```
GET https://finnhub.io/api/v1/stock/metric?symbol=PLTR&metric=all&token=<KEY>
→ { "metric": { "beta": 1.83, "52WeekHigh": ..., ... }, ... }
```

- Free tier (60 req/min), one request per ticker — already in the per-ticker
  loop that fetches P/E and EPS, so beta is essentially free to add.
- Map `metric.beta` → `fundamentals[].beta` in the same row you already build.
  No new request, no new cron.

### Fallback (optional)

Yahoo `quoteSummary` `defaultKeyStatistics.beta` — the same Yahoo source
OpenClaw already uses for price/BB and the lazy earnings fallback. Only worth
reaching for on tickers Finnhub *persistently* lacks beta on. On a transient
Finnhub failure/rate-limit, skip it — omit beta for that ticker this run and let
the next run recover.

## Cadence

Whatever the fundamentals generator already runs at (daily is fine). Beta is
stable, and the non-clobber upsert means a skipped run just keeps the last good
value — nothing decays to `—` from a missed cycle.

## Failure modes

| Scenario | App behavior |
|---|---|
| `beta` omitted from payload | Prior value left untouched (non-clobber). If never set, Radar hides the chip + Market Sensitivity section for that ticker. |
| `beta` sent as `null` | Same as omitted — treated as no-op, prior value kept. |
| Finnhub + Yahoo both unavailable | Beta omitted; Radar simply hides it. No error surfaced. |

The design goal matches the existing ingest specs: OpenClaw going quiet doesn't
break Radar — beta is purely additive context.
