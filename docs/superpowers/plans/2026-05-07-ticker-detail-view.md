# Per-Ticker Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only per-ticker drill-down view (header, open positions, lifespan history with verdict badges, all-time stats, trade timeline) accessible from the Positions table in the Explore tab.

**Architecture:** New `/api/ticker-detail?ticker=X` endpoint aggregates open positions + lifespans (with computed verdicts) + trades + stats into one response. Frontend adds a new `"ticker-detail"` sub-view to the existing state-based router (no react-router), entered by clicking a ticker badge in `OpenPositionsTab`. New components live in `src/components/tickerDetail/`. All styling uses inline `style={{}}` with `theme` tokens — no CSS files, no redesign primitives.

**Tech Stack:** React 18 (vite), Vercel serverless functions, Supabase, vitest. Spec at `/Users/vinhjones/Downloads/SPEC_TICKER_DETAIL_VIEW_v2.md`.

---

## File Structure

**New files:**
- `src/lib/tickerVerdict.js` — pure verdict computation (Ahead/Behind/Neutral) from lifespan baselines
- `src/lib/__tests__/tickerVerdict.test.js`
- `src/lib/tickerStats.js` — pure aggregator: takes trades + lifespans, returns the all-time stats card values, applying suspect-data rules
- `src/lib/__tests__/tickerStats.test.js`
- `api/ticker-detail.js` — Vercel handler: combines open positions, lifespans, trades, stats
- `src/hooks/useTickerDetail.js` — fetch + state for ticker-detail endpoint
- `src/components/tickerDetail/TickerDetailView.jsx` — top-level shell with breadcrumb
- `src/components/tickerDetail/TickerHeader.jsx` — header section
- `src/components/tickerDetail/TickerOpenPositions.jsx` — open positions table
- `src/components/tickerDetail/TickerLifespanHistory.jsx` — lifespan history (collapsed/expanded rows + verdict badges + filter)
- `src/components/tickerDetail/TickerAllTimeStats.jsx` — primary/secondary/tertiary stats grid
- `src/components/tickerDetail/TickerTradeTimeline.jsx` — chronological event log + filter
- `src/components/tickerDetail/VerdictBadge.jsx` — small reusable pill
- `src/components/tickerDetail/index.js` — barrel for lazy import

