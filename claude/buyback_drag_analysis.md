# Buyback Drag: Was Closing Early Worth What It Cost?

**Prepared:** 2026-07-27 · **Sources:** Supabase `bzfhheqqkwqqwsiqyqzk` (`trades` = source of truth) · spot-at-expiry closes from Unusual Whales `get_ticker_close_prices` (1Y daily), pulled per-ticker · **Author:** Claude

Follows the realized-CSP-yield analysis (2026-07-27), which found 43% of gross premium is handed back in buybacks and had never been measured. This measures it.

---

## Verdict first

**The buyback discipline is net-negative ex post: it cost ~$18,847 across the 138 measurable voluntary buybacks — it is NOT paying for itself.** This is verdict (c), expensive churn — but with one honest qualifier: the buybacks *did* buy real tail protection that clawed back **73%** of their gross cost. So it is "insurance you are overpaying for," not "insurance that is worthless."

The single most important finding is a trap you were about to fall into: **if you identify "closed early" by `close_date < expiry_date` as instructed, the raw number says the buybacks SAVED $9,467.** That is entirely an artifact of **4 early assignments** (APP $530, CDE $22, SHOP $145, IREN $55) that got swept in — the counterparty exercised early; you never chose to close them, and their `actual` result ignores the assignment loss. Strip those 4 non-decisions out and the sign flips from +$9.5k saved to **−$18.8k cost**. The distinction is the whole ballgame, so I lead with it.

The churn is concentrated exactly where you predicted: **CLS alone cost +$20,017** (23 closes, 4% of them right), and the AI/memory names that rallied through your closes (CLS, COHR, WDC, STX, CRDO, GLW) cost **+$41.8k combined**. The offsetting saves came entirely from names that kept falling (SOFI, INOD, DRAM, IREN).

---

## 1. Population and the assignment split — read before the numbers

| Population | Legs | Buyback $ | Note |
|---|---:|---:|---|
| Closed early (`close_date < expiry_date`), all-time | 148 | ~$100,777 | The literal instruction |
| — excluded: expiry in the future (2026-07-31), no realized spot | −5 | | CRDO, DELL, NBIS, SHOP×2 |
| Evaluable (expiry ≤ 2026-07-27) | 143 | ~$96,621 | All 143 matched a spot — **0 missing prices** |
| — **excluded: early assignments** (`exit_cost = 0`, `kept_pct = 1`) | −4 | $0 | **APP $530, CDE $22, SHOP $145, IREN $55 — not voluntary closes** |
| — excluded: 1 leg with NULL `entry_cost` (counterfactual uncomputable) | −1 | | GLW $155, closed 2026-05-06 |
| **Analysis population: computable voluntary buybacks** | **138** | **~$96,300** | `exit_cost < 0` |

**Why the 4 assignments must go.** A voluntary buyback pays a debit to close (`exit_cost < 0`). An early assignment has `exit_cost = 0` and keeps 100% of premium — the put holder exercised because the strike was deep ITM. Its `actual = premium_collected` records only the premium and ignores that you were handed stock at the strike. Comparing that against a "hold to expiry" counterfactual invents a huge phantom "saving" (APP alone: −$11,132) for a decision you never made. **These are the exact opposite of the CCJ case the prompt flagged** (an assignment mislabeled `Close`); here, real assignments hide inside the `close_date < expiry_date` filter. `exit_cost` is the reliable discriminator, and I use it.

**Coverage:** 138 of 148 closed-early legs (~96% of the ~$100.8k of buyback dollars). The 10 uncovered = 5 future-expiry + 4 early-assignment + 1 null-entry. Every evaluable buyback had a spot; **no prices were interpolated.**

---

## 2. The core computation

For each voluntary buyback:
```
counterfactual = gross_premium − max(strike − spot_at_expiry, 0) × 100 × contracts
actual         = premium_collected            (net of the buyback you paid)
delta          = counterfactual − actual
```
`delta > 0` → holding to expiry would have been better; **the buyback cost money.**
`delta < 0` → the buyback saved money.
`gross_premium = entry_cost × 100 × contracts`. Spot = the underlying's **close on the original expiry date** (settlement proxy). The counterfactual stops at expiry — it does not follow assigned shares onward.

