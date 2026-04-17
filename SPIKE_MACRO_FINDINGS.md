# Spike Findings: Macro Signal Data Availability

**Date:** 2026-04-15 (Tuesday — data reflects live market)

---

## Recommendation: GO — All 4 signals have viable free sources

| Signal | Verdict | Source | Auth Required | Refresh |
|--------|---------|--------|:---:|---------|
| SPY vs ATH | **GO** | Yahoo Finance (existing) | No | Every 30 min |
| CNN Fear & Greed | **GO** | CNN dataviz endpoint | No | Once daily |
| S5FI (breadth) | **GO** | Finviz screener | No | Once daily |
| CME FedWatch | **GO** | rateprobability.com | No | Twice daily |
| Unusual flow | **DEFERRED** | Unusual Whales (paid) | Yes ($50+/mo) | — |

All 4 active signals can be fetched from a single bundled `/api/macro.js` endpoint. No API keys needed for any of them.

---

## Signal 1: S5FI — % of S&P 500 Above 50-Day MA

### Verdict: GO

### Source: Finviz screener (HTML scrape, 2 requests)

**How it works:**
```
GET https://finviz.com/screener.ashx?v=111&f=idx_sp500&ft=4          → total S&P 500 count
GET https://finviz.com/screener.ashx?v=111&f=idx_sp500,ta_sma50_pa&ft=4  → count above SMA50
```

Parse the total from HTML: `/#1\s*\/\s*(\d+)/` extracts count from `#1 / 256` pagination text. Zero-results case returns `"No results"` in the HTML body.

**Compute:** `countAbove / totalCount * 100` = S5FI equivalent

**Current value:** ~52% (256 / 503) — aligns with StockCharts $S5FI within methodology variance.

**Performance:** 0.54 seconds total for both requests. No API key, no auth.

### Sources rejected

| Source | Reason |
|--------|--------|
| Yahoo Finance `^S5FI` ticker | Does not exist ("symbol may be delisted") |
| Finnhub | No aggregate breadth endpoint (per-symbol technicals only) |
| Alpha Vantage | No aggregate breadth endpoint |
| Barchart OnDemand | Paid API only |
| Financial Modeling Prep | No breadth data |
| TradingView / Investing.com | No public API |
| Compute from 500 Yahoo calls | ~50 seconds, dangerously close to 60s Vercel timeout |

### Fallback

Yahoo Finance `/v7/finance/quote?symbols=AAPL,MSFT,...` returns `fiftyDayAverageChangePercent` per ticker. Batch of 50 tickers per request works but requires cookie+crumb auth and ~11 requests with delays (~17s total). Use only if Finviz breaks.

### Risks

- HTML scraping — page structure could change (but `#1 / N` pattern has been stable for years)
- Finviz ToS should be reviewed for automated access
- 2 requests per load is minimal, unlikely to trigger rate limits

### Recommended cadence: Once daily at market close

---

## Signal 2: CME FedWatch — Rate Cut Probabilities

### Verdict: GO

### Source: rateprobability.com `/api/latest`

**Endpoint:**
```
GET https://rateprobability.com/api/latest
```

No auth, no API key. Returns JSON with per-meeting rate probability data.

**Response shape:**
```json
{
  "today": {
    "as_of": "2026-04-15",
    "current band": "3.50 - 3.75",
    "midpoint": 3.625,
    "rows": [
      {
        "meeting_iso": "2026-04-29",
        "implied_rate_post_meeting": 3.625,
        "num_moves": 0,
        "num_moves_is_cut": false,
        "change_bps": 0
      },
      {
        "meeting_iso": "2027-03-17",
        "num_moves": 0.48,
        "num_moves_is_cut": true,
        "change_bps": -12
      }
    ]
  },
  "ago_1w": { ... },
  "ago_3w": { ... },
  "ago_6w": { ... },
  "ago_10w": { ... }
}
```

**Extracting "number of cuts priced in":**
```js
const data = await res.json();
const cutoff = new Date();
cutoff.setFullYear(cutoff.getFullYear() + 1);
const rows = data.today.rows.filter(r => new Date(r.meeting_iso) <= cutoff);
const last = rows[rows.length - 1];
const cutsPricedIn = last.num_moves_is_cut ? last.num_moves : 0;
// Today: 0.48 cuts priced in over next 12 months
```

**Current value:** 0.48 cuts priced in (roughly half a 25bp cut expected in next 12 months).

**Bonus data:** Includes `ago_1w`, `ago_3w`, `ago_6w`, `ago_10w` snapshots for historical comparison — useful for showing trend ("more/fewer cuts priced in vs last week").