**Modified files:**
- `src/lib/modes.js` — add `"ticker-detail"` to `EXPLORE_SUBVIEWS` semantics (it's a hidden subview, not in chip nav)
- `src/components/ExploreView.jsx` — render `TickerDetailView` when subView is `"ticker-detail"` and pass selected ticker; hide chip nav in detail mode
- `src/App.jsx` — track `selectedDetailTicker` state alongside subView; route through ExploreView
- `src/components/OpenPositionsTab.jsx` — make ticker-cell clickable to open detail view
- `package.json` + `src/lib/constants.js` — version bump

---

## Task 1: Verdict computation library (TDD)

**Files:**
- Create: `src/lib/tickerVerdict.js`
- Test: `src/lib/__tests__/tickerVerdict.test.js`

The spec verdict combines two existing baselines from `api/position-lifespan.js`: `benchmarks.spaxx_baseline.vs_actual_pnl` and `benchmarks.cut_and_redeploy_baseline.vs_actual_pnl`. We classify as **Ahead** when both deltas exceed +threshold, **Behind** when both deltas fall below −threshold, otherwise **Neutral**. Threshold = `max($100, 0.005 × total_capital_committed)`.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/__tests__/tickerVerdict.test.js
import { describe, it, expect } from "vitest";
import { computeLifespanVerdict, verdictThreshold } from "../tickerVerdict.js";

describe("verdictThreshold", () => {
  it("returns $100 when 0.5% of capital is below $100", () => {
    expect(verdictThreshold(10_000)).toBe(100); // 0.5% = $50, floor $100
  });
  it("returns 0.5% of capital when above $100", () => {
    expect(verdictThreshold(50_000)).toBe(250);
  });
  it("returns $100 when capital is null/zero", () => {
    expect(verdictThreshold(null)).toBe(100);
    expect(verdictThreshold(0)).toBe(100);
  });
});

describe("computeLifespanVerdict", () => {
  const base = (overrides = {}) => ({
    lifespan_status: "closed",
    data_quality: "trusted",
    total_capital_committed: 50_000,
    benchmarks: {
      spaxx_baseline: { vs_actual_pnl: 500 },
      cut_and_redeploy_baseline: { vs_actual_pnl: 500 },
    },
    ...overrides,
  });

  it("returns 'suspect' when data_quality is suspect", () => {
    expect(computeLifespanVerdict(base({ data_quality: "suspect" }))).toBe("suspect");
  });

  it("returns 'ahead' when both deltas exceed +threshold ($250 for $50k cap)", () => {
    expect(computeLifespanVerdict(base())).toBe("ahead"); // 500 > 250 on both
  });

  it("returns 'behind' when both deltas fall below -threshold", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: -500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: -500 },
      },
    }))).toBe("behind");
  });

  it("returns 'neutral' when only one delta meets threshold", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: 500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: 50 },
      },
    }))).toBe("neutral");
  });

  it("returns 'neutral' when deltas have mixed signs", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: 500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: -500 },
      },
    }))).toBe("neutral");
  });

  it("returns 'neutral' when active lifespan", () => {
    expect(computeLifespanVerdict(base({ lifespan_status: "active" }))).toBe("neutral");
  });

  it("returns 'neutral' when cut_and_redeploy data missing (null vs_actual_pnl)", () => {
    expect(computeLifespanVerdict(base({
      benchmarks: {
        spaxx_baseline: { vs_actual_pnl: 500 },
        cut_and_redeploy_baseline: { vs_actual_pnl: null },
      },
    }))).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/lib/__tests__/tickerVerdict.test.js`
Expected: FAIL with "Cannot find module '../tickerVerdict.js'"

- [ ] **Step 3: Write the implementation**

```js
// src/lib/tickerVerdict.js
/**
 * verdictThreshold(totalCapital) — minimum dollar delta required against
 * BOTH baselines for a lifespan to be considered Ahead or Behind.
 * = max($100, 0.5% of capital).
 */
export function verdictThreshold(totalCapital) {
  if (!totalCapital || totalCapital <= 0) return 100;
  return Math.max(100, totalCapital * 0.005);
}

/**
 * computeLifespanVerdict(lifespanSummary) — returns one of:
 *   "ahead" | "behind" | "neutral" | "suspect"
 *
 * Suspect overrides verdict (per spec).
 * Active lifespans: neutral until they close (we don't predict).
 * Both vs-baseline deltas must exceed +/- threshold in the same direction.
 */
export function computeLifespanVerdict(lifespan) {
  if (lifespan.data_quality === "suspect") return "suspect";
  if (lifespan.lifespan_status === "active") return "neutral";

  const spaxx = lifespan.benchmarks?.spaxx_baseline?.vs_actual_pnl;
  const cut   = lifespan.benchmarks?.cut_and_redeploy_baseline?.vs_actual_pnl;

  if (spaxx == null || cut == null) return "neutral";

  const t = verdictThreshold(lifespan.total_capital_committed);

  if (spaxx > t && cut > t) return "ahead";
  if (spaxx < -t && cut < -t) return "behind";
  return "neutral";
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/__tests__/tickerVerdict.test.js`
Expected: PASS — 8 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/tickerVerdict.js src/lib/__tests__/tickerVerdict.test.js
git commit -m "feat: add lifespan verdict computation for ticker detail view"
```

---

## Task 2: Ticker stats aggregator (TDD)

**Files:**
- Create: `src/lib/tickerStats.js`
- Test: `src/lib/__tests__/tickerStats.test.js`

Pure function: takes `{ trades, lifespans }` for one ticker and returns the stat-card values for the All-Time Stats section. Applies the spec's suspect-data inclusion rules:
- **Realized P&L, Premium collected, Capital efficiency, Avg days CSP/CC**: include suspect data (note flag if any suspect contributed)
- **Wheels completed, Assignments, Times called away**: exclude suspect lifespans (return separate `suspectLifespanCount`)
- **Best/worst trade**: skip suspect-flagged trades; fall through to next non-suspect

Below-cost CC absorption = sum of negative `premium_collected` on `CC` trades where strike < blended cost basis at the time. We approximate using `relative_to_assignment === "below"` from lifespan cc_history (already computed). Plus standalone CCs not in any lifespan? In this codebase CCs always belong to a lifespan (assigned shares), so summing across lifespans is sufficient.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/__tests__/tickerStats.test.js
import { describe, it, expect } from "vitest";
import { computeTickerStats } from "../tickerStats.js";

const trade = (overrides) => ({
  id: "t1",
  ticker: "ABC",
  type: "CSP",
  subtype: "Close",
  strike: 50,
  premium_collected: 100,
  capital_fronted: 5000,
  days_held: 10,
  open_date: "2026-01-01",
  close_date: "2026-01-11",
  data_quality: "trusted",
  ...overrides,
});

const lifespan = (overrides) => ({
  ticker: "ABC",
  assignment_id: "2026-01-15",
  lifespan_status: "closed",
  data_quality: "trusted",
  total_capital_committed: 10_000,
  total_shares_at_peak: 200,
  blended_cost_basis: 50,
  exit_date: "2026-02-10",
  exit_event: { exit_type: "called_away" },
  cc_history: [],
  lifespan_metrics: {
    days_active: 26,
    csp_premium_collected: 100,
    cc_premium_total: 50,
    share_disposal_pnl: 200,
    total_lifespan_pnl: 350,
  },
  ...overrides,
});

describe("computeTickerStats — basic shape", () => {
  it("returns null-safe defaults for empty inputs", () => {
    const r = computeTickerStats({ trades: [], lifespans: [] });
    expect(r.realizedPnl).toBe(0);
    expect(r.premiumCollected).toBe(0);
    expect(r.wheelsCompleted).toBe(0);
    expect(r.bestTrade).toBeNull();
    expect(r.worstTrade).toBeNull();
    expect(r.belowCostCcAbsorption).toBe(0);
  });
});

describe("computeTickerStats — realizedPnl includes suspect with flag", () => {
  it("sums all realized P&L across closed trades regardless of data_quality", () => {
    const r = computeTickerStats({
      trades: [
        trade({ id: "t1", premium_collected: 100, data_quality: "trusted" }),
        trade({ id: "t2", premium_collected: 200, data_quality: "suspect" }),
      ],
      lifespans: [],
    });
    expect(r.realizedPnl).toBe(300);
    expect(r.includesSuspectData).toBe(true);
  });
});

describe("computeTickerStats — premium collected", () => {
  it("sums CSP + CC premium_collected (not LEAPS or Shares)", () => {
    const r = computeTickerStats({
      trades: [
        trade({ id: "t1", type: "CSP", premium_collected: 100 }),
        trade({ id: "t2", type: "CC",  premium_collected: 50 }),
        trade({ id: "t3", type: "LEAPS", premium_collected: 999 }),
        trade({ id: "t4", type: "Shares", premium_collected: 999 }),
      ],
      lifespans: [],
    });
    expect(r.premiumCollected).toBe(150);
  });
});

describe("computeTickerStats — wheels completed excludes suspect", () => {
  it("counts closed lifespans where exit_type === 'called_away', excluding suspect", () => {
    const r = computeTickerStats({
      trades: [],
      lifespans: [
        lifespan({ data_quality: "trusted", exit_event: { exit_type: "called_away" } }),
        lifespan({ data_quality: "suspect", exit_event: { exit_type: "called_away" } }),
        lifespan({ data_quality: "trusted", exit_event: { exit_type: "manual_sale" } }),
      ],
    });
    expect(r.wheelsCompleted).toBe(1);
    expect(r.wheelsSuspectExcluded).toBe(1);
  });
});

describe("computeTickerStats — assignments and called away counts exclude suspect", () => {
  it("counts assignment events from non-suspect lifespans only", () => {
    const r = computeTickerStats({
      trades: [],
      lifespans: [
        lifespan({ data_quality: "trusted", assignment_events: [{ date: "2026-01-15" }, { date: "2026-02-15" }] }),
        lifespan({ data_quality: "suspect", assignment_events: [{ date: "2025-08-01" }] }),
      ],
    });
    expect(r.assignmentsTaken).toBe(2);
    expect(r.timesCalledAway).toBe(1); // only the trusted called_away lifespan
  });
});

describe("computeTickerStats — avg days CSP/CC", () => {
  it("averages days_held across closed CSPs (Close subtype)", () => {
    const r = computeTickerStats({
      trades: [
        trade({ type: "CSP", subtype: "Close", days_held: 10 }),
        trade({ type: "CSP", subtype: "Close", days_held: 20 }),
        trade({ type: "CSP", subtype: "Assigned", days_held: 999 }), // excluded
      ],
      lifespans: [],
    });
    expect(r.avgDaysCsp).toBe(15);
  });

  it("averages days_held across closed CCs", () => {
    const r = computeTickerStats({
      trades: [
        trade({ type: "CC", subtype: "Close", days_held: 4 }),
        trade({ type: "CC", subtype: "Close", days_held: 14 }),
      ],
      lifespans: [],
    });
    expect(r.avgDaysCc).toBe(9);
  });
});

describe("computeTickerStats — best/worst trade skip suspect", () => {
  it("returns highest premium_collected trade ignoring suspect-flagged", () => {
    const r = computeTickerStats({
      trades: [
        trade({ id: "t1", premium_collected: 1000, data_quality: "suspect" }),
        trade({ id: "t2", premium_collected: 500,  data_quality: "trusted" }),
        trade({ id: "t3", premium_collected: -300, data_quality: "trusted" }),
      ],
      lifespans: [],
    });
    expect(r.bestTrade.id).toBe("t2");
    expect(r.bestTrade.premium_collected).toBe(500);
    expect(r.worstTrade.id).toBe("t3");
    expect(r.worstTrade.premium_collected).toBe(-300);
  });
});

describe("computeTickerStats — below-cost CC absorption", () => {
  it("sums negative premium_collected from CCs with relative_to_assignment === 'below'", () => {
    const r = computeTickerStats({
      trades: [],
      lifespans: [
        lifespan({
          cc_history: [
            { premium_collected: -200, relative_to_assignment: "below" },
            { premium_collected: -100, relative_to_assignment: "below" },
            { premium_collected: -500, relative_to_assignment: "above" }, // not absorption
            { premium_collected: 300,  relative_to_assignment: "below" }, // positive, not absorption
          ],
        }),
      ],
    });
    expect(r.belowCostCcAbsorption).toBe(-300);
  });
});

describe("computeTickerStats — capital efficiency", () => {
  it("returns realized_pnl / avg_capital_deployed annualized when data present", () => {
    // realized $1000, avg capital $50,000, days span 365 → 2% annualized
    const r = computeTickerStats({
      trades: [
        trade({ premium_collected: 1000, close_date: "2026-01-15", data_quality: "trusted" }),
      ],
      lifespans: [
        lifespan({
          total_capital_committed: 50_000,
          lifespan_metrics: { days_active: 365, total_lifespan_pnl: 1000, csp_premium_collected: 0, cc_premium_total: 0, share_disposal_pnl: 0 },
        }),
      ],
    });
    expect(r.capitalEfficiencyPct).toBeCloseTo(2.0, 1);
  });

  it("returns null when no lifespan capital", () => {
    const r = computeTickerStats({
      trades: [trade({ premium_collected: 100 })],
      lifespans: [],
    });
    expect(r.capitalEfficiencyPct).toBeNull();
  });
});

describe("computeTickerStats — avg kept_pct", () => {
  it("averages kept_pct on closed CSPs (skip null)", () => {
    const r = computeTickerStats({
      trades: [
        trade({ type: "CSP", subtype: "Close", kept_pct: 60 }),
        trade({ type: "CSP", subtype: "Close", kept_pct: 80 }),
        trade({ type: "CSP", subtype: "Close", kept_pct: null }),
      ],
      lifespans: [],
    });
    expect(r.avgKeptPct).toBe(70);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/lib/__tests__/tickerStats.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Write the implementation**

```js
// src/lib/tickerStats.js
/**
 * computeTickerStats({ trades, lifespans }) — pure aggregator for the
 * ticker-detail All-Time Stats card values. `trades` is an array of trade rows
 * (each with optional .data_quality, .type, .subtype, .premium_collected,
 * .days_held, .kept_pct, .close_date). `lifespans` is an array of lifespan
 * summaries from /api/position-lifespan.
 *
 * Suspect-data rules per spec:
 *   - realizedPnl, premiumCollected, capitalEfficiencyPct, avgDays*: include
 *     suspect data; flag with includesSuspectData when any suspect was used.
 *   - wheelsCompleted, assignmentsTaken, timesCalledAway: exclude suspect
 *     lifespans (return suspectLifespanCount alongside).
 *   - bestTrade, worstTrade: skip suspect-flagged trades.
 */
export function computeTickerStats({ trades = [], lifespans = [] }) {
  const closedTrades  = trades.filter((t) => t.close_date);
  const realizedPnl   = sumByKey(closedTrades, "premium_collected");

  const cspCcTrades   = closedTrades.filter((t) => t.type === "CSP" || t.type === "CC");
  const premiumCollected = sumByKey(cspCcTrades, "premium_collected");

  const trustedLifespans = lifespans.filter((l) => l.data_quality !== "suspect");
  const suspectLifespans = lifespans.filter((l) => l.data_quality === "suspect");

  const wheelsCompleted = trustedLifespans.filter(
    (l) => l.lifespan_status === "closed" && l.exit_event?.exit_type === "called_away"
  ).length;

  const wheelsSuspectExcluded = suspectLifespans.filter(
    (l) => l.lifespan_status === "closed" && l.exit_event?.exit_type === "called_away"
  ).length;

  const assignmentsTaken = trustedLifespans.reduce(
    (sum, l) => sum + (l.assignment_events?.length ?? 0),
    0
  );

  const timesCalledAway = wheelsCompleted; // same predicate

  const closedCsps = closedTrades.filter((t) => t.type === "CSP" && t.subtype === "Close");
  const closedCcs  = closedTrades.filter((t) => t.type === "CC"  && t.subtype === "Close");
  const avgDaysCsp = avgByKey(closedCsps, "days_held");
  const avgDaysCc  = avgByKey(closedCcs,  "days_held");

  const keptCsps = closedCsps.filter((t) => t.kept_pct != null);
  const avgKeptPct = avgByKey(keptCsps, "kept_pct");

  const trustedTrades = closedTrades.filter((t) => t.data_quality !== "suspect");
  const bestTrade = trustedTrades.length === 0
    ? null
    : trustedTrades.reduce((a, b) => (b.premium_collected > a.premium_collected ? b : a));
  const worstTrade = trustedTrades.length === 0
    ? null
    : trustedTrades.reduce((a, b) => (b.premium_collected < a.premium_collected ? b : a));

  // Capital efficiency: realized P&L / avg capital deployed, annualized.
  // avg capital deployed = sum(lifespan capital × days) / sum(days) for lifespans
  // with days_active > 0. Returns null when no usable lifespan data.
  const usable = lifespans.filter(
    (l) => l.total_capital_committed > 0 && (l.lifespan_metrics?.days_active ?? 0) > 0
  );
  const totalCapitalDays = usable.reduce(
    (s, l) => s + l.total_capital_committed * l.lifespan_metrics.days_active,
    0
  );
  const totalDays = usable.reduce((s, l) => s + l.lifespan_metrics.days_active, 0);
  const avgCapital = totalDays > 0 ? totalCapitalDays / totalDays : 0;
  const capitalEfficiencyPct = avgCapital > 0 && totalDays > 0
    ? (realizedPnl / avgCapital) * (365 / totalDays) * 100
    : null;

  // Below-cost CC absorption: sum of negative premium_collected from CC entries
  // where the strike was set below the blended cost basis at write-time.
  const belowCostCcAbsorption = lifespans.reduce((sum, l) => {
    const ccs = l.cc_history ?? [];
    return sum + ccs
      .filter((cc) => cc.relative_to_assignment === "below" && cc.premium_collected < 0)
      .reduce((s, cc) => s + cc.premium_collected, 0);
  }, 0);

  const includesSuspectData =
    suspectLifespans.length > 0 ||
    closedTrades.some((t) => t.data_quality === "suspect");

  return {
    realizedPnl: round2(realizedPnl),
    premiumCollected: round2(premiumCollected),
    capitalEfficiencyPct: capitalEfficiencyPct != null ? round2(capitalEfficiencyPct) : null,
    belowCostCcAbsorption: round2(belowCostCcAbsorption),
    wheelsCompleted,
    wheelsSuspectExcluded,
    assignmentsTaken,
    timesCalledAway,
    avgDaysCsp: avgDaysCsp != null ? round2(avgDaysCsp) : null,
    avgDaysCc:  avgDaysCc  != null ? round2(avgDaysCc)  : null,
    avgKeptPct: avgKeptPct != null ? round2(avgKeptPct) : null,
    bestTrade,
    worstTrade,
    includesSuspectData,
    tradeCount: closedTrades.length,
  };
}

function sumByKey(arr, key) {
  return arr.reduce((s, x) => s + (Number(x[key]) || 0), 0);
}

function avgByKey(arr, key) {
  if (arr.length === 0) return null;
  return sumByKey(arr, key) / arr.length;
}

function round2(n) {
  return n == null ? null : +n.toFixed(2);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/__tests__/tickerStats.test.js`
Expected: PASS — all describe blocks pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/tickerStats.js src/lib/__tests__/tickerStats.test.js
git commit -m "feat: add ticker stats aggregator with suspect-data rules"
```

---

## Task 3: Ticker-detail API endpoint

**Files:**
- Create: `api/ticker-detail.js`

This endpoint aggregates everything in one call: the ticker's open positions (from `positions` Supabase view used by `/api/data`), all lifespans (reusing the lifespan-summary shape from `/api/position-lifespan`), all trades for the ticker, and computed all-time stats. The verdict is computed server-side and attached to each lifespan summary.

**Important:** to keep diff size manageable, we extract `detectLifespans` / `buildLifespan` / `computeCspBaseline` / `lifespanSummary` from `position-lifespan.js` into a shared helper module, then both endpoints import it. We also enrich each `lifespanSummary` with `cc_history` (needed for below-cost CC absorption stat) and `assignment_events` and `exit_event`, all of which the existing `lifespanSummary()` strips.

We pass the existing `cc_history` array as part of the summary by using the full `buildLifespan` output, plus the verdict, and stripping `_tradeIds`. This is structurally fine — the endpoint is read-only and there's no schema contract to break.

- [ ] **Step 1: Extract shared lifespan helpers**

```bash
# Create the new shared module
```

Create `api/_lib/lifespan.js`:

```js
// api/_lib/lifespan.js
//
// Shared lifespan detection + summary helpers used by both
// /api/position-lifespan and /api/ticker-detail.

const DATA_QUALITY_THRESHOLD = "2026-01-01";

export { DATA_QUALITY_THRESHOLD };

// Sort priority for same-day events (CC bookkeeping first, share-removal last).
function tradeSortPriority(trade) {
  if (trade.type === "CC" && (trade.subtype === "Close" || trade.subtype === "Roll Loss")) return 1;
  if (trade.type === "CC" && trade.subtype === "Assigned")  return 2;
  if (trade.type === "CSP" && trade.subtype === "Assigned") return 3;
  if (trade.type === "Shares") return 4;
  return 5;
}

function isRedundantSharesSold(trade, closedLifespans, currentLifespan) {
  const sameDay = (cc) =>
    cc.type === "CC" &&
    cc.subtype === "Assigned" &&
    cc.close_date === trade.close_date &&
    (cc.contracts ?? 1) * 100 === (trade.contracts ?? 0);
  if (currentLifespan && currentLifespan.cc_history.some(sameDay)) return true;
  const last = closedLifespans[closedLifespans.length - 1];
  if (last && last.ticker === trade.ticker && last.cc_history.some(sameDay)) return true;
  return false;
}

export function detectLifespans(ticker, allTickerTrades) {
  // [COPY VERBATIM from api/position-lifespan.js lines 228–397]
  // (reproduced in full so the engineer doesn't need to read the source)
  const relevant = allTickerTrades.filter(
    (t) =>
      t.close_date &&
      ((t.type === "CSP" && t.subtype === "Assigned") ||
        (t.type === "CC" &&
          (t.subtype === "Close" ||
            t.subtype === "Roll Loss" ||
            t.subtype === "Assigned")) ||
        (t.type === "Shares" &&
          (t.subtype === "Sold" || t.subtype === "Exit")))
  );
  const sorted = [...relevant].sort((a, b) => {
    const d = (a.close_date ?? "").localeCompare(b.close_date ?? "");
    if (d !== 0) return d;
    const pd = tradeSortPriority(a) - tradeSortPriority(b);
    if (pd !== 0) return pd;
    return (a.open_date ?? "").localeCompare(b.open_date ?? "");
  });
  let runningShares = 0;
  let current = null;
  const lifespans = [];
  const orphanWarnings = [];
  for (const trade of sorted) {
    if (trade.type === "CSP" && trade.subtype === "Assigned") {
      const sharesAdded = (trade.contracts ?? 1) * 100;
      if (runningShares === 0) {
        current = {
          ticker, assignment_events: [], _cspTrades: [], cc_history: [],
          partial_dispositions: [], exit_event: null, _disposalTrade: null,
          _orphanWarnings: [],
        };
      }
      current._cspTrades.push(trade);
      current.assignment_events.push({
        date: trade.close_date,
        triggering_csp_id: trade.id,
        strike: parseFloat(trade.strike) || 0,
        csp_premium_collected: round2(parseFloat(trade.premium_collected) || 0),
        shares_added: sharesAdded,
        capital_added: round2(sharesAdded * (parseFloat(trade.strike) || 0)),
        spot_at_assignment: trade.spot_at_assignment != null ? parseFloat(trade.spot_at_assignment) : null,
      });
      runningShares += sharesAdded;
    } else if (trade.type === "CC" && (trade.subtype === "Close" || trade.subtype === "Roll Loss")) {
      if (current !== null) current.cc_history.push(trade);
      else orphanWarnings.push(`CC ${trade.subtype} for ${ticker} on ${trade.close_date} (id: ${trade.id}) with no active lifespan`);
    } else if (trade.type === "CC" && trade.subtype === "Assigned") {
      const sharesRemoved = (trade.contracts ?? 1) * 100;
      if (current !== null) {
        current.cc_history.push(trade);
        const basis = computeBlendedBasis(current.assignment_events);
        const disposalPnl = round2((parseFloat(trade.strike) - basis) * sharesRemoved);
        runningShares -= sharesRemoved;
        if (runningShares === 0) {
          current.exit_event = {
            date: trade.close_date, exit_type: "called_away",
            exit_price: parseFloat(trade.strike) || null,
            shares_disposed: sharesRemoved, share_disposal_pnl: disposalPnl,
            triggering_decision_id: null,
          };
          current._disposalTrade = trade;
          lifespans.push(current);
          current = null;
        } else {
          current.partial_dispositions.push({
            date: trade.close_date, type: "called_away",
            shares: sharesRemoved, disposal_pnl: disposalPnl,
          });
        }
      }
    } else if (trade.type === "Shares" && (trade.subtype === "Sold" || trade.subtype === "Exit")) {
      if (isRedundantSharesSold(trade, lifespans, current)) continue;
      const sharesRemoved = trade.contracts ?? 0;
      const disposalPnl = round2(parseFloat(trade.premium_collected) || 0);
      if (current !== null) {
        const sameDayCc = current.cc_history.find(
          (cc) => cc.close_date === trade.close_date && (cc.subtype === "Close" || cc.subtype === "Roll Loss")
        );
        const exitType = sameDayCc ? "coordinated_exit" : "manual_sale";
        const basis = computeBlendedBasis(current.assignment_events);
        const exitPrice = sharesRemoved > 0 ? round2(basis + disposalPnl / sharesRemoved) : null;
        runningShares -= sharesRemoved;
        if (runningShares === 0) {
          current.exit_event = {
            date: trade.close_date, exit_type: exitType, exit_price: exitPrice,
            shares_disposed: sharesRemoved, share_disposal_pnl: disposalPnl,
            triggering_decision_id: null,
          };
          current._disposalTrade = trade;
          lifespans.push(current);
          current = null;
        } else {
          current.partial_dispositions.push({
            date: trade.close_date, type: exitType,
            shares: sharesRemoved, disposal_pnl: disposalPnl,
          });
        }
      } else {
        orphanWarnings.push(`Shares ${trade.subtype} for ${ticker} on ${trade.close_date} (id: ${trade.id}) with no active lifespan`);
      }
    }
  }
  if (current !== null) lifespans.push(current);
  if (orphanWarnings.length > 0 && lifespans.length > 0) {
    lifespans[0]._orphanWarnings.push(...orphanWarnings);
  }
  return lifespans;
}

export function buildLifespan(raw, cspBaseline, today) {
  // [COPY VERBATIM from api/position-lifespan.js lines 403–586]
  const { ticker, assignment_events, cc_history, partial_dispositions, exit_event } = raw;
  const firstAssignment = assignment_events[0];
  const assignmentId    = firstAssignment?.date ?? null;
  const lifespanStatus  = exit_event ? "closed" : "active";
  const effectiveEnd    = exit_event ? exit_event.date : today;
  const basisRaw           = computeBlendedBasis(assignment_events);
  const blendedBasis        = round2(basisRaw);
  const totalSharesAtPeak   = assignment_events.reduce((s, e) => s + e.shares_added, 0);
  const totalCapital        = round2(assignment_events.reduce((s, e) => s + e.capital_added, 0));
  const cspPremiumTotal     = round2(assignment_events.reduce((s, e) => s + e.csp_premium_collected, 0));
  const ccPremiumTotal   = round2(cc_history.reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const ccPremiumWinning = round2(cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) > 0)
    .reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const ccPremiumLosing  = round2(cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) < 0)
    .reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const shareDisposalPnl = lifespanStatus === "closed"
    ? round2([
        ...partial_dispositions.map((d) => d.disposal_pnl ?? 0),
        exit_event ? (exit_event.share_disposal_pnl ?? 0) : 0,
      ].reduce((s, v) => s + v, 0))
    : null;
  const totalLifespanPnl =
    lifespanStatus === "closed" && shareDisposalPnl !== null
      ? round2(cspPremiumTotal + ccPremiumTotal + shareDisposalPnl)
      : null;
  const daysActive    = daysBetween(assignmentId, effectiveEnd);
  const capitalDays   = round2(totalCapital * daysActive);
  const canRate       = daysActive >= 1 && totalCapital > 0 && totalLifespanPnl !== null;
  const returnPct     = canRate ? round6(totalLifespanPnl / totalCapital) : null;
  const annualPct     = canRate ? round6(returnPct * (365 / daysActive)) : null;
  const returnPerCapDay = canRate && capitalDays > 0
    ? +(totalLifespanPnl / capitalDays).toFixed(8)
    : null;
  const spaxxReturn   = round2(totalCapital * 0.04 * (daysActive / 365));
  const spaxxVsActual = totalLifespanPnl !== null ? round2(totalLifespanPnl - spaxxReturn) : null;
  const { avg_return_per_capital_day, sample_size } = cspBaseline;
  const hasSpotAtFirst = firstAssignment?.spot_at_assignment != null;
  let cutAndRedeploy;
  if (!hasSpotAtFirst) {
    cutAndRedeploy = {
      requires_spot_at_first_assignment: true,
      sell_at_assignment_recovery: null,
      realized_loss_at_assignment: null,
      capital_to_redeploy: null,
      avg_csp_return_per_capital_day: avg_return_per_capital_day,
      sample_size_csps_used: sample_size,
      estimated_csp_pnl_over_lifespan: null,
      net_outcome_if_cut_and_redeploy: null,
      vs_actual_pnl: null,
      verdict: computeVerdict(lifespanStatus, null, false),
    };
  } else {
    const fa = firstAssignment;
    const sellRecovery = round2(fa.spot_at_assignment * fa.shares_added);
    const realizedLoss = round2(fa.capital_added - sellRecovery);
    const toRedeploy = sellRecovery;
    const estCspPnl = avg_return_per_capital_day > 0
      ? round2(toRedeploy * avg_return_per_capital_day * daysActive)
      : 0;
    const netOutcome = round2(-realizedLoss + estCspPnl);
    const vsActual = totalLifespanPnl !== null ? round2(totalLifespanPnl - netOutcome) : null;
    cutAndRedeploy = {
      requires_spot_at_first_assignment: true,
      sell_at_assignment_recovery: sellRecovery,
      realized_loss_at_assignment: realizedLoss,
      capital_to_redeploy: toRedeploy,
      avg_csp_return_per_capital_day: avg_return_per_capital_day,
      sample_size_csps_used: sample_size,
      estimated_csp_pnl_over_lifespan: estCspPnl,
      net_outcome_if_cut_and_redeploy: netOutcome,
      vs_actual_pnl: vsActual,
      verdict: computeVerdict(lifespanStatus, vsActual, true),
    };
  }
  const dataQuality = (assignmentId ?? "") >= DATA_QUALITY_THRESHOLD ? "trusted" : "suspect";
  const warnings = [...(raw._orphanWarnings ?? [])];
  if (daysActive < 1) warnings.push("days_active < 1: same-day assignment and exit; rate-based metrics are null");
  if (sample_size < 10) warnings.push(`CSP baseline uses only ${sample_size} sample${sample_size === 1 ? "" : "s"} (< 10); cut-and-redeploy estimate is low-confidence`);
  const ccHistoryFormatted = cc_history.map((t) => ({
    trade_id: t.id, open_date: t.open_date, close_date: t.close_date,
    strike: parseFloat(t.strike) || t.strike, contracts: t.contracts,
    premium_collected: round2(parseFloat(t.premium_collected) || 0),
    kept_pct: t.kept_pct ?? null, days_held: t.days_held,
    relative_to_assignment:
      parseFloat(t.strike) > basisRaw ? "above" :
      parseFloat(t.strike) === basisRaw ? "at" : "below",
    is_winning: (parseFloat(t.premium_collected) || 0) > 0,
    journal_context_summary: null,
  }));
  const lifespanTrades = [
    ...(raw._cspTrades ?? []),
    ...cc_history,
    ...(raw._disposalTrade ? [raw._disposalTrade] : []),
  ];
  const tradeIds = lifespanTrades.map((t) => t.id).filter(Boolean);
  return {
    ticker, assignment_id: assignmentId, lifespan_status: lifespanStatus,
    data_quality: dataQuality, assignment_events,
    blended_cost_basis: blendedBasis, total_shares_at_peak: totalSharesAtPeak,
    total_capital_committed: totalCapital, exit_event, partial_dispositions,
    lifespan_metrics: {
      days_active: daysActive, capital_days: capitalDays,
      csp_premium_collected: cspPremiumTotal, cc_premium_total: ccPremiumTotal,
      cc_premium_winning: ccPremiumWinning, cc_premium_losing: ccPremiumLosing,
      share_disposal_pnl: shareDisposalPnl, total_lifespan_pnl: totalLifespanPnl,
      cc_count_total: cc_history.length,
      cc_count_winning: cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) > 0).length,
      cc_count_losing:  cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) < 0).length,
      return_pct_on_capital: returnPct, annualized_return_pct: annualPct,
      return_per_capital_day: returnPerCapDay,
    },
    cc_history: ccHistoryFormatted,
    benchmarks: {
      spaxx_baseline: {
        annual_rate: 0.04, total_return: spaxxReturn,
        vs_actual_pnl: spaxxVsActual,
        verdict: computeVerdict(lifespanStatus, spaxxVsActual, true),
      },
      cut_and_redeploy_baseline: cutAndRedeploy,
    },
    computed_at: new Date().toISOString(),
    data_completeness: {
      has_spot_at_first_assignment: hasSpotAtFirst,
      has_all_ccs: true,
      has_disposal_event: lifespanStatus === "closed",
      warnings,
    },
    _tradeIds: tradeIds,
  };
}

export function computeCspBaseline(cspTrades) {
  const returns = cspTrades
    .map((t) => {
      const premium = parseFloat(t.premium_collected) || 0;
      const capital = parseFloat(t.capital_fronted) || 0;
      const days    = parseFloat(t.days_held) || 0;
      if (capital <= 0 || days <= 0) return null;
      return premium / (capital * days);
    })
    .filter((r) => r != null);
  const avg = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  return { avg_return_per_capital_day: avg, sample_size: returns.length };
}

export function lifespanSummary(l) {
  return {
    ticker: l.ticker,
    assignment_id: l.assignment_id,
    lifespan_status: l.lifespan_status,
    data_quality: l.data_quality,
    assignment_date: l.assignment_events[0]?.date ?? null,
    exit_date: l.exit_event?.date ?? null,
    days_active: l.lifespan_metrics.days_active,
    total_shares_at_peak: l.total_shares_at_peak,
    total_capital_committed: l.total_capital_committed,
    blended_cost_basis: l.blended_cost_basis,
    total_lifespan_pnl: l.lifespan_metrics.total_lifespan_pnl,
    return_pct_on_capital: l.lifespan_metrics.return_pct_on_capital,
    spaxx_verdict: l.benchmarks.spaxx_baseline.verdict,
    cut_and_redeploy_verdict: l.benchmarks.cut_and_redeploy_baseline.verdict,
  };
}

function computeBlendedBasis(assignmentEvents) {
  const totalCapital = assignmentEvents.reduce((s, e) => s + e.capital_added, 0);
  const totalShares  = assignmentEvents.reduce((s, e) => s + e.shares_added, 0);
  return totalShares > 0 ? totalCapital / totalShares : 0;
}

function computeVerdict(lifespanStatus, vsActualPnl, hasRequiredData) {
  if (lifespanStatus === "active") return "active";
  if (!hasRequiredData || vsActualPnl === null) return "data_missing";
  if (vsActualPnl > 0) return "outperformed";
  if (vsActualPnl < 0) return "underperformed";
  return "even";
}

function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(fromDate + "T00:00:00Z");
  const to   = new Date(toDate   + "T00:00:00Z");
  return Math.round((to - from) / 86_400_000);
}

function round2(n) { return +n.toFixed(2); }
function round6(n) { return +n.toFixed(6); }
```

- [ ] **Step 2: Replace inline helpers in position-lifespan.js with imports from _lib/lifespan.js**

Modify `api/position-lifespan.js` — replace the file's lines 167–767 (everything from `function lifespanSummary(l) {` through the end) with:

```js
// (At the top of api/position-lifespan.js, replace the existing imports + DATA_QUALITY_THRESHOLD)
import { createClient } from "@supabase/supabase-js";
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
  lifespanSummary,
} from "./_lib/lifespan.js";

// (then keep getSupabase + the handler unchanged, but replace the embedded
// helpers with the imports above. Also replace the local clusterLifespanDecisions
// fn — it needs to keep living in position-lifespan.js, since ticker-detail
// doesn't need it. Same for daysBetweenDates.)
```

The handler body (lines 28–165) stays exactly as-is. The clusterLifespanDecisions function (lines 606–705) and `daysBetweenDates` helper (lines 755–763) should remain in `api/position-lifespan.js` since only that endpoint needs them.

After the edit, `api/position-lifespan.js` should be ~250 lines: imports + handler + `clusterLifespanDecisions` + `attachJournalContext` + `daysBetweenDates`.

- [ ] **Step 3: Verify position-lifespan still works**

Run: `node -e "import('./api/_lib/lifespan.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'DATA_QUALITY_THRESHOLD', 'detectLifespans', 'buildLifespan', 'computeCspBaseline', 'lifespanSummary' ]`

Run: `npx vitest run` (the existing position-lifespan-related tests, if any)
Expected: PASS — no regressions

- [ ] **Step 4: Create the ticker-detail endpoint**

Create `api/ticker-detail.js`:

```js
/**
 * api/ticker-detail.js — Vercel serverless function
 *
 * GET /api/ticker-detail?ticker={TICKER}
 *
 * Returns a single aggregated payload for the per-ticker detail view:
 *   - openPositions: { csps, ccs, leaps, shares } — open positions for the ticker
 *   - lifespans:     [...] — array of lifespan summaries (with cc_history,
 *                            assignment_events, exit_event, and a `verdict`
 *                            field added per spec)
 *   - trades:        [...] — all trades for the ticker, ordered desc by close_date
 *   - earningsDate:  ISO date string or null
 *   - companyName:   null  (not currently in our data; UI will show "" if null)
 *   - quote:         { last, prev_close, mid } if available
 *   - computedAt:    ISO string
 */

import { createClient } from "@supabase/supabase-js";
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
} from "./_lib/lifespan.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const ticker = (req.query.ticker || "").toUpperCase();
  if (!ticker) {
    return res.status(400).json({ ok: false, error: "ticker query param is required" });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const supabase = getSupabase();

    // 1. CSP baseline (for cut-and-redeploy verdict computation)
    const baselineResult = await supabase
      .from("trades")
      .select("id, premium_collected, capital_fronted, days_held, close_date")
      .eq("type", "CSP")
      .eq("subtype", "Close")
      .gt("days_held", 0)
      .gt("capital_fronted", 0)
      .order("close_date", { ascending: false })
      .limit(60);
    if (baselineResult.error) throw new Error(`baseline: ${baselineResult.error.message}`);
    const cspBaseline = computeCspBaseline(baselineResult.data ?? []);

    // 2. All trades for ticker
    const tradesResult = await supabase
      .from("trades")
      .select("*")
      .eq("ticker", ticker)
      .order("close_date", { ascending: true });
    if (tradesResult.error) throw new Error(`trades: ${tradesResult.error.message}`);
    const trades = tradesResult.data ?? [];

    // 3. Quote (most recent equity quote for the ticker)
    const quoteResult = await supabase
      .from("quotes")
      .select("symbol, last, mid, prev_close, earnings_date, refreshed_at, instrument_type")
      .eq("symbol", ticker)
      .eq("instrument_type", "EQUITY")
      .maybeSingle();
    const quote = quoteResult.error ? null : quoteResult.data;

    // 4. Build lifespans (with full benchmarks objects intact)
    const rawLifespans = detectLifespans(ticker, trades);
    const lifespans = rawLifespans.map((r) => {
      const built = buildLifespan(r, cspBaseline, today);
      const { _tradeIds, ...rest } = built;
      return rest;
    });

    // 5. Slice open positions out of the trades — for the spec's "Open Positions"
    // table we want the rows the existing /api/data endpoint exposes. Simplest
    // approach: ask the same Supabase view for open positions filtered by ticker.
    const openPositions = await fetchOpenPositions(supabase, ticker);

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      ok: true,
      ticker,
      companyName: null,
      quote: quote ? {
        last:        quote.last,
        mid:         quote.mid,
        prev_close:  quote.prev_close,
        refreshedAt: quote.refreshed_at,
      } : null,
      earningsDate: quote?.earnings_date ?? null,
      openPositions,
      lifespans,
      trades,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/ticker-detail] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// Fetch open positions for the ticker by re-using the existing positions tables.
// We mirror the schema from /api/data: open_csps, assigned_shares, open_leaps,
// open_spreads.
async function fetchOpenPositions(supabase, ticker) {
  const [cspRes, sharesRes, leapsRes, spreadsRes] = await Promise.all([
    supabase.from("open_csps").select("*").eq("ticker", ticker),
    supabase.from("assigned_shares_view").select("*").eq("ticker", ticker),
    supabase.from("open_leaps").select("*").eq("ticker", ticker),
    supabase.from("open_spreads").select("*").eq("ticker", ticker),
  ]);
  return {
    csps:    cspRes.error    ? [] : (cspRes.data    ?? []),
    shares:  sharesRes.error ? [] : (sharesRes.data ?? []),
    leaps:   leapsRes.error  ? [] : (leapsRes.data  ?? []),
    spreads: spreadsRes.error? [] : (spreadsRes.data?? []),
  };
}
```

**NOTE for the engineer:** before writing this as-is, run the following to confirm the table/view names match your codebase. The endpoint `/api/data` is the source of truth for the open-positions schema. If the table names differ (e.g. `assigned_shares_view` may be called something else), adjust accordingly:

Run: `grep -rn "from(\"open_csps\"\|from(\"assigned_shares\"\|from(\"open_leaps\"\|from(\"open_spreads\"" api/`

Adjust the `fetchOpenPositions` function to use whichever names appear there. If the existing positions data is **client-side joined** rather than served as separate tables, simplify by deriving open positions from the trades array itself: a trade is "open" if `close_date` is null or in the future. Use that fallback if the named tables don't exist.

- [ ] **Step 5: Manually verify the endpoint with a real ticker**

Run: `cd /Users/vinhjones/trading-dashboard/.claude/worktrees/adoring-leakey-777893 && npx vercel dev --listen 3001 &` (background)

Wait ~5s, then: `curl -s "http://localhost:3001/api/ticker-detail?ticker=IREN" | head -100`

Expected: JSON response with `ok: true` and populated `lifespans`, `trades`, `quote` fields. If `openPositions` arrays are empty but trades exist for the ticker, the table-name fallback kicks in — that's OK to address in Task 6.

Kill the dev server: `kill %1`

- [ ] **Step 6: Commit**

```bash
git add api/_lib/lifespan.js api/position-lifespan.js api/ticker-detail.js
git commit -m "feat: add ticker-detail API endpoint and extract shared lifespan helpers"
```

---

## Task 4: useTickerDetail hook

**Files:**
- Create: `src/hooks/useTickerDetail.js`

- [ ] **Step 1: Write the hook**

```js
// src/hooks/useTickerDetail.js
import { useState, useEffect } from "react";

/**
 * useTickerDetail(ticker) — fetches /api/ticker-detail?ticker=X
 *
 * Returns: { data, loading, error }.
 *
 * Aborts in-flight fetches when the ticker changes or the component unmounts.
 */
export function useTickerDetail(ticker) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!ticker) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/ticker-detail?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((json) => {
        if (ctrl.signal.aborted) return;
        if (!json.ok) {
          setError(json.error || "Unknown error");
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [ticker]);

  return { data, loading, error };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useTickerDetail.js
git commit -m "feat: add useTickerDetail hook"
```

---

## Task 5: Wire ticker-detail subview into routing

**Files:**
- Modify: `src/lib/modes.js`
- Modify: `src/components/ExploreView.jsx`
- Modify: `src/App.jsx`

`"ticker-detail"` is a hidden subview — it doesn't appear in the chip nav but is a valid Explore subView state. The selected ticker is held alongside subView in `App.jsx`.

- [ ] **Step 1: Add ticker-detail to mode validation**

Modify `src/lib/modes.js`:

```js
// Top-level modes in the redesigned workspace.
export const MODES = ["focus", "explore", "review"];

// Visible chip-nav subviews
export const EXPLORE_SUBVIEWS = ["positions", "radar", "earnings", "macro"];
export const REVIEW_SUBVIEWS  = ["journal", "monthly", "history"];

// Hidden subviews (drill-downs accessed via click-through, not chip nav)
const EXPLORE_HIDDEN_SUBVIEWS = ["ticker-detail"];

export const SUBVIEW_LABELS = {
  positions: "Positions",
  radar:     "Radar",
  earnings:  "Earnings",
  macro:     "Macro",
  monthly:   "Monthly",
  history:   "History",
  journal:   "Journal",
};

export const MODE_LABELS = {
  focus:   "Focus",
  explore: "Explore",
  review:  "Review",
};

export function defaultSubView(mode) {
  if (mode === "explore") return "positions";
  if (mode === "review")  return "journal";
  return null;
}

export function isValidMode(mode) {
  return MODES.includes(mode);
}

export function isValidSubView(mode, subView) {
  if (mode === "focus")   return subView === null;
  if (mode === "explore") return EXPLORE_SUBVIEWS.includes(subView) || EXPLORE_HIDDEN_SUBVIEWS.includes(subView);
  if (mode === "review")  return REVIEW_SUBVIEWS.includes(subView);
  return false;
}
```

- [ ] **Step 2: Add detail-ticker state in App.jsx and pass through ExploreView**

Modify `src/App.jsx` — add `detailTicker` state below the existing `positionIntent` state (around line 75):

```jsx
const [positionIntent,  setPositionIntent]  = useState(null);
const [detailTicker,    setDetailTicker]    = useState(null); // NEW: ticker for /ticker-detail subview
```

Then, in the ExploreView render (around line 248–253), pass the new props:

```jsx
{mode === "explore" && (
  <ExploreView
    subView={subView}
    onSubViewChange={setSubView}
    positionIntent={positionIntent}
    onPositionIntentConsumed={() => setPositionIntent(null)}
    detailTicker={detailTicker}
    onOpenTickerDetail={(ticker) => {
      setDetailTicker(ticker);
      setSubViewRaw("ticker-detail");
    }}
    onCloseTickerDetail={() => {
      setDetailTicker(null);
      setSubViewRaw("positions");
    }}
  />
)}
```

- [ ] **Step 3: Render TickerDetailView from ExploreView when subView matches**

Modify `src/components/ExploreView.jsx`:

```jsx
import { Suspense } from "react";
import { useData } from "../hooks/useData";
import { EXPLORE_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../lib/modes";
import { theme } from "../lib/theme";
import { lazyNamed } from "../lib/lazyNamed";

const OpenPositionsTab = lazyNamed(() => import("./OpenPositionsTab"), "OpenPositionsTab");
const RadarTab         = lazyNamed(() => import("./RadarTab"),         "RadarTab");
const MacroTab         = lazyNamed(() => import("./MacroTab"),         "MacroTab");
const EarningsTab      = lazyNamed(() => import("./EarningsTab"),      "EarningsTab");
const TickerDetailView = lazyNamed(() => import("./tickerDetail"),     "TickerDetailView");

function TabLoading() {
  return (
    <div style={{
      padding:   theme.space[5],
      color:     theme.text.muted,
      fontSize:  theme.size.sm,
      textAlign: "center",
    }}>
      Loading…
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:       "6px 14px",
        fontSize:      theme.size.sm,
        fontFamily:    "inherit",
        cursor:        "pointer",
        background:    active ? theme.bg.elevated : theme.bg.surface,
        color:         active ? theme.blue : theme.text.muted,
        border:        `1px solid ${active ? theme.blue : theme.border.default}`,
        borderRadius:  theme.radius.pill,
        fontWeight:    active ? 600 : 400,
        letterSpacing: "0.3px",
        whiteSpace:    "nowrap",
        transition:    "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

export function ExploreView({
  subView,
  onSubViewChange,
  positionIntent,
  onPositionIntentConsumed,
  detailTicker,
  onOpenTickerDetail,
  onCloseTickerDetail,
}) {
  const { positions, account, trades } = useData();
  const isDetail = subView === "ticker-detail";
  const active = isValidSubView("explore", subView) ? subView : "positions";

  if (isDetail && detailTicker) {
    return (
      <Suspense fallback={<TabLoading />}>
        <TickerDetailView ticker={detailTicker} onClose={onCloseTickerDetail} />
      </Suspense>
    );
  }

  return (
    <div>
      <div style={{
        display:     "flex",
        gap:         theme.space[2],
        marginBottom: theme.space[4],
        overflowX:   "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {EXPLORE_SUBVIEWS.map(sv => (
          <Chip key={sv} active={active === sv} onClick={() => onSubViewChange(sv)}>
            {SUBVIEW_LABELS[sv]}
          </Chip>
        ))}
      </div>

      <Suspense fallback={<TabLoading />}>
        {active === "positions" && (
          <OpenPositionsTab
            positionIntent={positionIntent}
            onPositionIntentConsumed={onPositionIntentConsumed}
            onOpenTickerDetail={onOpenTickerDetail}
          />
        )}
        {active === "radar"     && <RadarTab positions={positions} account={account} />}
        {active === "earnings"  && <EarningsTab positions={positions} account={account} trades={trades} />}
        {active === "macro"     && <MacroTab />}
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/modes.js src/components/ExploreView.jsx src/App.jsx
git commit -m "feat: add ticker-detail subview routing scaffolding"
```

---

## Task 6: TickerDetailView shell + breadcrumb

**Files:**
- Create: `src/components/tickerDetail/TickerDetailView.jsx`
- Create: `src/components/tickerDetail/index.js`
- Create: `src/components/tickerDetail/VerdictBadge.jsx`

The shell renders breadcrumb (Explore / Positions / TICKER), loading/error states, and slots placeholder sections. Subsequent tasks fill in each section.

- [ ] **Step 1: Create the barrel file**

Create `src/components/tickerDetail/index.js`:

```js
export { TickerDetailView } from "./TickerDetailView";
```

- [ ] **Step 2: Create VerdictBadge**

Create `src/components/tickerDetail/VerdictBadge.jsx`:

```jsx
import { theme } from "../../lib/theme";

const VERDICT_STYLES = {
  ahead:    { color: theme.green, border: theme.green, bg: `${theme.green}1a`, label: "ahead" },
  behind:   { color: theme.red,   border: theme.red,   bg: `${theme.red}1a`,   label: "behind" },
  neutral:  { color: theme.text.muted, border: theme.border.strong, bg: theme.bg.elevated, label: "neutral" },
  suspect:  { color: theme.amber, border: theme.amber, bg: `${theme.amber}1a`, label: "suspect" },
};

export function VerdictBadge({ verdict }) {
  const s = VERDICT_STYLES[verdict] || VERDICT_STYLES.neutral;
  return (
    <span style={{
      display:        "inline-flex",
      alignItems:     "center",
      fontSize:       theme.size.xs,
      letterSpacing:  "0.08em",
      textTransform:  "uppercase",
      padding:        "2px 8px",
      border:         `1px solid ${s.border}`,
      background:     s.bg,
      color:          s.color,
      borderRadius:   theme.radius.pill,
      fontFamily:     theme.font.mono,
      fontWeight:     600,
    }}>
      {s.label}
    </span>
  );
}
```

- [ ] **Step 3: Create the shell component**

Create `src/components/tickerDetail/TickerDetailView.jsx`:

```jsx
import { theme } from "../../lib/theme";
import { useTickerDetail } from "../../hooks/useTickerDetail";

function Breadcrumb({ ticker, onClose }) {
  return (
    <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[3] }}>
      <button
        onClick={onClose}
        style={{
          background: "transparent", border: "none", padding: 0,
          color: theme.text.muted, fontSize: theme.size.sm, fontFamily: "inherit",
          cursor: "pointer", textDecoration: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = theme.blue)}
        onMouseLeave={(e) => (e.currentTarget.style.color = theme.text.muted)}
      >
        Explore / Positions
      </button>
      <span style={{ margin: `0 ${theme.space[1]}px`, color: theme.text.faint }}>/</span>
      <span style={{ color: theme.text.primary }}>{ticker}</span>
    </div>
  );
}

export function TickerDetailView({ ticker, onClose }) {
  const { data, loading, error } = useTickerDetail(ticker);

  if (loading && !data) {
    return (
      <div>
        <Breadcrumb ticker={ticker} onClose={onClose} />
        <div style={{ color: theme.text.muted, padding: theme.space[5], textAlign: "center" }}>
          Loading {ticker}…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Breadcrumb ticker={ticker} onClose={onClose} />
        <div style={{
          padding: theme.space[5], borderRadius: theme.radius.md,
          background: theme.alert.dangerBg, border: `1px solid ${theme.alert.dangerBorder}`,
          color: theme.text.primary,
        }}>
          Failed to load {ticker}: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      <Breadcrumb ticker={ticker} onClose={onClose} />
      {/* TickerHeader     — Task 7 */}
      {/* TickerOpenPositions — Task 8 */}
      {/* TickerLifespanHistory — Task 9 */}
      {/* TickerAllTimeStats — Task 10 */}
      {/* TickerTradeTimeline — Task 11 */}
      <pre style={{ fontSize: theme.size.xs, color: theme.text.muted, overflow: "auto", maxHeight: 400 }}>
        {JSON.stringify(data, null, 2).slice(0, 2000)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tickerDetail/
git commit -m "feat: scaffold TickerDetailView shell with breadcrumb"
```

---

## Task 7: TickerHeader

**Files:**
- Create: `src/components/tickerDetail/TickerHeader.jsx`
- Modify: `src/components/tickerDetail/TickerDetailView.jsx`

Header shows: ticker symbol large, current spot + day change %, earnings indicator, capital deployed (incl. LEAPS), open contract counts, blended cost basis, allocation %, health indicator (green/amber/red from cushion states), one-line status summary.

- [ ] **Step 1: Create TickerHeader**

Create `src/components/tickerDetail/TickerHeader.jsx`:

```jsx
import { theme } from "../../lib/theme";
import { formatDollarsFull, formatExpiry } from "../../lib/format";
import { computeCushion } from "../../lib/cushionBreach";

function HeaderField({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: theme.size.md, color: theme.text.primary }}>{children}</div>
    </div>
  );
}

function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  return Math.round(
    (new Date(toIso + "T00:00:00Z") - new Date(fromIso + "T00:00:00Z")) / 86_400_000
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function computeHealth(openPositions, quote) {
  const csps = openPositions?.csps ?? [];
  const last = quote?.last ?? quote?.mid ?? null;
  let worst = "safe";
  for (const p of csps) {
    const c = computeCushion(p.strike, last, p.iv);
    if (c.cushion_state === "assignment_risk") { worst = "assignment_risk"; break; }
    if (c.cushion_state === "approaching") worst = "approaching";
  }
  if (worst === "assignment_risk") return { color: theme.red,   label: "Risk"  };
  if (worst === "approaching")     return { color: theme.amber, label: "Watch" };
  if ((openPositions?.csps?.length ?? 0) === 0 &&
      (openPositions?.shares?.length ?? 0) === 0 &&
      (openPositions?.leaps?.length ?? 0) === 0) {
    return { color: theme.text.muted, label: "Idle" };
  }
  return { color: theme.green, label: "Healthy" };
}

function buildStatusSummary({ openPositions, lifespans, ticker }) {
  const cspCount   = openPositions?.csps?.length   ?? 0;
  const ccCount    = openPositions?.shares?.reduce((s, sh) => s + (sh.active_cc ? 1 : 0), 0) ?? 0;
  const leapCount  = openPositions?.leaps?.length  ?? 0;
  const shareCount = openPositions?.shares?.reduce((s, sh) =>
    s + (sh.positions?.reduce((ss, p) => ss + (p.shares ?? 0), 0) ?? 0), 0) ?? 0;

  if (shareCount > 0 && ccCount > 0) {
    const cc = openPositions.shares.flatMap((s) => s.active_cc ? [s.active_cc] : [])[0];
    return `Active wheel — ${shareCount} shares assigned${cc ? `, CC $${cc.strike} expiring ${formatExpiry(cc.expiry_date)}` : ""}`;
  }
  if (cspCount > 0 && shareCount === 0) {
    return `CSP-only — ${cspCount} active CSP${cspCount > 1 ? "s" : ""}, no assignments`;
  }
  if (cspCount === 0 && shareCount === 0 && leapCount === 0) {
    const last = lifespans?.[0];
    if (last?.exit_date) {
      return `Idle — no current positions. Last activity ${last.exit_date}.`;
    }
    return `Idle — no current positions on ${ticker}.`;
  }
  return `${shareCount} shares, ${cspCount} CSPs, ${ccCount} CCs, ${leapCount} LEAPS`;
}

export function TickerHeader({ data, accountValue }) {
  const { ticker, quote, earningsDate, openPositions, lifespans, companyName } = data;

  const dayChangeAbs = quote?.last != null && quote?.prev_close != null
    ? quote.last - quote.prev_close : null;
  const dayChangePct = dayChangeAbs != null && quote.prev_close
    ? (dayChangeAbs / quote.prev_close) * 100 : null;

  const cspCapital   = (openPositions?.csps  ?? []).reduce((s, p) => s + (p.capital_fronted || 0), 0);
  const sharesCapital = (openPositions?.shares ?? []).reduce((s, sh) =>
    s + (sh.positions?.reduce((ss, p) => ss + (p.fronted ?? 0), 0) ?? 0), 0);
  const leapsCapital = (openPositions?.leaps ?? []).reduce((s, p) => s + (p.capital_fronted || 0), 0);
  const totalCapital = cspCapital + sharesCapital + leapsCapital;

  const allocPct = accountValue > 0 ? (totalCapital / accountValue) * 100 : 0;
  const ALLOC_CAP_PCT = 15;

  const cspCount   = openPositions?.csps?.length ?? 0;
  const ccCount    = openPositions?.shares?.reduce((s, sh) => s + (sh.active_cc ? 1 : 0), 0) ?? 0;
  const leapCount  = openPositions?.leaps?.length ?? 0;
  const shareCount = openPositions?.shares?.reduce((s, sh) =>
    s + (sh.positions?.reduce((ss, p) => ss + (p.shares ?? 0), 0) ?? 0), 0) ?? 0;

  const blendedBasis = openPositions?.shares?.[0]?.positions?.length > 0
    ? (() => {
        const lots = openPositions.shares[0].positions;
        const totalCap = lots.reduce((s, l) => s + (l.fronted || 0), 0);
        const totalSh  = lots.reduce((s, l) => s + (l.shares  || 0), 0);
        return totalSh > 0 ? totalCap / totalSh : null;
      })()
    : null;

  const earningsSoon = (() => {
    if (!earningsDate) return null;
    const days = daysBetween(todayIso(), earningsDate);
    return days != null && days >= 0 && days <= 30 ? days : null;
  })();

  const health = computeHealth(openPositions, quote);
  const statusSummary = buildStatusSummary({ openPositions, lifespans, ticker });

  return (
    <div style={{
      padding:      theme.space[5],
      background:   theme.bg.surface,
      border:       `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.space[5], alignItems: "flex-start" }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: theme.text.primary, letterSpacing: "0.5px" }}>{ticker}</div>
          {companyName && <div style={{ fontSize: theme.size.sm, color: theme.text.muted }}>{companyName}</div>}
          <div style={{ marginTop: theme.space[2], fontSize: theme.size.lg, color: theme.text.primary }}>
            {quote?.last != null ? `$${quote.last.toFixed(2)}` : "—"}
            {dayChangeAbs != null && (
              <span style={{
                marginLeft: theme.space[2],
                color: dayChangeAbs >= 0 ? theme.green : theme.red,
                fontSize: theme.size.sm,
              }}>
                {dayChangeAbs >= 0 ? "+" : ""}{dayChangeAbs.toFixed(2)} ({dayChangePct >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%)
              </span>
            )}
            {earningsSoon != null && (
              <span style={{
                marginLeft: theme.space[2], fontSize: theme.size.xs,
                color: theme.amber, padding: "2px 6px",
                border: `1px solid ${theme.amber}`, borderRadius: theme.radius.sm,
              }}>
                Earnings {earningsDate} ({earningsSoon}d)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[4], flex: 1 }}>
          <HeaderField label="Capital">
            <div style={{ color: theme.text.primary }}>{formatDollarsFull(totalCapital)}</div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>{allocPct.toFixed(1)}% of portfolio</div>
          </HeaderField>

          <HeaderField label="Open">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: theme.size.sm }}>
              {cspCount   > 0 && <span style={{ color: theme.blue }}>CSP ×{cspCount}</span>}
              {ccCount    > 0 && <span style={{ color: theme.green }}>CC ×{ccCount}</span>}
              {leapCount  > 0 && <span style={{ color: theme.chart.leaps }}>LEAPS ×{leapCount}</span>}
              {shareCount > 0 && <span style={{ color: theme.text.primary }}>{shareCount} sh</span>}
              {(cspCount + ccCount + leapCount + shareCount) === 0 && <span style={{ color: theme.text.muted }}>none</span>}
            </div>
            {blendedBasis != null && (
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>cb ${blendedBasis.toFixed(2)}</div>
            )}
          </HeaderField>

          <HeaderField label="Allocation">
            <div style={{ background: theme.bg.elevated, height: 6, borderRadius: theme.radius.sm, position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", inset: 0,
                width: `${Math.min(100, (allocPct / ALLOC_CAP_PCT) * 100)}%`,
                background: allocPct > ALLOC_CAP_PCT ? theme.red : theme.blueBold,
              }} />
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 4 }}>
              {allocPct.toFixed(1)}% / {ALLOC_CAP_PCT}% cap
            </div>
          </HeaderField>

          <HeaderField label="Health">
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[1] }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: health.color, display: "inline-block" }} />
              <span style={{ color: health.color }}>{health.label}</span>
            </div>
          </HeaderField>
        </div>
      </div>

      <div style={{
        marginTop: theme.space[4], padding: theme.space[3],
        background: theme.bg.elevated, borderRadius: theme.radius.sm,
        fontSize: theme.size.sm, color: theme.text.secondary,
      }}>
        {statusSummary}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the shell**

