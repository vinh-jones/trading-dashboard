# Radar Chip-Signal Filtering + Curated Presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Radar signal chips (Trend, RSI, Score, GEX, IV-Trend) filterable, and ship six built-in curated presets that combine them into one-click setups.

**Architecture:** Add five array-valued "allow-set" filters to the existing client-side filter model. Extract the (currently inline) row-filter into a pure, unit-tested `rowMatchesFilters(row, filters, ctx)` in `src/lib/radarFilter.js`, where component-local lookups (ownership, earnings-days, IV-trend) are injected via `ctx`. Curated presets live in a code constant, render first in the existing preset bar as non-editable ✦ pills with a live match-count, and reuse the existing preset-apply path.

**Tech Stack:** React (inline-style components, no CSS/Tailwind), Vitest, Supabase (read-only here — no schema change). All styles via `theme` tokens from `src/lib/theme.js`.

**Spec:** `docs/superpowers/specs/2026-07-08-radar-curated-presets-design.md`

**Conventions (from CLAUDE.md):** never hardcode hex (use `theme`); check `git show origin/main:package.json` before the version bump; bump `package.json` + `src/lib/constants.js` together; commit to a branch, PR, merge, push.

---

## File Structure

- `src/components/radar/radarConstants.js` — **modify**: add 5 filter fields to `DEFAULT_FILTERS`, 5 option-list exports, extend `countActiveFilters` + `filterSummaryLines`.
- `src/lib/radarFilter.js` — **new**: pure `rowMatchesFilters(row, filters, ctx)`.
- `src/lib/__tests__/radarFilter.test.js` — **new**: unit tests.
- `src/components/radar/curatedPresets.js` — **new**: `CURATED_PRESETS`, `CURATED_ICON`, concentration blind-spot comment.
- `src/components/radar/__tests__/curatedPresets.test.js` — **new**: validity + naming-discipline tests.
- `src/components/radar/RadarAdvancedFilters.jsx` — **modify**: 5 pill-toggle rows.
- `src/components/radar/RadarPresetBar.jsx` — **modify**: built-in rendering, edit/delete gating, match-count, caption.
- `src/components/RadarTab.jsx` — **modify**: call `rowMatchesFilters`, merge curated presets, `applyPreset` built-in handling, compute per-preset counts.

---

## Task 1: Extend the filter model (radarConstants.js)

**Files:**
- Modify: `src/components/radar/radarConstants.js`
- Test: `src/components/radar/__tests__/radarConstants.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `src/components/radar/__tests__/radarConstants.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  countActiveFilters,
  filterSummaryLines,
  TREND_FILTER_OPTIONS,
  RSI_FILTER_OPTIONS,
  SCORE_FILTER_OPTIONS,
  GEX_FILTER_OPTIONS,
  IV_TREND_FILTER_OPTIONS,
} from "../radarConstants.js";

describe("DEFAULT_FILTERS new allow-set fields", () => {
  it("includes the five chip-signal arrays, each empty by default", () => {
    expect(DEFAULT_FILTERS.trend_states).toEqual([]);
    expect(DEFAULT_FILTERS.rsi_buckets).toEqual([]);
    expect(DEFAULT_FILTERS.score_buckets).toEqual([]);
    expect(DEFAULT_FILTERS.gex_envs).toEqual([]);
    expect(DEFAULT_FILTERS.iv_trend_states).toEqual([]);
  });
});

describe("countActiveFilters with allow-sets", () => {
  it("counts each non-empty allow-set as one active filter", () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, trend_states: ["uptrend"] })).toBe(1);
    expect(countActiveFilters({
      ...DEFAULT_FILTERS,
      trend_states: ["uptrend"], rsi_buckets: ["oversold"], score_buckets: ["Strong"],
      gex_envs: ["stabilized"], iv_trend_states: ["rising"],
    })).toBe(5);
  });
  it("ignores empty allow-sets", () => {
    expect(countActiveFilters({ ...DEFAULT_FILTERS, trend_states: [] })).toBe(0);
  });
});

describe("filterSummaryLines with allow-sets", () => {
  it("emits one labeled line per non-empty allow-set", () => {
    const lines = filterSummaryLines({
      ...DEFAULT_FILTERS,
      trend_states: ["uptrend", "pullback"],
      score_buckets: ["Strong"],
    });
    expect(lines).toContain("Trend: Uptrend, Pullback");
    expect(lines).toContain("Score: Strong");
  });
});

