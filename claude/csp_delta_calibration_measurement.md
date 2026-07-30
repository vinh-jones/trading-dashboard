# CSP Entry-Delta Calibration (v1) — Measurement

**Prepared:** 2026-07-30 · **Type:** Measurement only (no rule changes, no recommendations) · **Sources:** Supabase `bzfhheqqkwqqwsiqyqzk` `trades` (entry delta, strikes, dates) · settlement & entry spots from Unusual Whales `get_ticker_close_prices` (1Y daily) · **Author:** Claude

**Question (2026-07-29):** *"If I target 30 delta, can I expect assignment 30% of the time?"* Theory says no: put delta is `N(−d₁)`, P(ITM) is `N(−d₂)` with `d₂ = d₁ − σ√T`, so `P(ITM) > |Δ|` always, by an amount that grows with `σ√T`. This measures whether the realized rate matches.

---

## VERDICT: **CALIBRATED** — and the answer to the question is **no, ≈34%, not 30%**

Over the unbiased population (A∪B, n=155): **realized ITM = 33.5%** (90% CI **[28%, 40%]**). The risk-neutral model **N(−d₂) = 37.7%** sits **inside that CI** → calibrated. The naive `|Δ|` reading (**30.1%**) also sits inside the CI but at its lower edge, and realized runs **+3.4 pts above it** — exactly the direction theory predicts. The small gap between realized (33.5%) and the *risk-neutral* model (37.7%) is fully closed by real-world adjustment: with ~8%/yr drift and a 10-point vol risk premium the model gives **33.9%**, essentially dead-on realized. **No residual edge remains to attribute to skill** — the mechanism is drift + VRP, named, not entry timing.

**Direct answer:** targeting 30 delta, expect ITM/assignment **≈34% pooled, and ≈36% specifically in the 0.30–0.35 bucket** — not 30%. **Retire the `|Δ| = P(assignment)` reading.**

**Confidence: moderate.** Only two `|Δ|` buckets clear n≥15, and the rate is strongly regime-dependent (Feb & July drawdowns → 56–60% ITM; Mar–June rallies → 15–24%). The point estimate is solid; the precise calibration verdict rests on those two buckets and is regime-sensitive. See §5 for the data-quality caveats that soften the model benchmark.

---

## 1. Populations

`delta` lives in `trades` (signed; puts negative). 13 expired CSP legs were dropped for **null delta** (7 in A, 6 in B). Corporate actions: none of the covered tickers shows a split-like discontinuity across its open→expiry windows (checked the daily series), so strike-vs-settlement comparisons are valid; **no split adjustments applied.**

| Population | Definition | n | Expiry range |
|---|---|---:|---|
| **A — held to expiry** | `close_date IS NULL OR close_date ≥ expiry_date` | **18** | 2025-12-19 → 2026-07-24 |
| **B — closed early** (marked to settlement) | `close_date < expiry_date` | **137** | 2025-12-19 → 2026-07-24 |
| **A∪B — the answer population** | all expired CSP legs w/ delta | **155** | opens 2025-11-17 → 2026-07-06 |

**Trap 1 is not hypothetical here — it is total.** Population A is **100% ITM (18 of 18).** In this book a put bound to expire worthless gets **bought back early** (Population B) to free capital; a put is "held to expiry" essentially only when it goes ITM into assignment. So Population A is a pure selection artifact and Population B alone (25% ITM) is biased the other way. **Neither A nor B answers the question — only A∪B does.** Every headline below is A∪B.

---

## 2. The measure — A∪B by `|entry delta|`

Bucketed by `|Δ|`. `realized ITM` = share with settlement close < strike. `N(−d₂)` = risk-neutral model per leg (σ derived per §5). 90% CI is the Wilson score interval on the realized rate. Rates shown only for **n ≥ 15**; thinner buckets are marked INSUFFICIENT with the count.