---

## 3. Distribution — this is what decides the answer

**Denominators stated explicitly:** `delta` is a **dollar P&L sum** (not a yield). Per-leg figures are the **mean vs. median of delta across the 138 legs**. The buyback-dollar base is **~$96,300**.

| Metric | Value | Reading |
|---|---:|---|
| **Total delta (138 legs)** | **+$18,847** | Holding would have been better by $18.8k → **buybacks cost $18.8k net** |
| Mean delta / leg | **+$137** | The average buyback cost money |
| **Median delta / leg** | **+$384** | The *typical* buyback cost money |
| Hit rate (delta ≤ 0) | **19.6%** (27 / 138) | ~4 in 5 buybacks were the wrong call ex post |
| Would have expired worthless if held | 107 / 138 (77%) | For these, closing simply gave back premium |
| Gross cost on the 111 "losers" | **−$71,007** | Premium handed back on puts that recovered |
| Gross saved on the 27 "winners" | **+$52,160** | Deep-ITM assignments genuinely dodged |
| **Net** | **−$18,847** | Insurance recovered **73%** of its cost, not 100% |

**Skew is the tell, and it points the opposite way from the naïve read.** With the 4 assignments wrongly included, mean (−$66) and median (+$379) *disagreed* in sign — the textbook "tail insurance, judge on the tail" signature. **Remove them and mean (+$137) and median (+$384) agree: the buybacks cost money both typically and on average.** There is no hidden tail rescuing this. The left tail of saves is real but too small: the **10 biggest saves total −$36,412** and the **10 worst outcomes actually avoided total −$33,932** — genuine, but they offset only part of the $71k given back on the 111 recoveries.

**Biggest individual saves vs. costs (voluntary buybacks only):**

| | Ticker | Strike | Qty | Closed | Kept% | Spot@exp | If-held (cf) | Actual | **Delta** |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|
| Save | SOFI | 26 | 20 | 2026-01-08 | 10% | 20.86 | −6,960 | 320 | **−7,280** |
| Save | SOFI | 26 | 30 | 2026-01-08 | 16% | 22.81 | −5,850 | 600 | **−6,450** |
| Save | INOD | 90 | 2 | 2026-06-16 | 53% | 67.80 | −3,340 | 586 | **−3,926** |
| Save | IREN | 48 | 5 | 2026-06-11 | 27% | 38.82 | −2,990 | 425 | **−3,415** |
| Cost | STX | 275 | 3 | 2026-01-12 | 43% | 429.32 | 4,230 | 1,833 | **+2,397** |
| Cost | CLS | 280 | 3 | 2026-01-23 | 14% | 280.66 | 5,226 | 747 | **+4,479** |

The saves are names that cratered (SOFI 26→21, INOD 90→68); the costs are names that ran (STX 275→429, CLS strikes that finished just OTM). You cannot tell which is which at the moment you close.

---

## 4. The gap, in dollars

| | Dollars |
|---|---:|
| Premium handed back in these 138 buybacks (gross − net) | **~$96,300** |
| Value that buying-back bought (tail losses avoided) | **+$52,160** |
| **Net cost of the buyback discipline** | **−$18,847** |
| Cost as a share of buyback dollars spent | **~20¢ per $1 handed back** |

Put plainly: you spent ~$96k of foregone premium to buy ~$52k of realized downside protection. The other ~$44k of that spend was on positions that recovered on their own — and of that, the specific net leakage after all offsets is **$18,847**.

---

## 5. Segmentation

### 5a. By `kept_pct` at close — the most decision-relevant cut

| Kept at close | Legs | Buyback $ | **Sum delta** | Mean | Hit% |
|---|---:|---:|---:|---:|---:|
| Loss (<0, closed red) | 3 | 5,621 | −201 | −67 | 33% |
| 0–50% | 50 | 53,539 | **+6,427** | +129 | 26% |
| 50–75% | 73 | 35,657 | **+11,866** | +163 | 16% |
| 75–90% | 8 | 1,218 | +1,218 | +152 | 0% |
| 90–100% | 5 | 261 | −463 | −116 | 20% |

