# Unusual Whales Signal Integration — Finance Review Packet

**Date:** 2026-06-20
**Author:** engineering (for finance review)
**Scope:** Everything shipped in the options-flow / signal work — capital-efficiency fix, redeploy signal, and the five-consumer Unusual Whales (UW) integration. App versions 1.139.x → 1.143.0.

**How to read this:** each spec states the **decision it informs**, the **exact math**, the **thresholds (the judgment calls worth challenging)**, where it **surfaces**, and **review questions**. All thresholds are collected in the Appendix for a single-pass review. Nothing here changes order entry or sizing automatically — every signal is advisory and surfaced to a human.

---

## 0. Conventions & philosophy

- **Strategy context:** the wheel — selling cash-secured puts (CSPs), occasionally taking assignment and selling covered calls (CCs).
- **Signal purity rule:** UW data **never** mutates the core P&L math (the redeploy ratio, hold-yield, realized P&L). It only *overlays* as a separate confirm/veto layer or feeds capped modifiers. This keeps the accounting auditable and the flow noise quarantined.
- **Contrarian posture (house view):** high VIX → deploy more; low VIX → hold more cash. CSP-friendly = stable, mean-reverting tape.
- **Null-safety:** every signal treats missing data as "no signal" (no-op), so partial data never corrupts a score.
- **Normalization:** scale-free signals are pre-normalized to [−1, 1] so no per-ticker calibration is needed.

---

## Spec A — Capital-efficiency metric (fix)

**Decision:** "what annualized return am I earning per dollar of capital I actually tie up?" — used to compare names and judge whether collateral is working hard enough.

**Math (time-weighted, dollar-days):**
```
assignedCapitalDays = Σ  total_capital_committed × days_active     (per assigned-share lifespan)
cspCollateralDays   = Σ  capital_fronted        × days_held        (per closed CSP)
securedCapitalDays  = assignedCapitalDays + cspCollateralDays

capitalEfficiencyPct (primary)  = realizedPnl / securedCapitalDays × 365 × 100
capitalEfficiencyAssignedPct    = realizedPnl / assignedCapitalDays × 365 × 100   (secondary)
```
A CSP's `days_held` ends at assignment and the lifespan's `days_active` begins there, so the two denominators **stitch the timeline with no double-count**. CCs add no capital (their collateral is the underlying shares, already counted as assigned capital).

**The fix:** the prior version used an asymmetric denominator (numerator counted CSP premium income but denominator counted only assigned capital), which overstated efficiency for names that mostly expired without assignment. Now the **primary** metric divides by *total secured capital* (assigned + CSP collateral-days), matching the rest of the app's "deployed capital" vocabulary.

**Review questions:** (1) Is annualizing on `×365` (calendar days) the right convention vs trading days? (2) Should idle/uncommitted cash drag be reflected, or is per-deployed-dollar the intended lens?

---

## Spec B — Redeploy signal (per-CSP)

**Decision:** "is this open CSP's *leftover* premium still decaying fast enough to keep holding, or would the same collateral earn more in a fresh CSP?" — i.e. close-and-redeploy vs hold-to-expiry.

**Math:**
```
keptPct      = realized premium-capture %           (fraction of max profit already booked)
fracTimeLeft = daysRemaining / originalDTE          (= 1 − % time elapsed)
ratio        = (1 − keptPct) / fracTimeLeft
```
`ratio` compares the leftover premium's *earning velocity* to a brand-new position's even-paced decay. `ratio < 1` → the leftover pays slower than starting over.

**Thresholds (judgment):**
| State | Condition | Meaning |
|---|---|---|
| `underwater` | keptPct ≤ 0 (mark above entry) | roll/assignment decision, not a redeploy one |
| `redeploy` | ratio < **0.50** | leftover pays < half a fresh trade → close & redeploy wins even after bid/ask + idle-cash drag |
| `watch` | 0.50 ≤ ratio < **0.80** | approaching the line |
| `hold` | ratio ≥ 0.80 | leftover still competitive |

Also emits a `trigger_mark = 0.50 × entryPerShare × fracTimeLeft` — the buy-back price that trips the close line at today's DTE.

**Review questions:** (1) Is 0.50 the right close line given your actual round-trip cost (commissions + bid/ask + days of idle cash between trades)? (2) Should the threshold scale with DTE remaining (a 0.50 ratio at 3 DTE vs 25 DTE is a very different annualized give-up)?

---

## Spec C — Entry score (UW Consumer 1)

**Decision:** "should I sell premium on *this name* right now?" — the per-ticker richness/structure score on Radar and the CSP calculator.

