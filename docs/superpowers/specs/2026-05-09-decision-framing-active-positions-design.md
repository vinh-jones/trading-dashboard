# Decision Framing for Active Assigned Positions

**Date:** 2026-05-09
**Status:** Awaiting user review
**Scope:** Backend computation + two output integrations (position-lifespan JSON, EOD snapshot text + JSON)
**Related:** Downstream of the cut-and-redeploy benchmark stack (PRs #98–#102). Reuses the same `baseline_rate` (`avg_csp_return_per_capital_day`) computed by `computeCspBaseline`.

## Goal

Add a `decision_framing` computation for active assigned-share positions that quantifies the wheel-vs-cut-and-redeploy comparison and surfaces a forecasting question the user can actually answer ("Do you think TICKER reaches COST_BASIS by DATE?").

Two integration points:
1. `api/position-lifespan` — adds a `decision_framing` field to the per-lifespan JSON output
2. `api/eod-snapshot` — adds a "DECISION FRAMING" section to the text blob and a structured object to the JSON `data`

## Scope

- Active assigned-share positions only (`assignment_events` present, no `exit_event`)
- Skip if shares haven't been assigned yet (open CSPs only — handled by lifespan detection)
- Skip if `currentSpot >= blended_cost_basis` (productive position, no framing needed)
- Skip if position is closed (existing benchmarks handle this case)

## Out of Scope

- Modeling early call-away scenarios at below-cost CC strikes (user rolls up rather than letting shares be called away below cost)
- Real-time recalculation on every dashboard load (compute on each lifespan endpoint request — no caching at endpoint level; EOD snapshot caches via the existing snapshot pipeline)
- Active notifications/alerts for state transitions
- Predictive recovery date based on price trends
- New aggregate endpoint
- UI work (badges, refresh button) — separate task; this PR ships backend only

## Inputs

From the lifespan structure (`buildLifespan` output):
- `lifespan_metrics.csp_premium_collected` — sum across all assignment events
- `lifespan_metrics.cc_premium_total` — cumulative net CC P&L
- `blended_cost_basis`
- `total_shares_at_peak` (with adjustment for `partial_dispositions` — see implementation note)
- `lifespan_metrics.days_active`
- `cc_history` (used for trailing 60-day rate calculation)
- `lifespan_metrics.cc_count_winning` / `cc_count_losing`

From market/portfolio data:
- `currentSpot` — fetched from Supabase `quotes` table (`symbol = ticker`, `last` column). Position-lifespan endpoint will add this fetch for active assigned tickers.
- `baselineRate` — already on `cspBaseline.avg_return_per_capital_day`

## Computation

### Trailing 60-day wheel rate

```js
function computeTrailingCcRate(ccHistory, today, days = 60) {
  const cutoffDate = subtractCalendarDays(today, days);
  const cutoff = formatDate(cutoffDate); // YYYY-MM-DD string
  const recentCcs = ccHistory.filter((cc) => cc.close_date >= cutoff);
  if (recentCcs.length === 0) return null;

  const recentPnl  = recentCcs.reduce((s, cc) => s + (parseFloat(cc.premium_collected) || 0), 0);
  const recentDays = recentCcs.reduce((s, cc) => s + (parseFloat(cc.days_held) || 0), 0);
  return recentDays > 0 ? recentPnl / recentDays : 0;
}
```

If no CCs in trailing 60 days, fall back to lifetime rate (`cc_premium_total / days_active`).

### Per-position decision framing

```js
function computeDecisionFraming({ lifespan, currentSpot, baselineRate, ticker, today }) {
  // Guards
  if (lifespan.lifespan_status !== "active") return null;
  if (lifespan.assignment_events.length === 0) return null;
  if (currentSpot == null) return null;

  const cb     = lifespan.blended_cost_basis;
  if (currentSpot >= cb) return null;

  // Current shares = peak − sum(partial_dispositions.shares)
  // For lifespans with no partial dispositions, this equals total_shares_at_peak.
  const disposedShares = lifespan.partial_dispositions.reduce(
    (s, d) => s + (d.shares ?? 0), 0
  );
  const currentShares  = lifespan.total_shares_at_peak - disposedShares;
  if (currentShares <= 0) return null;

  const m = lifespan.lifespan_metrics;
  const cspPremium = m.csp_premium_collected;
  const ccPremium  = m.cc_premium_total;
  const daysHeld   = m.days_active;

  // Cumulative wheel state includes any partial-disposition P&L already realized
  const partialDisposalPnl = lifespan.partial_dispositions.reduce(
    (s, d) => s + (d.disposal_pnl ?? 0), 0
  );
  const cumulativeWheelPnl = round2(cspPremium + ccPremium + partialDisposalPnl);

  // Cut alternative if cut today
  const realizedLoss            = round2((cb - currentSpot) * currentShares);
  const freedCapital            = round2(currentSpot * currentShares);
  const cutAlternativeStateNow  = round2(cspPremium + partialDisposalPnl - realizedLoss);

  // Current gap (positive = wheel ahead of cut-today scenario)
  const gap = round2(cumulativeWheelPnl - cutAlternativeStateNow);

  // Forward rates
  const trailingCcRate = computeTrailingCcRate(lifespan.cc_history, today, 60);
  const usingTrailing  = trailingCcRate !== null;
  const wheelDailyRate = usingTrailing
    ? trailingCcRate
    : (daysHeld > 0 ? ccPremium / daysHeld : 0);

  const cutDailyRate     = freedCapital * baselineRate;
  const dailyDifferential = cutDailyRate - wheelDailyRate;

  const drawdownPct  = (currentSpot - cb) / cb;
  const drawdownZone = classifyDrawdown(drawdownPct);

  const recentCcStrike = getRecentCcStrike(lifespan.cc_history);
  const lifetimeCcRate = daysHeld > 0 ? ccPremium / daysHeld : 0;

  const baseFields = {
    drawdown_pct:       round4(drawdownPct),
    drawdown_zone:      drawdownZone,
    detailed_breakdown: {
      cumulative_wheel_pnl:        cumulativeWheelPnl,
      csp_premium_collected:       cspPremium,
      cc_premium_total:            ccPremium,
      partial_disposal_pnl:        round2(partialDisposalPnl),
      cc_count_winning:            m.cc_count_winning,
      cc_count_losing:             m.cc_count_losing,
      trailing_60day_cc_rate:      trailingCcRate != null ? round4(trailingCcRate) : null,
      lifetime_cc_rate:            round4(lifetimeCcRate),
      using_trailing_rate:         usingTrailing,
      recent_cc_strike:            recentCcStrike,
      current_shares:              currentShares,
      realized_loss_if_cut_today:  realizedLoss,
      freed_capital_if_cut:        freedCapital,
      cut_alternative_state:       cutAlternativeStateNow,
      gap:                         gap,
      wheel_daily_rate:            round4(wheelDailyRate),
      cut_daily_rate:              round4(cutDailyRate),
      daily_differential:          round4(dailyDifferential),
    },
  };

  if (dailyDifferential <= 0) {
    return {
      ...baseFields,
      days_to_breakeven:   null,
      breakeven_zone:      "wheel_ahead_perpetually",
      recovery_date:       null,
      framing_question:    "Wheel currently outperforming cut alternative; no breakeven date.",
      framing_duration:    null,
    };
  }

  const daysToBreakeven = Math.ceil(gap / dailyDifferential);
  const recoveryDate    = addCalendarDays(today, daysToBreakeven);
  const breakevenZone   = classifyBreakeven(daysToBreakeven);

  return {
    ...baseFields,
    days_to_breakeven:  daysToBreakeven,
    breakeven_zone:     breakevenZone,
    recovery_date:      recoveryDate,
    framing_question:   `Do you think ${ticker} reaches $${cb.toFixed(2)} (cost basis) by ${recoveryDate}?`,
    framing_duration:   humanizeDuration(daysToBreakeven),
  };
}
```

### Helpers (specified)

```js
function classifyDrawdown(pct) {
  if (pct >= -0.15) return "shallow";
  if (pct >= -0.30) return "moderate";
  if (pct >= -0.45) return "deep";
  return "severe";
}

function classifyBreakeven(days) {
  if (days < 90)  return "quick_recovery";
  if (days < 270) return "decision_zone";
  if (days < 540) return "long_horizon";
  return "effectively_stuck";
}

// Most recent CC strike from cc_history (by close_date).
// Returns null when no CCs have closed yet for this lifespan.
// Note: does not consider currently-open CCs not yet in cc_history; if needed
// later, the caller can pass an `activeCc` separately.
function getRecentCcStrike(ccHistory) {
  if (!ccHistory || ccHistory.length === 0) return null;
  const sorted = [...ccHistory].sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""));
  return sorted[0]?.strike ?? null;
}

// Calendar arithmetic on YYYY-MM-DD strings (no weekend skipping)
function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function subtractCalendarDays(dateStr, days) {
  return addCalendarDays(dateStr, -days);
}

// Human-readable duration (≤ ~30 chars)
function humanizeDuration(days) {
  if (days < 14)  return `~${days} days`;
  if (days < 60)  return `~${Math.round(days / 7)} weeks`;
  if (days < 365) {
    const months = Math.round((days / 30.44) * 2) / 2;   // round to nearest 0.5 month
    return `~${months} months`;
  }
  const years = Math.round((days / 365.25) * 2) / 2;     // round to nearest 0.5 year
  return `~${years} years`;
}
```

## Outputs

### `api/position-lifespan` endpoint

For each lifespan in the response:
- If `decision_framing` is computable → include the field
- If not (closed lifespan, currentSpot ≥ cb, no quote available, no current shares) → **omit the field entirely** (do not return null)

**New quote fetch**: position-lifespan endpoint adds a Supabase `quotes` query for the tickers it's about to return. For ticker-scoped requests (with `ticker` query param) this is a single-symbol fetch; for the all-tickers list mode it's an `.in('symbol', [...])` fetch over the active-lifespan tickers. If the quote lookup fails, decision_framing is omitted (no error).

Example output (added to existing single-lifespan response):

```json
"decision_framing": {
  "drawdown_pct": -0.39,
  "drawdown_zone": "deep",
  "days_to_breakeven": 320,
  "breakeven_zone": "long_horizon",
  "recovery_date": "2027-03-26",
  "framing_question": "Do you think SOFI reaches $26.00 (cost basis) by 2027-03-26?",
  "framing_duration": "~10.5 months",
  "detailed_breakdown": {
    "cumulative_wheel_pnl": 5742,
    "csp_premium_collected": 4752,
    "cc_premium_total": 990,
    "partial_disposal_pnl": 0,
    "cc_count_winning": 8,
    "cc_count_losing": 2,
    "trailing_60day_cc_rate": 12.5,
    "lifetime_cc_rate": 6.2,
    "using_trailing_rate": true,
    "recent_cc_strike": 26,
    "current_shares": 200,
    "realized_loss_if_cut_today": 2000,
    "freed_capital_if_cut": 3200,
    "cut_alternative_state": 2752,
    "gap": 2990,
    "wheel_daily_rate": 12.5,
    "cut_daily_rate": 21.84,
    "daily_differential": 9.34
  }
}
```

### `api/eod-snapshot`

Add a new section to `buildTextBlob` immediately after the existing assigned-shares section (positioned visually near the related context). Format:

```
DECISION FRAMING — ACTIVE ASSIGNED POSITIONS
────────────────────────────────────────
SOFI · Deep / Long horizon
  Q: "Do you think SOFI reaches $26.00 by 2027-03-26?" (~10.5 months)
HOOD · Deep / Long horizon
  Q: "Do you think HOOD reaches $126.14 by 2027-04-XX?" (~12 months)
PLTR · Moderate / Decision zone
  Q: "Do you think PLTR reaches $180.00 by 2026-10-13?" (~5 months)
CDE  · Shallow / Wheel ahead — no framing needed
KTOS · Moderate / Quick recovery
  Q: "Do you think KTOS reaches $73.50 by 2026-06-12?" (~5 weeks)

DECISION ZONE (comparison most informative): PLTR
ANCHORED (math says hold despite long timeline): SOFI, HOOD
```

Sort: by drawdown_zone severity (`severe` → `deep` → `moderate` → `shallow` → no-framing), ticker alphabetical within zone.

Footer two-line summary:
- "DECISION ZONE": tickers whose `breakeven_zone === "decision_zone"`
- "ANCHORED": tickers whose `breakeven_zone` is `"long_horizon"` or `"effectively_stuck"`
- Omit either line if no tickers qualify

Also include in the EOD snapshot's JSON `data` field as `decision_framing` array of `{ ticker, ...framing }` for programmatic access.

If no active assigned positions are below cost basis: omit the section entirely (no header, no empty body).

## Implementation note: shares accounting

The user's earlier spec used `total_shares_at_peak`, but if a lifespan ever had a partial called-away (a CC assigned that didn't dispose all shares), the current holdings are less than peak. For correctness the formula uses `currentShares = total_shares_at_peak − Σ partial_dispositions.shares` and includes `partial_disposal_pnl` in `cumulative_wheel_pnl` so the realized P&L is fully accounted for.