| bucket | n | mean \|Δ\| | mean N(−d₂) | realized ITM | gap vs \|Δ\| | gap vs N(−d₂) | 90% CI | top-3 tickers | assigned/ITM |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0.10–0.15 | 1 | 14.0% | 18.1% | INSUFF (0%) | — | — | — | STX 100% | 0/0 |
| 0.15–0.20 | 3 | 16.7% | 25.1% | INSUFF (0%) | — | — | — | WDC 67% | 0/0 |
| 0.20–0.25 | 10 | 22.8% | 30.6% | INSUFF (10%) | — | — | — | CLS 20%, IREN 20% | 1/1 |
| **0.25–0.30** | **62** | 27.0% | 34.9% | **29%** | +2 | −6 | **[21, 39]** | GLW 13%, IREN 11%, CLS 10% | 8/18 |
| **0.30–0.35** | **55** | 31.7% | 39.6% | **36%** | +5 | −3 | **[27, 47]** | CLS 25%, GLW 15%, CRDO 9% | 6/20 |
| 0.35–0.40 | 12 | 36.5% | 43.7% | INSUFF (50%) | — | — | — | HOOD 17%, IREN 17% | 1/6 |
| 0.40+ | 12 | 43.6% | 48.2% | INSUFF (58%) | — | — | — | CDE 25%, SHOP 25% | 3/7 |
| **POOLED** | **155** | **30.1%** | **37.7%** | **33.5%** | **+3.4** | **−4.2** | **[28, 40]** | — | 19/52 |

Real-world-adjusted N(−d₂) (μ=8%/yr, σ−10pt VRP), pooled: **33.9%** vs realized 33.5%.

**Reading the two robust buckets (where "30 delta" lives):** realized ITM is **29%** (0.25–0.30) and **36%** (0.30–0.35). Both run **above** their `mean |Δ|` (27.0%, 31.7%) and **below** the risk-neutral `N(−d₂)` (34.9%, 39.6%), with the model inside each CI. The ordering pooled is clean: **naive |Δ| 30.1% < realized 33.5% ≈ real-world model 33.9% < risk-neutral model 37.7%.** Truth sits between the naive reading and the risk-neutral model, right on the real-world-adjusted model.

---

## 3. Traps

- **Trap 1 — selection bias in A.** Handled: A = 100% ITM (see §1); all numbers are A∪B. Stated before any A number was quoted.
- **Trap 2 — thin buckets.** Only 0.25–0.30 (n=62) and 0.30–0.35 (n=55) clear n≥15. The other five buckets are INSUFFICIENT and shown with counts, not rates. **Buckets were not merged** to manufacture n.
- **Trap 3 — ticker concentration.** The two robust buckets are reasonably diversified (top ticker ≤25%). The 0.30–0.35 bucket is **25% CLS**, and CLS drags the pooled rate down: **ex-CLS realized = 37.1%** (n=132) vs 33.5% all-in — CLS puts went ITM less often (range-bound/recovering name), pulling the pooled estimate ~3.6 pts below the rest of the book.
- **Trap 4 — time clustering. The rate is a regime reading.** Realized ITM by expiry month: Dec 31%, **Jan 43%, Feb 56%**, Mar 19%, Apr 15%, May 20%, Jun 24%, **Jul 60%** (n=25). The high-ITM months are the drawdowns (Feb, July), the low-ITM months are rallies (Mar–June). The pooled 33.5% averages across regimes; in a persistent drawdown the rate is far higher, in a rally far lower.
- **Trap 5 — same-day multi-strike.** 155 legs = **151 decisions**; 3 decisions are multi-strike (CCJ 2026-03-06 ×2, CLS 2026-01-29 ×2, CRDO 2026-06-02 ×3). Four legs are correlated within one decision each. Immaterial to the pooled rate.
- **Trap 6 — carve-outs.** **ex-INOD:** 32.7% (n=153, both INOD legs went ITM; negligible shift). **ex-CLS:** 37.1% (n=132; see Trap 3).
- **Trap 7 — rolls.** Rolled legs are in B (closed early); their replacements are separate legs and also appear. **Not de-duplicated.** The 151-vs-155 decision/leg gap (Trap 5) is same-day multi-strike, not rolls; rolls open on a later day and count as independent legs by design.
- **Trap 8 — corporate actions.** No split-like discontinuities found in the covered tickers over the relevant windows (the large STX/WDC/DRAM moves are continuous, not splits). No exclusions.

---

## 4. ITM vs. recorded assignment

