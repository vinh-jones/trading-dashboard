# Spike Findings: VIX Trend Direction & Put/Call Ratio
*Investigated: 2026-04-16*

---

## Signal 1: VIX Trend Direction — GO (zero cost)

### Data confirmed

Yahoo Finance `range=5d` returns exactly what we need in one call:

```
GET /v8/finance/chart/%5EVIX?interval=1d&range=5d
```

Returns 5 daily close values today:
```
[19.23, 19.12, 18.36, 18.17, 18.19]  (oldest → newest)
```

Current VIX: 18.19. 5-day ago: 19.23. Change: **−1.04 pts → "Easing"** (green).

### Implementation path

The existing `fetchVix()` in `api/macro.js` already calls `fetchYahooChart("^VIX")` — it just uses `range=1d`. Changing to `range=5d` gives the full close array at no extra cost. The `indicators.quote[0].close` array has 5 entries.

Trend logic from the spec works directly:

```js
function computeVixTrend(closes) {
  if (!closes || closes.length < 2) return null;
  const recent   = closes[closes.length - 1];
  const fiveDago = closes[0];
  const change   = recent - fiveDago;

  if (change < -2)             return { direction: 'falling', label: 'Falling', color: 'green', changePts: change };
  if (change < -0.5)           return { direction: 'easing',  label: 'Easing',  color: 'green', changePts: change };
  if (Math.abs(change) <= 0.5) return { direction: 'stable',  label: 'Stable',  color: 'amber', changePts: change };
  if (change < 2)              return { direction: 'rising',  label: 'Rising',  color: 'amber', changePts: change };
  return                              { direction: 'spiking', label: 'Spiking', color: 'red',   changePts: change };
}
```

### Display on VIX card

Add as a secondary direction line below the value:

```
VIX                              ●●●●●
18.19              Slight Fear
▼ Easing (−1.0 pts over 5 days)
Cash target: 20–25%
▾ Why this matters
```

### Verdict: **GO — zero new API calls**

Change `fetchYahooChart("^VIX")` to `fetchYahooChart("^VIX", "5d")`, read the close array, compute trend. Add `vixTrend` to the VIX signal object and surface it on the card as a direction line. Does not affect scoring — purely contextual.

---

## Signal 2: Put/Call Ratio — NO GO (automated free sources dead)

### Sources tested

| Source | Result |
|--------|--------|
| CBOE CSV (`equitypc.csv`) | Empty response — endpoint defunct |
| Yahoo Finance `^PCCE` | "Symbol delisted or not found" |
| Stooq `^pce` | Returns data but requires CAPTCHA + API key |
| CNN Fear & Greed | 418 "I'm a teapot" in spike (bot detection) |

### CNN caveat

The spike hit CNN's bot detection. Our production `fetchFearGreed()` uses proper `User-Agent` + `Referer` headers and does work. The CNN response includes `put_call_options` as one of 7 components — but only as a normalized 0–100 score, not the raw ratio. The raw CBOE equity put/call value is not in that response.

### Verdict: **NO GO for now**

No free automated source delivers the raw CBOE equity put/call ratio without a setup barrier (API key, CAPTCHA). Options if we revisit:

1. **Stooq with key** — one-time CAPTCHA to get a key, then reliable. Low effort but manual step.
2. **Alpha Vantage** — has put/call data but requires free API key signup.
3. **CNN normalized score** — already in the Fear & Greed signal. Not the raw ratio but directionally useful.

Not worth building as a standalone card until a reliable automated source is confirmed.

---

## Build order recommendation

**Build VIX trend direction.** It's a zero-cost, zero-new-API-calls enhancement to an existing signal. Current conditions (VIX "Easing" from ~19 → 18) are exactly the kind of context that changes how you read the absolute level.

**Skip put/call for now.** Revisit when/if a clean automated source surfaces.

---

## Supabase note

`daily_snapshots` has 6 rows with VIX values — enough for trend but sparse. Yahoo Finance is the better source since it always has exactly 5 days regardless of snapshot history.

`macro_snapshots` table exists but is empty — no historical macro data to pull from.