**Math:**
```
compositeIv = (ivRank/100)·0.60 + min(iv/1.50, 1.0)·0.40
base        = (1 − bbPosition)·0.50 + compositeIv·0.50
score       = base × trendMod × ivTrendMod × gammaEnvMod × flowMod
```
- **base** weights *structure* (lower-Bollinger-Band proximity = Ryan's 1b) and *richness* (IV rank + raw IV = 1a) **co-equally** at 0.50 each.
- **trendMod** (MA50/200): uptrend 1.00 / pullback 0.90 / recovering 0.85 / downtrend 0.70.
- **gammaEnvMod** (UW): `g ≥ 0 → 1 + 0.10·g`; `g < 0 → 1 + 0.15·g` (boost up to +10% in stable regimes, damp up to −15% in fast ones).
- **flowMod** (UW): `1 + 0.15·f`, symmetric ±15%.

**Labels:** Strong ≥ 0.70 / Moderate ≥ 0.50 / Neutral ≥ 0.30 / Weak < 0.30.

**Judgment:** UW modifiers are deliberately **capped tighter than the core** (±10–15%) — flow/gamma are "confirmation/extra fuel," never the driver. They are null-safe no-ops until UW data exists, so the score is byte-identical to the pre-UW `scannerScore` without it.

**Earnings overlay** (`entryEarningsRisk`, kept *separate* from the per-ticker score because the score has no expiry): flags earnings landing between today and a given expiry.

**Review questions:** (1) `min(iv/1.50, 1.0)` caps the raw-IV term at 150% IV — reasonable ceiling? (2) Are the trend modifiers (esp. 0.70 downtrend) the right size relative to a 0.50/0.50 base? (3) Is co-equal 1a/1b weighting right, or should structure outweigh IV rank?

---

## Spec D — Assignment defense (UW Consumer 2)

**Decision:** "close/roll this CSP before a foreseeable gap" — a *leading* warning layered over the existing price-cushion (a lagging signal).

**Mechanism:** collect weighted **factors**, sort by severity, escalate:
```
any high factor      → level = high
≥ 2 factors          → elevated
exactly 1 factor     → watch
none                 → none
```

**Factors & thresholds:**
| Factor | Condition | Severity |
|---|---|---|
| Earnings — strike inside expected move | earnings before expiry, `strike ≥ spot·(1 − EM%/100)` | **high** |
| Earnings — strike outside expected move | earnings before expiry, strike below the expected downside | **low** (Ryan's preferred setup) |
| Earnings — no expected-move data | earnings ≤ 14d before expiry → high; else med | high / med |
| Price cushion breached | cushion_state = `assignment_risk` | high |
| Price approaching strike | cushion_state = `approaching` | med |
| Bearish institutional flow | flowSentiment ≤ **−0.20** | med |
| Choppy gamma regime | gammaEnv ≤ **−0.10** | low |
| High short interest | shortInterestPct ≥ **20%** of float | med |

**Data sources:** earnings expected-move and short interest from UW (`/earnings`, `/shorts/.../interest-float`); flow & gamma from UW flow/greek endpoints; earnings date and cushion already owned.

**Review questions:** (1) Is the expected-move "strike inside the implied downside" the right gate, vs a fraction of the move (e.g. strike inside 0.5×EM)? (2) Is 20% short-interest-of-float the right "crowded/fragile" line for your universe? (3) Should two med factors (elevated) ever auto-escalate to high?

---

## Spec E — GEX / strike walls (UW Consumer 3)

**Decision:** strike placement + pin/acceleration awareness — "is this a stable name to sell into, and where are the dealer-hedging walls relative to my strike?"

**Math (per-strike dealer gamma, from `/greek-exposure/strike`):**
```
netGammaAtStrike = call_gex + put_gex          (UW signs put_gex negative)
gammaRatio       = Σ netGamma / Σ |netGamma|   ∈ [−1, 1]
```
**Environment:**
- `gammaRatio > +0.05` → **stabilized** (dealers long gamma → buy dips/sell rips → CSP-friendly chop)
- `gammaRatio < −0.05` → **choppy** (dealers short gamma → amplify moves → caution)
- else → **neutral**

**Walls (Ryan's framing):**
- **resistance** = dominant *positive*-gamma strike **above** spot (a ceiling / pin)
- **support** = dominant *negative*-gamma strike **below** spot (acceleration zone — a break there can speed up)

**Surfaces:** Open Positions expanded row (env chip + resistance/strike/support in price order); Radar compact-row chip (loud on choppy, subtle on stable, hidden on neutral) + an expanded GEX section that flags when a sample CSP strike sits in the negative-gamma acceleration zone.

**Default posture:** sell CSPs in positive-gamma (stabilized) names.

**Review questions:** (1) Is the ±0.05 net-gamma deadband the right neutral band, or too tight (flip-flop risk)? (2) Support is defined as the *most-negative* gamma bar below spot (acceleration), per Ryan — but classic "put-wall support" is sometimes the *largest put-gamma* bar. Is the acceleration-zone framing the one you want for CSP placement? (3) Max-pain (pin level) was intentionally **deferred** — it needs OI-by-strike, which this endpoint doesn't carry. Worth sourcing separately?

---

## Spec F — Flow conviction veto (UW Consumer 4)

**Decision:** triangulate the redeploy signal with institutional flow — "don't churn out of a winner smart money is still pushing, and shed earlier when flow turns against you." (Jefferson's "close early *unless* big money is piling in.")

**Math:** pure overlay on the redeploy state; **never mutates the ratio**.
```
bullish = flowSentiment ≥ +0.20
bearish = flowSentiment ≤ −0.20
```
| Redeploy base | Flow | → Recommendation |
|---|---|---|
| `redeploy` (close-trigger fired) | bullish | **let_it_ride** (hold the winner) |
| `watch` | bullish | **hold** |
| `hold` or `watch` | bearish | **shed** (close/roll earlier than premium math says) |
| anything | neutral | base stands |

**Review questions:** (1) Are ±0.20 the right conviction cut-points? (2) Should "let it ride" require *repeat* flow (Ryan's smoothing) rather than a single reading, to avoid one-print head-fakes?

---

## Spec G — Whale CSP flow (UW Consumer 5)

**Decision:** idea generation + strike confirmation — "where are institutions selling puts right now → candidate CSP entries, and is the strike I'm eyeing being validated by size?"

**Filter (Ryan's "CSP whale flow" screen):** bid-side puts, ≥ **$50k** premium, **DTE 7–65**, **OTM only** (`(underlying − strike)/underlying > 0`), sweeps+crosses+normal.

**Flow sentiment** (per ticker, [−1, 1]):
```
bullish = puts SOLD (bid-side prem) + calls BOUGHT (ask-side prem)
bearish = puts BOUGHT (ask)         + calls SOLD (bid)
flow_sentiment = (bullish − bearish) / (bullish + bearish)
```

**Ranking:** aggregate to one row per ticker (total premium, trade count, dominant strike, DTE range). A row is a **candidate** when `entryScore ∈ {Strong, Moderate}` **AND** `flow_sentiment > 0.20` — i.e. good setup *and* bullish institutional put-selling. **Candidates sort first, then by total put-sell premium.**

**Review questions:** (1) Does the $50k floor / 7–65 DTE window match how you actually sell? (2) Should "dominant strike" weight recency, not just summed premium?

---

## Spec H — Earnings-date pipeline migration (data quality)

**Change:** `quotes.earnings_date` is now sourced **directly from UW** (`/earnings/{ticker}`) for the whole approved universe, replacing the Finnhub-via-OpenClaw push (a residential-IP detour that only existed because Vercel was network-blocked from Finnhub). Coverage went from ~33/55 tickers to full universe; the external dependency is retired.

**Parsing notes (verified against live data):**
- `expected_move_perc` is a **decimal fraction** ("0.122" = 12.2%) → ×100.
- Short interest uses **`percent_returned`** ("2.16" = already a percent of float), *not* the raw share-count fields — verified `si_float_returned (shares, thousands) ÷ total_float_returned` reproduces it.

**Review questions:** none financial — this is a data-sourcing change. Flagged only so the reviewer knows earnings dates now have full coverage feeding Specs C/D.

---

## Appendix — All tunable thresholds (single-pass review)

| Signal | Parameter | Value | Rationale |
|---|---|---|---|
| Redeploy | CLOSE_THRESHOLD | 0.50 | leftover < ½ a fresh trade → redeploy |
| Redeploy | WATCH_THRESHOLD | 0.80 | approaching the close line |
| Entry score | IV-rank weight | 0.60 of compositeIv | statistical richness |
| Entry score | raw-IV weight / cap | 0.40, capped at IV 150% | absolute premium |
| Entry score | base structure/richness | 0.50 / 0.50 | co-equal 1a/1b |
| Entry score | trend mods | 1.00 / 0.90 / 0.85 / 0.70 | up/pullback/recovering/down |
| Entry score | gammaEnvMod | +10% (stable) / −15% (fast) | confirmation cap |
| Entry score | flowMod | ±15% | confirmation cap |
| Entry score | labels | 0.70 / 0.50 / 0.30 | Strong/Moderate/Neutral |
| Assignment | earnings-soon window | ≤ 14 days | high vs med |
| Assignment | bearish flow | ≤ −0.20 | med factor |
| Assignment | choppy gamma | ≤ −0.10 | low factor |
| Assignment | high short interest | ≥ 20% float | med factor |
| GEX | env deadband | ±0.05 net-gamma ratio | stable/choppy/neutral |
| Flow veto (C4) | bullish / bearish | +0.20 / −0.20 | conviction cut-points |
| Whale flow (C5) | min premium | $50,000 | institutional size |
| Whale flow (C5) | DTE window | 7–65 days | CSP-shaped trades |
| Whale flow (C5) | candidate flow | > 0.20 + score ≥ Moderate | prime entries |

## Open cross-cutting questions

1. **Smoothing / repeat-activity:** Ryan's playbook treats flow as meaningful only on *repeat* activity, not one-offs. Flow currently reads the latest snapshot. Should a multi-session look-back be required before a flow-driven recommendation fires?
2. **Refresh cadence vs noise:** flow/gamma refresh intraday (every 15 min), GEX 2×/day, short-interest/earnings 2×/day, earnings dates daily. Are these cadences appropriate to the signal half-lives?
3. **Decision attribution:** the spec's own bar is "every signal must change a decision or it's cut." Recommend tracking, over the next N weeks, which signals actually flipped a hold/close/entry call — and pruning the ones that don't.