**ITM-at-settlement (settle < strike) is the clean measure; recorded `subtype='Assigned'` is contaminated.** Pooled A∪B: **52 legs ITM at settlement, but only 19 recorded as Assigned.** The 33-leg gap is almost entirely **Population B legs that were bought back before expiry** — they would have been ITM at expiry (settlement < strike) but were closed, so never "assigned." That is exactly why B must be marked to settlement rather than read off `subtype`.

Two contamination cases the spec anticipated, both in Population A (held to expiry, yet `subtype='Close'`):
- **CCJ 2026-05-06 K$113, settle $112.70** — ITM by **$0.30** (sub-dollar pin; not exercised).
- **COHR 2026-06-17 K$350, settle $277.60** — deep ITM (~$72) but recorded `Close`, not `Assigned` (closed/rolled at expiry rather than taking stock).

Full disagreement list (33 legs) is in the run log; all are ITM-at-settlement with `assignedFlag=0`, and all but the two above are B-closed-early (expected).

---

## 5. Data-quality flags on the model benchmark (σ derivation)

The realized ITM rate needs no model — it is settlement vs strike, solid for all 155. The **`N(−d₂)` benchmark carries real model uncertainty**, and the derivation surfaced three issues worth stating before leaning on it:

1. **18 of 155 legs (12%) have a recorded entry delta ABOVE the BS-maximum delta achievable at their strike's moneyness** — no risk-neutral σ reproduces `|Δ|` (the put is too far OTM for that delta at *any* vol). Concentrated in the highest-vol names (IREN ×4, SHOP ×4, CRDO ×3, SOFI ×2, HOOD, KTOS, CCJ, STX, VRT). For these I fell back to **premium-implied σ** (BS put-price inversion, always solvable) and flagged them; at that σ the *model* delta is 0.03–0.10 below the recorded delta. Interpretation: the stored entry deltas run a few points high relative to their strikes — consistent with a broker delta quoted at a slightly lower intraday spot than the close I used, or skew. **This is a caveat on `N(−d₂)`, not on realized ITM.**
2. **σ from delta-inversion vs σ from premium disagree by ~14 vol points** (median |diff| 0.137 on the legs where both are computable). The two market observables (recorded delta, recorded premium) imply materially different vols, so `N(−d₂)` inherits ±~14pt σ uncertainty. The verdict (calibrated, naive too low) survives this, but a precise per-leg `N(−d₂)` should not be over-trusted.
3. **3 legs have a POSITIVE recorded delta (sign error): CLS 2026-03-26 K$260 (+0.33), STX 2025-11-21 K$215 (+0.30), STX 2025-12-24 K$265 (+0.29).** Used via `|Δ|`. Flagged.

---

## 6. Downstream consequence — the delta-wall headline is biased low

The delta-wall headline is `Σ |Δ| × strike × 100 × contracts`. Because `P(ITM) > |Δ|` by `σ√T` at this book's vol, that headline **understates** the expected-assignment dollar figure. Recomputing each run's cluster under `N(−d₂)` weighting instead of `|Δ|`:

| Run | legs | headline, `|Δ|` weighting | headline, `N(−d₂)` weighting | understatement |
|---|---:|---:|---:|---:|
| **2026-07-24** (expired, `trades`) | 6 / 6 | **$44,935** | **$57,438** | **+$12,503 (+27.8%)** |
| **2026-07-31** (open, `positions`) | 3 / 7 | **$23,108** | **$27,998** | **+$4,890 (+21.2%)** |

So the delta-wall's expected-assignment dollars run **~21–28% low** at these vol levels; the 7/24 headline would have read **$57.4k, not $44.9k**, under `N(−d₂)`.

Two caveats: **(a)** the 7/31 run covers only **3 of 7 legs** — the other 4 open puts (DRAM $70, GLW $167.50, GLW $165, CLS $320) have **null entry delta** in `positions` and are excluded, so its headline is partial. **(b)** These use **entry-time σ and entry-DTE**; a delta-wall run executed closer to expiry (shorter remaining `T`) would show a **smaller** gap because `σ√T` shrinks — treat +28%/+21% as the entry-conditions (upper-ish) bias, not the bias at a run made days before expiry. *(Per spec: methodology unchanged this pass — measured and handed back.)*

---

## 7. SQL, code, and assumptions

