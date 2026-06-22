# UW Signal Integration — Review Response & Status

**Date:** 2026-06-21
**From:** engineering
**Re:** your review of the 2026-06-20 packet (Specs A–H + cross-cutting)
**App:** 1.138 → **1.149.0**

Every item you raised is delivered. This closes the loop, flags the few places I
refined or diverged from your recommendation (with reasoning), and makes the
case for the ending posture: **let it run.**

---

## Disposition of your review

| Your item | What shipped | Notes |
|---|---|---|
| **E — "support" backwards** (headline) | Split into three walls: `support` = dominant **positive**-gamma below spot (defended floor), `air_pocket` = **negative**-gamma below spot (relabelled "avoid"), `resistance` unchanged. Added `describeStrikeVsGex` (danger-first read). | See divergence #4 — added the shelf rather than flipping the label. |
| **B — redeploy vs hard rules** | Hard-rule precedence: when a take-profit tier (`PROFIT_TIERS` 50/60/80) or cushion breach fires, the overlay returns `rule_close`; the ratio can no longer display "hold". | Reframed — see divergence #1. |
| **F — `let_it_ride` is the dangerous override** | `let_it_ride` (a) cannot override a hard rule, and (b) requires **confirmed** bullish flow. `shed` kept single-direction. | Operationalised as the asymmetric gate — divergence #3. |
| **G — candidate engine has no Ryan gate** | `★` now requires **Strong** score + **≥2** institutional prints + **confirmed** bullish flow. Relabelled "prime candidate" → "whale-confirmed setup"; explicit "confirmation, not a buy signal — checklist + VIX target first." | Kept idea-gen purpose; gated it — divergence #5. |
| **D — short interest cuts both ways** | High SI no longer fires alone; only with **co-occurring bearish flow**. | Done as you suggested (co-occurrence over demotion-to-entry). |
| **A — per-deployed-$ temptation** | Tooltip: "per-deployed-dollar yield for comparing names; NOT a deploy-more signal; read against the leverage ceiling." | No portfolio-level net-of-idle headline added, per your warning. |
| **C — ivTrendMod undefined; multiplicative asymmetry; "Strong ≠ authorization"** | Documented ivTrendMod (rising 1.10 / stable 1.00 / falling·collapsing 0.90 / spiking 0.85); added Radar note "score ranks attractiveness, not deploy authorization." | Additive-then-clamp **not** done — see divergence #6. |
| **E — deadband too tight** | Hysteresis: enter ±0.10, hold until ±0.05; cron passes prior env through. | Did hysteresis (your preferred option) over a flat widen. |
| **E — max pain** | **Built**, not deferred. `/stock/{t}/max-pain` exists in API Basic; per-expiry pin level shown on held CSPs, coloured by pin-vs-strike. | See divergence #7. |
| **Cross-cutting #1 — enforce repeat flow** | `flowSmoothing.js`: intraday EMA + daily-close streak. "Confirmed" = EMA in-direction AND streak ≥ 2 days. | Hard requirement now, not optional. |
| **Cross-cutting #2 — cadence** | Unchanged (you were fine with it). Noted the "don't let 15-min refresh become a reason to watch intraday" point. | — |
| **Cross-cutting #3 — instrument attribution** | `signal_log` table + write path (logs each open CSP's recommendations daily) + a lightweight read panel. **Scoreboard (outcome attribution) intentionally pending data.** | See "let it run." |

---

## Where I refined or diverged from your call (and why)

1. **B is a precedence bug, not a math bug.** The redeploy ratio correctly answers a narrow question (yield-velocity of leftover premium vs a fresh trade). It was *mis-prioritised on screen*, not miscalculated. So the fix suppresses the "hold" **display** when a hard rule fires, rather than rewriting the ratio or DTE-scaling its threshold (a magic curve is harder to audit than a clean override). Same outcome you wanted; cleaner mechanism.

