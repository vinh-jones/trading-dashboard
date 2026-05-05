# Cushion Breach Alerting v1 — Design

**Date:** 2026-05-05
**Status:** Approved, ready for implementation planning

---

## Overview

IV-scaled formula that flags when a CSP's underlying has moved close enough to the strike that assignment risk is meaningful. Replaces ad-hoc judgment with a quantitative two-threshold system. Surfaces across three layers: API snapshot endpoints, Open Positions table UI, and Focus tab alerts.

---

## Formula

```
daily_move = IV / sqrt(252)   // IV as decimal, e.g. 0.685 for 68.5%

amber_trigger = strike * (1 + daily_move * 2)   // N=2
red_trigger   = strike * (1 + daily_move * 1)   // N=1

cushion_pct = (underlying - strike) / strike    // positive = above strike
```

### Three states

| State | Condition | UI |
|---|---|---|
| `safe` | underlying > amber_trigger | no indicator |
| `approaching` | underlying ≤ amber_trigger AND > red_trigger | ⚠ amber left-border |
| `assignment_risk` | underlying ≤ red_trigger | ● red left-border |

**DTE is not part of the formula.** It is surfaced prominently next to the alert label so the user can interpret urgency contextually (amber + low DTE = treat like red; red + any DTE = active decision required today).

### Test cases

- GLW $155p, underlying $160.50, IV 68.5%: daily_move=0.0432, amber_trigger=$168.39, red_trigger=$161.69 → $160.50 ≤ $161.69 → `assignment_risk`
- PLTR $80p, underlying $84.20, IV 68.5%: amber_trigger=$86.91, red_trigger=$83.46 → $84.20 between triggers → `approaching`
- SOFI $9p, underlying $11.40, IV 45%: triggers well above → `safe`

---

## Scope

- **CSPs only** for v1. CC breach logic is a separate follow-on.
- No DTE weighting in the formula.
- No dismiss/acknowledge mechanism (deferred to broader Focus noise reduction work).
- N values hardcoded (N=1 red, N=2 amber). No UI toggle for v1.

---

## Change 1: Shared helper

**New file: `src/lib/cushionBreach.js`**

