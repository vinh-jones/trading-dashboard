# Spike Findings: Roll-to-Assignment-Price Opportunity Detection

**Date:** April 13, 2026
**Branch:** `claude/spike-roll-opportunity-detection-QUdtA`
**Spike endpoint:** `GET /api/spike-roll-analysis` (requires `X-Ingest-Secret` header)

---

## TL;DR — Go / No-Go

**GO.** All five spike steps are architecturally unblocked. The only live-data unknowns (weekly expiry availability per ticker, strike rounding outcomes) are answered by running the spike endpoint once with real credentials. No new auth, no new API patterns, no schema changes required to build the full Roll Analysis section.

---

## Step 1 — Current CC mid price

**Finding: already in the quotes cache. No new API call needed.**

The `quotes` table is populated on every 30-minute lazy refresh with mid prices for every option in the `positions` table. The lookup key is the OCC symbol of the active CC:

```js
buildOccSymbol(cc.ticker, cc.expiry_date, true, cc.strike)
// e.g. PLTR $125 CC expiring May 15 → PLTR260515C00125000
```

This is identical to how `OpenPositionsTab.jsx` (line 185–190) already reads CSP G/L from `quoteMap`. Step 1 is a free read — zero additional API calls.

---

## Step 2 — Target expiry dates (~14 DTE and ~28 DTE)

**Finding: no expiry-list endpoint needed. Generate Fridays programmatically.**

There is no `/options/expirations` endpoint currently used or needed. The spike generates all upcoming Fridays (weekly + monthly) within 70 days and picks the ones nearest to each target DTE. Each Friday is flagged `isMonthly: true/false` so the live run will reveal which tickers have weekly expirations.

**From April 13, 2026:**

| Target | Best match (weekly) | Best match (monthly only) |
|--------|--------------------|-----------------------------|
| 14 DTE | Apr 24 (11 DTE) or May 1 (18 DTE) | May 15 (32 DTE) — **too far** |
| 28 DTE | May 8 (25 DTE) or May 15 (32 DTE) | May 15 (32 DTE) — acceptable |

**Key implication:** the 14 DTE window only works for tickers with weekly options. For monthly-only names the nearest available expiry would be ~32 DTE, making the "14 DTE roll" window unavailable. The spike will identify which tickers fall into each category.

**Caching note:** The `option_expiries` table (migration-006) is ready if we want to persist expiry lists. For initial build it's not required — generating Fridays client-side is deterministic and free.

---

## Step 3 — Assignment-strike mid prices

**Finding: architecture already supports it. Outcome rates determined by live run.**

The existing `fetchPublicQuotes()` function in `api/quotes.js` accepts any OCC symbol — it does not need to be a currently-held position. The spike constructs OCC symbols for the assignment-price strike at both target expiries and includes them in the same batch call used for all other quotes.

**OCC symbol construction:**
```
{TICKER}{YYMMDD}{C}{8-digit strike × 1000, zero-padded}

PLTR $180 call, May 15 expiry  → PLTR260515C00180000
HOOD $126 call, Apr 24 expiry  → HOOD260424C00126000
SOFI $26 call, May 8 expiry    → SOFI260508C00026000
```

**Strike rounding:** The spike tests three candidate strikes per ticker and reports which returns `outcome: "SUCCESS"`:

| Ticker | Cost basis | Candidates tested |
|--------|-----------|-------------------|
| PLTR | $180.00 | $180, $180 (all same at $1 rounding) |
| HOOD | $126.00 | $126, $125, $125 |
| SOFI | $26.00 | $26, $25, $25 |
| SHOP | $145.00 | $145, $145, $145 |
| APP | $530.00 | $530, $530, $530 |
| CRDO | $135.00 | $135, $135, $135 |
| IREN | $52.00 | $52, $52.50, $50 |

The best `SUCCESS` candidate (highest mid) is selected as the roll price. All candidate outcomes are included in the response for diagnostics.

**Failure handling:** If `outcome` is not `"SUCCESS"` (e.g. `"FAILED"` or no response), the roll leg is recorded as `mid: null, viable: null`. The roll analysis for that window is suppressed in the UI rather than showing bad data.

---

## Step 4 — Roll opportunity math

```js
function analyzeRollOpportunity({ ticker, costBasisPerShare, currentCCMid, roll14, roll28 }) {
  const assignmentStrike = Math.round(costBasisPerShare); // nearest whole dollar

  // roll_net > 0 = net credit roll (viable)
  // roll_net < 0 = net debit roll (not viable)
  const roll14Net = roll14.mid - currentCCMid;
  const roll28Net = roll28.mid - currentCCMid;

  return {
    roll_14dte: { premium: roll14.mid, net: roll14Net, viable: roll14Net >= 0 },
    roll_28dte: { premium: roll28.mid, net: roll28Net, viable: roll28Net >= 0 },
    any_viable: roll14Net >= 0 || roll28Net >= 0,
  };
}
```

**Example interpretations (hypothetical numbers):**

| Ticker | Current CC mid | Roll 14 DTE mid | Net 14 | Roll 28 DTE mid | Net 28 | Viable? |
|--------|---------------|-----------------|--------|-----------------|--------|---------|
| PLTR | $1.20 | $0.80 | −$0.40 | $1.45 | +$0.25 | ✓ 28 DTE |
| HOOD | $0.45 | $0.60 | +$0.15 | $0.90 | +$0.45 | ✓ both |
| SOFI | $0.30 | null | — | $0.25 | −$0.05 | ✗ |

A positive net means you collect more on the new CC than it costs to close the current one — a net-credit roll up to your assignment price.

---

## Step 5 — Rate limits and call volume

**Finding: single batched HTTP request per refresh cycle. No rate limit risk.**

