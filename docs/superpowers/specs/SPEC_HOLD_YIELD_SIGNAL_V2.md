# SPEC_HOLD_YIELD_SIGNAL_V2.md

**Status:** Revised after empirical validation against the live `trades` / `positions` tables (validated 2026-06-04). Supersedes `SPEC_HOLD_YIELD_SIGNAL_V1` and `SPEC_CSP_YIELD_BENCHMARK_V1` — the V1 benchmark (realized full-capture yield) was proven structurally unreachable by held positions' forward yield; see §11.
**Scope:** A trailing entry-yield benchmark (one object, server-side) + a per-CSP "hold yield" signal (client-side) rendered on green open CSPs, mirroring the existing cushion indicator. CSP-only. Does not touch CCs, cushion, recovery_sigmas, or the snapshot cron.

---

## 1. What this is, and what it deliberately is NOT

A close-decision aid for **green CSPs** answering: *"Am I still being paid my normal rate to carry this assignment risk?"*

- **Benchmark = the trader's own typical CSP *entry* forward-yield** — the annualized return-on-capital a fresh CSP offers at open. This is the apples-to-apples comparison: forward-yield vs forward-yield.
- **Framing = risk-shedding, not redeploy.** A low reading licenses closing and **letting the cash sit**. It says nothing about whether a replacement exists. This field must never render as "close and redeploy."

### Why NOT the V1 realized-capture benchmark
V1 benchmarked against the realized full-capture yield of *closed* CSPs. Validation showed that number is **100–167% annualized** because the trader closes winners fast (premium captured ÷ few days). The forward yield of a position still being *held* maxes out at its entry yield (66–124% on the live book) and only decays from there — so it can essentially never clear a 100%+ bar. The signal would have read `underpaid` on every position, every day. The benchmark population (fast closes) and the live population (held positions) are not comparable. The entry-yield benchmark fixes this: see §11 for the numbers.

---

## 2. Scope

- **Green CSPs only** (`profit_pct > 0`). Underwater CSPs are an assignment-management question handled by cushion/recovery, not this tool.
- **CSP-only.** CC early-closes are directional; do not emit this for CCs.

---

## 3. The benchmark — typical CSP entry forward-yield

**Source:** closed CSPs in the `trades` table. One object, computed once server-side in `api/data.js` (where the trades table is already fetched).

**Universe:** rows where `type='CSP'` AND `subtype='Close'` (the only two CSP subtypes are `Close` and `Assigned`; `Assigned` is excluded). Require `capital_fronted > 0` and `kept_pct <> 0` (and non-null) — `kept_pct = 0` is the only value that breaks the gross reconstruction.

> **Loss closes are kept IN, deliberately.** A `Close` taken at a loss has negative `premium_collected` (net) and negative `kept_pct`; the reconstruction `gross = net / kept_pct` returns a correct *positive* gross (neg ÷ neg), so there is no sign-flip or garbage to filter out — the reconstruction is exact by construction (`kept_pct ≡ net/gross`, so `net/kept_pct ≡ gross` for any nonzero `kept_pct`). And conceptually they *should* stay: entry yield is outcome-independent — at entry you don't know which trades lose, so dropping losers would re-introduce the survivorship bias that sank the V1 realized benchmark. Validated: filtering to `kept_pct > 0` moves the 90d median only 66.23% → 65.84% (n 65→64) — immaterial.

**Per-trade entry yield** (⚠ field mappings verified against live schema):

```
capital        = capital_fronted                          // already = strike*100*contracts
gross_premium  = premium_collected / kept_pct             // premium_collected on CLOSED rows is NET P&L;
                                                           //   kept_pct is the net/gross fraction → gross = net/kept_pct
original_dte   = max(1, expiry_date - open_date)          // calendar days
entry_yield_ann = (gross_premium / capital) / original_dte * 365
```

> **Integer-division trap:** `premium_collected` and `capital_fronted` are integer columns. Cast to numeric (`::numeric`) before dividing or the result floors to 0.

**Aggregate:** the **median** of `entry_yield_ann` over the trailing window.

```
avg_csp_entry_yield_ann = median(entry_yield_ann)   over closed CSPs in the trailing window
```

