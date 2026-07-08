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
  { id: "builtin:prime-entry",     name: "Prime Entry",     builtin: true, filters: {...} },
  { id: "builtin:oversold-bounce", name: "Oversold Bounce", builtin: true, filters: {...} },
  { id: "builtin:rich-premium",    name: "Rich Premium",    builtin: true, filters: {...} },
  { id: "builtin:fresh-safe",      name: "Fresh & Safe",    builtin: true, filters: {...} },
  { id: "builtin:pinned-paid",     name: "Pinned & Paid",   builtin: true, filters: {...} },
];
export const CURATED_ICON = "✦";
```

Each `filters` is a partial `DEFAULT_FILTERS` (merged over defaults on apply).

| Preset | Encodes | filters |
|---|---|---|
| **✦ Prime Entry** | cheap, top-scoring, no knife, calm tape, no event, room to add | `score_buckets:["Strong"]`, `bb_position_max:0.20`, `trend_states:["uptrend","pullback","recovering"]`, `gex_envs:["stabilized","neutral"]`, `earnings_days_min:21`, `ownership:"not_held"` |
| **✦ Oversold Bounce** | oversold and turning, not falling | `rsi_buckets:["oversold"]`, `bb_position_max:0.20`, `trend_states:["uptrend","pullback","recovering"]` |
| **✦ Rich Premium** | fat premium in relative AND absolute terms | `iv_rank_min:50`, `raw_iv_min:0.50`, `rsi_buckets:["oversold","neutral"]`, `earnings_days_min:21` |
| **✦ Fresh & Safe** | new, stable, un-owned candidates | `ownership:"not_held"`, `trend_states:["uptrend","pullback","recovering"]`, `gex_envs:["stabilized","neutral"]`, `earnings_days_min:21` |
| **✦ Pinned & Paid** | sell premium where dealers dampen moves | `gex_envs:["stabilized"]`, `iv_rank_min:50`, `raw_iv_min:0.35`, `earnings_days_min:21` |

Notes:
- `raw_iv_min` is a decimal (0.50 = 50%), matching existing `filterSummaryLines`.
- `bb_position_max:0.20` = "below band or near lower" (BB Position < 0.20).
- `rsi_buckets:["oversold","neutral"]` = "RSI ≠ Overbought".
- Numbers (50 IVR, 0.50/0.35 IV, 21 DTE) are the agreed starting values, tunable
  in one place.

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

## 6. Testing

`src/lib/__tests__/radarFilter.test.js`:
- Each new dimension: a row that matches, one that doesn't, and a null-value row
  under an active filter (must be excluded).
- Empty allow-set = pass-through (no filtering).
- Existing numeric/sector/ownership/earnings behavior preserved (regression).

`src/components/radar/__tests__/curatedPresets.test.js`:
- Every key in every curated preset's `filters` is a valid `DEFAULT_FILTERS`
  field (guards against a typo silently no-op'ing).
- Every allow-set value is a member of that dimension's known-bucket list.

## Files touched

- `src/components/radar/radarConstants.js` — DEFAULT_FILTERS, counts, summary, labels
- `src/lib/radarFilter.js` — **new**, `rowMatchesFilters`
- `src/components/radar/curatedPresets.js` — **new**, CURATED_PRESETS
- `src/components/radar/RadarAdvancedFilters.jsx` — 5 pill-toggle rows
- `src/components/radar/RadarPresetBar.jsx` — built-in rendering, edit/delete gating
- `src/components/RadarTab.jsx` — call rowMatchesFilters, merge curated presets, applyPreset
- tests as above

No DB migration required (curated presets live in code; filters are client-side).
