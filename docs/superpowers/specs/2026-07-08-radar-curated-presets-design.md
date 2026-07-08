# Radar — chip-signal filtering + curated presets

**Date:** 2026-07-08
**Status:** Design approved (pending written-spec review)

## Problem

The Radar tab already has a clickable-preset mechanism (`radar_presets`, rendered
as pills in `RadarPresetBar`). But two gaps stop it from delivering "click a
pre-made filter to see what fills a setup":

1. **No curated presets.** All presets today are user-authored. There's no
   built-in set that encodes known-good CSP setups.
2. **Chip signals aren't filterable.** The filter engine keys off numeric/
   categorical fields only (BB, IV Rank, Composite IV, Raw IV, P/E, sector,
   earnings-days, ownership). The signal *chips* — Trend, RSI, Score bucket,
   GEX env, IV Trend — are displayed but cannot be filtered, so the most
   interesting combinations ("oversold AND not in a downtrend") can't be
   expressed.

## Goal

Wire the chip signals into the filter engine, then ship a curated, built-in set
of one-click presets that combine them.

Success = clicking **✦ Prime Entry** (etc.) instantly filters the watchlist to
the names matching that setup, and any of the five new signal dimensions can be
filtered manually via pill toggles.

## Scope

In scope: filter-model extension, filter application, filter UI, curated presets,
preset-bar changes, tests.
Out of scope: changing the Scanner Score, adding new data sources, RSI-in-score
(explicitly excluded — see `project_rsi_context_only`).

---

## 0. Framing — confirmation screens, not deploy triggers

