# Bollinger Band Spike — Complete Findings & Discussion

**Date:** 2026-04-12  
**Context:** Wheel strategy trading dashboard. Exploring Bollinger Band position data as a signal for CSP entry candidates and broader position management.

---

## What We Were Trying to Answer

Can we get reliable `bb_position` data for 15–53 tickers on a regular refresh cycle, without adding new paid API dependencies? And is the signal useful beyond just a CSP entry filter?

---

## What bb_position Is

```
bb_position = (current_price - lower_band) / (upper_band - lower_band)
```

Standard parameters: 20-period SMA, 2 standard deviations. On a daily chart, 20 periods = 20 trading days (~1 calendar month).

| Value | Meaning |
|-------|---------|
| 0.0 | Exactly at the lower band |
| 0.5 | Exactly at the midline (20-day SMA) |
| 1.0 | Exactly at the upper band |
| < 0 | Below the lower band (extended to downside) |
| > 1 | Above the upper band (extended to upside) |

The value always answers: *"where is today's price relative to the bands?"* It incorporates both the band shape (based on the last 20 daily closes) and the current live price in the numerator.

---

## API Investigation

### Sources Checked

**Tastytrade** — Already used for IV data, but datacenter IPs (Vercel/AWS) are blocked. Would require the OpenClaw pipeline. Does have historical OHLC via DXFeed, but the complexity and dependency make it a non-starter when better options exist.

**Finnhub** — Used via OpenClaw for earnings data. Has a `/indicator` endpoint that may support `bbands`, but free-tier availability is unclear and it would require adding a `FINNHUB_API_KEY` env var to Vercel. Viable fallback only.

**Yahoo Finance** — Already integrated for VIX (`api/vix.js`). Same endpoint, change `range=1d` to `range=1mo`. No API key. No new dependencies. Works from Vercel. **Clear winner.**

### Yahoo Finance Endpoint

```
GET https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?interval=1d&range=1mo

Headers:
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
  Accept: application/json

Extract:
  closes:  chart.result[0].indicators.quote[0].close   (~22 daily closes)
  price:   chart.result[0].meta.regularMarketPrice      (live price)
```

Returns ~22 trading days of daily OHLC. The `regularMarketPrice` is live during market hours.

### Bollinger Band Computation (server-side, no library needed)

```js
const last20 = closes.slice(-20);
const sma = last20.reduce((a, b) => a + b, 0) / 20;
const variance = last20.reduce((s, c) => s + Math.pow(c - sma, 2), 0) / 20;
const stdDev = Math.sqrt(variance);
const upper = sma + 2 * stdDev;
const lower = sma - 2 * stdDev;
const bbPosition = (currentPrice - lower) / (upper - lower);
```

---

## All 15 Tickers — Verified April 10, 2026 Close

| Ticker | Price | SMA₂₀ | Upper | Lower | BB Position | Status |
|--------|------:|------:|------:|------:|------:|--------|
| PLTR | 128.06 | 147.76 | 164.06 | 131.46 | **-0.104** | Below lower band |
| SHOP | 110.79 | 118.47 | 127.75 | 109.20 | **0.086** | Near lower band |
| APP | 391.38 | 416.45 | 476.58 | 356.32 | 0.292 | Lower half |
| KTOS | 70.34 | 78.09 | 96.77 | 59.41 | 0.293 | Lower half |
| HOOD | 69.19 | 71.03 | 76.92 | 65.13 | 0.344 | Mid-lower |
| SOFI | 16.22 | 16.47 | 17.93 | 15.00 | 0.416 | Mid |
| IREN | 39.32 | 38.54 | 45.84 | 31.23 | 0.554 | Mid |
| CDE | 20.24 | 18.77 | 21.39 | 16.15 | 0.780 | Upper half |
| CCJ | 116.04 | 109.09 | 117.18 | 101.01 | 0.930 | Near upper band |
| WDC | 343.43 | 298.95 | 346.00 | 251.90 | 0.973 | Near upper band |
| CRDO | 119.59 | 103.89 | 119.77 | 88.01 | 0.994 | At upper band |
| NVDA | 188.63 | 177.42 | 188.30 | 166.54 | **1.015** | Above upper band |
| TSM | 370.60 | 341.92 | 367.89 | 315.96 | **1.052** | Above upper band |
| GLW | 171.24 | 141.30 | 168.21 | 114.39 | **1.056** | Above upper band |
| CLS | 351.31 | 289.99 | 334.59 | 245.39 | **1.187** | Above upper band |