Modify `src/components/tickerDetail/TickerDetailView.jsx` — replace the placeholder `<pre>` block with the header (we'll keep adding sections in subsequent tasks):

```jsx
import { theme } from "../../lib/theme";
import { useTickerDetail } from "../../hooks/useTickerDetail";
import { useData } from "../../hooks/useData";
import { TickerHeader } from "./TickerHeader";

// Breadcrumb component unchanged from Task 6 — keep as-is.
function Breadcrumb({ ticker, onClose }) {
  return (
    <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[3] }}>
      <button
        onClick={onClose}
        style={{
          background: "transparent", border: "none", padding: 0,
          color: theme.text.muted, fontSize: theme.size.sm, fontFamily: "inherit",
          cursor: "pointer", textDecoration: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = theme.blue)}
        onMouseLeave={(e) => (e.currentTarget.style.color = theme.text.muted)}
      >
        Explore / Positions
      </button>
      <span style={{ margin: `0 ${theme.space[1]}px`, color: theme.text.faint }}>/</span>
      <span style={{ color: theme.text.primary }}>{ticker}</span>
    </div>
  );
}

export function TickerDetailView({ ticker, onClose }) {
  const { data, loading, error } = useTickerDetail(ticker);
  const { account } = useData();

  if (loading && !data) {
    return (
      <div>
        <Breadcrumb ticker={ticker} onClose={onClose} />
        <div style={{ color: theme.text.muted, padding: theme.space[5], textAlign: "center" }}>
          Loading {ticker}…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Breadcrumb ticker={ticker} onClose={onClose} />
        <div style={{
          padding: theme.space[5], borderRadius: theme.radius.md,
          background: theme.alert.dangerBg, border: `1px solid ${theme.alert.dangerBorder}`,
          color: theme.text.primary,
        }}>
          Failed to load {ticker}: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      <Breadcrumb ticker={ticker} onClose={onClose} />
      <TickerHeader data={data} accountValue={account?.account_value || 0} />
      {/* Sections added in subsequent tasks */}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tickerDetail/TickerHeader.jsx src/components/tickerDetail/TickerDetailView.jsx
git commit -m "feat: add ticker detail header with capital, contracts, allocation, health"
```

---

## Task 8: TickerOpenPositions

**Files:**
- Create: `src/components/tickerDetail/TickerOpenPositions.jsx`
- Modify: `src/components/tickerDetail/TickerDetailView.jsx`

Open positions table — type badge, strike, expiry/DTE, qty, %OTM, notes, premium, P&L. CSP/CC/LEAPS rows + a Shares row when shares are held. When idle, show empty-state line.

- [ ] **Step 1: Create TickerOpenPositions**

Create `src/components/tickerDetail/TickerOpenPositions.jsx`:

```jsx
import { theme } from "../../lib/theme";
import { TYPE_COLORS } from "../../lib/constants";
import { calcDTE } from "../../lib/trading";
import { formatDollars, formatDollarsFull, formatExpiry } from "../../lib/format";

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || { bg: theme.bg.elevated, border: theme.border.strong, text: theme.text.primary };
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px",
      fontSize: theme.size.xs, fontWeight: 600,
      background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: theme.radius.sm,
      letterSpacing: "0.05em",
    }}>{type}</span>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      marginBottom: theme.space[3],
    }}>
      <div style={{
        fontSize: theme.size.md, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
      }}>{children}</div>
      {right && <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>{right}</div>}
    </div>
  );
}

function Row({ cells, accentColor }) {
  return (
    <tr style={{
      borderBottom: `1px solid ${theme.border.default}`,
      borderLeft: `3px solid ${accentColor || "transparent"}`,
    }}>
      {cells.map((c, i) => (
        <td key={i} style={{
          padding: `${theme.space[2]}px ${theme.space[2]}px`,
          textAlign: c.align || "left",
          color: c.color || theme.text.primary,
          fontWeight: c.bold ? 600 : 400,
          fontSize: theme.size.sm,
          whiteSpace: "nowrap",
        }}>{c.value}</td>
      ))}
    </tr>
  );
}

function pnlColor(pnl) {
  if (pnl == null) return theme.text.muted;
  return pnl >= 0 ? theme.green : theme.red;
}

export function TickerOpenPositions({ data }) {
  const { openPositions, lifespans, ticker } = data;
  const csps   = openPositions?.csps ?? [];
  const shares = openPositions?.shares ?? [];
  const leaps  = openPositions?.leaps ?? [];
  const liveCount = csps.length + shares.length + leaps.length;

  if (liveCount === 0) {
    const last = lifespans?.[0];
    return (
      <div style={{
        padding: theme.space[5], background: theme.bg.surface,
        border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
        marginBottom: theme.space[4],
      }}>
        <SectionTitle right="none">Open Positions</SectionTitle>
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
          No active positions on {ticker}.{" "}
          {last?.exit_date && <span>Last activity {last.exit_date}.</span>}
        </div>
      </div>
    );
  }

  const stockLast = data.quote?.last ?? data.quote?.mid ?? null;
  const otmCspPct = (strike) => stockLast != null && strike != null ? ((stockLast - strike) / strike) * 100 : null;
  const otmCcPct  = (strike) => stockLast != null && strike != null ? ((strike - stockLast) / stockLast) * 100 : null;
  const otmCell   = (pct) => pct == null
    ? { value: "—", align: "right", color: theme.text.muted }
    : { value: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, align: "right", color: pct >= 0 ? theme.green : theme.red, bold: true };

  // Build flat row list: shares row(s) first, then CSPs, then CCs (one per share group), then LEAPS.
  const rows = [];

  for (const sh of shares) {
    const totalShares = sh.positions?.reduce((s, p) => s + (p.shares ?? 0), 0) ?? 0;
    const totalFronted = sh.positions?.reduce((s, p) => s + (p.fronted ?? 0), 0) ?? 0;
    const blended = totalShares > 0 ? totalFronted / totalShares : null;
    const lots = sh.positions?.length ?? 0;
    rows.push({
      type: "Shares",
      cells: [
        { value: <TypeBadge type="Shares" /> },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: `opened ${sh.positions?.[0]?.open_date ? formatExpiry(sh.positions[0].open_date) : "—"}`, color: theme.text.muted },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: totalShares, color: theme.text.primary, bold: true, align: "right" },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: blended != null ? `blended cost basis · ${lots} lot${lots === 1 ? "" : "s"}` : "", color: theme.text.muted },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: "—", color: theme.text.muted, align: "right" },
      ],
    });

    if (sh.active_cc) {
      const cc = sh.active_cc;
      const dte = calcDTE(cc.expiry_date);
      const pnl = (cc.premium_collected ?? 0) - ((cc.current_mid ?? 0) * 100 * (cc.contracts ?? 1));
      rows.push({
        type: "CC",
        cells: [
          { value: <TypeBadge type="CC" /> },
          { value: `$${cc.strike}`, align: "right" },
          { value: formatExpiry(cc.expiry_date), color: theme.text.muted },
          { value: dte != null ? `${dte}d` : "—", align: "right", color: dte != null && dte <= 5 ? theme.red : theme.text.muted },
          { value: cc.contracts ?? 1, align: "right" },
          otmCell(otmCcPct(cc.strike)),
          { value: cc.notes ?? "", color: theme.text.muted },
          { value: formatDollarsFull(cc.premium_collected), color: theme.green, align: "right" },
          { value: formatDollars(pnl), color: pnlColor(pnl), bold: true, align: "right" },
        ],
      });
    }
  }

  for (const csp of csps) {
    const dte = calcDTE(csp.expiry_date);
    const pnl = (csp.premium_collected ?? 0) - ((csp.current_mid ?? 0) * 100 * (csp.contracts ?? 1));
    rows.push({
      type: "CSP",
      cells: [
        { value: <TypeBadge type="CSP" /> },
        { value: `$${csp.strike}`, align: "right" },
        { value: formatExpiry(csp.expiry_date), color: theme.text.muted },
        { value: dte != null ? `${dte}d` : "—", align: "right", color: dte != null && dte <= 5 ? theme.red : theme.text.muted },
        { value: csp.contracts ?? 1, align: "right" },
        otmCell(otmCspPct(csp.strike)),
        { value: csp.notes ?? "", color: theme.text.muted },
        { value: formatDollarsFull(csp.premium_collected), color: theme.green, align: "right" },
        { value: formatDollars(pnl), color: pnlColor(pnl), bold: true, align: "right" },
      ],
    });
  }

  for (const lp of leaps) {
    const dte = calcDTE(lp.expiry_date);
    rows.push({
      type: "LEAPS",
      cells: [
        { value: <TypeBadge type="LEAPS" /> },
        { value: `$${lp.strike}`, align: "right" },
        { value: formatExpiry(lp.expiry_date), color: theme.text.muted },
        { value: dte != null ? `${dte}d` : "—", align: "right" },
        { value: lp.contracts ?? 1, align: "right" },
        { value: "—", align: "right" },
        { value: lp.notes ?? "", color: theme.text.muted },
        { value: formatDollarsFull(lp.capital_fronted), color: theme.chart.leaps, align: "right" },
        { value: "—", align: "right", color: theme.text.muted },
      ],
    });
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <SectionTitle right={`${liveCount} live`}>Open Positions</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
            {["TYPE", "STRIKE", "EXPIRY", "DTE", "QTY", "% OTM", "NOTE", "PREMIUM", "P&L"].map((h, i) => (
              <th key={i} style={{
                padding: `${theme.space[2]}px ${theme.space[2]}px`,
                textAlign: ["STRIKE", "DTE", "QTY", "% OTM", "PREMIUM", "P&L"].includes(h) ? "right" : "left",
                color: theme.text.muted, fontWeight: 500,
                fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.5px",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <Row key={i} cells={r.cells} />)}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the shell**

Modify `src/components/tickerDetail/TickerDetailView.jsx` — add the import and render after `TickerHeader`:

```jsx
import { TickerOpenPositions } from "./TickerOpenPositions";
// ...
<TickerHeader data={data} accountValue={account?.account_value || 0} />
<TickerOpenPositions data={data} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tickerDetail/TickerOpenPositions.jsx src/components/tickerDetail/TickerDetailView.jsx
git commit -m "feat: add ticker detail open positions table"
```

---

## Task 9: TickerLifespanHistory with verdict badges

**Files:**
- Create: `src/components/tickerDetail/TickerLifespanHistory.jsx`
- Modify: `src/components/tickerDetail/TickerDetailView.jsx`

Lifespan history list, most recent first. Collapsed row: #N badge, status (Active/Closed), date range + days, peak shares + capital, total P&L $/%, verdict badge (or suspect flag). Active filter toggle: active/closed. Active lifespan auto-expands. Expanded: verdict line with full numbers, peak/capital/days/return, cycle events list.

- [ ] **Step 1: Create the component**

Create `src/components/tickerDetail/TickerLifespanHistory.jsx`:

```jsx
import { useMemo, useState } from "react";
import { theme } from "../../lib/theme";
import { computeLifespanVerdict } from "../../lib/tickerVerdict";
import { formatDollars, formatExpiry } from "../../lib/format";
import { VerdictBadge } from "./VerdictBadge";

function StatusPill({ status }) {
  const isActive = status === "active";
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 6px",
      border: `1px solid ${isActive ? theme.green : theme.border.strong}`,
      color: isActive ? theme.green : theme.text.muted,
      borderRadius: theme.radius.sm, letterSpacing: "0.05em",
      textTransform: "uppercase", fontWeight: 600,
    }}>{isActive ? "Active" : "Closed"}</span>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px", fontSize: theme.size.xs, fontFamily: "inherit",
        cursor: "pointer", color: active ? theme.green : theme.text.muted,
        background: active ? `${theme.green}1a` : "transparent",
        border: `1px solid ${active ? theme.green : theme.border.strong}`,
        borderRadius: theme.radius.pill, fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
      }}
    >{children}</button>
  );
}