Location rationale: `api/_lib/` is not importable by `src/lib/focusEngine.js` (Vite won't resolve it). `src/lib/` is importable from both directions — `focusEngine.js` is already there, and API endpoints already import from `../src/lib/` (e.g. `vixBand.js`).

Single exported function:

```js
computeCushion(position, underlyingPrice, iv)
// → {
//     cushion_trigger_amber,  // dollar price, N=2
//     cushion_trigger_red,    // dollar price, N=1
//     cushion_pct,            // decimal, e.g. 0.053
//     cushion_state,          // "safe" | "approaching" | "assignment_risk"
//     cushion_iv_used,        // IV decimal used
//     cushion_n_amber,        // 2
//     cushion_n_red,          // 1
//   }
```

Returns all-null object when `iv` is null (missing IV case).

### Called from

- `api/eod-snapshot.js` — enriches each open CSP position object after quotes are loaded (zero extra queries: IV already in the quotes map)
- `api/intraday-snapshot.js` — same
- `src/lib/focusEngine.js` — `ruleCushionBreach` uses the same function

### API response shape

Each open CSP in `data.positions.open_csps[]` gains the 7 cushion fields inline. The top-level response gains:

```js
data_completeness: {
  cushion_missing_iv: ["TICKER1", ...]   // tickers where IV was null
}
```

### Text blob (copy-paste summary)

The plain-text output in both snapshot endpoints should append the cushion state tag inline on each CSP line so the journal session sees it without needing to parse JSON:

```
SOFI   $9.00p  exp 2026-06-20 (46d)  56% profit  $320 premium  $9,000 capital
PLTR   $80.00p exp 2026-06-20 (46d)  48% profit  $210 premium  $8,000 capital  [⚠ APPROACHING]
GLW    $155.00p exp 2026-06-20 (7d)   -8% profit  $120 premium  $15,500 capital  [● ASSIGNMENT RISK]
```

Safe positions get no tag.

---

## Change 2: Open Positions table UI

**File: `src/components/OpenPositionsTab.jsx`**

### Row-level indicator

The ticker cell wraps the ticker text in a fixed-width `38px` inline block so icons align vertically across all rows regardless of ticker length:

```jsx
<span style={{ display: 'inline-block', width: 38 }}>{pos.ticker}</span>
{cushionIcon}  // null | ⚠ amber | ● red dot
```

The existing `rowHighlightColor` / `borderLeft` logic is extended:
- `approaching` → `theme.amber` left border (3px)
- `assignment_risk` → `theme.red` left border (3px)
- Priority: red > amber > existing green profit highlight

### Expand panel (click to open — existing pattern)

A **Cushion section** is prepended above the existing `PriceTargetPanel` for CSP rows only. Hidden entirely in `safe` state.

Panel content when open:
```
⚠ Approaching Strike · 46 DTE        (or ● Assignment Risk · 7 DTE)
within 2 expected daily moves of strike

Underlying  $84.20    Strike       $80.00
Cushion %    5.3%     IV used      68.5%
Amber trigger (N=2)  $86.91 ← crossed
Red trigger (N=1)    $83.46 · not yet   (or ← crossed if assignment_risk)
Daily move est.       4.3%
Formula: strike × (1 + IV/√252 × N)
```

Both triggers always shown so the user can see exactly where each threshold sits.

---

## Change 3: Focus tab alert

**File: `src/lib/focusEngine.js`**

New rule function `ruleCushionBreach(positions, quoteMap)` added after `ruleNearWorthlessOption`.

### Alert shape

```js
{
  id:         `cushion-${ticker}-${strike}-${expiry_date}-${state}`,
  priority:   state === "assignment_risk" ? "P1" : "P2",
  rule:       "cushion_breach",
  ticker, strike, expiry_date, dte,
  urgency:    dte,
  title:      `${ticker} $${strike}p — ${state === "assignment_risk" ? "assignment risk" : "approaching strike"}`,
  detail:     // underlying, both triggers, cushion_pct, DTE, IV used, suggested action
}
```

State is part of the alert ID so amber→red escalation fires as a new transition.

### Suggested action in detail text

- `assignment_risk` + kept_pct > 50% + DTE > 5 → suggest rolling out/down
- `assignment_risk` + DTE ≤ 5 → note that ITM expiry results in assignment
- `approaching` → informational, monitor

### Suppression rules

1. **DTE = 0** — skip (DTE_WARNING rule owns this)
2. **60/60 already firing** — skip if `rule6060` produced an alert for the same ticker+strike+expiry in this batch (user would close anyway)
3. **Entry-state** — skip if `position.open_date === today` (first observation, user knew the entry state)

### Registration

```js
// NOTIFY_RULES
cushion_breach: true,   // pushes via Pushover
```

Transition dedup handled by existing `alert_state` table in `evaluateAlerts.js` — fires once per episode, re-fires if state clears and breaches again.

---

## Change 4: Edge cases

| Case | Behavior |
|---|---|
| Missing IV | All cushion fields `null`. Ticker in `data_completeness.cushion_missing_iv`. No crash. |
| Spreads | Not in scope v1. `data_completeness.cushion_skipped_spreads: []` present but empty. |
| DTE = 0 | Cushion fields computed and returned in API. Focus alert suppressed. |
| Negative cushion_pct | Underlying at/below strike (deeply ITM). `cushion_state = "assignment_risk"`, raw negative value preserved. |
| CC positions | Skipped entirely for v1. No cushion fields on CC rows. |

---

## Architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| Computation timing | On-the-fly in API endpoints | IV already in memory from quotes fetch; zero extra queries; consistent with all other snapshot computations |
| Shared helper location | `api/_lib/computeCushion.js` | Single source of truth for formula; imported by both snapshot endpoints and focusEngine |
| Transition detection | Existing `alert_state` table dedup | Already handles once-per-episode; no new schema needed |
| Dismiss/acknowledge | Out of scope | Deferred to broader Focus noise reduction work |
| Tooltip vs expand panel | Expand panel (existing pattern) | No new component; works on mobile; no z-index/overflow fragility |
| DTE in formula | No | DTE surfaced as label context; user interprets urgency; keeps formula clean |

---

## Files changed

| File | Change |
|---|---|
| `src/lib/cushionBreach.js` | New — formula helper (importable by both API and frontend) |
| `api/eod-snapshot.js` | Enrich CSP positions with cushion fields; add `data_completeness` |
| `api/intraday-snapshot.js` | Same as eod-snapshot |
| `src/lib/focusEngine.js` | Add `ruleCushionBreach`, register in `NOTIFY_RULES` |
| `src/components/OpenPositionsTab.jsx` | Fixed-width ticker, border color extension, cushion panel section |

---

## Out of scope for v1

- CC cushion breach
- Configurable N via UI
- Velocity-based warnings (rapid price movement)
- Backfill historical cushion states
- Cushion in monthly review
- Push notifications beyond Focus tab
- Dismiss/acknowledge pattern