### Sources rejected

| Source | Reason |
|--------|--------|
| CME official FedWatch API | Paid, requires OAuth2 + commercial agreement |
| CME website XHR | Heavy JS SPA, endpoints would break frequently |
| FRED API | Has historical rates but NOT futures-derived probabilities |
| Atlanta Fed Probability Tracker | 403, blocks automated access |
| Finnhub / Alpha Vantage | No rate probability data |
| npm packages | None exist for FedWatch data |

### Risks

- Indie project with no SLA — could go offline
- Cloudflare-fronted with 15min browser / 4hr CDN cache
- Fallback: display FRED effective rate trend (`DFEDTARU` series, free API key) with "probability data unavailable" note

### Recommended cadence: Twice daily (9 AM + 4 PM ET)

---

## Signal 3: CNN Fear & Greed Index

### Verdict: GO

### Source: CNN dataviz endpoint

**Endpoint:**
```
GET https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{YYYY-MM-DD}
```

**Required headers** (returns HTTP 418 "I'm a teapot" without these):
```js
{
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
  "Referer": "https://www.cnn.com/markets/fear-and-greed"
}
```

**Response shape — composite + 7 components:**

| Key | Description | Current Score |
|-----|-------------|:---:|
| `fear_and_greed` | **Composite index** | **56.5 — Greed** |
| `market_momentum_sp500` | S&P 500 momentum | 81.6 (Extreme Greed) |
| `stock_price_strength` | New highs vs new lows | 24.8 (Extreme Fear) |
| `stock_price_breadth` | McClellan Volume Summation | 47.2 (Neutral) |
| `put_call_options` | Put/Call ratio | 46.8 (Neutral) |
| `market_volatility_vix` | VIX vs 50-day avg | 50.0 (Neutral) |
| `junk_bond_demand` | Junk bond spread | 45.8 (Neutral) |
| `safe_haven_demand` | Stock vs bond returns | 99.2 (Extreme Greed) |

Each component includes `score` (0-100), `rating` (string label), `timestamp`, and a `data` array.

The composite also includes: `previous_close` (47.0), `previous_1_week` (34.4), `previous_1_month` (21.4), `previous_1_year` (13.1) — useful for trend display.

### Server-side proxy required

Two reasons:
1. Requires `Referer: https://www.cnn.com/...` header — browsers can't set arbitrary Referer from client JS
2. No `Access-Control-Allow-Origin` header (CORS blocked)

### npm wrappers

None maintained. `fear-greed-index` on npm is crypto-only (alternative.me). Python `fear-and-greed` on PyPI is stale (2022). Direct fetch is simpler and more reliable.

### Risks

- Undocumented/unofficial endpoint — CNN can change or tighten at any time
- Has broken before and been restored with different URL patterns
- Paid fallback: RapidAPI has a CNN Fear & Greed wrapper if the direct endpoint dies

### Recommended cadence: Once daily

---

## Signal 4: SPY vs All-Time High

### Verdict: GO

### Source: Yahoo Finance (already integrated)

**Endpoint (same as existing VIX pattern):**
```
GET https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d
```

**Relevant fields in `meta` object:**

| Field | Current Value |
|-------|:---:|
| `regularMarketPrice` | 699.94 |
| `fiftyTwoWeekHigh` | 700.28 |
| `fiftyTwoWeekLow` | 508.46 |
| `chartPreviousClose` | 694.46 |

**Calculation:**
```js
const pctFromHigh = (meta.regularMarketPrice - meta.fiftyTwoWeekHigh) / meta.fiftyTwoWeekHigh;
// (699.94 - 700.28) / 700.28 = -0.0005 = -0.05% (essentially at ATH)
```

### 52-week high vs true ATH

- No `allTimeHigh` field exists in the Yahoo response
- True ATH is derivable via `range=max&interval=1mo` (504 monthly data points back to 1993) — but that's a heavy call
- **For SPY, 52-week high ≈ ATH** in all but multi-year bear markets (2008-2012 type)
- **Recommendation:** Use `fiftyTwoWeekHigh` as proxy. It's free in the existing 1d response, no extra API call needed. For the rare case where true ATH is >52 weeks old, it would show a more bearish reading, which is directionally correct anyway.

### No extra API call needed

The existing `/api/vix.js` already fetches Yahoo Finance data. SPY price data could be added to the same call or to the `/api/snapshot.js` cron (which already fetches SPY for daily snapshots).

### Recommended cadence: Every 30 min during market hours

---

## Signal 5: Unusual Options Flow

### Verdict: DEFERRED

