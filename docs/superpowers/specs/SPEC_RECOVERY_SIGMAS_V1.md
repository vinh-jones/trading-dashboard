# SPEC_RECOVERY_SIGMAS_V1.md
**Status:** Implemented (v1.121.0)
**Scope:** Backend addition to the `decision_framing` builder + a small render change in the framing panel / EOD text. Single-purpose. Does not touch cushion, snapshot cron, or any other endpoint.

---
## 1. Problem this fixes
The current `decision_framing[].days_to_breakeven` (and its `recovery_date` / `~N months` label) is a **constant-recovery-rate** estimate: time ≈ gap ÷ assumed-rate. Because the gap is a function of spot, the number is as volatile as the underlying and prints its **worst reading on the worst days** — i.e. it screams "7.5 months" on a red day and "4 months" two sessions later for the same position, purely from price noise. That misleads the EOD read and nudges reactive decisions at the exact moment judgment is most fragile.

It also ignores volatility entirely. A name needing +26% at 79% IV is genuinely close; a name needing +26% at 25% IV is genuinely far. The constant-rate model treats them identically.

**Fix:** express "distance to breakeven" in **horizon-scaled sigmas** and a **touch probability**, reusing the same per-name IV the cushion triggers already use. Display as a coarse band, not a false-precise number.

---
## 2. Definitions
For each `decision_framing` entry (assigned-share positions only):
- `S` = current spot (same source the panel already uses for drawdown — radar `last` / market price)
- `K` = breakeven = the blended cost basis the panel **already computes** for `framing_question` (reuse it; do not recompute). Underwater positions have `K > S`.
- `IV` = per-name implied vol. **Source priority:** the value the cushion calc used for this ticker (`cushion_iv_used` on any open CSP for the same ticker) → else radar `iv` → else `null`.
- `H` = horizon in **trading days** (config; see §4).
- `σ_H` = `IV × sqrt(H / 252)` — stdev of log-returns over the horizon (identical construction to the cushion `IV/√252` band, just scaled to H days instead of 1).

### Core formulas
```
b              = ln(K / S)                       // log-distance up to breakeven (>0 when underwater)
sigma_horizon  = IV * sqrt(H / 252)
recovery_sigmas = b / sigma_horizon              // how many horizon-sigmas away breakeven sits
touch_prob     = min(1, 2 * Phi(-recovery_sigmas))   // P(path touches K before horizon end)
```
`Phi` = standard normal CDF. `touch_prob` uses the **driftless reflection-principle** result for an upper barrier (`2·Φ(−d)`), which is the probability the path *touches* `K` at any point in `[0,H]` — the right question for a recovery/call-away, not terminal probability. Driftless keeps it consistent with the cushion band and avoids assuming an expected return; it is mildly optimistic (omits the −½σ² log-drift), which is acceptable for a relative gauge. Do **not** add drift in v1.

### Worked example (KTOS, from the 2026-06-03 snapshot)
```
S = 58.40, K = 73.50, IV = 0.787, H = 63 (≈ 3 months)
sigma_horizon  = 0.787 * sqrt(63/252) = 0.787 * 0.5      = 0.3935
b              = ln(73.50 / 58.40)    = ln(1.2586)        = 0.2300
recovery_sigmas = 0.2300 / 0.3935                          = 0.58
touch_prob      = 2 * Phi(-0.58) = 2 * (1 - 0.7190)        = 0.562  → ~56%
band            = Reachable
```
So the "Jan 2027 / 7.5 months" line becomes **"breakeven 0.6σ away over ~3mo, ~56% touch odds"** — a sub-one-sigma move, not a long shot. (A 25% IV name at the same +26% gap would be ~1.84σ / ~6% touch — correctly flagged "Distant.")

---
## 3. Output schema
Add a `recovery` object to each `decision_framing` entry. Keep `days_to_breakeven` in the JSON for continuity but **stop surfacing it** (see §5).
```jsonc
"recovery": {
  "breakeven": 73.50,
  "spot": 58.40,
  "iv_used": 0.787,
  "iv_source": "cushion",        // "cushion" | "radar" | null
  "horizon_trading_days": 63,
  "horizon_label": "~3mo",
  "sigma_horizon": 0.3935,
  "recovery_sigmas": 0.58,
  "touch_prob": 0.562,
  "reachability_band": "reachable",   // see §4
  "at_or_above_breakeven": false,
  // secondary — "called away THIS cycle?" using the active CC's DTE:
  "cc_dte": 15,
  "touch_prob_cc_cycle": 0.23
}
```
Add a top-level `recovery_missing_iv: []` array (list of tickers where IV was unavailable), mirroring the existing `data_completeness.cushion_missing_iv` pattern.

