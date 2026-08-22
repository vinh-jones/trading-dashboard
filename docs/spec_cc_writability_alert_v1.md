# Spec — Covered-Call Writability Alert (v1)

**Status:** proposed, 2026-08-22 · cadence **intraday** · gate **30% annualized RoR at the basis
strike**, no delta floor, no IV-rank gate
**For:** Claude Code

Surface the moment an uncovered assigned position becomes writable at or above gross basis, at
a rate worth doing — and put it in front of Vinh unprompted, **with the full strike ladder**, so
the choice between renting the position and exiting it well is visible in one place.

---

## Why

The CSP side already has a cushion monitor: `cushion_trigger_amber`, `cushion_trigger_red`,
`cushion_state`, computed per position and surfaced in every snapshot. **The covered-call side
has no counterpart.** Uncovered assigned shares sit silently until someone happens to look.

Five positions sat uncovered through most of August — roughly **$182,900 of share capital
earning nothing** — not because writing was a bad idea but because nobody was watching for the
moment it became a good one.

> ### Four mistakes this must not make
>
> **1. It is not a price alert.** The same price with collapsed IV is not writable. The three
> uncovered names need wildly different moves to reach the same condition, and the spread comes
> from their volatility, not their distance to basis.
>
> **2. It cannot assume one tenor.** The qualifying spot varies by DTE — and *not
> monotonically* (§2.2), and the shape inverts around an event (§2.2a).
>
> **3. It cannot gate on delta.** Delta is a human shortcut for "is this worth writing" because
> annualized RoR is hard to do in your head. Software has no such constraint. Gating on delta
> demonstrably rejects good trades (§2.3).
>
> **4. It cannot report only the basis strike.** A call struck at gross basis captures the
> highest premium rate on the board and **exactly zero appreciation** (§3.2). Reporting that
> rung alone hides the trade Vinh most wants to see.

---

## 1. Scope

Every position in `positions` where the share position is open **and** `has_active_cc` is false.
Currently CLS, IREN, KTOS. Derive per run — the set changes whenever a call is written or
expires.

---

## 2. The trigger

For each in-scope ticker:

1. **`K_basis` = the lowest listed strike ≥ gross basis.** Gross basis is the assignment price,
   not net of premium. Blend multi-lot positions on capital fronted: IREN is 400 @ $55 + 400 @
   $45 = $40,000 / 800 = **$50.00**. CLS → $350, IREN → $50, KTOS → $75.
2. **Evaluate a DTE ladder** at `K_basis`: nearest listed expiry to each of **7, 14, 21, 28, 35,
   45, 60**.
3. Per rung compute delta, premium, RoR, and **annualized RoR** against gross basis.
4. A rung **qualifies** when:

```
annualized_ror >= ROR_ANN_MIN        (default 30)      -- evaluated at K_basis ONLY
```

That is the entire gate. One number, one strike.

**The strike ladder above `K_basis` is reported, never gated (§3.2).** Premium falls
monotonically with strike, so `K_basis` carries the highest annualized RoR on the board — gating
there is the *loosest* possible version of the test. If `K_basis` fails, every strike above it
fails harder, and the whole board is too thin to bother with.

### 2.1 Why annualized RoR alone

Backtested against all 49 covered calls opened since 2026-05-01:

| Configuration | Passes | Premium captured |
|---|---|---|
| **30% annualized** | **21/49** | **$18,173 (69.5%)** |
| 35% annualized | 19/49 | $17,160 (65.7%) |
| 30% + per-tenor delta floors | 17/49 | $15,221 (58.2%) |

Only **two trades** sit between the 30% and 35% bars — CLS $350 (32.4%) and CCJ $118 (31.8%),
$1,013 combined. The choice between them is immaterial; 30 is the default.

**The 30% gate rejects every losing covered call in the book**, all four: SOFI $17.50
(−$1,716), PLTR $175 (−$2,410), HOOD $110 (−$176), KTOS $70 (−$16). It also rejects the LRCX
$8 write, which was a deliberate uncap rather than a premium trade.

### 2.2 The ladder is not monotone — this is why all rungs must be evaluated

Spot required to reach 30% annualized at `K_basis`, by rung, **holding IV flat across the term**:

| | 7d | 14d | 21d | 28d | **35d** | 45d | 60d |
|---|---|---|---|---|---|---|---|
| CLS | $318.59 | $313.46 | $311.10 | $309.96 | **$309.54** | $309.69 | $310.93 |
| KTOS | $68.37 | $67.29 | $66.79 | $66.55 | **$66.46** | $66.49 | $66.75 |
| IREN | $41.75 | $40.13 | $39.22 | $38.63 | $38.23 | $37.86 | **$37.57** |

A shallow **U**, easiest around 28–45 DTE. The 7-day rung needs the stock roughly **3% higher**
than the 28–35 rung.

Consequences:

- **Under a flat term structure, implication runs one way only.** If the 7d rung qualifies,
  14–60 already do. The converse is false.
- **The first alert on any position fires at 28–35 DTE** — *absent an event.*
- **The shortest qualifying rung is a recovery-progress indicator.**

The apparent paradox, both halves true: at a *fixed spot far below the strike*, longer DTE is
better — short-dated options have no time to matter. At a *fixed delta*, shorter DTE is better,
same moneyness with faster turnover. Different points in a recovery, not a contradiction.

### 2.2a The U inverts when an event sits in the front week — ⚠ verified against a live chain

**The table above is a flat-IV artifact.** Around an earnings print the front week is the
richest vol on the board, the ladder is **monotone decreasing** in DTE, and the *shortest* rung
is the best rate — the exact opposite of §2.2.

IREN $50 calls, real chain, **2026-08-21 close**, spot **$41.875**, earnings **8/27 pm**
(verified) — the print lands inside the front week:

| Expiry | DTE | Mid | IV | Δ | Ann. RoR |
|---|---|---|---|---|---|
| 8/28 | 7 | $0.730 | **140%** | 0.19 | **76.1%** |
| 9/04 | 14 | $1.280 | 119% | 0.25 | 66.7% |
| 9/18 | 28 | $2.180 | 105% | 0.32 | 56.8% |
| 10/16 | 56 | $3.700 | 98% | 0.40 | 48.2% |
| 12/18 | 119 | $6.825 | 99% | 0.50 | 41.9% |
| 6/17/27 | 300 | $12.350 | 98% | 0.61 | 30.1% |

§2.2 modeled IREN's 7d rung at **31.4%**. The chain says **76.1%** — a 45-point error, entirely
from using one stored IV for every rung.