function CycleEvents({ lifespan }) {
  const events = [];

  for (const a of lifespan.assignment_events ?? []) {
    events.push({
      date: a.date,
      label: `CSP $${a.strike} assigned · ${a.shares_added / 100} ct`,
      color: theme.blue,
    });
  }
  for (const cc of lifespan.cc_history ?? []) {
    const subtype = cc.is_winning ? "closed" : "rolled";
    events.push({
      date: cc.close_date,
      label: `CC $${cc.strike} ${subtype} · ${cc.contracts ?? 1} ct · ${formatDollars(cc.premium_collected)}${cc.kept_pct != null ? ` (${cc.kept_pct}% kept)` : ""}`,
      color: cc.premium_collected >= 0 ? theme.green : theme.red,
    });
  }
  if (lifespan.exit_event) {
    events.push({
      date: lifespan.exit_event.date,
      label: `Shares ${lifespan.exit_event.exit_type === "called_away" ? "called away" : "sold"} @ $${lifespan.exit_event.exit_price ?? "—"} · ${formatDollars(lifespan.exit_event.share_disposal_pnl)}`,
      color: lifespan.exit_event.share_disposal_pnl >= 0 ? theme.green : theme.red,
    });
  }
  events.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return (
    <div style={{ marginTop: theme.space[3] }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
      }}>Cycle events</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: `${theme.space[1]}px ${theme.space[3]}px`, fontSize: theme.size.sm }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div style={{ color: theme.text.muted, fontFamily: theme.font.mono }}>{e.date && formatExpiry(e.date)}</div>
            <div style={{ color: e.color }}>{e.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LifespanRow({ lifespan, n, expanded, onToggle, accentColor }) {
  const verdict = computeLifespanVerdict(lifespan);
  const pnl     = lifespan.lifespan_metrics?.total_lifespan_pnl;
  const pnlPct  = lifespan.lifespan_metrics?.return_pct_on_capital;
  const pnlColor = pnl == null ? theme.text.muted : pnl >= 0 ? theme.green : theme.red;
  const status   = lifespan.lifespan_status;

  return (
    <div style={{
      borderLeft: `3px solid ${accentColor}`,
      background: expanded ? theme.bg.elevated : theme.bg.surface,
      marginBottom: theme.space[2], borderRadius: theme.radius.sm,
      transition: "background 0.15s",
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: theme.space[3],
          display: "flex", alignItems: "center", gap: theme.space[3],
          cursor: "pointer", flexWrap: "wrap",
        }}
      >
        <span style={{
          fontSize: theme.size.xs, padding: "1px 6px",
          background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.sm, color: theme.text.muted, fontWeight: 600,
          letterSpacing: "0.05em",
        }}>#{n}</span>
        <StatusPill status={status} />
        <div style={{ fontSize: theme.size.sm, color: theme.text.muted, flex: "1 1 auto" }}>
          {lifespan.assignment_events?.[0]?.date && formatExpiry(lifespan.assignment_events[0].date)}
          {" → "}
          {lifespan.exit_event?.date ? formatExpiry(lifespan.exit_event.date) : "now"}
          {" · "}
          {lifespan.lifespan_metrics?.days_active}d
          {" · peak "}{lifespan.total_shares_at_peak} sh
          {" · "}{formatDollars(lifespan.total_capital_committed)} cap
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          <VerdictBadge verdict={verdict} />
          <div style={{ textAlign: "right", minWidth: 100 }}>
            <div style={{ color: pnlColor, fontWeight: 600 }}>
              {pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${formatDollars(pnl)}`}
              {status === "active" && <span style={{ fontSize: theme.size.xs, color: theme.text.muted, marginLeft: 4 }}>running</span>}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>
              {pnlPct == null ? "" : `${(pnlPct * 100).toFixed(2)}%`}
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: `0 ${theme.space[3]}px ${theme.space[3]}px`,
          borderTop: `1px solid ${theme.border.default}`,
        }}>
          <div style={{ marginTop: theme.space[3], fontSize: theme.size.sm, color: theme.text.secondary }}>
            <VerdictLine lifespan={lifespan} />
          </div>
          <div style={{ marginTop: theme.space[3], display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[3], fontSize: theme.size.sm }}>
            <Stat label="Peak shares" value={lifespan.total_shares_at_peak} />
            <Stat label="Capital" value={formatDollars(lifespan.total_capital_committed)} />
            <Stat label="Days held" value={`${lifespan.lifespan_metrics?.days_active}d`} />
            <Stat label="Return" value={pnlPct != null ? `${(pnlPct * 100).toFixed(2)}%` : "—"} color={pnlColor} />
          </div>
          <CycleEvents lifespan={lifespan} />
        </div>
      )}
    </div>
  );
}

function VerdictLine({ lifespan }) {
  const spaxx = lifespan.benchmarks?.spaxx_baseline?.vs_actual_pnl;
  const cut   = lifespan.benchmarks?.cut_and_redeploy_baseline?.vs_actual_pnl;
  const status = lifespan.lifespan_status;

  if (status === "active") {
    return <span style={{ color: theme.text.muted }}>Lifespan still active — verdict pending close.</span>;
  }
  const parts = [];
  if (spaxx != null) parts.push(`${spaxx >= 0 ? "+" : ""}${formatDollars(spaxx)} vs SPAXX`);
  if (cut   != null) parts.push(`${cut   >= 0 ? "+" : ""}${formatDollars(cut)} vs cut-and-redeploy`);
  if (parts.length === 0) return <span style={{ color: theme.text.muted }}>Insufficient benchmark data.</span>;
  return <span>{parts.join(" · ")}</span>;
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: theme.size.md, color: color || theme.text.primary, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

export function TickerLifespanHistory({ data }) {
  const lifespans = data.lifespans ?? [];
  const sorted = useMemo(() =>
    [...lifespans].sort((a, b) => (b.assignment_events?.[0]?.date ?? "").localeCompare(a.assignment_events?.[0]?.date ?? "")),
    [lifespans]
  );

  const [filter, setFilter] = useState("all"); // "all" | "active" | "closed"
  const [expandedIds, setExpandedIds] = useState(() => {
    // auto-expand the first active lifespan, if any
    const active = sorted.find((l) => l.lifespan_status === "active");
    return new Set(active ? [active.assignment_id] : []);
  });

  function toggle(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = sorted.filter((l) => {
    if (filter === "all") return true;
    return l.lifespan_status === filter;
  });

  if (sorted.length === 0) {
    return (
      <div style={{
        padding: theme.space[5], background: theme.bg.surface,
        border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
        marginBottom: theme.space[4],
      }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
          marginBottom: theme.space[3],
        }}>Lifespan History · 0 cycles</div>
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
          No assignment cycles. This ticker is CSP-only — see trade timeline below.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
        }}>Lifespan History · {sorted.length} {sorted.length === 1 ? "cycle" : "cycles"}</div>
        <div style={{ display: "flex", gap: theme.space[1] }}>
          <FilterButton active={filter === "active"} onClick={() => setFilter(filter === "active" ? "all" : "active")}>active</FilterButton>
          <FilterButton active={filter === "closed"} onClick={() => setFilter(filter === "closed" ? "all" : "closed")}>closed</FilterButton>
        </div>
      </div>

      {filtered.map((l, i) => {
        const n = sorted.length - sorted.indexOf(l);
        const id = l.assignment_id;
        const verdict = computeLifespanVerdict(l);
        const accent = verdict === "ahead"   ? theme.green
                    : verdict === "behind"  ? theme.red
                    : verdict === "suspect" ? theme.amber
                    : l.lifespan_status === "active" ? theme.green
                    : theme.border.strong;
        return (
          <LifespanRow
            key={id ?? i}
            lifespan={l}
            n={n}
            expanded={expandedIds.has(id)}
            onToggle={() => toggle(id)}
            accentColor={accent}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the shell**

Modify `src/components/tickerDetail/TickerDetailView.jsx` — import and render after `TickerOpenPositions`:

```jsx
import { TickerLifespanHistory } from "./TickerLifespanHistory";
// ...
<TickerOpenPositions data={data} />
<TickerLifespanHistory data={data} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tickerDetail/TickerLifespanHistory.jsx src/components/tickerDetail/TickerDetailView.jsx
git commit -m "feat: add ticker detail lifespan history with verdict badges"
```

---

## Task 10: TickerAllTimeStats (primary + secondary + tertiary rows)

**Files:**
- Create: `src/components/tickerDetail/TickerAllTimeStats.jsx`
- Modify: `src/components/tickerDetail/TickerDetailView.jsx`

Three rows:
- **Primary (4 large cards):** Realized P&L, Below-cost CC absorption (amber border), Premium collected, Capital efficiency
- **Secondary (4 smaller cards):** Avg days CSP, Avg days CC, Best trade, Worst trade
- **Tertiary (only if relevant):** Wheels completed, Assignments taken, Times called away, Avg kept_pct

- [ ] **Step 1: Create the component**

Create `src/components/tickerDetail/TickerAllTimeStats.jsx`:

```jsx
import { theme } from "../../lib/theme";
import { computeTickerStats } from "../../lib/tickerStats";
import { formatDollars, formatDollarsFull, formatExpiry } from "../../lib/format";

function Card({ label, value, sub, color, accent, large }) {
  return (
    <div style={{
      padding: large ? theme.space[4] : theme.space[3],
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderLeft: accent ? `3px solid ${accent}` : `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[1],
      }}>{label}</div>
      <div style={{
        fontSize: large ? theme.size.xl : theme.size.lg,
        color: color || theme.text.primary, fontWeight: 600, fontFamily: theme.font.mono,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

const PORTFOLIO_AVG_KEPT_PCT = 60; // mock-anchored portfolio average; could be wired up later

export function TickerAllTimeStats({ data }) {
  const stats = computeTickerStats({
    trades:    data.trades ?? [],
    lifespans: data.lifespans ?? [],
  });

  if (stats.tradeCount === 0) {
    return null; // brand-new ticker with no trades
  }

  const realizedColor = stats.realizedPnl >= 0 ? theme.green : theme.red;
  const tertiaryRelevant = stats.wheelsCompleted > 0 || stats.assignmentsTaken > 0;

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
        }}>All-Time Stats</div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          across {stats.tradeCount} trade{stats.tradeCount === 1 ? "" : "s"}
          {stats.includesSuspectData && " · includes pre-2026 data flagged as suspect"}
        </div>
      </div>

      {/* Primary row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: theme.space[3], marginBottom: theme.space[3],
      }}>
        <Card
          label="Realized P&L"
          value={`${stats.realizedPnl >= 0 ? "+" : ""}${formatDollarsFull(stats.realizedPnl)}`}
          color={realizedColor}
          large
        />
        <Card
          label="Below-cost CC absorption"
          value={stats.belowCostCcAbsorption === 0
            ? "$0"
            : formatDollarsFull(stats.belowCostCcAbsorption)}
          sub={stats.belowCostCcAbsorption === 0
            ? "no absorption losses on this ticker"
            : "specific to wheel strategy on this ticker"}
          color={stats.belowCostCcAbsorption < 0 ? theme.amber : theme.text.primary}
          accent={theme.amber}
          large
        />
        <Card
          label="Premium collected"
          value={formatDollarsFull(stats.premiumCollected)}
          sub="CSP + CC, lifetime"
          large
        />
        <Card
          label="Capital efficiency"
          value={stats.capitalEfficiencyPct != null
            ? `${stats.capitalEfficiencyPct.toFixed(1)}%`
            : "—"}
          sub="annualized return on avg capital"
          large
        />
      </div>

      {/* Secondary row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: theme.space[3], marginBottom: tertiaryRelevant ? theme.space[3] : 0,
      }}>
        <Card label="Avg days CSP" value={stats.avgDaysCsp != null ? `${Math.round(stats.avgDaysCsp)}d` : "—"} />
        <Card label="Avg days CC"  value={stats.avgDaysCc  != null ? `${Math.round(stats.avgDaysCc)}d`  : "—"} />
        <Card
          label="Best trade"
          value={stats.bestTrade ? `${stats.bestTrade.premium_collected >= 0 ? "+" : ""}${formatDollars(stats.bestTrade.premium_collected)}` : "—"}
          sub={stats.bestTrade ? `${stats.bestTrade.type} $${stats.bestTrade.strike} · ${formatExpiry(stats.bestTrade.close_date)}` : null}
          color={stats.bestTrade ? theme.green : theme.text.muted}
        />
        <Card
          label="Worst trade"
          value={stats.worstTrade ? `${stats.worstTrade.premium_collected >= 0 ? "+" : ""}${formatDollars(stats.worstTrade.premium_collected)}` : "—"}
          sub={stats.worstTrade ? `${stats.worstTrade.type} $${stats.worstTrade.strike} · ${formatExpiry(stats.worstTrade.close_date)}` : null}
          color={stats.worstTrade && stats.worstTrade.premium_collected < 0 ? theme.red : theme.text.muted}
        />
      </div>

      {/* Tertiary row — only when there's wheel activity */}
      {tertiaryRelevant && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: theme.space[3],
        }}>
          <Card
            label="Wheels completed"
            value={String(stats.wheelsCompleted)}
            sub={stats.wheelsSuspectExcluded > 0 ? `${stats.wheelsSuspectExcluded} suspect excluded` : null}
          />
          <Card label="Assignments taken" value={String(stats.assignmentsTaken)} />
          <Card label="Times called away" value={String(stats.timesCalledAway)} />
          <Card
            label="Avg kept_pct"
            value={stats.avgKeptPct != null ? `${stats.avgKeptPct.toFixed(0)}%` : "—"}
            sub={stats.avgKeptPct != null ? `port ${PORTFOLIO_AVG_KEPT_PCT}%` : null}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the shell**

Modify `src/components/tickerDetail/TickerDetailView.jsx`:

```jsx
import { TickerAllTimeStats } from "./TickerAllTimeStats";
// ...
<TickerLifespanHistory data={data} />
<TickerAllTimeStats data={data} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tickerDetail/TickerAllTimeStats.jsx src/components/tickerDetail/TickerDetailView.jsx
git commit -m "feat: add ticker detail all-time stats grid"
```

---

## Task 11: TickerTradeTimeline

**Files:**
- Create: `src/components/tickerDetail/TickerTradeTimeline.jsx`
- Modify: `src/components/tickerDetail/TickerDetailView.jsx`

Chronological trade event log. Columns: date, type badge, action (Open/Close/Assigned/Sold), strike, detail, days held, cycle reference (#N badge), P&L. Filter buttons: All / CSP / CC / Shares / LEAPS. Best/worst markers from stats.

A trade's cycle reference is determined by which lifespan (if any) contains that trade ID. We derive a `tradeId → lifespanIndex` map upfront.

- [ ] **Step 1: Create the component**

Create `src/components/tickerDetail/TickerTradeTimeline.jsx`:

```jsx
import { useMemo, useState } from "react";
import { theme } from "../../lib/theme";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../../lib/constants";
import { formatDollars, formatExpiry } from "../../lib/format";
import { computeTickerStats } from "../../lib/tickerStats";

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || { bg: theme.bg.elevated, border: theme.border.strong, text: theme.text.primary };
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px",
      fontSize: theme.size.xs, fontWeight: 600,
      background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: theme.radius.sm,
      letterSpacing: "0.05em",
    }}>{type}</span>
  );
}

function CycleRef({ index }) {
  if (index == null) return <span style={{ color: theme.text.faint }}>—</span>;
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 6px",
      background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
      borderRadius: theme.radius.sm, color: theme.text.muted, fontWeight: 600,
      letterSpacing: "0.05em",
    }}>#{index}</span>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px", fontSize: theme.size.xs, fontFamily: "inherit",
        cursor: "pointer", color: active ? theme.blue : theme.text.muted,
        background: active ? theme.bg.elevated : "transparent",
        border: `1px solid ${active ? theme.blue : theme.border.strong}`,
        borderRadius: theme.radius.pill, fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
      }}
    >{children}</button>
  );
}

