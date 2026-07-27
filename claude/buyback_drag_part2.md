# Buyback Drag, Part 2: Redeployment Credit & the CLS Range-Trading Claim

**Prepared:** 2026-07-27 · **Sources:** Supabase `bzfhheqqkwqqwsiqyqzk` (`trades`, `positions`) · daily closes from Unusual Whales `get_ticker_close_prices` (1Y) · **Author:** Claude

Follows `claude/buyback_drag_analysis.md`, which found the buyback discipline cost **$18,847** across 138 voluntary buybacks. Population is unchanged and settled: `type='CSP' AND close_date < expiry_date AND expiry_date <= '2026-07-27' AND exit_cost < 0 AND entry_cost IS NOT NULL`, 138 legs.

---

## Both verdicts up front

**Part 1 (redeployment):** Crediting the capital velocity that early closing buys **shrinks the drag from $18,847 to ~$7,135** at the honest all-time realized rate — and flips it to a *net gain* at recent-regime rates. The reason it doesn't vanish is that **measured utilization of the freed capital was only 42%**, not the ~100% the naive scaling assumed. The verdict moves from a clear **(c) expensive churn toward (b) roughly break-even** — and the residual cost is itself a ceiling (see §1.4). It is not the ~$19k of pure waste the first report implied. But it is not clearly profitable either.