This codebase has a documented, deliberate discipline hierarchy: **Ryan-first →
hard rules → soft yield signals → confirmation**. The UW work encodes it in code
rather than leaving it to willpower, and specifically relabels buy-signal
language ("prime candidate" → "whale-confirmed setup", *"confirmation, not a buy
signal — checklist + VIX target first"*). A one-click, always-green pill labeled
with an action imperative ("Prime *Entry*") is the frictionless version of the
exact pull-toward-risk vector that discipline exists to defang.

Two cheap guardrails keep the radar subordinate to that hierarchy:

1. **Setup-descriptive names, never action-imperative.** Presets describe *what
   matched*, not *what to do* (§4). No name asserts safety or entry.
2. **A persistent caption on the curated bar** (§5): *"Confirmation screens —
   not deploy triggers. Checklist + Ryan-first before any entry."*

These are consistency with an existing decision, not a new opinion.

---

## 1. Filter model — five new allow-set filters

In `src/components/radar/radarConstants.js`, extend `DEFAULT_FILTERS`:

```js
trend_states:    [],  // subset of ["uptrend","pullback","recovering","downtrend"]
rsi_buckets:     [],  // subset of ["oversold","neutral","overbought"]
score_buckets:   [],  // subset of ["Strong","Moderate","Neutral","Weak"]
gex_envs:        [],  // subset of ["stabilized","choppy","neutral"]
iv_trend_states: [],  // subset of ["rising","spiking","falling","collapsing","stable"]
```

**Semantics:** empty array = dimension not filtered (all pass). Non-empty =
row's computed/stored bucket for that dimension must be a member. "Exclude X" is
expressed as an allow-set of everything-but-X (e.g. Trend ≠ Downtrend →
`["uptrend","pullback","recovering"]`).

Update:
- `countActiveFilters` — each non-empty array counts as one active filter.
- `filterSummaryLines` — one human-readable line per non-empty array.

Add label maps for the summary/UI where not already exported:
`TREND_FILTER_LABELS`, reuse `RSI_BUCKET_LABELS` (from `rsi.js`),
`SCORE_FILTER_LABELS`, `GEX_FILTER_LABELS`, `IV_TREND_FILTER_LABELS`.

## 2. Filter application — extract to a tested pure helper

The row-filter callback in `RadarTab.jsx` (~`processedRows`) is already ~30 lines
inline and will grow. **Extract it to `src/lib/radarFilter.js`:**

```js
export function rowMatchesFilters(row, filters, ctx) { ... return boolean }
```

`ctx` carries what the per-row computed dimensions need:
`{ positions, marketContext, ivTrendsByTicker, expandGroupsToSectors }` (or the
already-expanded include/exclude sector arrays). The helper computes, per row:
- **trend** via `getTrendState(last, ma_50, ma_200)` → `.state`
- **rsi** via `rsiBucket(rsi_14)`
- **score** via `scoreLabel(entryScore(...))` (needs `ivTrendsByTicker`)
- **iv trend** via the existing per-ticker IV-trend state
- **gex** = `row.gex_env` (stored)

For each of the five allow-sets: if non-empty and the row's value is **null or
not a member**, return false. (Null value + active filter → excluded: asking for
"Oversold only" must not surface a name with no RSI.)

The existing numeric/sector/ownership/earnings checks move into the same helper
unchanged. `RadarTab.jsx` calls `rowMatchesFilters` inside `processedRows`; the
separate `bbFilter` bucket-pill check stays where it is.

## 3. Filter UI

In `src/components/radar/RadarAdvancedFilters.jsx`, add five pill-toggle rows,
reusing the **exact** pattern the existing BB-bucket pills use. Each row: a
label + one pill per bucket; clicking toggles membership in that dimension's
allow-set. Pills colored to match their chips (import the existing color maps:
`RSI_BUCKET_COLORS`, `TREND_COLORS`, `IV_TREND_COLORS`, `GEX_ENV_META`, and score
bucket colors). No new UI primitives.

## 4. Curated presets — built-in, in code

New file `src/components/radar/curatedPresets.js`:

```js
export const CURATED_PRESETS = [
  { id: "builtin:prime-setup",     name: "Prime Setup",     builtin: true, filters: {...} },
  { id: "builtin:oversold-bounce", name: "Oversold Bounce", builtin: true, filters: {...} },
  { id: "builtin:juiced-premium",  name: "Juiced Premium",  builtin: true, filters: {...} },
  { id: "builtin:fresh-calm",      name: "Fresh & Calm",    builtin: true, filters: {...} },
  { id: "builtin:pinned-paid",     name: "Pinned & Paid",   builtin: true, filters: {...} },
  { id: "builtin:write-zone",      name: "Write Zone",      builtin: true, filters: {...} },
];
export const CURATED_ICON = "✦";
```

Each `filters` is a partial `DEFAULT_FILTERS` (merged over defaults on apply).

**Naming discipline (see §0 rationale):** presets are named for *what matched the
screen* (setup-descriptive), never for *what to do* (action-imperative). This is
the same relabelling the UW work applied ("prime candidate" → "whale-confirmed
setup"). No preset name asserts safety or tells the user to enter.

| Preset | Encodes | filters |
|---|---|---|
| **✦ Prime Setup** | cheap, top-scoring, no knife, calm tape, no event, room to add | `score_buckets:["Strong"]`, `bb_position_max:0.20`, `trend_states:["uptrend","pullback","recovering"]`, `gex_envs:["stabilized","neutral"]`, `earnings_days_min:30`, `ownership:"not_held"` |
| **✦ Oversold Bounce** | oversold and turning, not falling | `rsi_buckets:["oversold"]`, `bb_position_max:0.20`, `trend_states:["uptrend","pullback","recovering"]` |
| **✦ Juiced Premium** | high IV in relative AND absolute terms — **this is the high-vol assignment cluster, not a safety screen** | `iv_rank_min:50`, `raw_iv_min:0.50`, `rsi_buckets:["oversold","neutral"]`, `earnings_days_min:30` |
| **✦ Fresh & Calm** | un-owned, stable, not extended, no event | `ownership:"not_held"`, `trend_states:["uptrend","pullback","recovering"]`, `gex_envs:["stabilized","neutral"]`, `bb_position_max:0.60`, `earnings_days_min:30` |
| **✦ Pinned & Paid** | sell premium where dealers dampen moves | `gex_envs:["stabilized"]`, `iv_rank_min:50`, `raw_iv_min:0.35`, `earnings_days_min:30` |
| **✦ Write Zone** | *held book:* which assigned names are in a call-writing window | `ownership:"held"`, `gex_envs:["stabilized"]`, `iv_rank_min:40`, `rsi_buckets:["neutral","overbought"]` |

Notes:
- **`earnings_days_min:30`**, not 21. Verified entry-DTE distribution (last 120d,
  n=88): avg 24, p90 32, max 42. A 21-day gate lets earnings land *inside* the
  contract on most entries; 30 covers the average book with buffer. One central
  knob — nudge toward 35 if you want to clear the p90.
- **Juiced Premium** deliberately does not claim safety. At `iv_rank≥50 &
  raw_iv≥50%` it currently matches ~32/55 names, dominated by the 90–124%-IV
  cluster (NBIS, IREN, MU, DRAM, WDC, COHR, STX, LRCX…) — the names re-inflating
  the assigned book. Honest read: "well-paid, but you'll likely be assigned."
- **Fresh & Calm** carries `bb_position_max:0.60` so extended top-of-band names
  (FTNT 0.72, RTX 0.84, SHOP 0.65 today) don't pass. "Calm" = stable tape + not
  downtrend + not extended; it does **not** assert "safe."
- **Write Zone** is a *surfacer*, not a strike-picker. It answers "where should I
  even be looking to write calls today," not "what strike" — the below-cost /
  roll-to-assignment-price nuance lives in the `cc-gex-decision` skill, not a
  screen. `rsi_buckets:["neutral","overbought"]` avoids writing a call right at a
  bounce low (capping upside on a name that just turned up). No earnings gate:
  earnings-before-expiry is context-dependent for CCs, not a blanket exclude.
- `raw_iv_min` is a decimal (0.50 = 50%), matching existing `filterSummaryLines`.
- `bb_position_max:0.20` = "below band or near lower"; `0.60` = "not extended".
- `rsi_buckets:["oversold","neutral"]` = "RSI ≠ Overbought".
- All thresholds are the agreed starting values, tunable in this one file.

## 5. Preset-bar behavior

`RadarTab.jsx` + `RadarPresetBar.jsx`:
- **Merge** `CURATED_PRESETS` ahead of the user's `radar_presets`. Curated render
  first, prefixed with `✦`.
- Curated presets are **non-editable** (no ✎) and **non-deletable** — gate the
  edit/delete UI on `!preset.builtin` (equivalently, id not starting `builtin:`).
- Curated presets **always render as pills**, never folded into the dropdown, so
  they stay one-click. The `PRESET_BUTTON_THRESHOLD` fold-to-dropdown rule
  applies to **user presets only**.
- `applyPreset` handles built-in string ids with **no DB call** — it just merges
  `preset.filters` over `DEFAULT_FILTERS` and sets `activePresetId`. Selecting an
  active preset again clears it (existing toggle behavior). Manual filter edits
  clear `activePresetId` (existing behavior).
- **Live match-count on each curated pill** — e.g. `✦ Prime Setup (3)`. Several
  presets stack many conditions (Prime Setup = 6) or intersect naturally-rare
  states (Oversold Bounce asks oversold AND not-downtrend, a small set by
  construction), so they'll often return 0. A visible count turns "empty" into
  information (rare = high-conviction) instead of a dead click that trains the
  user to loosen filters. Compute by running `rowMatchesFilters(row,
  {...DEFAULT_FILTERS, ...preset.filters}, ctx)` over `rows` per curated preset —
  cheap (6 presets × ~55 rows), memoized on `rows`. User presets get no count.
- **Persistent caption** under the curated pills (small, muted): *"Confirmation
  screens — not deploy triggers. Checklist + Ryan-first before any entry."* (§0).

## 6. Testing

`src/lib/__tests__/radarFilter.test.js`:
- Each new dimension: a row that matches, one that doesn't, and a null-value row
  under an active filter (must be excluded).
- Empty allow-set = pass-through (no filtering).
- `ownership` symmetric: `"held"` and `"not_held"` each filter correctly (Write
  Zone depends on the `held` branch).
- Existing numeric/sector/ownership/earnings behavior preserved (regression).

`src/components/radar/__tests__/curatedPresets.test.js`:
- Every key in every curated preset's `filters` is a valid `DEFAULT_FILTERS`
  field (guards against a typo silently no-op'ing).
- Every allow-set value is a member of that dimension's known-bucket list.
- No preset name contains action-imperative words ("entry", "buy", "enter",
  "safe") — lightweight lint keeping §0 naming discipline from eroding later.

## 7. Known blind spot — household concentration (flag, don't build)

Presets filter one ticker at a time; they cannot see portfolio-level
concentration, which is one of the user's stated risk principles. A name
surfacing in **Prime Setup** may be the same AI-infra / high-beta cluster as the
heavy assigned book (CLS, NBIS, IREN, CRDO…) — in a drawdown it behaves as *more
of the same bet*, and nothing here catches that. A clean 5-name Prime Setup list
is not evidence of diversification.

Out of scope to solve in a per-row screen. Action: a code comment at the top of
`curatedPresets.js` naming the limitation, so future work doesn't misread a
curated list as concentration-aware.

## Files touched

- `src/components/radar/radarConstants.js` — DEFAULT_FILTERS, counts, summary, labels
- `src/lib/radarFilter.js` — **new**, `rowMatchesFilters`
- `src/components/radar/curatedPresets.js` — **new**, CURATED_PRESETS
- `src/components/radar/RadarAdvancedFilters.jsx` — 5 pill-toggle rows (Trend, RSI, Score, GEX, IV-Trend)
- `src/components/radar/RadarPresetBar.jsx` — built-in rendering, edit/delete gating, match-count on curated pills, persistent caption
- `src/components/RadarTab.jsx` — call rowMatchesFilters, merge curated presets, applyPreset, compute per-preset match counts
- tests as above

`ownership: "held"` (needed by Write Zone) is **already** in the filter model and
applied in `RadarTab.jsx` — no new dimension, just a preset that uses it.
No DB migration (curated presets live in code; filters are client-side).