For the user's actual portfolio today, none of the active lifespans have partial dispositions, so currentShares == peak. The adjustment is a correctness guard, not a behavior change.

## Caching

- **EOD snapshot**: cached as part of the existing 4:30 ET snapshot job (no new caching layer)
- **position-lifespan**: computed on each request using current spot from `quotes` table. The quotes table itself has a stale-refresh policy (15 min) — endpoint reads whatever's there.

## Tests

Create `api/_lib/__tests__/decision-framing.test.js`:

| # | Scenario | Expectation |
|---|----------|-------------|
| 1 | Lifespan is closed | returns null |
| 2 | Active position, currentSpot ≥ cost basis | returns null |
| 3 | Active position with current shares = 0 (e.g., shares all called away) | returns null |
| 4 | currentSpot is null (no quote) | returns null |
| 5 | SOFI-style: single assignment, deeply below cost, trailing 60d CCs available | gap, daily rates, breakeven, recovery date all populated correctly; `using_trailing_rate: true` |
| 6 | No CCs in trailing 60 days → uses lifetime rate fallback | `using_trailing_rate: false`; lifetime_cc_rate is the wheel_daily_rate |
| 7 | wheel rate ≥ cut rate at current spot | `breakeven_zone: "wheel_ahead_perpetually"`, `days_to_breakeven: null`, framing_question is the static perpetual-ahead message |
| 8 | Drawdown classification boundaries: -0.15, -0.30, -0.45 (test exact thresholds) | shallow, moderate, deep correctly assigned |
| 9 | Breakeven classification boundaries: 89, 90, 269, 270, 539, 540 days | quick/decision/long/stuck correctly assigned |
| 10 | Calendar arithmetic: today=2026-05-09, days=320 → recovery_date='2027-03-25' (or correct value) | computed without skipping weekends |
| 11 | humanizeDuration: 1, 13, 14, 59, 60, 364, 365, 730 → check format | follows the rules above |
| 12 | Lifespan with partial_dispositions present | currentShares is reduced; partial_disposal_pnl in cumulative_wheel_pnl |