**Decay is much slower than 1/√T** because `K_basis` is 19% OTM: extending pulls the strike
toward the money and the option gains value faster than √T until delta reaches ~0.5 (12/18,
119 DTE), after which √T reasserts (300d→756d ratio 0.658 vs √T's 0.630).

**Where the gate stops binding:** 50% annualized at ~47 DTE, **30% at ~302 DTE**. Every listed
expiry out to ten months clears the gate. For a ~100% IV name the gate is not a filter — it is
satisfied everywhere, and `best_rate_rung` carries all the information.

**Strip the event and the picture reverses.** Two-point variance decomposition off the 7d/14d
pair: base IV **92.9%**, implied event move **±14.5%** ($35.79 / $47.96). Re-priced at base IV
the 7d rung is worth ~$0.19–0.23 against a $0.730 mid — **more than half that premium is the
print**, and ex-event the rung pays ~20–24% annualized, which **fails the gate**.

**Implementation consequences, all mandatory:**

1. **Per-expiry IV, never a single ticker-level IV.**
2. **`shortest_qualifying_rung` and `best_rate_rung` can be the same rung.**
3. **The "first alert fires at 28–35 DTE" expectation does not hold near an event.**
4. **Carry `event_move_implied` in the payload** when an event sits in the window, so the
   event-driven share of the rate is visible rather than mistaken for base richness.

### 2.3 Why no delta floor

An earlier draft proposed per-tenor delta floors. **Backtesting killed them.** Adding floors
drops 21 qualifying trades to 17 and costs $2,952, and what it rejects is not junk:

| | DTE | Δ | Premium | Ann | Outcome |
|---|---|---|---|---|---|
| **COHR $300 · 7/30** | 15 | 0.23 | **$1,460** | 72.3% | **assigned, 100% kept** |
| CDE $21 · 5/28 | 15 | 0.24 | $680 | 44.3% | 87% kept |
| IREN $50 · 8/07 | 14 | 0.20 | $616 | 48.8% | 92% kept |

A 0.25 floor at 10–16 DTE rejects a 72%-annualized write that got assigned at full premium and
cleared the position.

**The floors were meant to exclude a cluster of sub-0.15-delta writes. Those were not junk
either** — PLTR $152.50 against a $175+ basis, HOOD $85, SOFI $17.50 — they were **below-basis
covered calls, written with the deliberate intent of *not* being assigned.** Opposite
instrument, opposite intent, **out of scope entirely** (§6). There is nothing left for a delta
floor to catch.

Report delta in the payload as information. Never gate on it.

### 2.4 Two tiers

| Tier | Condition | Behavior |
|---|---|---|
| **AMBER** | spot within **5%** of qualifying at `K_basis` on any rung | dashboard state only |
| **RED** | at least one rung qualifies at `K_basis` | dashboard **+ push** |

### 2.5 Computing without pulling chains

Do **not** pull an option chain per ticker per run — expensive, and Unusual Whales calls must
run sequentially with retry-on-abort, never parallel-batched.

Approximate with Black-Scholes from `quotes`: spot, strike, DTE, IV. Mark delta and premium as
modeled (`priced_from: 'model'`).

**⚠ The IV input must be per-expiry.** §2.2a is the proof: a single stored IV mispriced IREN's
7d rung by 45 annualized points. If per-expiry IV is not available, pull the term structure once
daily (not per run) and interpolate, or **pull the real chain for any ticker already in AMBER**
— the in-scope set is 3–5 tickers, a bounded cost, and precision only matters near the boundary.

**Never approximate a rung whose window contains an earnings date, and never approximate the
strike ladder** (§3.2) — model error compounds badly on far-OTM strikes. Either use the real
chain or report those as unpriced.

---

## 3. Payload

### 3.1 Per-rung, at `K_basis`

```
ticker · gross_basis · spot · K_basis · shares · contracts

per rung (7/14/21/28/35/45/60):
  expiry · dte · delta · premium · ror_pct · ror_annualized · iv · qualifies
  bid · ask · spread_pct · open_interest · illiquid
  priced_from: 'chain' | 'model'

best_rate_rung · shortest_qualifying_rung
iv · iv_rank · iv_rank_pctile_90d      <- SHADOW ONLY, see §8
bb_position
earnings_date · earnings_before_expiry (per rung) · event_move_implied
```

`bb_position` is not decoration. CCJ was written 8/21 at bb 0.91 near its band top — good
timing. CLS was deliberately *not* written at bb 0.10 near its band bottom, because that sells
cheap upside exactly where a bounce is most likely.

### 3.2 The strike ladder — report, never gate

**This is the section that exists because the basis strike hides the trade.**

A call struck at `K_basis` collects the highest rate on the board and returns **exactly zero
appreciation** — assignment at gross basis is flat on the shares. On a position underwater and
being worked toward an exit, that is the wrong-shaped outcome, and reporting only that rung
makes it invisible.

For each qualifying tenor, also report **`K_basis` plus the next 4 listed strikes** (strike
increments vary — IREN is $5 above $50; take listed strikes, not fixed offsets):

```
per strike:
  strike · mid · bid · ask · spread_pct · open_interest · illiquid
  delta                       <- P(finish ITM)
  premium                     <- mid x 100 x contracts
  ror_annualized              <- premium rate vs gross basis; informational above K_basis
  gain_if_assigned            <- (strike - gross_basis) x shares
  total_if_assigned           <- gain_if_assigned + premium
  return_on_capital_pct       <- total_if_assigned / (gross_basis x shares)
```

**Live example — IREN 8/21 close, spot $41.875, basis $50.00, 800 sh:**

*8/28 · 7 DTE (contains the print)*

| K | Mid | Premium | Ann. RoR | Δ | Gain if assigned | Total | Spread |
|---|---|---|---|---|---|---|---|
| 50 | 0.730 | $584 | 76.1% | 0.19 | **$0** | $584 | 2.7% |
| 55 | 0.295 | $236 | 30.8% | 0.09 | $4,000 | $4,236 | 3.4% |
| 60 | 0.130 | $104 | 13.6% | 0.04 | $8,000 | $8,104 | 15.4% |
| 65 | 0.065 | $52 | 6.8% | 0.02 | $12,000 | $12,052 | **46%** |
| 70 | 0.040 | $32 | 4.2% | 0.01 | $16,000 | $16,032 | **50%** |

*9/18 · 28 DTE*

| K | Mid | Premium | Ann. RoR | Δ | Gain if assigned | Total | Spread | OI |
|---|---|---|---|---|---|---|---|---|
| 50 | 2.180 | $1,744 | 56.8% | 0.32 | **$0** | $1,744 | 2.8% | 29,108 |
| 55 | 1.340 | $1,072 | 34.9% | 0.22 | $4,000 | $5,072 | 9.0% | 10,419 |
| **60** | 0.855 | **$684** | 22.3% | 0.15 | $8,000 | **$8,684** | **5.8%** | 14,140 |
| 65 | 0.550 | $440 | 14.3% | 0.10 | $12,000 | $12,440 | 14.5% | 32,445 |

**P&L at 8/28 expiry vs the $50 gross basis, 800 shares:**

| Terminal | Uncovered | $50 CC | $55 CC | $60 CC |
|---|---|---|---|---|
| $42 | −$6,400 | −$5,816 | −$6,164 | −$6,296 |
| $50 | $0 | $584 | $236 | $104 |
| $53 | $2,400 | **$584** | $2,636 | $2,504 |
| $57 | $5,600 | **$584** | $4,236 | **$5,704** |
| $60 | $8,000 | **$584** | $4,236 | **$8,104** |
| $70 | $16,000 | **$584** | $4,236 | $8,104 |

**An out-of-the-money call strictly dominates holding uncovered at every price below its
strike, by exactly the premium**, and only caps above it. The $50 call pins the position at
$584 forever; at $57 that is a **$5,120** gap against the $60 write for $132 less premium.

### 3.3 Why the ladder is not gated

Two candidate second gates were considered and rejected:

- **"Total return if assigned ≥ X% annualized."** Degenerate. The 7d $60 rung annualizes to
  ~1000% *conditional on* a 4% probability event. Annualizing a conditional payoff is
  meaningless.
- **Expected value ranking.** Under risk-neutral pricing the expected return of a covered call
  is the risk-free rate **at every strike**. An EV ranking is flat by construction and would
  encode nothing but the model's drift assumption.

What actually distinguishes strikes is **preference about outcome shape**, not edge. That is
Vinh's call, not the alert's. The alert reports premium, P(assign), and payoff-if-assigned side
by side and stops. **Posture: a picture, not an instruction** (§6).

### 3.4 Liquidity is part of the alert, not a footnote

A qualifying rate on an untradeable strike is a false positive. IREN's own 8/21 ladder had two
of five DTE rungs at 15–21% spreads (9/11, 9/25 — the odd weeklies between monthlies) and the
7d $65/$70 strikes at **46% and 50%**, where a $52 premium nets ~$40.

**Rule:** compute annualized RoR from the mid, **report the bid-based rate alongside it**, and
mark any contract with spread > 10% of mid or OI < 500 as `illiquid: true`. **An illiquid
contract is never `best_rate_rung`, never the recommended strike, and never drives a push.**

**Push copy names the shortest qualifying rung and the best appreciation-preserving strike:**
`IREN writable — 28d, $50 $1,744 @ 56.8% ann · or $60 $684 @ Δ0.15 keeping $8,000 upside`

---

## 4. Anti-fatigue

An ignored alert is worse than none — it trains dismissal of the channel.

1. **Fire once per crossing.** After RED, do not re-fire until the condition goes false and
   true again.
2. **Minimum re-arm: 5 trading days**, even on a genuine re-cross.
3. **Do not re-fire when an additional rung or strike qualifies** while already RED.
4. **Suppress any rung whose expiry sits after an earnings date**, unless overridden per
   ticker. IREN is the live case: it qualifies at *every* rung today and is deliberately left
   uncovered through its 8/27 print. **Note the tension §2.2a exposes:** the reason the 7d rung
   pays 76% *is* the print. The suppression is a deliberate decision not to sell the event — the
   payload should still carry the number so the choice stays visible rather than hidden.
5. **Suppress when an order for that ticker was placed the same day.**

Use existing `alert_state` / `sent_alerts`. No parallel mechanism.

---

## 5. Cadence — intraday

On the existing `/api/alert-check` cron, market-hours window. RED pushes on crossing.

Moves that matter here reverse within the session: CDE printed **$21.88** on 8/21 and closed at
**$20.975**, a fully round-tripped intraday spike an EOD check would have missed.

**Floor: an end-of-day digest** listing everything currently AMBER or RED regardless of whether
it pushed, so a missed intraday push is recoverable that evening.

---

## 6. Out of scope for v1

- **Below-basis CCs.** Governed by `below_cost_cc_framework.md`. Opposite intent — collect
  premium while deliberately *not* capping a recovery — so a rate gate does not apply.
- **Strike recommendation.** The alert reports a condition and hands over numbers. The
  `cc-gex-decision` skill exists for the strike call, on request.
- **Auto-placement.** Never.

---

## 7. Acceptance fixture — IREN, real chain, 2026-08-21 close

**Measured, not modeled.** Spot **$41.875**, gross basis **$50.00**, **800 shares / 8
contracts**, **$40,000** capital, earnings **2026-08-27 pm**.

| Expiry | DTE | Bid | Mid | Ask | Prem (8c) | **Ann.** | Ann. (bid) | Δ | IV | OI | Liquid |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 8/28 | 7 | 0.72 | 0.730 | 0.74 | $584 | **76.1%** | 75.1% | 0.19 | 140% | 10,641 | ✓ |
| 9/04 | 14 | 1.24 | 1.280 | 1.32 | $1,024 | **66.7%** | 64.7% | 0.25 | 119% | 5,790 | ✓ |
| 9/11 | 21 | 1.60 | 1.785 | 1.97 | $1,428 | 62.0% | 55.6% | 0.29 | 111% | 1,159 | ✗ |
| 9/18 | 28 | 2.15 | 2.180 | 2.21 | $1,744 | **56.8%** | 56.1% | 0.32 | 105% | 29,108 | ✓ |
| 9/25 | 35 | 2.36 | 2.550 | 2.74 | $2,040 | 53.2% | 49.2% | 0.34 | 102% | 431 | ✗ |
| 10/02 | 42 | 2.62 | 2.935 | 3.25 | $2,348 | 51.0% | 45.5% | 0.36 | 100% | 564 | ✗ |
| 10/16 | 56 | 3.50 | 3.700 | 3.90 | $2,960 | 48.2% | 45.6% | 0.40 | 98% | 2,723 | ~ |

`best_rate_rung` = **7d** · `shortest_qualifying_rung` = **7d** · all rungs RED, **all
suppressed** (every expiry sits after 8/27). Strike ladder per §3.2.

**Load-bearing tests:**

1. **IREN qualifies at zero move while KTOS needs +16.2%** — the volatility term doing the work.
   Any implementation keyed on distance-to-basis gets this backwards.
2. **The ladder here is monotone *decreasing*** — 76.1% → 48.2%. An implementation carrying
   §2.2's U-shape as an assumption reports the wrong `best_rate_rung`.
3. **Two of seven rungs are illiquid** and must not be pushed on.
4. **A single stored IV reproduces none of this** — modeled flat, the 7d rung reads 31.4%.
5. **The $50 strike returns $0 of appreciation at every tenor.** An implementation that reports
   only `K_basis` passes every other test and still hides the decision.

---

## 8. IV rank — shadow instrumentation, NOT a gate

An `iv_rank >= 30` second gate was proposed and **rejected on evidence**. Log it; do not trigger
on it.

### 8.1 What the data showed

`iv_snapshots`, 61 tickers, 2026-07-23 → 2026-08-21. Cross-section at the latest capture:

| p10 | p25 | **median** | p75 | p90 | max |
|---|---|---|---|---|---|
| 12.8 | 17.2 | **27.4** | 37.6 | 46.1 | 71.4 |

IREN sits at **27.6** — the universe median. CLS at **19.2** — roughly p25. A ≥30 cut passes
28 of 61 names, a near-median slice, and would block **both** live candidates.

The time series is what kills it:

| Date | IREN | IREN IV | CLS | KTOS |
|---|---|---|---|---|
| 7/23 | 80.3 | 130% | 98.2 | 72.8 |
| 8/07 | 45.0 | 108% | 38.0 | 41.3 |
| 8/21 | 27.6 | 100% | 19.2 | 18.8 |

**Pairwise correlation of daily IV rank: IREN↔CLS 0.946 · IREN↔KTOS 0.961 · CLS↔KTOS 0.940.**

Three names, three sectors, one signal. This is a **market-wide vol decompression measured three
times**, not per-name option richness. Gating on it would switch the entire alert on in July and
off in August, for every ticker simultaneously — a regime filter in disguise. If a regime filter
is wanted, build it explicitly where it can be seen.

Three further objections:

1. **Extreme leverage.** IREN's IV fell 23% (130 → 100) while its rank fell **52.7 points** —
   ~2.3 rank points per 1% of IV. A metric that swings 70 points in a month will flicker across
   any fixed threshold, fighting §4 directly.
2. **It shuts off exactly when the alert is needed.** The clean writing window opens **8/28**,
   post-print, when IV crushes further and rank falls further. The gate would go silent through
   the one period it was built for.
3. **Zero backtest.** The RoR gate has 49 trades behind it. `iv_snapshots` begins 7/23 — 30 days
   — so an IV-rank gate would have none. Asymmetric evidence; do not ship the unmeasured one.

**One point in its favor, recorded honestly:** IREN failing on IV rank agrees with §2.2a — strip
the event and the 7d rung pays ~20–24%, below the gate anyway. Two independent measures reaching
the same verdict is weak confirmation of direction. Not enough to gate on.

### 8.2 What to build instead

1. **Log `iv` and `iv_rank` on every evaluation of every in-scope ticker** — not only on
   AMBER/RED. The non-firing baseline is what makes the eventual backtest possible.
2. **Also log `iv_rank_pctile_90d`** — the ticker's current rank as a percentile of its own
   trailing 90 days. This is immune to the market-wide drift that killed the absolute version
   and is the more likely survivor. Shadow only.
3. **Pre-register the hypothesis now, before the data exists:** *writes opened at
   `iv_rank_pctile_90d ≥ 0.67` retain a higher share of premium than those below.* Test it
   against ≥ 4 quarters of CC history, the same way §2.1 tested the RoR gate. Do not revise the
   hypothesis after seeing the data.
4. **Until then `iv_rank` is a payload field only.** It colors the read. It cannot suppress an
   alert or change a tier.

### 8.3 Open question — blocking for any future gate

**What lookback does the radar use to compute `iv_rank`?** 52 weeks is standard, but a
2.3-points-per-1%-IV sensitivity is consistent with a much shorter window, in which case a large
share of the July→August collapse is the window rolling off its own high rather than signal.
**Answer this from the app source before encoding `iv_rank` anywhere beyond shadow.**

---

## Acceptance

1. Scope derived per run; writing a CC removes the ticker automatically.
2. **The §7 IREN table reproduces from the live chain within roughly a percentage point** when
   fed spot $41.875 and the 8/21 close. Modeled numbers are not accepted for this test.
3. RED fires once, no re-fire for at least 5 trading days.
4. IREN suppressed while any qualifying rung crosses 8/27; un-suppresses after.
5. Payload is per-rung and carries `iv`, `iv_rank`, `bb_position`, `open_interest`,
   `spread_pct`, `illiquid`, `priced_from`, earnings fields, `event_move_implied`, plus both
   `best_rate_rung` and `shortest_qualifying_rung`.
6. **Annualized RoR at `K_basis` is the sole gate.** Verify by constructing a case where a 60
   DTE rung has higher absolute premium than a 14 DTE rung and confirming the 14 DTE rung is
   reported as best rate.
7. **No delta threshold anywhere in the trigger path.** Verify by inspection.
8. **No IV-rank threshold anywhere in the trigger path.** `iv_rank` is write-only to the payload
   and the shadow log. Verify by inspection.
9. **Per-expiry IV.** Verify by inspection that no code path applies one ticker-level IV across
   the ladder.
10. **The strike ladder reports `K_basis` plus the next 4 listed strikes**, with
    `gain_if_assigned` computed against gross basis. Verify `gain_if_assigned == 0` at
    `K_basis` — if it is nonzero, the basis is being confused with spot.
11. **An illiquid contract is never `best_rate_rung`, never recommended, never pushed on.**
12. **Shadow log writes on every evaluation**, including non-firing ones. Verify by row count
    against in-scope tickers x runs.
13. Nothing in the alert path can place an order. Verify by inspection.