**Populations & leg pull (Supabase):**
```sql
-- population flags; delta is the ENTRY delta in trades (signed)
SELECT ticker, open_date, expiry_date, close_date, strike, contracts, delta, subtype,
       CASE WHEN close_date<expiry_date THEN 'B' ELSE 'A' END AS popn
FROM trades
WHERE type='CSP' AND expiry_date < current_date AND delta IS NOT NULL;   -- A=18, B=137; null-delta dropped=13
-- delta-wall clusters
SELECT ... FROM positions WHERE position_type='open_csp' AND type='CSP' AND expiry_date=DATE '2026-07-31' AND delta IS NOT NULL;  -- 3 of 7 have delta
SELECT ... FROM trades    WHERE type='CSP' AND expiry_date=DATE '2026-07-24';  -- 6 legs
```

**σ derivation and P(ITM) (Python, `calib.py`):**
```python
# primary: invert delta.  |Δput| = N(-d1) -> d1 = -Φ⁻¹(|Δ|);  solve for σ (smallest root in [0.05,2.5]) of
#   d1 = [ln(S/K) + (r+σ²/2)T] / (σ√T),   S=close@open, K=strike, T=(expiry-open)/365, r=0.04
def solve_sigma(S,K,T,ad):
    d1=-Phinv(ad); m=math.log(S/K)
    f=lambda s:(m+(R+s*s/2)*T)/(s*math.sqrt(T))-d1
    # bisect the smallest sign-change in [0.05,2.5]; None if delta > BS-max for the moneyness (no root)
# fallback for the 18 no-root/out-of-range legs: premium-implied σ (BS put-price inversion, monotone)
def sigma_from_prem(S,K,T,prem): ...   # bisect BS_put(σ)=entry_cost
# model P(ITM), risk-neutral, from the chosen σ:
def pitm(S,K,T,sig):  d2=(math.log(S/K)+(R-sig*sig/2)*T)/(sig*math.sqrt(T)); return Φ(-d2)   # = N(-d2)
# real-world variant: replace R with μ=0.08 and σ with max(σ-0.10,0.05)  (drift + 10-pt vol risk premium)
# realized: itm = 1 if settlement_close < strike else 0
# CI: Wilson score interval, z=1.645 (90%)
```
Every settlement price for the 17 non-`p2` tickers was **cross-checked against the independently transcribed `expiry_closes.csv`** (0 mismatches); the 7 largest tickers reuse the daily series already validated against known anchors in `p2.py`; and any transcription error in a spot-at-open would surface as an out-of-`[0.10,2.50]` σ (the flag that caught the 18 legs).

**Assumptions / judgment calls:**
- **Spot at open = the underlying's close on `open_date`** (EOD proxy for an intraday sale). This is the likeliest source of the "delta above BS-max" flag in §5 for up-day entries. **[Assumption]**
- **Settlement = the underlying's close on `expiry_date`** (standard settlement proxy). Every A∪B expiry was a trading day with a close present; no interpolation, no dropped legs for missing price.
- **r = 0.04.** Real-world adjustment uses **μ = 0.08** and a **10-pt vol risk premium** (per the spec's illustration) — reported as a secondary benchmark, not the primary verdict basis.
- **Premium-IV fallback** for the 18 delta-inconsistent legs keeps the sample whole at n=155; using delta-inversion-only would drop them and bias toward the lower-vol names. Flagged either way (§5).
- **σ model uncertainty ±~14 vol pts** (§5.2) — the `N(−d₂)` benchmark is soft at the per-leg level; the pooled verdict is robust to it because it survives on both bucket estimates and the CI.
- **Delta-wall bias** uses entry-time σ/DTE and, for 7/31, only the 3 delta-available legs (§6 caveats).
- `account_value` frozen at $875,131.25 is intended; no dividend data exists (SLV/CDE distributions, if any, not modeled — would nudge P(ITM) marginally).

---

*Measurement complete. Verdict: **CALIBRATED** — realized 33.5% (90% CI [28,40]) contains the risk-neutral model 37.7% and matches the real-world-adjusted model 33.9%; the naive |Δ|=30% understates and should be retired. A 30-delta target lands ITM ≈34% (≈36% in the 0.30–0.35 bucket), regime-permitting. Downstream, the delta-wall expected-assignment headline runs ~21–28% low at these vol levels. No rule changes made; handed back.*