EOD snapshot integration test (light): pass a lifespans-with-quotes fixture to the text-builder section and verify sort order + footer summary.

## Acceptance criteria

1. `computeDecisionFraming` lives in `api/_lib/lifespan.js` (or a new `api/_lib/decisionFraming.js` if preferred — depends on file size). Tests pass.
2. `api/position-lifespan` fetches quotes for active lifespans' tickers and includes `decision_framing` per-lifespan when computable.
3. `api/eod-snapshot` calls `computeDecisionFraming` per active assigned position and surfaces a new section in both the text blob and JSON `data`.
4. CRDO / IREN / SOFI / HOOD spot-checks against production data look reasonable.
5. Version bumped (1.108.6 → 1.109.0; minor for new feature).
6. Full test suite passes.

## Open implementation choices (decisions made)

1. **Module location**: keep `computeDecisionFraming` in `api/_lib/lifespan.js` initially; if the file passes ~700 lines after this addition, factor out to `api/_lib/decisionFraming.js`.
2. **Quote stale-window**: rely on existing 15-min refresh in the quotes table; don't trigger a new refresh from the lifespan endpoint.
3. **Recent CC strike**: from `cc_history` only (closed CCs). Open CCs not in scope; can be added later via a separate `activeCc` parameter if the UI needs it.
4. **No exception path for missing baseline_rate**: if `baselineRate` is 0 (empty CSP sample), `cutDailyRate` = 0 → `dailyDifferential` ≤ 0 → `wheel_ahead_perpetually` state. Tests should cover this implicitly.
5. **No new constants file**: drawdown/breakeven thresholds inlined in the helpers. They're domain values, not configuration.

## Deferred to follow-up

- UI work: badges, framing question display, collapsible detailed breakdown
- Manual refresh button on lifespan view
- Active CC integration (currently-open CC, not yet closed) for `recent_cc_strike`
- Notifications/alerts on state transitions