**Zero failures.** All 15 tickers returned 22 valid daily closes.

**Verification:** CLS bb_position = 1.187 (> 1.0 criterion met — CLS was extended above upper band per spike doc). PLTR at -0.104 consistent with tariff-driven weakness described in spike doc.

---

## Scale & Refresh Rate

**53 tickers** is not a problem. 53 sequential requests at 100ms stagger = ~5.3 seconds per cycle.

| Refresh Interval | Requests/day | Avg rate |
|-----------------|-------------|----------|
| 30 min | ~689 | 1.8/min |
| 1 hour | ~371 | 1.0/min |
| 2 hours | ~212 | 0.6/min |

**Recommendation: 1–2 hour refresh.** BB bands are based on daily closes so they only change meaningfully once per day. Hourly is frequent enough to catch intraday price moves in `bb_position` without wasting calls.

---

## Real-Time Accuracy

Two components update at different rates:

**The bands (SMA, upper, lower):** Calculated from the last 20 daily closes. During market hours, the current day's price is included as the 20th data point, so bands shift slightly intraday — but with 19 fixed prior closes, one data point has limited impact on the band shape.

**The price (`regularMarketPrice`):** Live during market hours (same feed used for VIX).

**Example — 8% intraday swing:** If CLS drops from $351 to $323 during a session:
- The bands barely move (19/20 data points unchanged)
- `bb_position` drops from ~1.19 to ~0.85
- This correctly reflects that CLS is no longer extended above the upper band

**Bottom line:** bb_position is responsive enough for a 1–2 hour refresh scanner. It won't catch a 5-minute spike, but it accurately represents where price sits relative to the bands at each refresh. That's the right fidelity for CSP entry decisions.

---

## Broader Signal Utility

bb_position doesn't have to be just a CSP entry filter. It's another numeric signal alongside `iv_rank` and `itmPct` in the focus engine. Potential uses:

### CSP Entry (the original scanner use case)
- `bb_position < 0.20` → price near or below lower band → CSP candidate

### CC Management
- `bb_position > 0.80` + profit at 40–50% → consider early close (price extended, momentum could reverse)
- `bb_position` flattening near lower band on a challenged CC → close before it gets worse

### 60/60 Rule Augmentation
- `bb_position > 0.85` at 50% profit capture → treat as 60% and close early (price extended upside, risk/reward shifts)
- `bb_position < 0.15` at 50% profit capture → consider holding past 60% (price extended to downside, premium decay strongly favors you)

### CSP Position Management (existing positions)
- High `bb_position` + approaching ITM → roll out sooner (momentum extended, less likely to reverse quickly)
- Low `bb_position` + deeply ITM → hold, mean reversion likely incoming

---

## Proposed Architecture

Integration follows existing patterns in the codebase:

1. **New fetch in `api/quotes.js`** — when quotes refresh, also fetch 1mo daily candles for each ticker from Yahoo Finance, compute `bb_position` server-side, upsert to `quotes` table
2. **Schema change** — `ALTER TABLE quotes ADD COLUMN bb_position numeric` (new migration following `supabase/migration-003-quotes.sql` pattern)
3. **No new hooks or API routes** — frontend reads `bb_position` alongside existing quote data
4. **No OpenClaw dependency** — Yahoo Finance doesn't block datacenter IPs, runs entirely on Vercel

---

## Go / No-Go

**GO.**

- Yahoo Finance returns reliable daily OHLC for all tickers in the universe, no API key required
- CLS verification test passed (bb_position = 1.187 > 1.0)
- Scales to 53 tickers with no rate limit concerns at 1–2 hour refresh
- Zero new dependencies — reuses existing Yahoo Finance integration pattern
- Signal has broader utility beyond the CSP scanner (CC management, 60/60 augmentation)

**Next step:** Write the CSP scanner spec as a separate feature, and consider framing `bb_position` as a general-purpose signal in the focus engine spec rather than just a scanner filter.