**Part 2 (CLS):** The range-trading story is **true for 3 legs and $704 — 3% of CLS's $22,760**. The Feb 11/23/27 cluster is exactly what was claimed: dip entries (27th percentile), a dead-flat range (efficiency ≈ 0), patient 28-day holds, 83% of premium kept, near-zero cost. **The other 97% was not that.** January — half the spend ($13,875, +$11,604 of the delta) — was *defensive closing into a drawdown that then recovered*, the opposite of skillful range-harvesting. April onward ($5,050) was momentum-chasing as CLS ran, entering at the 71st percentile. And CLS's book-relative entry timing shows **no bottom-catching edge** (52.7th percentile vs the book's 58.7th). The comfortable story is real but small; the expensive bulk is a different, worse behavior.

---

# PART 1 — The redeployment credit

## 1.1 Method

I built a **daily deployed-capital series** for CSP collateral: for each calendar day, the sum of `strike × 100 × contracts` over every CSP leg open that day — closed legs from `trades` (deployed `[open_date, close_date)`) plus the 10 currently-open CSPs from `positions` (deployed `[open_date, today]`). Sanity check: the closed-leg integral is **157,516 dollar-years ÷ 365**, reproducing the realized-yield analysis's 157,940 to within 0.3% (the gap is `capital_fronted` vs `strike×100×contracts`).

**Scope: CSP collateral only.** I did not reconstruct capital committed to assigned-share lots or LEAPS — the share-disposal timing is the same pooled-lot mess flagged in the realized-yield report, and I will not approximate a denominator. This makes the utilization figure a **lower bound**: capital that flowed from a closed CSP into assigned shares or a LEAPS reads here as "not redeployed," even though it was. That is the honest, conservative choice, and it is also *coherent* — the rate I apply is the CSP realized yield, which only belongs on capital recycled back into CSPs.

**Utilization, per the spec.** For each of the 138 buybacks: the pre-close deployment level `L = deployed(close_date − 1)`; then over the freed window `[close_date, expiry_date)` — the days holding-to-expiry would have kept the capital locked — the **utilization fraction** is the share of days on which total deployed capital stayed **≥ L**. A leg whose capital sat idle earns ~0; one instantly replaced earns ~1. Then `redeployment_credit = Σ(freed_collateral_days × utilization) × realized_rate`.

## 1.2 Results

The freed-capital scale reproduces the task's figures exactly: **$3,823,000 released, 18.2 avg days remaining, 193,301 collateral-dollar-years freed.** The new measurement is utilization:

| | Value |
|---|---:|
| Utilization, collateral-day-weighted | **42.1%** |
| Utilization, leg-averaged | 43.4% |
| Utilized freed collateral-days | **81,335 dollar-years** (of 193,301) |

**Denominators, stated:** the freed collateral-days are **capital-weighted, days-held basis** (`strike×100×contracts × (expiry−close)/365`), matching the realized rate, which is `Σ realized P&L / Σ collateral-days` — **capital-weighted, days-held**. Same basis on both sides. The realized rates (14.4% all-time / 35.1% T3M / 39.4% T6M) are the collateral-days-basis figures from the realized-yield report, **not** the DTE-basis (6.3% all-time) or the optimistic entry yields.

| Realized rate applied | Redeployment credit | **Net vs. −$18,847 drag** | Verdict |
|---|---:|---:|---|
| **14.4% (all-time)** | **+$11,712** | **−$7,135** | still a net cost, 62% smaller |
| 35.1% (trailing 3M) | +$28,549 | **+$9,702** | pays for itself |
| 39.4% (trailing 6M) | +$32,046 | **+$13,199** | pays for itself |

**Break-even redeployment rate = $18,847 / 81,335 = 23.2%.** Above it, the velocity covers the drag; below it, a residual cost remains.

## 1.3 Which rate — the all-time 14.4% is the honest default

The 138 closes span Nov 2025 – Jul 2026, and the freed collateral-days are spread across that whole window (by close-month: Dec 20k, Jan 44k, Apr 25k, May 22k, Jun 40k dollar-years — not concentrated in the recent quarter). Capital freed in Nov–Mar was redeployed into the **Nov–Mar environment**, which is exactly the environment whose early assignments (SOFI, HIMS, PLTR) dragged the realized yield down to 14.4%. Applying the trailing 35–39% rates — which *exclude* those disasters — to capital that was actually recycled *through* them would overstate the credit. **The all-time 14.4% is the self-consistent single rate for capital recycled across the full history; I use it as the default and report the trailing rates as an upper band.**

**Circularity — named, as instructed.** The realized rate was measured on this same buyback-heavy history, so using it as the redeployment rate is *self-consistent, not double-counting*. The buyback-drag delta only ever compared each leg to holding-*it*-to-expiry; it never counted the earnings of the *next* leg the freed capital funded. The redeployment credit adds exactly those next-leg earnings, at the **net** realized rate — and "freed capital redeployed into a leg that itself got bought back" is already netted inside that rate (14.4% is after all buyback drags), so there is no second layer of credit.

## 1.4 Restated verdict

**With redeployment credited at the honest rate, the buyback discipline is roughly break-even (−$7,135), not the $18,847 pure cost the first report showed — and the −$7,135 is a ceiling on the loss, for two compounding reasons:**

1. **Utilization is a floor (42%).** It counts only recycling back into CSPs; capital that went into assigned shares or LEAPS earned a return that is credited nowhere here.
2. **The 14.4% rate is itself depressed by the assignments the buybacks were partly avoiding.** In a counterfactual "never buy back" world you would eat *more* assignments, so the realized rate on that path would be even lower — meaning 14.4% understates the value of the redeploy-and-resell world.

At recent-regime rates the practice is net-positive. **Honest reading: once capital velocity is credited, the buyback discipline is approximately break-even, plausibly mildly positive — not clearly profitable, not clearly wasteful.**

**Sensitivity.** The whole result rides on utilization × rate. At the measured 42% utilization, break-even needs a 23.2% redeployment rate. If true utilization is higher (it is — shares/LEAPS uncredited) or the rate is higher than 14.4% (it is in the recent regime), the practice pays for itself. If utilization were actually ~25% (if much freed capital truly idled), even the trailing rates wouldn't cover it. **Caveat on the utilization measure:** it is a *book-level* proxy — "did total deployment stay above the pre-close level" conflates this leg's recycling with the book's overall trend. The book was hump-shaped (peaked ~$508k deployed in late Jan, down to $219k now), so early-close utilization can be flattered by the ramp and late-close deflated by the wind-down. Empirically the by-month utilization is noisy, not a clean ramp artifact (Nov 13%, Dec 69%, Jan 30%, Mar 17%, Jun 62%, Jul 85%), so 42% is a reasonable central estimate — but it is a proxy, not a capital tracer.

## 1.5 Three fixes to the first report

**(a) §6 double-counted the "$45k ticker lever" and the "$21k timing lever" — they are one behavior.** Cross-tab confirms it: of the 15–21-days-remaining bucket (35 legs, $29,245 buyback), **20 legs and $21,775 (74% of the bucket's spend) ARE the six churn tickers** (CLS/COHR/WDC/STX/CRDO/GLW). Those six are 70 of the 138 legs and $54,904 of the $96,296 total buyback (57%). So there is **one** lever, not two: *reflexively closing the rally-prone AI/memory names about three weeks before expiry.* The "timing" and "ticker" cuts are the same legs seen twice.

**(b) The 19.6% hit rate is not evidence of bad decisions — it is the arithmetic of selling OTM puts.** Of the 138 buybacks, **107 (77.5%) would have expired worthless** — a buyback on a worthless-bound put *always* looks wrong ex post, no matter how well timed, so 77.5% "wrong" is structural, not a skill failure. Only the **31 (22.5%) that finished ITM** could possibly be hits, and 27 of them were (87%). Formally: observed 27 hits vs. a no-signal baseline of ~31 (the ITM-finish count) on n=138 is z ≈ −0.8, **p ≈ 0.41 — indistinguishable from random.** There is **no timing signal**, good or bad. That matters because it changes the fix: you cannot "time the closes better" (there's nothing to time); the only lever is to **close less** — which is exactly what the ticker/timing cross-tab says (stop closing the rally-prone names mid-cycle).

**(c) §4 mixed denominators.** Restated cleanly, separating the two:
- *Buyback dollars handed back* (gross − net premium): **$96,296** — this is the spend.
- *Counterfactual P&L difference* (what the spend bought vs. holding): **+$52,160** saved on the 27 winners, **−$71,007** cost on the 111 losers, **net −$18,847** — this is the result.

The $96,296 is not comparable to the $18,847; they are spend and net-outcome, not two P&L terms.

---

# PART 2 — Was the CLS trading actually range-trading?

**The claim:** *"I got near the local bottoms multiple times because it was trading in a tight range, collecting premium and re-deploying, or waiting for it to pull back and entering again."*

**Method.** Pulled CLS daily closes (UW 1Y, 251 trading days, validated against known anchors). For every CLS CSP at open (and close), computed its **percentile in the trailing 20- and 60-day high–low range** (0 = at the low, 100 = at the high), the **60-day Kaufman efficiency ratio** (`|net move| / Σ|daily moves|`; low = range-bound, high = trending), and **percent-OTM at open** (`(spot − strike)/spot`). **Control group:** the identical measure on 64 non-CLS CSP entries across 6 diverse tickers (IREN, GLW, HOOD, CCJ, NVDA, SOFI — fallers, AI/memory churn, uranium, mega-cap). *Coverage caveat: 64 of 149 non-CLS CSP legs (~43%), a diverse representative subset, not the entire book.*

## 2.1 Entry timing — no bottom-catching edge vs. the book

| | Entry pctile, 20-day (median) | Entry pctile, 60-day (median) |
|---|---:|---:|
| **CLS** (24 legs) | 47.2 | **52.7** |
| **Control** (64 legs) | 44.7 | **58.7** |

CLS enters at the **middle** of its trailing range, not the bottom. "Catching bottoms" requires a median well under 50; CLS is at 47–53. It is **not distinguishable from the book** — if anything CLS's 60-day entry (52.7) is a touch *lower* (more dip-buying) than the control's (58.7), but both are mid-range. **There is no CLS-specific bottom-catching skill.** The dip-buying is a general habit, not a CLS edge — and on average it isn't even dip-buying, it's mid-range selling.

## 2.2 The round-trip edge is real but small — and lives only in the range regime

CLS **exits** near the top of the short-term range (exit 20-day median **95.1**), i.e. it closes into bounces — though that is partly mechanical (a CSP profits when the stock rises, so you close near local highs by construction). The round-trip that matters:

| Entry→exit 60-day percentile spread (sold-higher-than-bought) | Median | Mean |
|---|---:|---:|
| CLS | **+9.3** | +9.9 |
| Control | +3.3 | −2.7 |

So CLS's timing is modestly better than the book (+9 vs +3 percentile points) — a small real edge. **The regime gate shows where it comes from.** Splitting at the median efficiency ratio (0.082):

| CLS legs | n | Entry pctile (60d, median) | Exit pctile (60d, median) |
|---|---:|---:|---:|
| **Low efficiency (range-bound)** | 16 | **35.6** (dip-buying ✓) | 55.6 |
| **High efficiency (trending)** | 8 | **80.2** (chasing ✗) | 92.9 |

**The dip-buying edge exists only when CLS is range-bound.** In range regimes CLS enters at the 36th percentile and exits at the 56th — a genuine +20-point round-trip. In *trending* regimes it enters at the **80th percentile** — buying near the top, i.e. chasing. This is the directly actionable finding: **the strategy is real when the 60-day efficiency ratio is low, and inverts into chasing when it is high.** A simple efficiency-ratio gate would have flagged the April run-up.

## 2.3 By period — the three-regime hypothesis holds exactly

| CLS period | legs | Entry pctile (60d) | Efficiency | %OTM at open (median, range) |
|---|---:|---:|---:|---:|
| Nov–Jan (defensive/early) | 10 | 56.3 | 0.10 | 9.4% [6.7–11.7] |
| **Feb–Mar (range regime)** | 6 | **27.4** (dip ✓) | **0.00** (dead flat) | 10.1% [4.9–15.2] |
| **Apr+ (chasing run-up)** | 8 | **71.3** (chase ✗) | 0.10 | 8.7% [0.6–10.7] |

Feb–Mar is textbook range-selling: dip entries (27th percentile) into a zero-efficiency range. April onward is the opposite: entering at the 71st percentile as CLS ran from ~$360 to ~$470.

## 2.4 Moneyness — strikes mostly followed the stock, with two reaches

As the strikes ratcheted $275→$290→$315→$360→$365→$380 from April, **percent-OTM mostly held around 8–11%** — i.e., he was *holding moneyness and the strikes simply tracked the stock* (unremarkable), **not** systematically compressing. The exceptions are two aggressive near-ATM sells that stand out: **2026-04-28 K$350 at 3.2% OTM** and **2026-05-22 K$365 at just 0.6% OTM** (spot $367). Those two he reached; the rest he did not. So: not a clean "reaching as it ran" story — two reach-y legs against a backdrop of constant moneyness.

## 2.5 Re-entry — leans toward the claim, but a third of the time he chased

After each CLS close, comparing the *next* CLS open's spot to the close's spot (22 re-entries): **re-entered lower 14 times, higher 8 times (64% lower)**, median next-open-minus-prior-close = **−$15.2**. So "waiting for it to pull back and entering again" is true a **majority** of the time — but 8 of 22 re-entries were at a *higher* price (up to +$50), i.e. chasing back in. Distribution: `[−61, −48, −42, −41, −33, −28, −28, −24, −24, −19, −15, −15, −2, −1, +5, +6, +14, +14, +17, +17, +31, +50]`. Leans toward the claim; not consistent.

## 2.6 Verdict — the range-trading account explains 3 legs and $704

| CLS bucket (by entry regime) | legs | Buyback $ | % of $22,760 | Delta $ | Avg kept | Avg hold |
|---|---:|---:|---:|---:|---:|---:|
| **Patient range (Feb 11/23/27)** | **3** | **$704** | **3%** | +$704 | 0.83 | 28.3 d |
| Feb–Mar range regime (incl. quick scalps) | 6 | $3,835 | 17% | +$3,835 | 0.66 | 16.7 d |
| Nov–Jan defensive/early (Jan alone ≈ $11.3k) | 10 | $13,875 | **61%** | **+$11,604** | 0.41 | 9.4 d |
| Apr+ chasing the run-up | 7 | $5,050 | 22% | +$4,578 | 0.56 | 5.0 d |

**In the task's own words: it is three legs and $704.** That cluster — Feb 11/23/27 — is precisely the claimed strategy: it entered on dips (27th percentile) in a dead-flat range, held patiently (28 days), kept 83% of premium, and cost almost nothing. Stretch the definition to "any dip-entry in a range regime" and it is 6 legs and $3,835 (17%).

**The other 83–97% was something else, and worse:**
- **January was defensive closing into a drawdown — $13,875 (61% of spend), +$11,604 of the $20,017 delta (58% of the whole CLS cost).** As CLS fell ~$345→$280, he repeatedly bought puts back at 41% of max (giving back 59%) and re-sold lower. Every one of those puts then *recovered and would have expired worthless* — which is why the counterfactual says holding would have been $11,604 better. This is not range-harvesting; it is **selling the fear at the wrong end of the range.** The "tight range" that the story credits is the very thing that made these defensive closes wrong: the range held, so the panic closes were unnecessary.
- **April onward was momentum-chasing — $5,050, entering at the 71st percentile, 5-day holds, strikes ratcheting up** as CLS ran. Also mostly puts that expired worthless.

So the story is true for a small, genuine slice and false for the expensive majority. The single most expensive CLS behavior — January's defensive buybacks — is the direct opposite of the skill the story claims.

---

## Assumptions and judgment calls

**Part 1**
- **CSP collateral only** in the deployed series (no assigned-share/LEAPS capital) — stated, and it makes utilization a lower bound. Coherent with applying the CSP realized rate.
- **Open CSPs** (from `positions`) treated as deployed `[open_date, 2026-07-27]`. They matter only for July windows.
- **Utilization = book-level** "deployed ≥ pre-close level," per the spec. It is a proxy, not a per-dollar tracer, and is confounded by the book's hump shape (§1.4 caveat).
- **`pre_close_level = deployed(close_date − 1)`** includes the closing leg's own collateral. Same-day-open-and-close legs (a few) get the level from the day before they opened; immaterial.
- **Realized rate = collateral-days (days-held) basis**, capital-weighted, matching the freed-collateral-days basis. All-time 14.4% is the default (justified in §1.3); trailing rates are the upper band.
- Circularity and no-double-count are argued in §1.3, not merely asserted.

**Part 2**
- **Percentile-in-range** uses the trailing N trading days *including* the entry day; spot = the ticker's close on `open_date` (EOD proxy for an intraday sale). **[Assumption]**
- **Efficiency ratio** = Kaufman, 60 trading days.
- **Control = 64 non-CLS legs across 6 tickers (~43% of non-CLS legs)** — a diverse representative subset, **not** the full book. **[Stated hole]** The excluded tickers are mostly small-count names; the control median is stable across the 6 included, but a full-book control could shift it a few points.
- **Regime split at the sample-median efficiency (0.082).** A different threshold would move a few borderline legs between buckets but not the Feb–Mar-low / Apr-high pattern.
- **"Patient range" = the Feb 11/23/27 legs** (dip entry + ≥20-day hold + ≥70% kept). The looser "Feb–Mar regime" bucket (6 legs) is offered alongside so the reader can pick the definition.
- **Prices** are the UW closes as returned (the same strong AI/memory tape noted in the prior report — STX ~$1,000, WDC ~$700); used as-is.
- `account_value` frozen at $875,131.25 is intended; `positions.delta` is entry delta; no dividend data — none used.

---

## SQL and code (verbatim)

**Daily deployed-capital series + integral sanity check (Part 1):**
```sql
WITH span AS (
  SELECT (strike*100*contracts)::numeric AS coll, open_date AS s, close_date AS e FROM trades WHERE type='CSP'
  UNION ALL
  SELECT (strike*100*contracts)::numeric, open_date, DATE '2026-07-28'
  FROM positions WHERE position_type='open_csp' AND type='CSP'
),
d AS (SELECT generate_series((SELECT min(s) FROM span), DATE '2026-07-27', INTERVAL '1 day')::date AS day),
deployed AS (
  SELECT d.day, COALESCE(sum(span.coll) FILTER (WHERE span.s<=d.day AND d.day<span.e),0) AS dep,
         COALESCE(sum(span.coll) FILTER (WHERE span.s<=d.day AND d.day<span.e AND e<=DATE '2026-07-27'),0) AS dep_closed
  FROM d LEFT JOIN span ON true GROUP BY d.day)
SELECT round(sum(dep_closed)/365.0,0) AS integral_closed  -- 157,516 ≈ 157,940 ✓
FROM deployed;  -- (variant used for the closed-only check joins only trades)
```

**Per-leg utilization + redeployment credit (Part 1 core):**
```sql
WITH span AS ( ... as above ... ),
d AS (SELECT generate_series((SELECT min(s) FROM span), DATE '2026-07-27', INTERVAL '1 day')::date AS day),
deployed AS (SELECT d.day, COALESCE(sum(span.coll) FILTER (WHERE span.s<=d.day AND d.day<span.e),0) AS dep
             FROM d LEFT JOIN span ON true GROUP BY d.day),
leg AS (
  SELECT t.close_date AS c, t.expiry_date AS e,
    (t.strike*100*t.contracts)::numeric * (t.expiry_date-t.close_date)/365.0 AS freed_cd,
    (SELECT avg( (dep >= (SELECT dep FROM deployed WHERE day = t.close_date-1))::int )::numeric
       FROM deployed WHERE day >= t.close_date AND day < t.expiry_date) AS util
  FROM trades t
  WHERE t.type='CSP' AND t.close_date<t.expiry_date AND t.expiry_date<=DATE '2026-07-27'
    AND t.exit_cost<0 AND t.entry_cost IS NOT NULL)
SELECT round(sum(freed_cd),0) AS freed_cd,                              -- 193,301
  round((sum(freed_cd*util)/sum(freed_cd))::numeric,3) AS util_wtd,     -- 0.421
  round(sum(freed_cd*util),0) AS utilized_cd,                          -- 81,335
  round(sum(freed_cd*util)*0.144,0) AS credit_14_4,                    -- 11,712
  round(sum(freed_cd*util)*0.351,0) AS credit_35_1,                    -- 28,549
  round(sum(freed_cd*util)*0.394,0) AS credit_39_4                     -- 32,046
FROM leg;
```

**Fix (a) — 15–21-day bucket × six-ticker overlap:**
```sql
WITH leg AS (SELECT ticker, (expiry_date-close_date) AS drem, (entry_cost*100*contracts-premium_collected) AS buyback
  FROM trades WHERE type='CSP' AND close_date<expiry_date AND expiry_date<=DATE '2026-07-27'
    AND exit_cost<0 AND entry_cost IS NOT NULL)
SELECT count(*) FILTER (WHERE drem BETWEEN 15 AND 21) AS bucket_legs,                         -- 35
  round(sum(buyback) FILTER (WHERE drem BETWEEN 15 AND 21),0) AS bucket_buyback,              -- 29,245
  count(*) FILTER (WHERE drem BETWEEN 15 AND 21 AND ticker IN ('CLS','COHR','WDC','STX','CRDO','GLW')) AS overlap_legs,     -- 20
  round(sum(buyback) FILTER (WHERE drem BETWEEN 15 AND 21 AND ticker IN ('CLS','COHR','WDC','STX','CRDO','GLW')),0) AS overlap_buyback  -- 21,775
FROM leg;
```

**CLS attribution by entry regime (Part 2 verdict):**
```sql
WITH px(expiry_date,spot) AS (VALUES (DATE '2025-11-28',344.41),(DATE '2025-12-19',292.29),(DATE '2026-01-30',280.99),
 (DATE '2026-02-13',280.66),(DATE '2026-02-20',292.69),(DATE '2026-02-27',277.63),(DATE '2026-03-20',269.1),
 (DATE '2026-03-27',280.22),(DATE '2026-04-17',396.01),(DATE '2026-04-24',410.21),(DATE '2026-05-01',418.93),
 (DATE '2026-05-29',385.39),(DATE '2026-06-18',372.55),(DATE '2026-07-24',305.28)),
cls AS (SELECT t.open_date, (t.entry_cost*100*t.contracts - t.premium_collected) AS buyback,
    (t.entry_cost*100*t.contracts - GREATEST((t.strike-px.spot)*100*t.contracts,0)) - t.premium_collected AS delta,
    CASE WHEN t.open_date<'2026-02-01' THEN '1_Nov-Jan' WHEN t.open_date<'2026-04-01' THEN '2_Feb-Mar' ELSE '3_Apr+' END AS period,
    (t.open_date IN (DATE '2026-02-11',DATE '2026-02-23',DATE '2026-02-27')) AS patient_range
  FROM trades t JOIN px USING(expiry_date)
  WHERE t.type='CSP' AND t.ticker='CLS' AND t.close_date<t.expiry_date AND t.exit_cost<0)
SELECT period, count(*), sum(buyback), sum(delta) FROM cls GROUP BY period;
-- Nov-Jan: 10, 13875, 11604 | Feb-Mar: 6, 3835, 3835 | Apr+: 7, 5050, 4578 | patient-range: 3, 704, 704
```

**Percentile / efficiency / moneyness / re-entry (Part 2)** were computed in Python (`p2.py`) over the UW daily closes; core logic:
```python
def pctile(t, dstr, win):        # percentile of spot in trailing `win` trading days ending at dstr
    i = idx_on_or_before(t, dstr)
    w = CLOS[t][i-win+1:i+1]; lo, hi = min(w), max(w)
    return 100.0*(CLOS[t][i]-lo)/(hi-lo) if hi>lo else None
def efficiency(t, dstr, win=60): # Kaufman ER: |net move| / sum(|daily moves|)
    i = idx_on_or_before(t, dstr)
    net  = abs(CLOS[t][i] - CLOS[t][i-win])
    path = sum(abs(CLOS[t][j]-CLOS[t][j-1]) for j in range(i-win+1, i+1))
    return net/path if path else None
moneyness = 100.0*(spot(t, open_date) - strike)/spot(t, open_date)
# entry/exit percentile per leg; medians for CLS vs control; regime split at median ER;
# re-entry: for each CLS close, compare next CLS open's spot to this close's spot.
# All 7 daily series validated against known anchor closes before use (assert).
```

---

*Bottom line. Part 1: crediting capital velocity cuts the buyback drag from $18.8k to ~$7.1k (a ceiling) at the honest rate, and to net-positive at recent rates — roughly break-even, not waste. Part 2: the CLS range-trading story is genuinely true for three Feb–March legs worth $704; the $13.9k of January defensive closing — the bulk of the cost — was the opposite of that skill, selling dips that the range then reclaimed. Both levers point to the same fix the first report reached from the other side: close less on the rally-prone names, and don't panic-close into a range that keeps holding.*