2. **One principle drove most of the fixes:** encode the **discipline hierarchy** in code — Ryan-first → hard rules → soft yield signals → flow *confirmation* — instead of presenting parallel signals the trader reconciles by willpower at the tempting moment. Nearly every item was an instance of "make precedence explicit," not "add/retune a signal."

3. **The flow gate is deliberately asymmetric**, which operationalises your "shed is safe, `let_it_ride` is dangerous":
   - **Pull-toward-risk** (`let_it_ride`, `★` candidacy) → **full confirmation** (EMA + multi-day streak). A single bullish print can't extend a hold or star a name.
   - **Push-toward-safety** (`shed`, assignment-defense bearish factor) → **EMA noise-removal only, no streak.** You're never blocked from de-risking; erring toward closing is the safe error.

4. **On E ("support"):** your mechanics are right *for CSP placement*, but the label also collided with Ryan's literal transcript ("negative-gamma bar below = support/acceleration") and the SpotGamma "put-wall = support" convention. Rather than flip the label, I **added** the positive-gamma shelf as the real `support` and **renamed** the negative level "air pocket (avoid)" — so both framings coexist and nothing silently inverts. Vinh confirmed this reading.

5. **G keeps its idea-gen purpose.** Collapsing it to "strike confirmation only" would have deleted the feature's intended use (it's Ryan's actual daily screen). Instead: tighten the gate (Strong + repeat prints + confirmed flow) and relabel away from buy-signal language. Ryan-first is now enforced by the tool, not willpower.

6. **C's multiplicative asymmetry: acknowledged, deprioritised.** Your math is right (worst ≈ −49%, best ≈ +27%), but the large, lopsided swing comes from `trendMod` (core, intended, pre-UW). The *UW* modifiers stay tightly capped at ±15%, so "extra fuel, never the driver" still holds for them. I did the cheap parts (docs + the attractiveness note) and left additive-then-clamp as an optional auditability nicety, not a correctness fix. **Flagging for your disagreement if you think the trend penalty itself should be bounded.**

7. **Max pain wasn't deferred** — you were right that a dedicated endpoint exists. Built it, scoped to **held tickers** (the per-ticker UW call would otherwise blow the cron's 60s timeout, and pin risk only matters on something you carry into expiry).

---

## Ending recommendation: let it run (≈ 3–4 weeks) before any further tuning

**Why now is the wrong time to keep building or re-tuning:**

- **The architecture is done; remaining value is empirical, not structural.** Every fix that encodes judgment (precedence, gates, the asymmetric flow split) is in. What's left — thresholds (streak N=2, the ±0.05/0.10 hysteresis, 20% short-interest, the 0.50 redeploy line) — can only be calibrated against *observed behaviour*, not re-derived in the abstract. Tuning them now would be overfitting to zero data.

- **Your cross-cutting #3 is the gate, and it needs to accrue.** The decision-attribution **scoreboard** — "which signals actually flipped a hold/close/entry, and did following them help" — is the mechanism that decides what earns its keep vs. gets cut. It is *uncomputable* until there's closed-position history alongside the logged signal states. The logger is live as of 1.149; the scoreboard is a follow-on once there's ~a month of data. Building it sooner produces a chart of noise.

- **This is the spec's own bar.** "Every signal must change a decision or it's cut." That can only be adjudicated by living with it. Shipping more signal surface before validating the current set would re-introduce exactly the complexity-for-its-own-sake risk your review flagged.

- **The drift-risk surface is already leashed.** The two override paths you were most worried about (`let_it_ride`, `★`) now require multi-day confirmation *and* yield to hard rules. So "let it run" isn't "let it run unguarded" — the dangerous directions are gated; we're observing, not exposed.

**What to watch during the run (low effort):**
- The new **Signal log** panel — does any flagged state (`rule: close`, `let_it_ride`, `shed`, elevated/high risk) fire noisily or feel wrong?
- Whether `★` candidacy ever lights up (with the Strong + repeat-trades + confirmed-flow gate it should be *rare* — if it never fires in a month, the gate may be too tight).
- Any threshold that subjectively misfires against a real position.