**Why:**
- Unusual Whales API requires paid subscription ($50-100/month)
- Options flow data is high-volume and complex to normalize
- The signal is qualitative/pattern-recognition — hard to express as a clean rule
- It's a confirmation signal, not a leading one — by the time unusual flow appears, the move has started

**If budget opens up:** Unusual Whales has a well-documented REST API. The relevant endpoint would filter for leveraged ETF (TQQQ, SOXL) call sweeps with large notional values. But the interpretation requires context that's hard to automate.

---

## Composite Posture Logic — Tested with Current Values

### Scoring function (from spike doc)

Each signal maps to a 1-5 score. Average determines posture label.

### Current values (2026-04-15)

| Signal | Value | Score | Reasoning |
|--------|-------|:---:|-----------|
| VIX | 18.17 | 4 | < 20 → constructive |
| S5FI | ~52% | 4 | > 50 → broad participation |
| Fear & Greed | 56.5 | 4 | > 55 → greed territory |
| Rate Cuts | 0.48 | 2 | < 1 → barely any cuts priced in |
| SPY vs ATH | -0.05% | 3 | Within 1% → at resistance |

**Average: (4 + 4 + 4 + 2 + 3) / 5 = 3.4 → CONSTRUCTIVE**

This matches the expected posture from the spike doc. The rate cuts signal is the drag — only ~half a cut priced in for the next year, reflecting the current "higher for longer" environment.

### Posture thresholds

| Average | Label |
|:---:|-------|
| ≥ 4.0 | BULLISH |
| ≥ 3.2 | CONSTRUCTIVE |
| ≥ 2.5 | NEUTRAL |
| ≥ 1.8 | DEFENSIVE |
| < 1.8 | BEARISH |

---

## Architecture Notes

### Serverless function approach

**Vercel Pro plan — no function limit.** Recommended: single `/api/macro.js` endpoint that fetches all 4 signals and returns a combined response. This keeps the macro data atomic (one call, one cache entry).

### Suggested implementation

```js
// api/macro.js — single endpoint, all signals
export default async function handler(req, res) {
  const [spy, fearGreed, s5fi, fedWatch] = await Promise.all([
    fetchSpyVsAth(),      // Yahoo Finance (existing pattern)
    fetchFearGreed(),     // CNN dataviz
    fetchS5fi(),          // Finviz screener (2 requests)
    fetchFedWatch(),      // rateprobability.com
  ]);

  const posture = computeMacroPosture({ vix, s5fi, fearGreed, fedWatch, spyVsAth });

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=300");
  res.json({ ok: true, spy, fearGreed, s5fi, fedWatch, posture });
}
```

### Caching strategy

| Signal | Cache TTL | Rationale |
|--------|-----------|-----------|
| SPY vs ATH | 30 min | Price-based, benefits from freshness |
| Fear & Greed | 24 hours | CNN updates once daily |
| S5FI | 24 hours | Breadth only meaningful at EOD |
| FedWatch | 12 hours | Rate markets move during day |
| Combined endpoint | 30 min | Driven by shortest TTL |

### Data flow

```
Client (React)
  ↓
useMacro() hook → GET /api/macro
  ↓
api/macro.js → Promise.all([Yahoo, CNN, Finviz, rateprobability.com])
  ↓
Returns: { spy, fearGreed, s5fi, fedWatch, posture }
```

Alternatively, macro signals could be computed in the existing `/api/snapshot.js` cron (4:30 PM ET daily) and stored in a `macro_signals` Supabase table, with the client reading cached values. This avoids runtime fetches but loses intraday freshness for SPY vs ATH.

---

## Refresh Cadence Summary

| Signal | Recommended | Method |
|--------|-------------|--------|
| VIX | Already live (5 min) | Existing `/api/vix.js` |
| S5FI | Once daily (market close) | `/api/macro.js` or cron |
| Fear & Greed | Once daily | `/api/macro.js` or cron |
| FedWatch | Twice daily (9 AM + 4 PM ET) | `/api/macro.js` or cron |
| SPY vs ATH | Every 30 min (market hours) | `/api/macro.js` |

---

## Success Criteria Checklist

- [x] S5FI: confirmed source (Finviz), sample data (~52%), GO
- [x] CME FedWatch: confirmed source (rateprobability.com), sample data (0.48 cuts), GO
- [x] Fear & Greed: CNN endpoint tested, current score 56.5, GO
- [x] SPY vs ATH: Yahoo Finance returns `fiftyTwoWeekHigh` (700.28), GO
- [x] Composite posture logic tested: average 3.4 → CONSTRUCTIVE (matches expected)
- [x] Unusual options flow: documented as DEFERRED (paid API required)
