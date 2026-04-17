# Spike Findings: Bollinger Band Data for CSP Scanner

**Date:** 2026-04-12 (Sunday — data reflects Friday April 10 close)

---

## Recommendation: GO — Yahoo Finance

Yahoo Finance v8 chart endpoint is the clear winner. Already integrated for VIX, requires no API key, works from Vercel, and returns reliable data for all 15 tickers.

---

## 1. Which API works best and why

**Yahoo Finance** — best on every dimension:

| Criterion | Yahoo Finance | Finnhub | Tastytrade |
|-----------|:---:|:---:|:---:|
| Already integrated | Yes (VIX) | Via OpenClaw only | Via OpenClaw only |
| API key required | No | Yes | Yes |
| Works from Vercel | Yes | Yes | No (datacenter IP blocked) |
| Historical OHLC | Yes (1mo daily) | Yes (candles) | Yes (DXFeed) |
| Direct BB values | No | Unclear (paid tier?) | No |
| Rate limits | Generous (no key) | 60/min free | Unknown |
| Extra dependency | None | FINNHUB_API_KEY env var | OpenClaw pipeline |

Finnhub is a viable fallback if Yahoo ever breaks. Tastytrade is not practical for this use case.

## 2. Direct BB values or compute from OHLC?

**Compute from OHLC.** No tested API returns pre-computed Bollinger Band values on a free/existing tier. Yahoo returns 22 daily closes for a 1-month range, which is more than enough for the 20-day SMA + 2σ calculation.

The computation is 5 lines of math — no library needed:
```js
const last20 = closes.slice(-20);
const sma = last20.reduce((a, b) => a + b, 0) / 20;
const variance = last20.reduce((s, c) => s + Math.pow(c - sma, 2), 0) / 20;
const stdDev = Math.sqrt(variance);
const upper = sma + 2 * stdDev;
const lower = sma - 2 * stdDev;
const bbPosition = (currentPrice - lower) / (upper - lower);
```

## 3. API call pattern

**Endpoint:**
```
GET https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?interval=1d&range=1mo
```

**Headers:**
```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Accept: application/json
```

**Response extraction:**
```
closes:       chart.result[0].indicators.quote[0].close   (array of ~22 daily closes)
currentPrice: chart.result[0].meta.regularMarketPrice      (last/current price)
```

**Existing reference:** `api/vix.js` uses the identical endpoint pattern (same base URL, same headers).

## 4. Ticker results — all 15 pass

| Ticker | Price | SMA₂₀ | Upper | Lower | BB Position | Signal |
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

**Zero failures.** All 15 tickers returned 22 valid daily closes. No nulls, no empty arrays, no HTTP errors.

**CSP candidates (bb_position < 0.20):** PLTR (-0.104), SHOP (0.086)

## 5. Verification

**CLS bb_position = 1.187 (> 1.0)** — spike acceptance criterion met. CLS closed at $351.31, well above the upper band at $334.59, consistent with the "up 7%, extended move" context from the spike doc.

**PLTR bb_position = -0.104 (< 0)** — below the lower band, consistent with recent tariff-driven weakness mentioned in the spike doc.

## 6. Recommended refresh interval

**30 minutes** — matches the existing `STALE_MS` pattern in `api/quotes.js`. Bollinger Bands only change once per day (they use daily closes), so even 30 minutes is conservative. But keeping the same cadence as quote refreshes simplifies the architecture.

15 sequential requests with 100ms stagger = ~1.5s total fetch time per cycle. Well within Yahoo's implicit rate limits.

## 7. Architecture recommendation

Integrate into the existing `api/quotes.js` lazy refresh cycle:

1. When quotes are refreshed (stale + market open), also fetch 1mo daily candles for each ticker
2. Compute bb_position server-side
3. Store in the `quotes` table (add `bb_position numeric` column)
4. Frontend reads it alongside existing quote data — no new hooks needed

This keeps the same lazy-refresh + Supabase-cache pattern used for prices and IV data.

---

## Appendix: Finnhub & Tastytrade notes

**Finnhub:** Has a `/indicator` endpoint that may support `bbands`, but documentation is unclear on free tier availability. The `/stock/candle` endpoint definitely returns daily OHLC on the free tier (60 calls/min). Would require adding `FINNHUB_API_KEY` to Vercel env vars. Viable as a fallback but adds unnecessary dependency when Yahoo works.

**Tastytrade:** Has historical candle data via DXFeed streaming, but datacenter IPs are blocked. Would require the OpenClaw push pipeline, adding significant complexity for data that Yahoo provides directly. Not recommended.