**Then:** build the scoreboard against real data, review it together, and prune. That review — not this one — is where we decide what to cut.

---

## Open questions for you

1. **Scoreboard metrics:** when we build it, what's the minimal set that would let you call a signal "earned its keep"? (My starting proposal: per signal — # times it fired, # times it diverged from the action taken, and realized P&L delta on divergence vs. follow.)
2. **Streak N = 2 days** for confirmed flow — reasonable starting bar, or would you start stricter (3) given the deployment-pull concern?
3. **C's trend penalty:** leave the multiplicative stack as-is (UW mods capped, trend core), or do you want the *total* modifier swing bounded for auditability?

---

## Addendum — response reviewed, sharpenings shipped (2026-06-21, → 1.150.0)

Finance review **endorsed "let it run"** ("the right call regardless of how the next 3–4 weeks turn out … for you specifically, the urge to keep refining is the drift pattern wearing a productive mask"). Three sharpenings + answers to the open questions came back; all code-level points are now shipped in **1.150.0**.

**Sharpenings → what shipped:**

1. **Extend the asymmetry to the observation period.** Pull-toward-risk signals must be *observe-only* during the run, or "let it run" becomes a backdoor to acting on unvalidated machinery and contaminating the data.
   → `let_it_ride` now renders as a dashed "watch" chip + "observe-only; don't hold past your plan on its say-so" note; whale `★` footer states observe-only until the scoreboard validates it. Both keep firing/logging. Defensive signals (assignment, GEX, max-pain, `shed`) stay action-usable now.

2. **Distinguish a tuning question from a safety misfire.** A threshold that *feels* off vs a real position = data, log it, wait. A *gated override path behaving wrong* on a live position (e.g. `let_it_ride` holds past a hard rule; `★` fires and the deployment pull is felt) = a real-money event, fix immediately. "Let it run" ≠ "don't look until day 28."
   → Operating guidance for the run (no code); recorded here.

3. **Build the scoreboard scaffold now, not as a week-4 follow-on** — else week 4 becomes "spend two weeks building, then start reading," pushing the prune to week 6+.
   → `src/lib/signalScoreboard.js` + a summary strip in the Signal log panel. Computes what the log alone supports today (per-signal frequency; lead drift metric = **days held past a `rule: close`**). Noisy on thin data by design; flips on as data accrues.

**Answers to the open questions:**

- **Q1 — metrics.** Lead metric is **decision-divergence rate vs the Ryan-first baseline**, not P&L: a signal that never diverges from what the rules already say is *redundant and gets cut even if perfectly accurate*. P&L delta is secondary/noisy over a short window. Add **state-accuracy** for descriptive signals (did "choppy" realize higher vol; did "assignment risk" precede breaches — a process measure on untouched positions), and a **separate entry paper-track** (counterfactual for ideas not taken, kept distinct from live P&L). → This is the spec the full scoreboard will be built against.
- **Q2 — streak N.** Start at **N=3** on the pull-toward-risk side (erring away from pulling toward risk is the safe error). Log raw streak length so N=2/3/4 can be backtested from the log — strict live, flexible in analysis. → **Shipped: STREAK_MIN = 3**; `flow_streak` persisted in `uw_signals` + `signal_log`.
- **Q3 — trend penalty.** **Leave it.** A downtrend *should* dominate the score (selling puts into a falling knife is the PLTR-below-cost trap); multiplicative compounding of independent bad signs is correct. Auditability is handled by logging per-modifier contributions. → No change; per-modifier breakdown already shown in `ScannerScoreFormula`.

**Confirmed (no code):** `PROFIT_TIERS` (50/60/80) is DTE-conditional on DTE-% remaining, so `hardClose` is not a flat profit ladder firing at the wrong tier.