- Median, not mean/blended — the entry-yield distribution is mildly right-skewed (a few rich entries, max ~315%); median is the robust "typical."
- **No inflation guard, no dollar-day blending.** Those existed in V1 to defend against fast-scalp inflation in the *realized* benchmark. The entry-yield distribution has no such inflation (entry yields don't explode at low days_held), so the machinery is removed.
- **Window:** trailing **90 days** by `close_date`. Fall back to lifetime if fewer than `MIN_TRADES` (10) closed CSPs in window; set `benchmark_immature: true` if still under 10. Validated 90d count = 65, so maturity is comfortable in practice.

---

## 4. Per-CSP live signal (client-side, in `OpenPositionsTab`)

Computed alongside the existing cushion calc (it needs the same client-side inputs: the current option mid from `quoteMap`, and `cushion_state`).

```
capital            = capital_fronted
profit_pct         = glPct / 100                            // from shortOptionGlPct({premiumCollected, optionMid, contracts})
gross_premium      = premium_collected                      // OPEN rows store GROSS premium (unlike closed rows — see §11)
premium_remaining  = gross_premium * (1 - profit_pct)       // current buyback cost = uncaptured premium at stake
days_remaining     = days_to_expiry
days_held          = today - open_date
original_dte       = days_held + days_remaining

forward_yield_ann  = (premium_remaining / capital) / days_remaining * 365
realized_yield_ann = (gross_premium * profit_pct / capital) / max(days_held,1) * 365   // context only — NOT the benchmark

ratio = forward_yield_ann / avg_csp_entry_yield_ann
```

> **Open vs closed premium semantics:** on `positions` (open) rows `premium_collected` is GROSS premium received at open. On `trades` (closed) rows the same-named column is NET P&L. Do not cross the wires.

---

## 5. The DTE gate (theta tail-off)

```
gate_passed = (days_remaining >= DTE_FLOOR_ABS) AND (days_remaining / original_dte >= DTE_FRAC)
```

- `DTE_FLOOR_ABS = 7`, `DTE_FRAC = 0.33` (tunable).
- If `gate_passed == false`: state = `late_cycle_let_ride` (no shed signal regardless of ratio).

---

## 6. State + priority

When `gate_passed`:

| ratio (forward vs your typical entry yield) | `hold_yield_state` | meaning |
|---|---|---|
| ≥ 1.0 | `fairly_paid` | remaining premium still pays your normal entry rate or better — hold |
| 0.5 – 1.0 | `below_average` | below your norm to keep holding — soft watch |
| < 0.5 | `underpaid_to_hold` | less than half your normal rate to carry this risk — shed candidate |

> **Bands are provisional.** Validated structurally (benchmark now sits inside the live forward-yield range) but the exact `fairly_paid/below_average/underpaid` split across the book needs an eyeball once live marks flow through. Mirror-cushion surfacing makes that a glance.

**Risk modulation** (reuse existing `cushion_state`):

```
if hold_yield_state == "underpaid_to_hold":
    if cushion_state in ("assignment_risk", "approaching"):  priority = "HIGH"
    else (safe):                                             priority = "LOW"
else: priority = "none"
```

HIGH = underpaid AND near the strike (the real signal). LOW = underpaid but miles OTM — informational, not worth manufacturing activity over.

---

## 7. Output schema

**Top-level (one per build):**
```jsonc
"csp_entry_yield_benchmark": {
  "window_days": 90,                    // 90, or lifetime if widened
  "trade_count": 65,
  "avg_csp_entry_yield_ann": 0.662,     // median entry yield — what the signal consumes
  "benchmark_immature": false
}
```

**Per green open CSP (client-side):**
```jsonc
"hold_yield": {
  "capital": 10700,
  "forward_yield_ann": 0.41,
  "realized_yield_ann": 0.95,           // context only; null if days_held = 0
  "avg_csp_entry_yield_ann": 0.662,
  "ratio": 0.62,
  "days_remaining": 22,
  "dte_fraction_remaining": 0.88,
  "gate_passed": true,
  "hold_yield_state": "below_average",  // fairly_paid | below_average | underpaid_to_hold | fully_captured | late_cycle_let_ride | no_benchmark
  "priority": "none"                    // HIGH | LOW | none
}
```

`hold_yield_skipped: []` lists tickers skipped (underwater, missing mid, no benchmark).

---

## 8. Render — mirror the existing cushion indicator

Cushion already renders a red dot / amber ⚠ on CSP rows ([OpenPositionsTab.jsx](../../../src/components/OpenPositionsTab.jsx)). Sit beside it.

- **Collapsed row (green CSPs only):**
  - `underpaid_to_hold` + HIGH → visible chip (amber/red), e.g. "underpaid · near strike"
  - `underpaid_to_hold` + LOW → muted dot
  - `below_average` → muted dot or nothing (tunable)
  - `fully_captured` → muted dot (low-urgency housekeeping — bank it, but zero risk)
  - `fairly_paid` / `late_cycle_let_ride` → nothing (silence is the default)
- **Expanded row:** the risk-shedding sentence + forward yield / your typical entry yield / ratio.
  - HIGH → "Paid ~{ratio} of your normal entry rate to hold this, and it's near the strike — shedding the risk is reasonable."
  - LOW → "Below-normal pay to hold, but it's safe — optional cleanup, no urgency."
  - `fairly_paid` → "Still paying your normal rate — hold."
  - `fully_captured` → "Fully captured — nothing left to earn, close it."
  - `late_cycle_let_ride` → "Late in the cycle — let it resolve."
- **Forbidden phrasing:** anything with "redeploy," "recycle," "put the cash to work."

---

## 9. Edge cases

- **Underwater** (`profit_pct <= 0`): skip, add to `hold_yield_skipped`.
- **Missing current mid** (no quote in `quoteMap`): can't compute `profit_pct` → skip, add to `hold_yield_skipped`.
- **days_held = 0** (opened today): `realized_yield_ann = null`; still compute `forward_yield_ann` and state.
- **Missing/thin benchmark:** `avg_csp_entry_yield_ann = null`, `hold_yield_state = "no_benchmark"`, skip priority. Never fabricate.
- **profit_pct ≥ 1** (fully captured): clamp `premium_remaining` to 0, state `fully_captured`, `priority = "none"`. This is its own terminal state, NOT `underpaid_to_hold` — the risk is gone and there's nothing left to earn, which is "done, close it" not "judgment call on a thin payer." Render: "Fully captured — nothing left to earn, close it." (still a stop-holding message, not a redeploy one.)

---

## 10. Config

```
TRAILING_WINDOW_DAYS = 90
MIN_TRADES           = 10
DTE_FLOOR_ABS        = 7
DTE_FRAC             = 0.33
```

---

## 11. Validation record (2026-06-04, live data)

**Why V1's benchmark was scrapped.** Realized full-capture benchmark over closed CSPs:

| scope | n | blended | mean | median |
|---|---|---|---|---|
| 90d | 66 | 103.5% | 167.7% | 130.0% |

Live book's *maximum* forward yield (at entry, profit_pct=0; only decays from here): 66.9%–123.6%. → 5 of 9 already below blended, **all 9 below median**. Signal would read underpaid on everything. Also: blended (103.5%) < median (130%), so V1's inflation guard (`blended > median × 1.5`) fires *backwards* on this data.

**Entry-yield benchmark (adopted):**

| scope | n | mean | median | p25 | p75 | max |
|---|---|---|---|---|---|---|
| 90d entries | 65 | 76.1% | **66.2%** | 57.2% | 84.3% | 315% |
| lifetime | 117 | 68.9% | 61.5% | 50.6% | 78.0% | 315% |

Median 66.2% sits inside the live forward-yield range → the signal discriminates. Tight IQR (57–84%) → no inflation machinery needed.

**Schema facts confirmed:**
- CSP subtypes in data: `Close` (118) and `Assigned` (19) only. No `Roll Loss`/`Expired` for CSPs.
- `premium_collected` is GROSS on `positions` (open), NET P&L on `trades` (closed) — confirmed at `api/_lib/lifespan.js:464,553`.
- `kept_pct` is a fraction (0–1), can be negative (loss closes). `capital_fronted` = strike×100×contracts. Dollar columns are integers (cast before dividing).
- `cushion_state` ∈ {`safe`,`approaching`,`assignment_risk`}, computed client-side in `src/lib/cushionBreach.js`.