function Marker({ kind }) {
  const c = kind === "BEST" ? theme.green : theme.red;
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 4px",
      border: `1px solid ${c}`, color: c,
      borderRadius: theme.radius.sm, fontWeight: 700,
      letterSpacing: "0.05em",
    }}>{kind}</span>
  );
}

export function TickerTradeTimeline({ data }) {
  const trades = data.trades ?? [];
  const lifespans = data.lifespans ?? [];

  // Build trade-id → cycle index (newest = #1 conceptually but we want #N matching the
  // lifespan-history numbering. Lifespan history sorts most recent first and shows #N
  // where N = totalCount - sortedIndex. We replicate that here.)
  const sortedLifespans = useMemo(
    () => [...lifespans].sort((a, b) =>
      (b.assignment_events?.[0]?.date ?? "").localeCompare(a.assignment_events?.[0]?.date ?? "")),
    [lifespans]
  );
  const tradeIdToCycle = useMemo(() => {
    const map = new Map();
    sortedLifespans.forEach((l, i) => {
      const cycleIndex = sortedLifespans.length - i;
      // CSP assignments
      for (const ae of l.assignment_events ?? []) {
        if (ae.triggering_csp_id) map.set(ae.triggering_csp_id, cycleIndex);
      }
      // CC history
      for (const cc of l.cc_history ?? []) {
        if (cc.trade_id) map.set(cc.trade_id, cycleIndex);
      }
    });
    return map;
  }, [sortedLifespans]);

  const stats = useMemo(
    () => computeTickerStats({ trades, lifespans }),
    [trades, lifespans]
  );

  const [filter, setFilter] = useState("all"); // all | CSP | CC | Shares | LEAPS

  const filtered = useMemo(() => {
    let rows = [...trades].filter((t) => t.close_date);
    if (filter !== "all") rows = rows.filter((t) => t.type === filter);
    rows.sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""));
    return rows;
  }, [trades, filter]);

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
        }}>Trade Timeline</div>
        <div style={{ display: "flex", gap: theme.space[1], flexWrap: "wrap" }}>
          {[
            { key: "all",    label: `all (${trades.filter((t) => t.close_date).length})` },
            { key: "CSP",    label: "CSP" },
            { key: "CC",     label: "CC" },
            { key: "Shares", label: "Shares" },
            { key: "LEAPS",  label: "LEAPS" },
          ].map(({ key, label }) => (
            <FilterButton key={key} active={filter === key} onClick={() => setFilter(key)}>{label}</FilterButton>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>No trades match this filter.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
              {[
                { label: "DATE",    align: "left"  },
                { label: "TYPE",    align: "left"  },
                { label: "ACTION",  align: "left"  },
                { label: "STRIKE",  align: "right" },
                { label: "DETAIL",  align: "left"  },
                { label: "DAYS",    align: "right" },
                { label: "CYCLE",   align: "left"  },
                { label: "P&L",     align: "right" },
              ].map((h, i) => (
                <th key={i} style={{
                  padding: `${theme.space[2]}px ${theme.space[2]}px`,
                  textAlign: h.align, color: theme.text.muted, fontWeight: 500,
                  fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.5px",
                }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const action = SUBTYPE_LABELS[t.subtype] || t.subtype;
              const cycle  = tradeIdToCycle.get(t.id) ?? null;
              const pnl    = Number(t.premium_collected) || 0;
              const pnlColor = pnl > 0 ? theme.green : pnl < 0 ? theme.red : theme.text.muted;
              const isBest  = stats.bestTrade?.id  === t.id;
              const isWorst = stats.worstTrade?.id === t.id;
              return (
                <tr key={t.id} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted, fontSize: theme.size.sm }}>{formatExpiry(t.close_date)}</td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}><TypeBadge type={t.type} /></td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.secondary, fontSize: theme.size.sm }}>{action}</td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "right", color: theme.text.primary, fontSize: theme.size.sm }}>
                    {t.strike != null ? `$${t.strike}` : "—"}
                  </td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted, fontSize: theme.size.sm }}>
                    {t.contracts != null ? `${t.contracts} ct` : ""}
                    {t.kept_pct != null && ` · ${t.kept_pct}% kept`}
                    {isBest  && <span style={{ marginLeft: theme.space[1] }}><Marker kind="BEST"  /></span>}
                    {isWorst && <span style={{ marginLeft: theme.space[1] }}><Marker kind="WORST" /></span>}
                  </td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "right", color: theme.text.muted, fontSize: theme.size.sm }}>
                    {t.days_held != null ? `${t.days_held}d` : "—"}
                  </td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}><CycleRef index={cycle} /></td>
                  <td style={{
                    padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "right",
                    color: pnlColor, fontWeight: 600, fontSize: theme.size.sm,
                  }}>
                    {pnl === 0 ? "—" : `${pnl > 0 ? "+" : ""}${formatDollars(pnl)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the shell**

Modify `src/components/tickerDetail/TickerDetailView.jsx`:

```jsx
import { TickerTradeTimeline } from "./TickerTradeTimeline";
// ...
<TickerAllTimeStats data={data} />
<TickerTradeTimeline data={data} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tickerDetail/TickerTradeTimeline.jsx src/components/tickerDetail/TickerDetailView.jsx
git commit -m "feat: add ticker detail trade timeline with filter and best/worst markers"
```

---

## Task 12: Click-through entry from OpenPositionsTab

**Files:**
- Modify: `src/components/OpenPositionsTab.jsx`

The ticker badge in each row of the existing positions table becomes a link to the detail view.

- [ ] **Step 1: Thread `onOpenTickerDetail` through OpenPositionsTab into PositionsTable**

In `src/components/OpenPositionsTab.jsx`, find the function signature at line 665:

```jsx
export function OpenPositionsTab({ positionIntent, onPositionIntentConsumed }) {
```

Replace with:

```jsx
export function OpenPositionsTab({ positionIntent, onPositionIntentConsumed, onOpenTickerDetail }) {
```

Find every `<PositionsTable ... />` instantiation in the file (search for `<PositionsTable`) and add `onOpenTickerDetail={onOpenTickerDetail}` to each one's props.

In `PositionsTable` (function signature at line 418), add the prop:

```jsx
function PositionsTable({ rows, positionType, quoteMap, isMobile, highlightedTicker, onOpenTickerDetail }) {
```

Find the ticker-cell rendering at lines 610–622 (the `<td>` containing the ticker symbol). Replace the `<span>` wrapping the ticker text with a button:

```jsx
{td(
  <span style={{ display: "flex", alignItems: "center" }}>
    <button
      onClick={(e) => {
        e.stopPropagation(); // don't trigger row expand
        onOpenTickerDetail?.(pos.ticker);
      }}
      style={{
        background: "transparent", border: "none", padding: 0,
        display: "inline-block", width: 38, fontWeight: 700,
        color: theme.text.primary, fontFamily: "inherit",
        fontSize: "inherit", cursor: onOpenTickerDetail ? "pointer" : "default",
        textAlign: "left",
      }}
      onMouseEnter={(e) => { if (onOpenTickerDetail) e.currentTarget.style.color = theme.blue; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = theme.text.primary; }}
    >
      {pos.ticker}
    </button>
    {pos.cushion_state === "assignment_risk" && (dte == null || dte <= 21) && (
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: theme.red, display: "inline-block", flexShrink: 0 }} />
    )}
    {pos.cushion_state === "approaching" && (dte == null || dte <= 14) && (
      <span style={{ fontSize: theme.size.sm, color: theme.amber, lineHeight: 1 }}>⚠</span>
    )}
  </span>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/OpenPositionsTab.jsx
git commit -m "feat: ticker badges in positions table open detail view"
```

---

## Task 13: URL hash routing for `#/ticker/{symbol}`

**Files:**
- Modify: `src/App.jsx`

The spec asks for direct URL routing for bookmarks. The app doesn't use react-router, so we use hash-based routing — no new dependency. The URL format is `#/ticker/SYMBOL`. When the hash matches, App enters Explore → ticker-detail with that symbol on mount and on hashchange. When the user navigates away from the detail view, the hash is cleared.

- [ ] **Step 1: Add hash sync effect to App.jsx**

In `src/App.jsx`, after the existing `useEffect` for `/api/data` (around line 67) add:

```jsx
// ── Hash routing for #/ticker/SYMBOL bookmarks ────────────────────────────
useEffect(() => {
  function applyHash() {
    const m = window.location.hash.match(/^#\/ticker\/([A-Za-z0-9.\-]+)/);
    if (m) {
      const sym = m[1].toUpperCase();
      setModeRaw("explore");
      setSubViewRaw("ticker-detail");
      setDetailTicker(sym);
    }
  }
  applyHash();
  window.addEventListener("hashchange", applyHash);
  return () => window.removeEventListener("hashchange", applyHash);
}, []);
```

- [ ] **Step 2: Update detail-view open/close handlers in the ExploreView render to set the hash**

In `src/App.jsx`, replace the `onOpenTickerDetail`/`onCloseTickerDetail` callbacks with versions that also update the hash:

```jsx
{mode === "explore" && (
  <ExploreView
    subView={subView}
    onSubViewChange={setSubView}
    positionIntent={positionIntent}
    onPositionIntentConsumed={() => setPositionIntent(null)}
    detailTicker={detailTicker}
    onOpenTickerDetail={(ticker) => {
      setDetailTicker(ticker);
      setSubViewRaw("ticker-detail");
      window.history.replaceState(null, "", `#/ticker/${ticker}`);
    }}
    onCloseTickerDetail={() => {
      setDetailTicker(null);
      setSubViewRaw("positions");
      window.history.replaceState(null, "", " "); // clear hash without reload
    }}
  />
)}
```

- [ ] **Step 3: Manually verify**

Open the app, click into a ticker detail view, copy the URL (it should now contain `#/ticker/SYMBOL`), open in new tab → verify it lands directly on the detail view. Click breadcrumb → hash clears. Reload at the hashed URL → still lands on the detail view.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: hash-based URL routing for ticker detail view"
```

---

## Task 14: End-to-end verification + version bump

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Check current main version**

Run: `git fetch origin main && git show origin/main:package.json | grep '"version"'`
Note the current version (e.g. `"version": "1.103.4"`). Increment minor: e.g. `1.104.0`.

- [ ] **Step 2: Run vitest suite**

Run: `npx vitest run`
Expected: all tests pass — including the two new test suites from Tasks 1 and 2.

- [ ] **Step 3: Start dev server and verify in browser**

Run: `npx vercel dev --listen 3000` (or use the project's standard start command — check `package.json` scripts).

In a browser at `http://localhost:3000`:
1. Navigate to Explore → Positions
2. Click an active ticker (e.g. one of yours with assigned shares — `IREN` or similar)
3. Verify the ticker-detail view loads:
   - Breadcrumb shows "Explore / Positions / TICKER"
   - Header shows symbol, spot, day change, capital, open contracts, allocation, health
   - Open positions table populated
   - Lifespan history shows cycles, most recent auto-expanded, verdict badges visible
   - All-time stats: primary/secondary/tertiary rows render
   - Trade timeline with filter buttons works