**State:** build complete; pull-toward-risk signals observe-only; defensive signals live; scoreboard scaffold in place. Next artifact is the **data-driven scoreboard review (~week 4)** — that review, not this one, decides what gets cut.

---

## Addendum 2 — CCJ flow investigation (2026-06-22, → 1.152.1)

First live scoreboard data point, on a real position (CCJ 107p, 4 DTE). The app's flow read (`flow_ema` ≈ −0.49, bearish) contradicted an independent UW-tape pull (+0.34 bullish). Investigated end to end.

**Diagnosis — it's a definition gap, not staleness or a sign bug.**
- The stored `flow_sentiment` was **fresh** (cron ran 10 min prior) and the formula (`flowSentimentFromAlerts`) is **correct** — so it's not stale and not inverted. (An interim "+0.49, app is buggy" claim was wrong — it came from a stale UW MCP response that returned nothing past 06-18 on a trading day. Corrected.)
- Our `flow_sentiment` is computed over UW's **flow-alerts subset** (curated "unusual" prints). Today that subset skews **bearish** (near-money, near-term put-*buying* — genuine downside hedging). The **full tape** (finance Claude / UW aggregate buckets) is **bullish** — dominated by big far-OTM put-*sales* (yield harvesting). Same day, opposite signs, because they're **different populations**. A single signed number flattens a two-sided tape.

**The deeper finding (finance review) — one scalar serving three consumers that want different definitions:**
- **Assignment defense (D) + `shed`** want "is someone positioning for a near-term move against my short put" → the **alert subset** (near-money/near-term) is arguably the *right* source.
- **Whale candidacy (G)** is Ryan's screen (bid-side puts ≥$50k, 7–65 DTE, OTM) → the **bid-side put-selling tape** (bullish-leaning).
- **`let_it_ride` (F-pull)** wants net conviction → closer to the **full tape**.
- Collapsing these into one `flow_sentiment` scalar is the original sin. **This is a week-4 definitional call — parked, not built now** (redefining three ways today is exactly the build-more energy we agreed to stop).

**Done now (instrumentation, not building):**
1. **Log both flow readings side by side** — `signal_log` gains `flow_alert` (alert-subset value the app uses) and `flow_tape` (full-tape value). Same principle as logging raw streak length: capture both during the window so week-4 adjudicates from data, not guesswork. (`flow_tape` is null until the snapshot cron sources it — queued on UW MCP, see below.)
2. **Fixed a real logger bug the investigation surfaced:** `signal_log` was recording **pre-load snapshots** (null gex/flow, assignment "none") because it logged on first render before quotes/UW signals loaded, then the once-per-day flag locked the garbage in. CCJ's 06-21/06-22 rows were all null despite the live panel showing HIGH/shed/choppy. Now gated on `quotes + UW signals loaded` before logging — so the scoreboard captures the real rendered state. **(Without this, the entire week-4 review would have been built on null data.)**

**Queued on the UW MCP (it keeps disconnecting):**
- **Definitive check:** `get_flow_alerts` + `get_flow_per_strike` read against the DB at the same instant — isolates alert-subset (−0.49) vs full-tape (+0.34) with no stale-data noise.
- **Source `flow_tape`:** once the per-strike/aggregate endpoint shape is confirmed, compute the full-tape value in `uw-snapshot` → `uw_signals.flow_tape` → flows into the log automatically.

**Cautions carried forward:**
- "Working as designed → −0.49 is a *real* read" is true as a *measurement* but does **not** make it a useful *signal*. A narrow alert read can be real and still predict nothing. The scoreboard decides; "working as designed" must not smuggle in "therefore keep it."
- CCJ decision unchanged: **close/roll on assignment mechanics** (pinned at strike, max pain 106 below, negative gamma), not flow. Flow gave a contestable read; defensive signals held — the observe-only/defensive-trustworthy split, vindicated on day one.