---
## 4. Config + bands
```
RECOVERY_HORIZON_TRADING_DAYS = 63     // ~3 months, primary strategic horizon. Tunable.
```
Compute the headline numbers at this horizon. Also compute `touch_prob_cc_cycle` at the active covered call's `days_to_expiry` (answers the per-expiry "does it get called away this cycle" question). If no active CC, omit `cc_dte` / `touch_prob_cc_cycle`.

**Reachability bands** (banded on `touch_prob` — intuitive and tunable; deliberately coarse so the panel reports a *state*, not a screaming decimal):

| touch_prob | band | meaning |
|---|---|---|
| ≥ 0.50 | `reachable` | breakeven is a normal move away over the horizon |
| 0.25 – 0.50 | `plausible` | gettable but not the base case |
| < 0.25 | `distant` | needs an outsized move; treat as a genuine hold-or-cut question |

---
## 5. Rendering changes
- **Framing panel / `framing_question`:** replace the `~N months` / `recovery_date` phrasing with band + sigma + odds. E.g.
  `KTOS · breakeven $73.50 · 0.6σ over ~3mo · Reachable (~56%) · this cycle ~23%`
  Keep the human-judgment prompt ("Do you think it gets there?") — the metric informs the call, it doesn't make it.
- **EOD text:** wherever the debrief currently pulls `days_to_breakeven`, pull `reachability_band` + `recovery_sigmas` instead. This is the line that's been causing the confusion in our reviews.
- `days_to_breakeven` / `recovery_date`: leave in JSON, remove from all rendered surfaces. (Demote, don't delete — easy to revert if you miss it.)

---
## 6. Edge cases
- **At/above breakeven** (`S ≥ K`, `b ≤ 0`): set `recovery_sigmas = 0`, `touch_prob = 1.0`, `at_or_above_breakeven = true`, band `reachable`. Don't feed a negative `b` into the formula.
- **Missing IV** (no cushion IV, no radar IV): set `recovery` numeric fields to `null`, `iv_source: null`, add ticker to `recovery_missing_iv`. Render "—" not a guess.
- **σ_H = 0 guard:** if `sigma_horizon == 0` (zero/absent IV), treat as missing IV — never divide by zero.
- **Ultra-high IV** (e.g. CRDO ~116%): `touch_prob` will read high because the breakeven genuinely *is* within a normal move for that vol. This is the model working, not a bug — do not clamp it down. The honest read is "high vol cuts both ways."

---
## 7. What this is / isn't (put this in the panel tooltip)
It **is** a relative reachability gauge: driftless, single-IV, no skew, no path-dependence. Good for "is breakeven a normal move or an outsized one, given this name's vol, over this horizon."

It is **not** a tradeable probability. Don't let "~56%" become the new "7.5 months" — that's why it's displayed as a band. The number grounds the judgment; it doesn't replace it.

---
## 8. Implementation notes (as built, v1.121.0)
- Pure addition to the `decision_framing` builder; no new endpoint, consistent with the separate-single-purpose convention.
- **`Phi`:** rather than add the A&S `erf`/`Phi` helper the original spec sketched, the implementation reuses the existing `normCDF` (same Abramowitz & Stegun 7.1.26, ~1e-7 accuracy) that already backs the Black-Scholes pricer. To avoid dragging the options-pricing import chain into the dependency-free `api/_lib/lifespan.js`, `normCDF` was extracted into `src/lib/normal.js`; `blackScholes.js` re-exports it for backward compatibility.
- **IV provenance:** in this codebase `cushion_iv_used` and radar `iv` are the same `quotes.iv` value, so the source-priority logic affects only the `iv_source` label, never the numeric value. `iv_source` is `"cushion"` when the ticker has an open CSP, else `"radar"`, else `null`.
- **Consumers wired:** `computeDecisionFraming` now accepts `iv` / `ivSource` / `ccDte` and attaches `recovery` in both the perpetual and normal branches. All three callers pass them through: `api/eod-snapshot.js` (full data incl. cushion IV + CC DTE, aggregates `recovery_missing_iv`), `api/ticker-detail.js` (equity IV + CC DTE), `api/position-lifespan.js` (radar IV only; CC fields omitted).
- **Tests** (`api/_lib/__tests__/decision-framing.test.js`): KTOS → `recovery_sigmas ≈ 0.58`, `touch_prob ≈ 0.56`, band `reachable`; low-IV (25%) → ~1.84σ / ~6.6% / `distant`; at-breakeven → `touch_prob = 1.0`, `at_or_above_breakeven = true`, band `reachable`; missing/zero IV → nulls + `iv_source: null`; active CC (15 DTE) → `touch_prob_cc_cycle ≈ 0.23`; band thresholds; and integration tests asserting `recovery` attaches in both `computeDecisionFraming` branches.