4. Click "Explore / Positions" breadcrumb → returns to positions tab
5. Click a CSP-only ticker (e.g. `GLW` if you have it) → verify lifespan empty state and that all-time stats still render

- [ ] **Step 4: Bump version**

Modify `package.json`:

```json
"version": "X.Y.Z",
```

Modify `src/lib/constants.js`:

```js
export const VERSION = "X.Y.Z";
```

(Replace X.Y.Z with the bumped value.)

- [ ] **Step 5: Final commit + push to main**

Per CLAUDE.md, this is direct-to-main work. Push immediately after committing:

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to X.Y.Z (ticker detail view)"

# (User's normal merge process applies — this plan was implemented on a feature
# branch in a worktree, so the engineer should follow the project's PR or
# direct-merge workflow per CLAUDE.md guidance.)
```

---

## Implementation notes for the engineer

1. **Don't import from `src/redesign/`** — the redesign folder is frozen per memory. Use `src/lib/theme.js` and inline `style={{}}` objects throughout.
2. **No CSS files, no Tailwind, no hardcoded hex** — always use `theme.green` etc.
3. **Pacific Time for user-facing display, Eastern Time for market-hours math.** None of the new components do market-hours math — `formatExpiry` from `src/lib/format.js` is browser-local and is correct here.
4. **The `/api/ticker-detail` endpoint deliberately reuses logic** from `/api/position-lifespan` via the new `api/_lib/lifespan.js` module. Don't duplicate that logic in the new endpoint.
5. **The endpoint payload may be large** for tickers with long histories. Worry about that only if a real ticker takes >2s to render. The architecture is per-ticker so this stays bounded.
6. **Suspect data:** the spec excludes suspect lifespans from wheel-count tertiary stats but includes them in P&L/premium aggregates. The implementation in `tickerStats.js` follows that split exactly — don't "simplify" by uniformly excluding.
7. **Active vs. closed lifespan:** active lifespans get verdict "neutral" (we don't predict). Tests in Task 1 lock this down.

## Intentionally deferred (not blocking v1)

The following items are mentioned in the spec but are interaction polish / nice-to-haves; deferring keeps v1 shippable. Each can be added in a v1.1 follow-up:

- **P1/P2 priority badges in Open Positions table** — requires joining with focus-engine items. Adds plumbing complexity (focus items are computed at App level). Can be wired by passing `focus.items` into `TickerDetailView` and filtering by ticker.
- **Cycle column click → expand corresponding lifespan** — ergonomic enhancement; current implementation shows the cycle # as a static badge.
- **Highlight trades in timeline that belong to an expanded lifespan** — visual sync between lifespan and timeline sections; current implementation uses the cycle # badge for visual linkage.
- **Company name** — endpoint returns `null`; UI gracefully omits. Wire when a company-name source becomes available (Public.com instrument lookup or a static map).