**There is no profit-taking threshold that turns this positive.** Every band from 0–90% cost money. The **50–75% band — your standard profit-take zone — is the single biggest leak (+$11,866)**, and the 0–50% band (defensive closes, only partial premium kept) cost another +$6,427 on the largest dollar spend ($53.5k). Only the 90–100% band (let it ride to near-max, then close) was net-neutral — but on trivial size (5 legs, $261 spent), so it is not actionable evidence, just the absence of drag. **Actionable read: the money leaks in the 50–75% zone, not at some too-early extreme. Closing later does not fix it; closing less would.**

### 5b. By days remaining at close (`expiry_date − close_date`)

| Days left | Legs | Buyback $ | **Sum delta** | Mean | Hit% |
|---|---:|---:|---:|---:|---:|
| 0–3 | 13 | 3,572 | +1,946 | +150 | 15% |
| 4–7 | 8 | 2,473 | +1,478 | +185 | 25% |
| 8–14 | 21 | 9,144 | +1,276 | +61 | 19% |
| **15–21** | 35 | 29,245 | **+21,142** | **+604** | 11% |
| **22+** | 62 | 51,862 | **−6,995** | −115 | 24% |

**This cut is genuinely informative.** The **15–21-days-left closes are the disaster (+$21,142, more than the entire net drag)** — mid-cycle profit-takes on names that then recovered into expiry. In contrast, **closing with 22+ days left net *saved* $6,995**: those are the early defensive exits that actually caught the fallers (SOFI, INOD, IREN). Last-minute closes (≤7 days) cost modestly — you are giving back the final scraps of time value. **If there is one behavioral lever here: the ~3-weeks-to-expiry profit-take is where you bleed.**

### 5c. By ticker (sorted by total delta)

| Costliest buybacks | Legs | Buyback $ | Sum delta | Hit% |    | Best buybacks | Legs | Buyback $ | Sum delta | Hit% |
|---|---:|---:|---:|---:|---|---|---:|---:|---:|---:|
| **CLS** | 23 | 22,760 | **+20,017** | 4% |    | **SOFI** | 4 | 6,350 | **−13,500** | 50% |
| COHR | 7 | 6,562 | +6,562 | 0% |    | INOD | 2 | 3,622 | −6,640 | 100% |
| WDC | 9 | 6,319 | +6,319 | 0% |    | DRAM | 4 | 2,878 | −6,374 | 75% |
| STX | 8 | 6,239 | +6,239 | 0% |    | IREN | 12 | 8,313 | −2,792 | 33% |
| CRDO | 7 | 6,248 | +3,528 | 14% |    | HOOD | 7 | 4,122 | −2,021 | 43% |
| GLW | 17 | 6,776 | +2,728 | 18% |    | KTOS | 3 | 1,162 | −1,954 | 33% |
| LRCX,TSM,DELL,VRT,SHOP,CCJ,NVDA,SLV,FTNT,HIMS | 40 | ~13k | +9,145 | — |    | CDE, PLTR | 6 | 2,239 | −3,303 | 50% |