describe("filter option lists", () => {
  it("expose [value,label] pairs for each dimension", () => {
    expect(TREND_FILTER_OPTIONS).toEqual([
      ["uptrend", "Uptrend"], ["pullback", "Pullback"],
      ["recovering", "Recovering"], ["downtrend", "Downtrend"],
    ]);
    expect(RSI_FILTER_OPTIONS.map(o => o[0])).toEqual(["oversold", "neutral", "overbought"]);
    expect(SCORE_FILTER_OPTIONS.map(o => o[0])).toEqual(["Strong", "Moderate", "Neutral", "Weak"]);
    expect(GEX_FILTER_OPTIONS.map(o => o[0])).toEqual(["stabilized", "choppy", "neutral"]);
    expect(IV_TREND_FILTER_OPTIONS.map(o => o[0])).toEqual(["rising", "spiking", "falling", "collapsing", "stable"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/radar/__tests__/radarConstants.test.js`
Expected: FAIL — `TREND_FILTER_OPTIONS` (etc.) undefined; `DEFAULT_FILTERS.trend_states` undefined.

- [ ] **Step 3: Add the fields, option lists, and extend the two helpers**

In `src/components/radar/radarConstants.js`, add the five fields to `DEFAULT_FILTERS` (place them just after `iv_rank_max: null,`):

```js
  iv_rank_min:      null,
  iv_rank_max:      null,
  // Chip-signal allow-sets — empty = not filtered; non-empty = row's bucket must be a member.
  trend_states:     [],
  rsi_buckets:      [],
  score_buckets:    [],
  gex_envs:         [],
  iv_trend_states:  [],
```

Add the option lists near the top (after the `SECTOR_GROUPS` export or anywhere module-scope). These are `[value, label]` pairs; `value` must match the runtime bucket strings from `entryScore.js` / `rsi.js` / `quotes.gex_env`:

```js
// ── Chip-signal filter options ────────────────────────────────────────────────
// value = the exact bucket string produced at runtime (getTrendState().state,
// rsiBucket(), scoreLabel(), quotes.gex_env, ivTrend.state). Do not rename values.
export const TREND_FILTER_OPTIONS = [
  ["uptrend", "Uptrend"], ["pullback", "Pullback"],
  ["recovering", "Recovering"], ["downtrend", "Downtrend"],
];
export const RSI_FILTER_OPTIONS = [
  ["oversold", "Oversold"], ["neutral", "Neutral"], ["overbought", "Overbought"],
];
export const SCORE_FILTER_OPTIONS = [
  ["Strong", "Strong"], ["Moderate", "Moderate"], ["Neutral", "Neutral"], ["Weak", "Weak"],
];
export const GEX_FILTER_OPTIONS = [
  ["stabilized", "Stable"], ["choppy", "Choppy"], ["neutral", "Neutral"],
];
export const IV_TREND_FILTER_OPTIONS = [
  ["rising", "Rising"], ["spiking", "Spiking"], ["falling", "Falling"],
  ["collapsing", "Collapsing"], ["stable", "Stable"],
];

// Maps a filter field → its option list, for generic summary/labeling.
const ALLOW_SET_FIELDS = [
  ["trend_states",    "Trend", TREND_FILTER_OPTIONS],
  ["rsi_buckets",     "RSI",   RSI_FILTER_OPTIONS],
  ["score_buckets",   "Score", SCORE_FILTER_OPTIONS],
  ["gex_envs",        "GEX",   GEX_FILTER_OPTIONS],
  ["iv_trend_states", "IV Trend", IV_TREND_FILTER_OPTIONS],
];
```

Extend `countActiveFilters` — add before `return count;`:

```js
  ALLOW_SET_FIELDS.forEach(([field]) => {
    if (filters[field]?.length > 0) count++;
  });
```

Extend `filterSummaryLines` — add before `return lines;`:

```js
  ALLOW_SET_FIELDS.forEach(([field, label, options]) => {
    const vals = filters[field] ?? [];
    if (vals.length > 0) {
      const labelFor = v => (options.find(o => o[0] === v)?.[1]) ?? v;
      lines.push(`${label}: ${vals.map(labelFor).join(", ")}`);
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/radar/__tests__/radarConstants.test.js`
Expected: PASS (all 4 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/components/radar/radarConstants.js src/components/radar/__tests__/radarConstants.test.js
git commit -m "feat(radar): add chip-signal allow-set filter fields + options"
```

---

## Task 2: Pure row-filter helper (radarFilter.js)

**Files:**
- Create: `src/lib/radarFilter.js`
- Test: `src/lib/__tests__/radarFilter.test.js`

Context: `rowMatchesFilters` folds in the existing numeric/sector/ownership/earnings
checks (moved **unchanged** — same `!== null` semantics, so a null `bb_position`
still behaves as today) plus the five new allow-sets. Component-local lookups are
injected via `ctx` so the helper stays pure:

```
ctx = {
  isHeld:           (ticker) => boolean,
  earningsDaysAway: (ticker) => number | null,
  ivTrend:          (ticker) => ({ state, modifier } | null),
  includeSectors:   string[],   // already expanded via expandGroupsToSectors
  excludeSectors:   string[],
}
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/radarFilter.test.js`:

```js
import { describe, it, expect } from "vitest";
import { rowMatchesFilters } from "../radarFilter.js";
import { DEFAULT_FILTERS } from "../../components/radar/radarConstants.js";

// A permissive ctx: nothing held, no earnings, no IV-trend, no sector constraints.
const baseCtx = {
  isHeld: () => false,
  earningsDaysAway: () => null,
  ivTrend: () => null,
  includeSectors: [],
  excludeSectors: [],
};

// A row that, with DEFAULT_FILTERS, passes everything.
function makeRow(over = {}) {
  return {
    ticker: "AAA", sector: "Technology",
    last: 100, ma_50: 90, ma_200: 80,          // price above both MAs → uptrend
    bb_position: 0.10, iv: 0.60, iv_rank: 80,   // cheap + rich → Strong-ish
    rsi_14: 25,                                 // oversold
    gex_env: "stabilized",
    gamma_env: null, flow_tape_ema: null,
    pe_ttm: 20,
    ...over,
  };
}

describe("rowMatchesFilters — passthrough", () => {
  it("passes a normal row under DEFAULT_FILTERS", () => {
    expect(rowMatchesFilters(makeRow(), DEFAULT_FILTERS, baseCtx)).toBe(true);
  });
});

describe("rowMatchesFilters — existing numeric/ownership/earnings preserved", () => {
  it("excludes on bb_position_max", () => {
    expect(rowMatchesFilters(makeRow({ bb_position: 0.5 }), { ...DEFAULT_FILTERS, bb_position_max: 0.20 }, baseCtx)).toBe(false);
  });
  it("lets unknown P/E pass a pe_min filter", () => {
    expect(rowMatchesFilters(makeRow({ pe_ttm: null }), { ...DEFAULT_FILTERS, pe_min: 10 }, baseCtx)).toBe(true);
  });
  it("ownership is symmetric (held / not_held)", () => {
    const heldCtx = { ...baseCtx, isHeld: () => true };
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, ownership: "held" }, heldCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, ownership: "held" }, baseCtx)).toBe(false);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, ownership: "not_held" }, heldCtx)).toBe(false);
  });
  it("earnings_days_min excludes a near-earnings row but passes unknown", () => {
    const soon = { ...baseCtx, earningsDaysAway: () => 10 };
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, earnings_days_min: 30 }, soon)).toBe(false);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, earnings_days_min: 30 }, baseCtx)).toBe(true); // null = unknown passes
  });
});

describe("rowMatchesFilters — trend_states", () => {
  it("matches an uptrend row, excludes when only downtrend allowed", () => {
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, trend_states: ["uptrend", "pullback", "recovering"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, trend_states: ["downtrend"] }, baseCtx)).toBe(false);
  });
  it("excludes a row with null trend inputs under an active trend filter", () => {
    expect(rowMatchesFilters(makeRow({ last: null }), { ...DEFAULT_FILTERS, trend_states: ["uptrend"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — rsi_buckets", () => {
  it("matches oversold, excludes overbought-only, excludes null RSI", () => {
    expect(rowMatchesFilters(makeRow({ rsi_14: 25 }), { ...DEFAULT_FILTERS, rsi_buckets: ["oversold"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow({ rsi_14: 25 }), { ...DEFAULT_FILTERS, rsi_buckets: ["overbought"] }, baseCtx)).toBe(false);
    expect(rowMatchesFilters(makeRow({ rsi_14: null }), { ...DEFAULT_FILTERS, rsi_buckets: ["oversold"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — gex_envs", () => {
  it("matches membership, excludes non-member and null", () => {
    expect(rowMatchesFilters(makeRow({ gex_env: "stabilized" }), { ...DEFAULT_FILTERS, gex_envs: ["stabilized", "neutral"] }, baseCtx)).toBe(true);
    expect(rowMatchesFilters(makeRow({ gex_env: "choppy" }), { ...DEFAULT_FILTERS, gex_envs: ["stabilized", "neutral"] }, baseCtx)).toBe(false);
    expect(rowMatchesFilters(makeRow({ gex_env: null }), { ...DEFAULT_FILTERS, gex_envs: ["stabilized"] }, baseCtx)).toBe(false);
  });
});

describe("rowMatchesFilters — iv_trend_states", () => {
  it("matches ctx-supplied state, excludes non-member and null", () => {
    const rising = { ...baseCtx, ivTrend: () => ({ state: "rising", modifier: 1.10 }) };
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, iv_trend_states: ["rising"] }, rising)).toBe(true);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, iv_trend_states: ["falling"] }, rising)).toBe(false);
    expect(rowMatchesFilters(makeRow(), { ...DEFAULT_FILTERS, iv_trend_states: ["rising"] }, baseCtx)).toBe(false); // null state
  });
});

describe("rowMatchesFilters — score_buckets", () => {
  it("passes when the row's real score label is allowed, excludes otherwise", () => {
    // Compute the row's actual label via the same libs to avoid hardcoding score math.
    const row = makeRow();
    // Allowing every bucket must pass; allowing an impossible-only set must fail.
    const allBuckets = ["Strong", "Moderate", "Neutral", "Weak"];
    expect(rowMatchesFilters(row, { ...DEFAULT_FILTERS, score_buckets: allBuckets }, baseCtx)).toBe(true);
    // A row with null bb_position has null score → excluded under any active score filter.
    expect(rowMatchesFilters(makeRow({ bb_position: null }), { ...DEFAULT_FILTERS, score_buckets: allBuckets }, baseCtx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/radarFilter.test.js`
Expected: FAIL — `rowMatchesFilters` is not defined (module missing).

- [ ] **Step 3: Implement `rowMatchesFilters`**

Create `src/lib/radarFilter.js`:

```js
// Pure row predicate for the Radar advanced filters. Extracted from RadarTab so
// it can be unit-tested in isolation. Component-local lookups (ownership,
// earnings-days, IV-trend) are injected via `ctx`; everything else is computed
// here from the row + the shared entryScore/rsi libs.
//
// Covers ALL advanced-filter dimensions. The separate BB-bucket pill filter
// (`bbFilter`) stays in RadarTab and is applied before this.

import { compositeIv, getTrendState, entryScore, scoreLabel } from "./entryScore.js";
import { rsiBucket } from "./rsi.js";

/**
 * @param {object} row     a merged Radar row (quotes + fundamentals + uw_signals)
 * @param {object} filters advancedFilters (DEFAULT_FILTERS shape)
 * @param {object} ctx     { isHeld, earningsDaysAway, ivTrend, includeSectors, excludeSectors }
 * @returns {boolean}
 */
export function rowMatchesFilters(row, filters, ctx) {
  const f = filters;

  // ── Numeric ranges (moved unchanged from RadarTab) ──
  if (f.bb_position_min  !== null && row.bb_position < f.bb_position_min)  return false;
  if (f.bb_position_max  !== null && row.bb_position > f.bb_position_max)  return false;
  if (f.raw_iv_min       !== null && row.iv          < f.raw_iv_min)       return false;
  if (f.raw_iv_max       !== null && row.iv          > f.raw_iv_max)       return false;
  const civ = compositeIv(row.iv, row.iv_rank);
  if (f.composite_iv_min !== null && civ             < f.composite_iv_min) return false;
  if (f.composite_iv_max !== null && civ             > f.composite_iv_max) return false;
  if (f.iv_rank_min      !== null && row.iv_rank     < f.iv_rank_min)      return false;
  if (f.iv_rank_max      !== null && row.iv_rank     > f.iv_rank_max)      return false;
  if (f.pe_min !== null && row.pe_ttm != null && row.pe_ttm < f.pe_min)    return false;
  if (f.pe_max !== null && row.pe_ttm != null && row.pe_ttm > f.pe_max)    return false;

  // ── Sectors (pre-expanded in ctx) ──
  if (ctx.includeSectors.length > 0) {
    if (!ctx.includeSectors.includes(row.sector)) return false;
  } else if (ctx.excludeSectors.length > 0) {
    if (ctx.excludeSectors.includes(row.sector)) return false;
  }

  // ── Ownership ──
  const isHeld = ctx.isHeld(row.ticker);
  if (f.ownership === "not_held" && isHeld)  return false;
  if (f.ownership === "held"     && !isHeld) return false;

  // ── Earnings (null days = unknown = passes, unchanged) ──
  if (f.earnings_days_min !== null) {
    const days = ctx.earningsDaysAway(row.ticker);
    if (days !== null && days < f.earnings_days_min) return false;
  }

  // ── Chip-signal allow-sets (empty = skip; null value under active filter = exclude) ──
  const ivTrend = ctx.ivTrend(row.ticker);

  if (f.trend_states?.length) {
    const t = getTrendState(row.last, row.ma_50, row.ma_200)?.state ?? null;
    if (!t || !f.trend_states.includes(t)) return false;
  }
  if (f.rsi_buckets?.length) {
    const b = rsiBucket(row.rsi_14);
    if (!b || !f.rsi_buckets.includes(b)) return false;
  }
  if (f.score_buckets?.length) {
    const s = scoreLabel(entryScore(
      row.bb_position, row.iv, row.iv_rank, row.last, row.ma_50, row.ma_200,
      ivTrend, row.gamma_env, row.flow_tape_ema,
    ));
    if (!s || !f.score_buckets.includes(s)) return false;
  }
  if (f.gex_envs?.length) {
    if (!row.gex_env || !f.gex_envs.includes(row.gex_env)) return false;
  }
  if (f.iv_trend_states?.length) {
    const st = ivTrend?.state ?? null;
    if (!st || !f.iv_trend_states.includes(st)) return false;
  }

  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/radarFilter.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/radarFilter.js src/lib/__tests__/radarFilter.test.js
git commit -m "feat(radar): pure rowMatchesFilters helper with chip-signal allow-sets"
```

---

## Task 3: Wire `rowMatchesFilters` into RadarTab (replace inline filter)

**Files:**
- Modify: `src/components/RadarTab.jsx` (the `processedRows` memo, ~lines 1480–1522)

No new unit test (component-level); verified by the Task 2 unit tests + a full
build + the existing suite staying green.

- [ ] **Step 1: Add the import**

At the top of `src/components/RadarTab.jsx`, near the other lib imports:

```js
import { rowMatchesFilters } from "../lib/radarFilter";
```

- [ ] **Step 2: Replace the inline advanced-filter block**

In the `processedRows` memo, replace the block that currently starts at
`// 2. Advanced filters` and ends at the close of the `result = result.filter(row => { ... })`
call (the numeric/sector/ownership/earnings inline checks) with:

```js
    // 2. Advanced filters — delegated to the pure, tested helper.
    const f = advancedFilters;
    const ctx = {
      isHeld:           (ticker) => getPositionIndicators(ticker, positions).length > 0,
      earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, marketContext),
      ivTrend:          (ticker) => ivTrendsByTicker.get(ticker) ?? null,
      includeSectors:   expandGroupsToSectors(f.sectors_include),
      excludeSectors:   expandGroupsToSectors(f.sectors_exclude),
    };
    result = result.filter(row => rowMatchesFilters(row, f, ctx));
```

Leave the `// 1. BB bucket filter` block (using `bbFilter`) above it untouched,
and the `// 3. Sort` block below it untouched. `expandGroupsToSectors` is already
imported in RadarTab; confirm it is (it is, from `./radar/radarConstants`).

- [ ] **Step 3: Run the full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build succeeds. (No behavior change for existing
filters; the new dims are inert until a preset/pill sets them.)

- [ ] **Step 4: Commit**

```bash
git add src/components/RadarTab.jsx
git commit -m "refactor(radar): route advanced filters through rowMatchesFilters"
```

---

## Task 4: Curated presets constant (curatedPresets.js)

**Files:**
- Create: `src/components/radar/curatedPresets.js`
- Test: `src/components/radar/__tests__/curatedPresets.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/components/radar/__tests__/curatedPresets.test.js`:

```js
import { describe, it, expect } from "vitest";
import { CURATED_PRESETS, CURATED_ICON } from "../curatedPresets.js";
import {
  DEFAULT_FILTERS,
  TREND_FILTER_OPTIONS, RSI_FILTER_OPTIONS, SCORE_FILTER_OPTIONS,
  GEX_FILTER_OPTIONS, IV_TREND_FILTER_OPTIONS,
} from "../radarConstants.js";

const ALLOW_SETS = {
  trend_states:    TREND_FILTER_OPTIONS.map(o => o[0]),
  rsi_buckets:     RSI_FILTER_OPTIONS.map(o => o[0]),
  score_buckets:   SCORE_FILTER_OPTIONS.map(o => o[0]),
  gex_envs:        GEX_FILTER_OPTIONS.map(o => o[0]),
  iv_trend_states: IV_TREND_FILTER_OPTIONS.map(o => o[0]),
};

describe("CURATED_PRESETS", () => {
  it("has the six expected presets, all builtin with unique ids", () => {
    const names = CURATED_PRESETS.map(p => p.name);
    expect(names).toEqual([
      "Prime Setup", "Oversold Bounce", "Juiced Premium",
      "Fresh & Calm", "Pinned & Paid", "Write Zone",
    ]);
    expect(CURATED_PRESETS.every(p => p.builtin === true)).toBe(true);
    expect(CURATED_PRESETS.every(p => p.id.startsWith("builtin:"))).toBe(true);
    expect(new Set(CURATED_PRESETS.map(p => p.id)).size).toBe(CURATED_PRESETS.length);
    expect(CURATED_ICON).toBe("✦");
  });

  it("every filter key is a real DEFAULT_FILTERS field", () => {
    const valid = new Set(Object.keys(DEFAULT_FILTERS));
    for (const p of CURATED_PRESETS) {
      for (const k of Object.keys(p.filters)) {
        expect(valid.has(k), `${p.name}.${k}`).toBe(true);
      }
    }
  });

  it("every allow-set value is a known bucket", () => {
    for (const p of CURATED_PRESETS) {
      for (const [field, allowed] of Object.entries(ALLOW_SETS)) {
        for (const v of (p.filters[field] ?? [])) {
          expect(allowed.includes(v), `${p.name}.${field}=${v}`).toBe(true);
        }
      }
    }
  });

  it("uses no action-imperative / safety names (naming discipline)", () => {
    const banned = /\b(entry|buy|enter|safe)\b/i;
    for (const p of CURATED_PRESETS) {
      expect(banned.test(p.name), p.name).toBe(false);
    }
  });

  it("pins the agreed thresholds", () => {
    const by = id => CURATED_PRESETS.find(p => p.id === id).filters;
    expect(by("builtin:juiced-premium")).toMatchObject({ iv_rank_min: 50, raw_iv_min: 0.50 });
    expect(by("builtin:fresh-calm")).toMatchObject({ bb_position_max: 0.60 });
    expect(by("builtin:write-zone")).toMatchObject({ ownership: "held" });
    // earnings gate is 30 (not 21) everywhere it appears
    for (const p of CURATED_PRESETS) {
      if ("earnings_days_min" in p.filters) expect(p.filters.earnings_days_min).toBe(30);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/radar/__tests__/curatedPresets.test.js`
Expected: FAIL — `curatedPresets.js` module not found.

- [ ] **Step 3: Create the constant**

Create `src/components/radar/curatedPresets.js`:

```js
// Built-in, curated Radar filter presets — one-click "setups" that combine the
// numeric metrics with the chip-signal allow-sets (Task 1). These live in code
// (not radar_presets) so they're always present, non-deletable, and tunable in
// one place.
//
// NAMING DISCIPLINE: presets are named for WHAT MATCHED THE SCREEN
// (setup-descriptive), never for what to do (no "Entry"/"Buy"/"Safe"). The radar
// is a CONFIRMATION screen, subordinate to Ryan-first + the checklist + the VIX
// cash target — not a deploy trigger. Same relabelling the UW work applied.
//
// BLIND SPOT: these filter one ticker at a time and CANNOT see household-level
// concentration. A clean Prime Setup list can be five names in the same AI-infra
// / high-beta cluster as the assigned book (CLS, NBIS, IREN, CRDO…); in a
// drawdown that's one bet, not five. A screen can't catch this — judge it
// separately.
//
// Thresholds are the agreed starting values (see the design spec); tune here.

export const CURATED_ICON = "✦";

export const CURATED_PRESETS = [
  {
    id: "builtin:prime-setup",
    name: "Prime Setup",
    builtin: true,
    filters: {
      score_buckets: ["Strong"],
      bb_position_max: 0.20,
      trend_states: ["uptrend", "pullback", "recovering"],
      gex_envs: ["stabilized", "neutral"],
      earnings_days_min: 30,
      ownership: "not_held",
    },
  },
  {
    id: "builtin:oversold-bounce",
    name: "Oversold Bounce",
    builtin: true,
    filters: {
      rsi_buckets: ["oversold"],
      bb_position_max: 0.20,
      trend_states: ["uptrend", "pullback", "recovering"],
    },
  },
  {
    id: "builtin:juiced-premium",
    name: "Juiced Premium",
    builtin: true,
    // High IV both relative (rank) AND absolute — this is the high-vol assignment
    // cluster, NOT a safety screen. Well-paid, but assignment is likely.
    filters: {
      iv_rank_min: 50,
      raw_iv_min: 0.50,
      rsi_buckets: ["oversold", "neutral"], // ≠ overbought
      earnings_days_min: 30,
    },
  },
  {
    id: "builtin:fresh-calm",
    name: "Fresh & Calm",
    builtin: true,
    filters: {
      ownership: "not_held",
      trend_states: ["uptrend", "pullback", "recovering"],
      gex_envs: ["stabilized", "neutral"],
      bb_position_max: 0.60, // not extended
      earnings_days_min: 30,
    },
  },
  {
    id: "builtin:pinned-paid",
    name: "Pinned & Paid",
    builtin: true,
    filters: {
      gex_envs: ["stabilized"],
      iv_rank_min: 50,
      raw_iv_min: 0.35,
      earnings_days_min: 30,
    },
  },
  {
    id: "builtin:write-zone",
    name: "Write Zone",
    builtin: true,
    // Held book: which assigned names are in a call-writing window. A surfacer,
    // not a strike-picker — the below-cost / roll nuance lives in cc-gex-decision.
    filters: {
      ownership: "held",
      gex_envs: ["stabilized"],
      iv_rank_min: 40,
      rsi_buckets: ["neutral", "overbought"], // don't cap upside writing at a bounce low
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/radar/__tests__/curatedPresets.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/radar/curatedPresets.js src/components/radar/__tests__/curatedPresets.test.js
git commit -m "feat(radar): six built-in curated presets"
```

---

## Task 5: Filter UI — five pill-toggle rows (RadarAdvancedFilters.jsx)

**Files:**
- Modify: `src/components/radar/RadarAdvancedFilters.jsx`

UI change — verified by build + preview (the Radar tab renders real quotes from
Supabase locally; the filter pills work client-side).

- [ ] **Step 1: Add imports + a generic bucket-row component**

At the top of `RadarAdvancedFilters.jsx`, extend the radarConstants import:

```js
import {
  SECTOR_GROUPS,
  TREND_FILTER_OPTIONS, RSI_FILTER_OPTIONS, SCORE_FILTER_OPTIONS,
  GEX_FILTER_OPTIONS, IV_TREND_FILTER_OPTIONS,
} from "./radarConstants";
```

Add a generic pill (mirrors `SectorBtn`'s monochrome blue-active style) and a row,
placed just above the `// ── Main component ──` banner:

```js
// ── Generic allow-set pill + row (monochrome blue-active, like SectorBtn) ──────
function BucketPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize:     theme.size.xs,
        padding:      `2px ${theme.space[2]}px`,
        borderRadius: theme.radius.pill,
        border:       `1px solid ${active ? theme.blue : theme.border.default}`,
        background:   active ? theme.blue : "transparent",
        color:        active ? theme.text.primary : theme.text.muted,
        cursor:       "pointer",
        fontWeight:   active ? 600 : 400,
        whiteSpace:   "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function BucketFilterRow({ label, field, options, filters, onToggle }) {
  const selected = filters[field] ?? [];
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[2] }}>
      <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0, minWidth: 64 }}>{label}:</span>
      {options.map(([value, optLabel]) => (
        <BucketPill
          key={value}
          label={optLabel}
          active={selected.includes(value)}
          onClick={() => onToggle(field, value)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add a generic toggle handler**

Inside the `RadarAdvancedFilters` component body, next to `toggleSectorGroup`:

```js
  function toggleBucket(field, value) {
    const current = filters[field] ?? [];
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onChange(field, next);
  }
```

- [ ] **Step 3: Render the five rows**

Insert a new block immediately after the closing `</div>` of the `{/* ── Sector toggles ── */}`
section and before `{/* ── Ownership + Earnings ── */}`:

```jsx
      {/* ── Chip-signal allow-sets ── */}
      <div style={{ marginBottom: theme.space[3] }}>
        <BucketFilterRow label="Trend"    field="trend_states"    options={TREND_FILTER_OPTIONS}    filters={filters} onToggle={toggleBucket} />
        <BucketFilterRow label="RSI"      field="rsi_buckets"     options={RSI_FILTER_OPTIONS}      filters={filters} onToggle={toggleBucket} />
        <BucketFilterRow label="Score"    field="score_buckets"   options={SCORE_FILTER_OPTIONS}    filters={filters} onToggle={toggleBucket} />
        <BucketFilterRow label="GEX"      field="gex_envs"        options={GEX_FILTER_OPTIONS}      filters={filters} onToggle={toggleBucket} />
        <BucketFilterRow label="IV Trend" field="iv_trend_states" options={IV_TREND_FILTER_OPTIONS} filters={filters} onToggle={toggleBucket} />
      </div>
```

- [ ] **Step 4: Build + preview verification**

Run: `npm run build`
Expected: build succeeds.

Then start the preview (`preview_start`), open the Radar tab, expand **Advanced
Filters**, and confirm: five new rows (Trend / RSI / Score / GEX / IV Trend) each
render pills that toggle blue on click, and toggling one narrows the list. Capture
a screenshot for the user.

- [ ] **Step 5: Commit**

```bash
git add src/components/radar/RadarAdvancedFilters.jsx
git commit -m "feat(radar): pill-toggle filters for Trend/RSI/Score/GEX/IV-Trend"
```

---

## Task 6: Preset bar — curated presets, gating, match-counts, caption

**Files:**
- Modify: `src/components/RadarTab.jsx` (merge presets, per-preset counts, `applyPreset`)
- Modify: `src/components/radar/RadarPresetBar.jsx` (built-in rendering, edit/delete gating, counts, caption)

UI change — verified by build + preview.

- [ ] **Step 1: RadarTab — import curated presets + compute merged list and counts**

In `src/components/RadarTab.jsx` add imports:

```js
import { CURATED_PRESETS, CURATED_ICON } from "./radar/curatedPresets";
import { rowMatchesFilters } from "../lib/radarFilter"; // already added in Task 3 — do not duplicate
```

Where the component builds preset state (near `const [presets, setPresets] = useState([]);`),
compute a merged list (curated first) and per-curated-preset match counts. Add,
inside the component body after `rows`/`positions`/`marketContext`/`ivTrendsByTicker`
are available:

```js
  const allPresets = useMemo(() => [...CURATED_PRESETS, ...presets], [presets]);

  const curatedCounts = useMemo(() => {
    const counts = {};
    for (const p of CURATED_PRESETS) {
      const pf = { ...DEFAULT_FILTERS, ...p.filters };
      const ctx = {
        isHeld:           (ticker) => getPositionIndicators(ticker, positions).length > 0,
        earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, marketContext),
        ivTrend:          (ticker) => ivTrendsByTicker.get(ticker) ?? null,
        includeSectors:   expandGroupsToSectors(pf.sectors_include),
        excludeSectors:   expandGroupsToSectors(pf.sectors_exclude),
      };
      counts[p.id] = rows.filter(row => rowMatchesFilters(row, pf, ctx)).length;
    }
    return counts;
  }, [rows, positions, marketContext, ivTrendsByTicker]);
```

- [ ] **Step 2: RadarTab — teach `applyPreset` to handle built-ins, pass new props**

Update `applyPreset` so a built-in id merges its filters with **no DB dependency**
(built-ins already carry `.filters`, so the existing body works — just ensure it
never tries to look them up in `presets`). Confirm the body is:

```js
  function applyPreset(preset) {
    if (!preset) {
      setActivePresetId(null);
      setAdvancedFilters(DEFAULT_FILTERS);
      return;
    }
    setActivePresetId(preset.id);
    setAdvancedFilters({ ...DEFAULT_FILTERS, ...preset.filters });
  }
```

In the `RadarPresetBar` JSX usage, pass the merged list + counts (replace
`presets={presets}` with the merged list and add `curatedCounts`):

```jsx
          <RadarPresetBar
            presets={allPresets}
            curatedCounts={curatedCounts}
            activePresetId={activePresetId}
            /* …existing props unchanged… */
          />
```

Note: `onPresetsChange` handlers in RadarTab must keep writing only **user**
presets back to `radar_presets`. Since curated presets are prepended in
`allPresets` (not in `presets` state), the existing save/edit/delete handlers —
which operate on `presets` — remain correct. Verify `handleSaved`/`handleEdited`/
`handleDeleted` in `RadarPresetBar` still receive only user presets (they do:
they mutate the passed `presets` array; guard added in Step 3 stops built-ins from
reaching edit/delete).

- [ ] **Step 3: RadarPresetBar — render built-ins distinctly, gate edit/delete, show counts, add caption**

In `src/components/radar/RadarPresetBar.jsx`:

1. Extend the signature to accept counts:

```js
export default function RadarPresetBar({
  presets,
  curatedCounts = {},
  activePresetId,
  filtersExpanded,
  activeFilterCount,
  currentFilters,
  onSelect,
  onPresetsChange,
  onToggleFilters,
  saveModalOpen = false,
  onSaveModalClose,
}) {
```

2. Import the icon:

```js
import { CURATED_ICON } from "./curatedPresets";
```

3. Update `PresetBtn` to support a built-in (no ✎, optional count, ✦ prefix):

```js
function PresetBtn({ preset, active, count, onSelect, onEdit }) {
  const [hovered, setHovered] = useState(false);
  const isBuiltin = preset.builtin === true;
  const label = isBuiltin
    ? `${CURATED_ICON} ${preset.name}${count != null ? ` (${count})` : ""}`
    : preset.name;

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: theme.space[1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        style={{
          fontSize:     theme.size.sm,
          padding:      `2px ${theme.space[2]}px`,
          borderRadius: theme.radius.pill,
          border:       `1px solid ${active ? theme.blue : theme.border.default}`,
          background:   active ? theme.blue : "transparent",
          color:        active ? theme.text.primary : theme.text.muted,
          cursor:       "pointer",
          fontWeight:   active ? 600 : 400,
          whiteSpace:   "nowrap",
        }}
      >
        {label}
      </button>
      {!isBuiltin && hovered && (
        <button
          onClick={e => { e.stopPropagation(); onEdit(); }}
          title={`Edit "${preset.name}"`}
          style={{
            width: 18, height: 18, borderRadius: "50%",
            border: `1px solid ${theme.border.default}`, background: theme.bg.elevated,
            color: theme.text.subtle, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: theme.size.xs, padding: 0, flexShrink: 0,
          }}
        >
          ✎
        </button>
      )}
    </div>
  );
}
```

4. Split rendering so **curated always render as pills**, and only **user**
presets fold into the dropdown. Replace the `useDropdown`/render block. First
derive the two groups near the top of the component body:

```js
  const curated = presets.filter(p => p.builtin);
  const userPresets = presets.filter(p => !p.builtin);
  const useDropdown = userPresets.length > PRESET_BUTTON_THRESHOLD;
```

Then in the JSX, render curated pills first (always), then user presets (pills or
dropdown). Replace the existing `{useDropdown ? (…) : (presets.map(…))}` block
with:

```jsx
        {curated.map(p => (
          <PresetBtn
            key={p.id}
            preset={p}
            active={activePresetId === p.id}
            count={curatedCounts[p.id]}
            onSelect={() => onSelect(activePresetId === p.id ? null : p)}
          />
        ))}

        {useDropdown ? (
          <>
            <select
              value={userPresets.some(p => p.id === activePresetId) ? activePresetId : ''}
              onChange={e => {
                const p = userPresets.find(x => x.id === e.target.value);
                onSelect(p ?? null);
              }}
              onMouseEnter={() => setSelectHovered(true)}
              onMouseLeave={() => setSelectHovered(false)}
              style={{
                fontSize: theme.size.sm, padding: `2px ${theme.space[2]}px`,
                background: selectHovered ? "rgba(58,130,246,0.06)" : theme.bg.base,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
                color: theme.text.primary, cursor: "pointer", transition: "background 0.1s",
              }}
            >
              <option value="">Select preset…</option>
              {userPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              onClick={() => setEditPreset(userPresets.find(p => p.id === activePresetId) ?? userPresets[0])}
              style={ghostBtnStyle}
            >
              Edit presets
            </button>
          </>
        ) : (
          userPresets.map(p => (
            <PresetBtn
              key={p.id}
              preset={p}
              active={activePresetId === p.id}
              onSelect={() => onSelect(activePresetId === p.id ? null : p)}
              onEdit={() => setEditPreset(p)}
            />
          ))
        )}
```

5. Add the persistent caption. Immediately below the flex row that holds the
presets (after its closing `</div>`, before the modals), add:

```jsx
      <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 4 }}>
        {CURATED_ICON} Confirmation screens — not deploy triggers. Checklist + Ryan-first before any entry.
      </div>
```

6. **Fix the mutation handlers to emit only user presets.** Because `presets` now
holds the merged list (curated + user), `handleSaved`/`handleEdited`/`handleDeleted`
must reconstruct from `userPresets` so curated presets never leak into the
`radar_presets`-backed state. Replace those three handlers with:

```js
  function handleSaved(newPreset) {
    onPresetsChange([...userPresets, newPreset], newPreset.id);
    closeSaveModal();
  }

  function handleEdited(updated) {
    onPresetsChange(userPresets.map(p => p.id === updated.id ? updated : p), activePresetId);
    setEditPreset(null);
  }

  function handleDeleted(deletedId) {
    onPresetsChange(
      userPresets.filter(p => p.id !== deletedId),
      activePresetId === deletedId ? null : activePresetId,
    );
    setEditPreset(null);
  }
```

RadarTab's `onPresetsChange` handler (`(next, nextActiveId) => { setPresets(next); setActivePresetId(nextActiveId); }`) then stores only user presets; `allPresets` re-derives the merged list via its `useMemo`. No change needed in RadarTab for this.

- [ ] **Step 4: Build + full suite**

Run: `npx vitest run && npm run build`
Expected: tests PASS, build succeeds.

- [ ] **Step 5: Preview verification**

Start preview, open Radar. Confirm: six ✦ pills render first, each with a
`(N)` count; clicking one applies its filters and narrows the list; curated pills
have no ✎ on hover; your own saved presets still appear (and still edit/delete);
the caption shows under the bar. Screenshot for the user.

- [ ] **Step 6: Commit**

```bash
git add src/components/RadarTab.jsx src/components/radar/RadarPresetBar.jsx
git commit -m "feat(radar): curated preset pills with match-counts + confirmation caption"
```

---

## Task 7: Version bump, final verification, PR

**Files:**
- Modify: `package.json`, `src/lib/constants.js`

- [ ] **Step 1: Determine the next version from main**

Run: `git show origin/main:package.json | grep '"version"'`
Take that value; this is a new feature → **minor** bump (`x.Y.0`). (Baseline is
expected to be 1.166.0 → 1.167.0, but use whatever main actually shows.)

- [ ] **Step 2: Bump both files**

Set `"version"` in `package.json` and `export const VERSION` in
`src/lib/constants.js` to the new minor version (matching exactly).

- [ ] **Step 3: Full verification**

Run: `npx vitest run && npm run build`
Expected: all tests PASS (including the new radarConstants / radarFilter /
curatedPresets suites), build succeeds.

- [ ] **Step 4: Commit, push, PR, merge**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version for radar curated presets (vX.Y.0)"
git push -u origin <branch>
gh pr create --fill --base main
gh pr merge --squash --admin
git checkout main && git pull origin main
```

(Per CLAUDE.md: merge the PR immediately; ensure the push to main completes.)

---

## Notes for the implementer

- **No DB migration.** Curated presets are code; filters are client-side. The
  `quotes.rsi_14` column already exists (shipped in v1.166.0).
- **`ownership: "held"`** is already supported by the filter model and applied in
  RadarTab — Write Zone just uses it. No new dimension.
- **Local preview works here.** Unlike API-only panels, the Radar tab reads
  `quotes` directly from Supabase, so filters, presets, and counts all exercise
  real data locally. `rsi_14` may be null until the next production `api/bb` run,
  so RSI-dependent presets (Oversold Bounce) can legitimately show `(0)` locally —
  that's the match-count feature working, not a bug.
- **Don't touch `entryScore`.** RSI/Score are read for filtering only; the Scanner
  Score formula is unchanged (see `project_rsi_context_only`).