All 7 positions × 3 instruments (current CC + 14 DTE roll + 28 DTE roll) = **21 OCC symbols** are sent in one `POST` to `/userapigateway/marketdata/{ACCOUNT_ID}/quotes` — the same endpoint and batching pattern already used for all existing quotes. This is 1 HTTP request per refresh, not 21.

At 2-hour refresh × 12 cycles/day = **12 additional batch requests per day** (each batch adds ~21 option symbols to the existing payload).

The spike measures `response_time_ms` and includes it in the response. Expected: < 2 seconds based on existing quotes latency.

---

## Strike rounding — recommended approach

For production implementation, use `Math.round(costBasisPerShare)` as the primary candidate (nearest whole dollar). Most liquid names (PLTR, HOOD, SOFI, SHOP) have $1-increment strikes. If that returns `FAILED`, fall back to nearest $2.50 then $5.

```js
function candidateStrikes(costBasis) {
  const rounded_1   = Math.round(costBasis);
  const rounded_250 = Math.round(costBasis / 2.5) * 2.5;
  const rounded_500 = Math.round(costBasis / 5)   * 5;
  return [...new Set([rounded_1, rounded_250, rounded_500])];
}
```

---

## Positions in scope (qualifying filter)

Active CC strike < cost basis per share AND stock price within 25% of cost basis:

| Ticker | Cost basis / share | CC strike | % below cost |
|--------|--------------------|-----------|-------------|
| HOOD | ~$126 | $78–79 | ~38% — **may fail 25% filter** |
| PLTR | ~$180 (blended) | $125 | ~31% — **may fail 25% filter** |
| SOFI | ~$26 | $18–19 | ~27% — borderline |
| SHOP | ~$145 | $124–132 | ~9–14% — passes |
| APP | ~$530 | $455 | ~14% — passes |
| CRDO | ~$135 | $114 | ~16% — passes |
| IREN | ~$52 | $41–45 | ~13–21% — passes |

Note: HOOD and PLTR are deeply underwater. The 25% UX filter will suppress them from the UI (too far underwater for roll math to be realistic). The spike intentionally tests all of them anyway to get complete data.

---

## Files shipped in this spike

| File | Purpose |
|------|---------|
| `api/spike-roll-analysis.js` | Live investigation endpoint — run once to get real numbers |
| `supabase/migration-006-option-expiries.sql` | Daily expiry-date cache table (optional, ready if needed) |

---

## What the spike endpoint returns

```json
{
  "ok": true,
  "spike_date": "2026-04-13",
  "expiry_calendar": {
    "all_upcoming_fridays": [...],
    "target_14dte": { "expiry": "2026-04-24", "dte": 11, "isMonthly": false },
    "target_28dte": { "expiry": "2026-05-08", "dte": 25, "isMonthly": false }
  },
  "step1_cc_mid_in_cache": {
    "covered": 7,
    "total": 7,
    "pct": 100,
    "detail": [...]
  },
  "instruments_requested": 21,
  "response_time_ms": 843,
  "success_rates": {
    "current_cc":    "7/7",
    "roll_14dte":    "5/7",
    "roll_28dte":    "6/7",
    "data_complete": "5/7"
  },
  "roll_findings": [
    {
      "ticker": "PLTR",
      "cost_basis_per_share": 180.0,
      "current_cc_mid": 1.20,
      "roll_14dte_best": { "symbol": "PLTR260424C00180000", "strike": 180, "dte": 11, "mid": 0.80, "outcome": "SUCCESS" },
      "roll_28dte_best": { "symbol": "PLTR260508C00180000", "strike": 180, "dte": 25, "mid": 1.45, "outcome": "SUCCESS" },
      "roll_analysis": {
        "assignment_strike": 180,
        "current_cc_mid": 1.20,
        "roll_14dte": { "premium": 0.80, "net": -0.40, "viable": false },
        "roll_28dte": { "premium": 1.45, "net": 0.25,  "viable": true },
        "any_viable": true
      },
      "data_sufficient": true
    }
  ],
  "go_nogo": "GO",
  "go_nogo_rationale": "5/7 positions have sufficient data for roll analysis."
}
```
*(Numbers above are illustrative — run the endpoint for real values.)*

---

## Success criteria status

| Criterion | Status |
|-----------|--------|
| Current CC mid confirmed available | ✅ Confirmed from code — already in `quotes` cache |
| Available expiry dates retrievable | ✅ Generated programmatically, no endpoint needed |
| Nearest expiry to 14 DTE and 28 DTE identifiable | ✅ Implemented in spike |
| Mid price retrievable for assignment-price strike | ⏳ Confirmed possible architecturally — live run needed for outcome rates |
| Roll math produces interpretable results | ✅ Implemented and verified with example numbers |
| Call volume within rate limits | ✅ 1 batched HTTP request per refresh cycle |
| Graceful null/error handling documented | ✅ `mid: null, viable: null` when outcome ≠ SUCCESS |

---

## If go: next feature spec

The full Roll Analysis section needs:

1. **`api/quotes.js`** — extend `buildInstruments()` to add assignment-strike OCC symbols for qualifying below-cost CC positions (the 25% filter applied here). Adds ~14 option symbols to the existing batch per refresh.

2. **`src/components/OpenPositionsTab.jsx`** — add Roll Analysis subsection inside each assigned-shares card, below the Active CC block. Show only when `any_viable: true` (green alert) or `any_viable: false` with data present (muted "no roll available"). Hide entirely when data is insufficient.

3. **`src/lib/focusEngine.js`** — add `ruleRollOpportunity` rule: P2 alert when `any_viable: true` for a below-cost CC position.

4. **`src/hooks/useQuotes.js`** — no changes needed; roll mids flow through the existing `quoteMap`.

No new auth, no new endpoints, no schema migrations required beyond what's already in this branch.