**The churn names you named — CLS, GLW, COHR, WDC, STX — dominate the cost side, exactly as expected, at +$41.8k combined** (add CRDO and it is +$45.3k). Every one is an AI/semi/memory name that rallied through your closes; on CLS, COHR, WDC, STX the buybacks were right **0–4%** of the time. The saves are the mirror image — names that fell and stayed down. **CLS is the headline: 23 buybacks, +$20,017 cost, 96% of them wrong. That one ticker is larger than the entire net drag.** (GLW's 17 legs include the 1 null-`entry_cost` leg, which contributes to its count but not its delta.)

### 5d. Rolls vs. flat closes

A **roll** = a same-ticker CSP reopened within ~2 calendar days of the close (a different decision than a profit-take-and-walk-away).

| | Legs | Buyback $ | Sum delta | Mean | Hit% |
|---|---:|---:|---:|---:|---:|
| Roll (reopened ≤2 cal days) | 73 | 50,072 | +7,802 | +108 | 18% |
| Flat close | 66 | 46,224 | +11,045 | +167 | 21% |

**Both cost money; separating rolls does not rescue the verdict.** Rolls are marginally less bad per leg (+$108 vs +$167) — consistent with rolls being more defensively motivated. Note the roll flag is threshold-sensitive: **32 legs reopened same-day, 57 within 1 day, 73 within 2 days, 83 within 4 days.** I used ≤2 calendar days; at ≤1 day the roll bucket drops to 57 and the split shifts modestly, but both sides stay net-positive (cost) under every threshold.

---

## 6. So — worth it?

**On pure realized P&L: no.** The discipline cost ~$18.8k over ~9 months on the 138 measurable closes, and the cost is concentrated in reflexively closing names that keep running (CLS above all). The naïve "+$9.5k saved" reading is a mirage created by 4 early assignments.

**But it is not pure waste.** The buybacks recovered 73% of their cost by genuinely dodging deep-ITM assignments in the names that fell. That is real risk reduction — 27 assignments avoided, and the 10 worst outcomes it sidestepped totaled −$34k of losses that never hit the book. Whether ~$18.8k over nine months is a fair price for that much assignment-avoidance and sleep is your risk-tolerance call, not a math result.

**The controllable levers, in priority order:**
1. **CLS and the rallying AI/memory names (COHR, WDC, STX, CRDO, GLW).** +$45k of the cost lives here, at 0–18% hit rates. On names in a strong uptrend, the reflexive buyback is close to pure churn — let more of them expire.
2. **The 15–21-days-to-expiry profit-take (+$21k) and the 50–75%-kept band (+$12k).** This is the same behavior seen two ways: closing mid-cycle at a "good enough" profit. That is where the premium leaks.
3. **Keep doing it on the fallers.** The 22+-days-left defensive closes and the SOFI/INOD/DRAM/IREN buybacks were correct and net-positive. The discipline works when the thesis is actually breaking; it costs when you are just taking a winner off the table early.

---

## 7. Assumptions and judgment calls

- **[Judgment call — the big one] Early assignments excluded from the buyback population.** 4 legs (`exit_cost = 0`, `kept_pct = 1`, subtype `Assigned`: APP $530, CDE $22, SHOP $145, IREN $55) satisfy `close_date < expiry_date` but were not voluntary closes — the counterparty exercised early. Their `actual` ignores the assignment, so including them fabricates ~$28.3k of phantom "savings" and flips the sign of the whole result. I excluded them and used `exit_cost < 0` to define a voluntary buyback. **This departs from the literal "identify by `close_date < expiry_date`" instruction; I judged the instruction was aimed at not *missing* assignments (the CCJ case), not at *counting assignments as buybacks*.** Flagged prominently so you can overrule.
- **[Data hole] 1 leg dropped:** GLW $155 (closed 2026-05-06) has NULL `entry_cost`, so gross premium and the counterfactual are uncomputable. Left out rather than guessed. Population is 138, not 139.
- **[Exclusion] 5 legs with expiry 2026-07-31** (CRDO, DELL, NBIS, SHOP×2) have no realized expiry spot (future). Excluded, not interpolated. Coverage is ~96% of buyback dollars.
- **Spot at expiry = the underlying's closing price on the original `expiry_date`,** from Unusual Whales 1Y daily closes. This is the standard settlement proxy for equity options. Every one of the 143 evaluable expiry dates was a trading day with a close present — no holiday/weekend fallback was needed.
- **Column semantics** (verified against rows, consistent with the prior analysis): `gross = entry_cost×100×contracts`; `actual = premium_collected` (net of buyback); `buyback = gross − actual`; `capital_fronted = strike×100×contracts`.
- **[Heuristic] Roll detection** = another CSP on the same ticker opened within ≤2 calendar days after the close. Calendar days approximate "2 trading days"; a Friday→Monday roll is 3 calendar days and would read as a flat close under ≤2. Sensitivity reported in §5d (32/57/73/83 legs at 0/1/2/4 days). The roll split does not change the verdict at any threshold.
- **Counterfactual stops at expiry.** For legs that would have finished ITM, "holding" means taking assignment at strike and marking to the expiry-date spot — exactly `max(strike − spot, 0)`. I do **not** follow the assigned shares afterward; that would import the separate "when to sell" decision.
- **`delta` is a P&L dollar sum, not a yield.** No annualization, no collateral-days denominator here — this analysis is per-leg realized dollars, so the days-held/DTE denominator ambiguity from the prior report does not arise. Per-leg stats are mean and median of delta.
- **Prices look like a strong bull/AI-memory tape** (STX ~$1,000, WDC ~$700, DRAM up 2×). These are the values Unusual Whales returned for this account's tickers and are internally consistent across the sector; I used them as-is and did not second-guess them.
- **`account_value` frozen at $875,131.25** — noted as intended, not used here. No dividend data exists and none was sought.

---

## 8. SQL used (verbatim)

All price-dependent queries share one `px(ticker, expiry_date, spot)` CTE built from the 108 Unusual Whales closes (one per needed ticker×expiry). It is shown in full once below and referenced as `WITH px(...) AS (VALUES …) /* 108 rows, see above */` thereafter.

**The shared price CTE (108 rows):**
```sql
WITH px(ticker,expiry_date,spot) AS (VALUES
 ('CLS','2025-11-28',344.41),('CLS','2025-12-19',292.29),('CLS','2026-01-30',280.99),('CLS','2026-02-13',280.66),
 ('CLS','2026-02-20',292.69),('CLS','2026-02-27',277.63),('CLS','2026-03-20',269.10),('CLS','2026-03-27',280.22),
 ('CLS','2026-04-17',396.01),('CLS','2026-04-24',410.21),('CLS','2026-05-01',418.93),('CLS','2026-05-29',385.39),
 ('CLS','2026-06-18',372.55),('CLS','2026-07-24',305.28),('APP','2026-02-20',418.68),
 ('CCJ','2026-03-20',101.55),('CCJ','2026-04-02',112.57),('CCJ','2026-04-10',116.04),('CCJ','2026-04-24',122.15),
 ('CCJ','2026-05-29',112.70),('CCJ','2026-06-26',104.49),('CDE','2026-03-27',17.13),('CDE','2026-05-01',17.65),
 ('CDE','2026-05-29',19.32),('CDE','2026-06-26',16.02),('COHR','2026-05-08',335.26),('COHR','2026-05-29',361.47),
 ('COHR','2026-06-05',376.99),('COHR','2026-06-18',389.57),('COHR','2026-06-26',380.56),('COHR','2026-07-02',333.36),
 ('CRDO','2026-02-06',111.40),('CRDO','2026-05-29',236.03),('CRDO','2026-06-26',238.00),('CRDO','2026-07-02',241.91),
 ('DELL','2026-07-24',437.50),('DRAM','2026-07-10',63.04),('DRAM','2026-07-17',52.72),('FTNT','2026-05-08',114.07),
 ('GLW','2026-03-20',124.58),('GLW','2026-03-27',136.81),('GLW','2026-04-24',175.89),('GLW','2026-05-01',158.26),
 ('GLW','2026-05-08',186.94),('GLW','2026-05-29',181.16),('GLW','2026-06-05',177.58),('GLW','2026-06-12',179.20),
 ('GLW','2026-06-26',221.05),('GLW','2026-07-02',196.79),('GLW','2026-07-17',154.61),('GLW','2026-07-24',146.65),
 ('HIMS','2025-12-05',39.20),('HOOD','2025-12-26',118.13),('HOOD','2026-01-30',99.48),('HOOD','2026-05-15',77.14),
 ('HOOD','2026-05-22',73.64),('INOD','2026-07-10',67.80),('INOD','2026-07-24',55.89),('IREN','2025-12-19',39.92),
 ('IREN','2026-01-02',42.70),('IREN','2026-01-16',57.82),('IREN','2026-01-30',53.74),('IREN','2026-02-06',41.83),
 ('IREN','2026-02-20',39.98),('IREN','2026-05-08',61.20),('IREN','2026-05-29',63.54),('IREN','2026-06-18',59.96),
 ('IREN','2026-07-02',38.82),('IREN','2026-07-17',33.62),('KTOS','2026-05-22',56.18),('KTOS','2026-06-26',47.21),
 ('LRCX','2026-06-12',366.81),('LRCX','2026-07-10',350.33),('NVDA','2025-11-21',178.88),('NVDA','2025-12-26',190.53),
 ('NVDA','2026-01-16',186.23),('NVDA','2026-03-20',172.70),('PLTR','2026-01-16',170.96),('PLTR','2026-05-01',144.07),
 ('SHOP','2026-02-20',126.20),('SHOP','2026-06-05',109.54),('SHOP','2026-06-18',108.85),('SHOP','2026-06-26',116.86),
 ('SHOP','2026-07-17',123.56),('SLV','2026-03-13',72.69),('SOFI','2025-11-28',29.72),('SOFI','2026-01-30',22.81),
 ('SOFI','2026-02-06',20.86),('STX','2025-12-26',286.22),('STX','2026-01-02',287.54),('STX','2026-01-23',346.10),
 ('STX','2026-02-06',429.32),('STX','2026-02-13',425.99),('TSM','2025-11-28',291.51),('TSM','2025-12-26',302.84),
 ('TSM','2026-03-13',338.31),('TSM','2026-04-10',370.60),('TSM','2026-04-17',370.50),('VRT','2026-06-26',303.95),
 ('VRT','2026-07-17',289.56),('WDC','2026-02-20',285.52),('WDC','2026-03-13',272.29),('WDC','2026-03-20',293.10),
 ('WDC','2026-03-27',275.34),('WDC','2026-04-24',404.00),('WDC','2026-05-01',431.52),('WDC','2026-05-29',531.21),
 ('WDC','2026-06-26',586.45)
)
```

**Coverage check (every evaluable leg has a spot; nothing interpolated):**
```sql
WITH px(...) AS (VALUES …),  -- 108 rows, see above
ce AS (SELECT * FROM trades WHERE type='CSP' AND close_date < expiry_date)
SELECT (SELECT count(*) FROM ce) AS closed_early_legs,
       (SELECT count(*) FROM ce WHERE expiry_date > DATE '2026-07-27') AS future_expiry_excluded,
       (SELECT count(*) FROM ce WHERE expiry_date <= DATE '2026-07-27') AS evaluable_legs,
       (SELECT count(*) FROM ce JOIN px USING(ticker,expiry_date) WHERE expiry_date <= DATE '2026-07-27') AS matched_price,
       (SELECT json_agg(json_build_object('ticker',ticker,'expiry',expiry_date)) FROM ce
          WHERE expiry_date <= DATE '2026-07-27'
            AND NOT EXISTS (SELECT 1 FROM px WHERE px.ticker=ce.ticker AND px.expiry_date=ce.expiry_date)) AS missing_price;
-- → 148 / 5 / 143 / 143 / null
```

**Voluntary-buyback vs. early-assignment split:**
```sql
SELECT CASE WHEN exit_cost < 0 THEN 'voluntary_buyback' ELSE 'exit_cost_0 (assignment)' END AS kind,
       subtype, count(*) legs, sum(entry_cost*100*contracts) gross_prem,
       sum(COALESCE(-exit_cost,0)*100*contracts) buyback_paid, sum(premium_collected) net_prem
FROM trades
WHERE type='CSP' AND close_date < expiry_date AND expiry_date <= DATE '2026-07-27'
GROUP BY 1, subtype;
-- → voluntary_buyback/Close: 139 legs; exit_cost_0/Assigned: 4 legs
```

**The per-leg counterfactual (the analysis population is this `leg` CTE), and the headline distribution:**
```sql
WITH px(...) AS (VALUES …),  -- 108 rows, see above
leg AS (
  SELECT t.ticker, t.strike, t.contracts, t.kept_pct, px.spot,
    t.entry_cost*100*t.contracts AS gross_prem, t.premium_collected AS actual,
    t.entry_cost*100*t.contracts - GREATEST((t.strike-px.spot)*100*t.contracts,0) AS counterfactual,
    (t.entry_cost*100*t.contracts - GREATEST((t.strike-px.spot)*100*t.contracts,0)) - t.premium_collected AS delta
  FROM trades t JOIN px ON px.ticker=t.ticker AND px.expiry_date=t.expiry_date
  WHERE t.type='CSP' AND t.close_date < t.expiry_date AND t.expiry_date <= DATE '2026-07-27'
    AND t.exit_cost < 0                              -- voluntary buybacks only
)                                                    -- NULL entry_cost legs drop out of delta sums automatically
SELECT count(*) FILTER (WHERE delta IS NOT NULL) AS n_computable,
  round(sum(delta)::numeric,0) AS total_delta,
  round(avg(delta)::numeric,1) AS mean_delta,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY delta)::numeric,1) AS median_delta,
  round(100.0*count(*) FILTER (WHERE delta<=0)/count(*) FILTER (WHERE delta IS NOT NULL),1) AS hit_rate_pct,
  count(*) FILTER (WHERE spot>=strike) AS n_would_expire_worthless,
  round(sum(-delta) FILTER (WHERE delta<0)::numeric,0) AS saved_on_winners,
  round(sum(delta)  FILTER (WHERE delta>0)::numeric,0) AS cost_on_losers
FROM leg;
-- → 138 / +18847 / +136.6 / +384.0 / 19.6 / 108 / 52160 / 71007
```

**Tail (worst-5 / worst-10 by both delta and counterfactual), over the same `leg` CTE:**
```sql
SELECT (SELECT sum(delta)          FROM (SELECT delta FROM leg ORDER BY delta ASC LIMIT 5)  a) AS worst5_delta_savings,
       (SELECT sum(delta)          FROM (SELECT delta FROM leg ORDER BY delta ASC LIMIT 10) a) AS worst10_delta_savings,
       (SELECT sum(counterfactual) FROM (SELECT counterfactual FROM leg ORDER BY counterfactual ASC LIMIT 10) a) AS worst10_cf
FROM (SELECT 1) x;   -- → −24122 / −36412 / −33932
```

**Segmentations — `kept_pct` and days-remaining buckets** (both group the same `leg` CTE; days bucket adds `(expiry_date - close_date)`):
```sql
SELECT CASE WHEN kept_pct<0 THEN '0. loss' WHEN kept_pct<0.5 THEN '1. 0-50%'
            WHEN kept_pct<0.75 THEN '2. 50-75%' WHEN kept_pct<0.90 THEN '3. 75-90%' ELSE '4. 90-100%' END AS bucket,
       count(*) n, round(sum(delta)::numeric,0) sum_delta, round(avg(delta)::numeric,0) mean_delta,
       round(sum(gross_prem-actual)::numeric,0) buyback_spent,
       round(100.0*count(*) FILTER (WHERE delta<=0)/count(*),0) hit_pct
FROM leg GROUP BY 1 ORDER BY 1;
-- days-remaining variant: bucket on (expiry_date - close_date) into 0-3 / 4-7 / 8-14 / 15-21 / 22+
```

**Per-ticker:**
```sql
SELECT ticker, count(*) n, round(sum(delta)::numeric,0) sum_delta,
       round(sum(gross_prem-actual)::numeric,0) buyback_spent,
       round(100.0*count(*) FILTER (WHERE delta<=0)/count(*),0) hit_pct
FROM leg GROUP BY ticker ORDER BY sum_delta DESC;
```

**Rolls vs. flat closes** (roll = same-ticker CSP reopened within ≤2 calendar days of the close):
```sql
-- add to the leg CTE:
--   (SELECT min(t2.open_date - t.close_date) FROM trades t2
--      WHERE t2.type='CSP' AND t2.ticker=t.ticker AND t2.id<>t.id AND t2.open_date >= t.close_date) AS reopen_gap
SELECT CASE WHEN reopen_gap IS NOT NULL AND reopen_gap<=2 THEN 'roll' ELSE 'flat close' END AS split,
       count(*) n, round(sum(delta)::numeric,0) sum_delta, round(avg(delta)::numeric,0) mean_delta,
       round(100.0*count(*) FILTER (WHERE delta<=0)/count(*),0) hit_pct
FROM leg GROUP BY 1;
-- sensitivity: count(*) FILTER (WHERE reopen_gap=0/<=1/<=2/<=4) → 32 / 57 / 73 / 83
```

---

*Bottom line: the buyback discipline is a net ex-post cost of ~$18.8k, not the ~$9.5k saving the raw close-early filter implies — the difference is 4 early assignments that were never yours to close. It is expensive churn concentrated in the winners you keep buying back (CLS above all), partly redeemed by genuine tail avoidance on the fallers. The lever is not "close later" — it is "close less, especially on the names still trending up."*
