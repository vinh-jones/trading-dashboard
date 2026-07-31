# Deferred CSP-Assignment Income Recognition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, brokerage-aligned "distributable" income basis that defers CSP-assignment premium until the resulting shares are disposed, shown side by side with today's "booked" basis in the History view.

**Architecture:** Pure client-side computation over trade data `/api/data` already ships. `detectLifespans` is extracted from `api/_lib/lifespan.js` into `src/lib/lifespanChains.js` (re-exported, so server consumers are untouched). A new pure module `src/lib/incomeRecognition.js` walks each lifespan chain carrying a running premium pool, releasing pro-rata as shares are disposed. A new presentational component renders the monthly ledger. Nothing existing changes behavior.

**Tech Stack:** Vanilla ES modules, React 18 (no state library), Vitest, inline styles via `src/lib/theme.js`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-deferred-csp-assignment-income-design.md`

---

## Background an engineer needs before starting

**The domain problem.** When a cash-secured put (CSP) is assigned, the seller is forced to buy 100 shares per contract at the strike price. The premium collected on that put is *not* income at a brokerage — it reduces the cost basis of the acquired shares, and profit is only recognized when those shares are eventually sold. This app currently books that premium as realized income on the assignment date, which overstates withdrawable income in heavy-assignment months.

**How trades are stored.** The `trades` table holds *closed* trades. Relevant columns: `id`, `ticker`, `type` (`CSP` / `CC` / `Shares` / `LEAPS` / `Spread` / `Interest`), `subtype` (`Close` / `Expired` / `Assigned` / `Sold` / `Exit` / `Held` / `Roll Loss`), `strike`, `contracts`, `open_date`, `close_date` (ISO `YYYY-MM-DD`), `premium_collected` (net realized dollars — **not** dollars-per-share), `description`.

The rows this feature cares about:
- `CSP` + `Assigned` → shares acquired. `contracts` is a **contract** count; shares = `contracts × 100`.
- `Shares` + `Assigned` → shares bought outright, no option involved. `contracts` here is a **share** count, not contracts.
- `Shares` + `Sold` / `Exit` → shares disposed. `contracts` is a share count; when NULL, the count is embedded in `description`.
- `CC` + `Assigned` → a covered call was assigned, shares called away.

**Lifespan chains.** `detectLifespans(ticker, allTickerTrades)` groups a ticker's trades into "chains": one share-holding cycle from first acquisition until the share count returns to zero. It returns an array of raw chain objects, each with `assignment_events[]` (`{ date, triggering_csp_id, csp_premium_collected, shares_added, ... }`), `partial_dispositions[]` (`{ date, shares, ... }`), and `exit_event` (`{ date, shares_disposed, ... }`) or `null` if the chain is still open. Open chains are returned too.

**Run tests with:** `npm test` (Vitest, single run). A single file: `npx vitest run src/lib/__tests__/incomeRecognition.test.js`.

**Do not** modify `lib/parseSheets.js`, `lib/syncSheets.js`, the `trades` schema, `api/_lib/computeForecastV2.js`, or any existing income number. This feature is purely additive.

---

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lib/lifespanChains.js` | Create | Chain detection — `detectLifespans` + its private helpers, moved verbatim from `api/_lib/lifespan.js`. Pure, browser-safe. |
| `api/_lib/lifespan.js` | Modify | Imports the moved helpers, re-exports `detectLifespans` and `DATA_QUALITY_THRESHOLD`. Keeps all lifespan *metrics* code. |
| `src/lib/trading.js` | Modify | `normalizeTrade` gains `close_date` and `premium_collected`. |
| `src/lib/incomeRecognition.js` | Create | `buildRecognitionLedger` — the two-basis monthly ledger. Pure, no React. |
| `src/lib/__tests__/incomeRecognition.test.js` | Create | Unit tests for the ledger. |
| `src/lib/__tests__/trading.test.js` | Create or modify | Regression test for the `normalizeTrade` additions. |
| `src/components/RecognitionLedger.jsx` | Create | Presentational month table + headline. No data fetching, no filter state. |
| `src/components/HistoryTab.jsx` | Modify | Third option in the existing Cards/Breakdown toggle. |
| `package.json`, `src/lib/constants.js` | Modify | Version bump to 1.173.0. |

---

## Task 1: Extract chain detection into `src/lib/lifespanChains.js`

Pure move, no behavior change. The existing suite is the proof.

**Files:**
- Create: `src/lib/lifespanChains.js`
- Modify: `api/_lib/lifespan.js`

- [ ] **Step 1: Capture the current test baseline**

Run: `npm test 2>&1 | tail -20`

Write down the passing/failing counts. Every one of these must be identical at the end of this task. If anything is already failing before you start, note it and do not attempt to fix it here.

- [ ] **Step 2: Create `src/lib/lifespanChains.js`**

Move these from `api/_lib/lifespan.js` **verbatim** — do not rewrite, retype, or "improve" them. Copy the exact bodies:

- `DATA_QUALITY_THRESHOLD` (line 23)
- `tradeSortPriority` (line 55)
- `parseShareCountFromDesc` (line 69)
- `resolveSoldShares` (line 80)
- `computePremiumOnlyCcIds` (line 91)
- `computeNetShares` (line 116)
- `detectLifespans` (lines 137–354, the whole function)
- `computeBlendedBasis` (line 766)
- `round2` (line 797)

The file header:

```js
/**
 * src/lib/lifespanChains.js
 *
 * Share-lifespan chain detection. Groups a ticker's closed trades into
 * "chains" — one share-holding cycle from first acquisition until the running
 * share count returns to zero. Open chains are emitted too.
 *
 * Lives in src/lib/ (not api/_lib/) because both the browser and the
 * serverless functions need it. `api/_lib/lifespan.js` re-exports
 * detectLifespans and DATA_QUALITY_THRESHOLD, so server consumers
 * (position-lifespan, ticker-detail, eod-snapshot) are unaffected.
 *
 * Keep this module dependency-free. Anything imported here ends up in the
 * client bundle.
 *
 * Exports: DATA_QUALITY_THRESHOLD, detectLifespans, computeBlendedBasis, round2
 */
```

Export exactly four names: `DATA_QUALITY_THRESHOLD`, `detectLifespans`, `computeBlendedBasis`, `round2`. The other four helpers stay module-private (no `export`).

Note `detectLifespans` calls `round2` and `computeBlendedBasis` internally — they must be in this file, not imported back from `lifespan.js`, or you create a cycle.

- [ ] **Step 3: Rewire `api/_lib/lifespan.js`**

Delete the nine moved definitions from `api/_lib/lifespan.js`. Add this import directly below the existing `normCDF` import:

```js
import {
  DATA_QUALITY_THRESHOLD,
  detectLifespans,
  computeBlendedBasis,
  round2,
} from "../../src/lib/lifespanChains.js";
```

Then re-export the two names that consumers import from here:

```js
export { DATA_QUALITY_THRESHOLD, detectLifespans };
```

`computeBlendedBasis` and `round2` stay imported-but-not-re-exported — they were private before and the rest of `lifespan.js` still calls them (`computeBlendedBasis` at line 369; `round2` throughout `buildLifespan`).

Update the file's header comment block: remove `detectLifespans` and `DATA_QUALITY_THRESHOLD` from the "Exports:" line only if you also note they are re-exported. Remove `tradeSortPriority`, `parseShareCountFromDesc`, `resolveSoldShares`, `computePremiumOnlyCcIds`, `computeNetShares`, `computeBlendedBasis`, and `round2` from the "Private (not exported):" list, since they no longer live here.

- [ ] **Step 4: Verify the move is behavior-neutral**

Run: `npm test 2>&1 | tail -20`

Expected: **identical** pass/fail counts to Step 1. `api/_lib/__tests__/lifespan-detection.test.js` imports `detectLifespans` and `DATA_QUALITY_THRESHOLD` from `../lifespan.js` and must still pass untouched — that file is the proof the re-export works. `api/_lib/__tests__/lifespan-baseline.test.js` must also still pass.

If anything fails, you moved something incorrectly. Diff the moved functions against git history rather than debugging from scratch:

```bash
git diff HEAD -- api/_lib/lifespan.js
```

- [ ] **Step 5: Verify the client bundle builds**

Run: `npm run build 2>&1 | tail -15`

Expected: build succeeds. This confirms `src/lib/lifespanChains.js` has no server-only dependencies.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lifespanChains.js api/_lib/lifespan.js
git commit -m "refactor(lifespan): extract chain detection to src/lib/lifespanChains.js

detectLifespans is pure and needed by the browser, but living in api/_lib/
meant importing server code into the client bundle. Moved to src/lib/ with a
re-export from api/_lib/lifespan.js so position-lifespan, ticker-detail, and
eod-snapshot are unchanged. No behavior change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Add `close_date` and `premium_collected` to `normalizeTrade`

**Files:**
- Modify: `src/lib/trading.js:42-72`
- Create: `src/lib/__tests__/trading.test.js` (create only if absent; otherwise append the describe block)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/trading.test.js` (if it already exists, append the `describe` block to it and keep the existing imports):

```js
import { describe, it, expect } from "vitest";
import { normalizeTrade } from "../trading.js";

const raw = {
  id: "t1",
  ticker: "HOOD",
  type: "CSP",
  subtype: "Assigned",
  strike: 85,
  contracts: 2,
  open_date: "2026-06-02",
  close_date: "2026-06-20",
  expiry_date: "2026-06-20",
  days_held: 18,
  premium_collected: 640,
  kept_pct: null,
  capital_fronted: 17000,
  description: null,
};

describe("normalizeTrade — raw passthrough fields", () => {
  it("keeps the ISO close_date alongside the Date object and display string", () => {
    const t = normalizeTrade(raw);
    expect(t.close_date).toBe("2026-06-20");
    expect(t.close).toBe("06/20");
    expect(t.closeDate).toBeInstanceOf(Date);
  });

  it("keeps premium_collected identical to premium", () => {
    const t = normalizeTrade(raw);
    expect(t.premium_collected).toBe(640);
    expect(t.premium_collected).toBe(t.premium);
  });

  it("defaults both premium keys to 0 when the column is null", () => {
    const t = normalizeTrade({ ...raw, premium_collected: null });
    expect(t.premium).toBe(0);
    expect(t.premium_collected).toBe(0);
  });

  it("nulls close_date when the column is null", () => {
    const t = normalizeTrade({ ...raw, close_date: null });
    expect(t.close_date).toBeNull();
    expect(t.closeDate).toBeNull();
  });
});
```

Why `premium_collected` must equal `premium` exactly: `src/lib/cohorts.js:47` and `src/lib/strategyBasket.js:75` both read `trade.premium_collected ?? trade.premium ?? 0` and accept either the raw DB row or `normalizeTrade` output. If the two keys ever disagree, those consumers silently change behavior. The test pins them together.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/trading.test.js`

Expected: FAIL — `expected undefined to be '2026-06-20'` and `expected undefined to be 640`.

- [ ] **Step 3: Add the two fields**

In `src/lib/trading.js`, inside the object returned by `normalizeTrade`, directly below the existing `closeDate,` line (line 57):

```js
    close_date: t.close_date ?? null,   // ISO string — chain detection sorts on this
```

And directly below the existing `premium: t.premium_collected ?? 0,` line (line 59):

```js
    premium_collected: t.premium_collected ?? 0,  // raw-shape alias; must stay === premium
```

Change nothing else in the function.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/__tests__/trading.test.js`

Expected: PASS, 4 tests.

Then run the full suite to confirm no consumer regressed:

Run: `npm test 2>&1 | tail -20`

Expected: same pass/fail counts as Task 1 Step 4, plus 4 new passing tests. Pay particular attention to `cohorts.test.js` — it exercises the `premium_collected ?? premium` fallback.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading.js src/lib/__tests__/trading.test.js
git commit -m "feat(trades): keep close_date and premium_collected on normalized trades

Chain detection sorts on the ISO close_date and reads premium_collected;
normalizeTrade dropped both. Additive, and premium_collected is pinned equal
to premium so the cohorts/basket fallback is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `buildRecognitionLedger` — booked basis and month bucketing

Build the module in three passes. This one establishes the shape and the trivial basis; deferral arrives in Task 4.

**Files:**
- Create: `src/lib/incomeRecognition.js`
- Create: `src/lib/__tests__/incomeRecognition.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/incomeRecognition.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildRecognitionLedger } from "../incomeRecognition.js";

// Minimal closed-trade factory. Dates are ISO; premium is net realized dollars.
export function trade(over = {}) {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    ticker: "TEST",
    type: "CSP",
    subtype: "Expired",
    strike: 100,
    contracts: 1,
    open_date: "2026-02-01",
    close_date: "2026-02-20",
    premium_collected: 0,
    description: null,
    ...over,
  };
}

const monthRow = (ledger, month) => ledger.months.find((m) => m.month === month);

describe("buildRecognitionLedger — booked basis", () => {
  it("buckets closed trades into their close_date month", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
      trade({ close_date: "2026-02-25", premium_collected: 200 }),
      trade({ close_date: "2026-03-04", premium_collected: 150 }),
    ]);
    expect(monthRow(ledger, "2026-02").booked).toBe(500);
    expect(monthRow(ledger, "2026-03").booked).toBe(150);
  });

  it("returns months in ascending order with no gaps skipped", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: "2026-03-04", premium_collected: 150 }),
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
    ]);
    expect(ledger.months.map((m) => m.month)).toEqual(["2026-02", "2026-03"]);
  });

  it("ignores trades with no close_date", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: null, premium_collected: 999 }),
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
    ]);
    expect(ledger.cumulativeBooked).toBe(300);
  });

  it("distributable equals booked when nothing was assigned", () => {
    const ledger = buildRecognitionLedger([
      trade({ close_date: "2026-02-10", premium_collected: 300 }),
      trade({ type: "CC", subtype: "Close", close_date: "2026-02-14", premium_collected: -80 }),
    ]);
    expect(monthRow(ledger, "2026-02").distributable).toBe(220);
    expect(monthRow(ledger, "2026-02").delta).toBe(0);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("returns an empty ledger for no trades", () => {
    const ledger = buildRecognitionLedger([]);
    expect(ledger.months).toEqual([]);
    expect(ledger.cumulativeBooked).toBe(0);
    expect(ledger.cumulativeDistributable).toBe(0);
    expect(ledger.outstandingDeferred).toBe(0);
    expect(ledger.openChains).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/incomeRecognition.test.js`

Expected: FAIL — `Failed to resolve import "../incomeRecognition.js"`.

- [ ] **Step 3: Write the module**

Create `src/lib/incomeRecognition.js`:

```js
/**
 * src/lib/incomeRecognition.js
 *
 * Two recognition bases over the same closed-trade rows:
 *
 *   booked        — today's behavior everywhere in the app: every closed
 *                   trade's premium_collected recognized on its close_date.
 *   distributable — brokerage behavior: CSP-assignment premium is deferred at
 *                   assignment and released as the acquired shares are
 *                   disposed, because an assigned put's premium adjusts the
 *                   share cost basis rather than realizing as income.
 *
 * Only `type === "CSP" && subtype === "Assigned"` rows move between the two.
 *
 * Invariant, asserted in tests and displayed in the UI as a self-check:
 *
 *   cumulative booked − cumulative distributable ≡ outstanding deferred
 *
 * See docs/superpowers/specs/2026-07-31-deferred-csp-assignment-income-design.md
 */

import { detectLifespans } from "./lifespanChains.js";

const round2 = (n) => +n.toFixed(2);

/** "2026-07-15" → "2026-07". Null-safe. */
function monthOf(iso) {
  return iso ? iso.slice(0, 7) : null;
}

/** Empty month row. All figures are dollars. */
function emptyMonth(month) {
  return {
    month,
    booked: 0,
    distributable: 0,
    delta: 0,
    deferredAdded: 0,
    deferredReleased: 0,
    outstandingAtMonthEnd: 0,
  };
}

/**
 * @param {Array<object>} trades closed-trade rows. Accepts raw DB rows or
 *        normalizeTrade output — both carry close_date and premium_collected.
 * @returns {{
 *   months: Array<object>,
 *   outstandingDeferred: number,
 *   cumulativeBooked: number,
 *   cumulativeDistributable: number,
 *   openChains: Array<object>,
 * }}
 */
export function buildRecognitionLedger(trades) {
  const rows = Array.isArray(trades) ? trades : [];

  // Deferral is added in Task 4. For now every trade recognizes on close_date
  // in both bases.
  const deferredIds = new Set();
  const releases = [];
  const openChains = [];

  const byMonth = new Map();
  const monthRow = (m) => {
    if (!byMonth.has(m)) byMonth.set(m, emptyMonth(m));
    return byMonth.get(m);
  };

  for (const t of rows) {
    const m = monthOf(t.close_date);
    if (!m) continue;
    const amount = Number(t.premium_collected) || 0;
    const row = monthRow(m);
    row.booked = round2(row.booked + amount);

    const isDeferred =
      t.type === "CSP" && t.subtype === "Assigned" && deferredIds.has(t.id);
    if (isDeferred) {
      row.deferredAdded = round2(row.deferredAdded + amount);
    } else {
      row.distributable = round2(row.distributable + amount);
    }
  }

  for (const r of releases) {
    const m = monthOf(r.date);
    if (!m) continue;
    const row = monthRow(m);
    row.distributable = round2(row.distributable + r.amount);
    row.deferredReleased = round2(row.deferredReleased + r.amount);
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  let cumulativeBooked = 0;
  let cumulativeDistributable = 0;
  let outstanding = 0;
  for (const row of months) {
    row.delta = round2(row.booked - row.distributable);
    outstanding = round2(outstanding + row.deferredAdded - row.deferredReleased);
    row.outstandingAtMonthEnd = outstanding;
    cumulativeBooked = round2(cumulativeBooked + row.booked);
    cumulativeDistributable = round2(cumulativeDistributable + row.distributable);
  }

  return {
    months,
    outstandingDeferred: outstanding,
    cumulativeBooked,
    cumulativeDistributable,
    openChains,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/__tests__/incomeRecognition.test.js`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/incomeRecognition.js src/lib/__tests__/incomeRecognition.test.js
git commit -m "feat(income): add recognition ledger skeleton with booked basis

Month bucketing and the two-basis output shape. Deferral logic lands next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Deferral and release — the running-average pool

**Files:**
- Modify: `src/lib/incomeRecognition.js`
- Modify: `src/lib/__tests__/incomeRecognition.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/incomeRecognition.test.js`. These reuse the `trade` factory and `monthRow` helper already in the file.

Note the two `contracts` conventions: on a `CSP`/`Assigned` row it is a **contract** count (×100 for shares); on a `Shares`/`Sold` row it is a **share** count.

```js
// A CSP assigned on `date` for `contracts` contracts, collecting `premium`.
const assign = (over) =>
  trade({ type: "CSP", subtype: "Assigned", ...over });

// A share disposal of `contracts` SHARES on `date`, realizing `premium` P&L.
const sell = (over) =>
  trade({ type: "Shares", subtype: "Sold", ...over });

describe("buildRecognitionLedger — deferral and release", () => {
  it("defers premium while the shares are still held", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-06-19", contracts: 1, strike: 100, premium_collected: 400 }),
    ]);
    expect(monthRow(ledger, "2026-06").booked).toBe(400);
    expect(monthRow(ledger, "2026-06").distributable).toBe(0);
    expect(monthRow(ledger, "2026-06").deferredAdded).toBe(400);
    expect(ledger.outstandingDeferred).toBe(400);
  });

  it("nets to zero change when assignment and disposal share a month", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-06-05", contracts: 1, strike: 100, premium_collected: 400 }),
      sell({ id: "s1", close_date: "2026-06-26", contracts: 100, premium_collected: 250 }),
    ]);
    const june = monthRow(ledger, "2026-06");
    expect(june.booked).toBe(650);
    expect(june.distributable).toBe(650);
    expect(june.delta).toBe(0);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("moves premium from the assignment month to the disposal month", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-05-15", contracts: 1, strike: 100, premium_collected: 400 }),
      sell({ id: "s1", close_date: "2026-07-10", contracts: 100, premium_collected: 250 }),
    ]);
    expect(monthRow(ledger, "2026-05").booked).toBe(400);
    expect(monthRow(ledger, "2026-05").distributable).toBe(0);
    expect(monthRow(ledger, "2026-07").booked).toBe(250);
    expect(monthRow(ledger, "2026-07").distributable).toBe(650);
    expect(monthRow(ledger, "2026-07").deferredReleased).toBe(400);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("carries outstandingAtMonthEnd across the gap months", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-05-15", contracts: 1, strike: 100, premium_collected: 400 }),
      trade({ id: "x", close_date: "2026-06-10", premium_collected: 100 }),
      sell({ id: "s1", close_date: "2026-07-10", contracts: 100, premium_collected: 250 }),
    ]);
    expect(monthRow(ledger, "2026-05").outstandingAtMonthEnd).toBe(400);
    expect(monthRow(ledger, "2026-06").outstandingAtMonthEnd).toBe(400);
    expect(monthRow(ledger, "2026-07").outstandingAtMonthEnd).toBe(0);
  });

  it("keeps chains on different tickers independent", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", ticker: "AAA", close_date: "2026-05-15", contracts: 1, strike: 100, premium_collected: 400 }),
      assign({ id: "a2", ticker: "BBB", close_date: "2026-05-16", contracts: 1, strike: 50, premium_collected: 200 }),
      sell({ id: "s1", ticker: "AAA", close_date: "2026-06-10", contracts: 100, premium_collected: 90 }),
    ]);
    expect(monthRow(ledger, "2026-06").deferredReleased).toBe(400);
    expect(ledger.outstandingDeferred).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/incomeRecognition.test.js`

Expected: the 5 Task-3 tests pass; the 5 new ones FAIL — distributable still equals booked because `deferredIds` is empty and `releases` is empty.

- [ ] **Step 3: Implement the pool walk**

In `src/lib/incomeRecognition.js`, replace the placeholder block:

```js
  // Deferral is added in Task 4. For now every trade recognizes on close_date
  // in both bases.
  const deferredIds = new Set();
  const releases = [];
  const openChains = [];
```

with a call to a new helper, and add the helper above `buildRecognitionLedger`:

```js
/**
 * Walk every ticker's lifespan chains, carrying a running premium pool and
 * share count. Returns the set of CSP-assignment trade ids that entered a
 * chain (and are therefore deferred), the dated release amounts, and the
 * still-open chains holding the outstanding balance.
 *
 * Only chain-participating assignments are deferred. detectLifespans drops
 * pre-DATA_QUALITY_THRESHOLD trades for tickers fully closed before the
 * cutoff; such a CSP has no disposal to release against, so deferring it
 * would strand its premium in neither basis and break the invariant.
 */
function walkChains(rows) {
  const deferredIds = new Set();
  const releases = [];
  const openChains = [];

  const tradeById = new Map();
  for (const t of rows) if (t.id != null) tradeById.set(t.id, t);

  const byTicker = new Map();
  for (const t of rows) {
    if (!t.ticker) continue;
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
    byTicker.get(t.ticker).push(t);
  }

  for (const [ticker, tickerTrades] of byTicker) {
    for (const chain of detectLifespans(ticker, tickerTrades)) {
      // detectLifespans exposes acquisitions and disposals as separate arrays
      // rather than one ordered stream, so rebuild the stream. On a same-date
      // tie acquisitions go first: you cannot dispose shares you have not
      // acquired, and both events land in the same month either way, so the
      // monthly ledger is unaffected by the choice.
      const events = [];
      for (const a of chain.assignment_events) {
        events.push({ date: a.date, kind: "assign", shares: a.shares_added, id: a.triggering_csp_id });
      }
      for (const d of chain.partial_dispositions) {
        events.push({ date: d.date, kind: "dispose", shares: d.shares });
      }
      if (chain.exit_event) {
        events.push({ date: chain.exit_event.date, kind: "dispose", shares: chain.exit_event.shares_disposed });
      }
      events.sort((a, b) => {
        const d = (a.date ?? "").localeCompare(b.date ?? "");
        if (d !== 0) return d;
        return (a.kind === "assign" ? 0 : 1) - (b.kind === "assign" ? 0 : 1);
      });

      let pool = 0;
      let sharesHeld = 0;
      let firstAssignmentDate = null;

      for (const ev of events) {
        if (ev.kind === "assign") {
          if (!firstAssignmentDate) firstAssignmentDate = ev.date;
          const src = ev.id != null ? tradeById.get(ev.id) : null;
          // Only a CSP assignment contributes premium. A direct Shares/Assigned
          // purchase adds shares only — its premium_collected is share P&L, not
          // option premium, and must never enter the pool.
          if (src && src.type === "CSP" && src.subtype === "Assigned") {
            pool = round2(pool + (Number(src.premium_collected) || 0));
            deferredIds.add(src.id);
          }
          sharesHeld += ev.shares || 0;
        } else {
          if (sharesHeld <= 0) continue;
          const disposed = Math.min(ev.shares || 0, sharesHeld);
          if (disposed <= 0) continue;
          // The disposal that empties the chain takes the whole remaining pool,
          // so releases always sum exactly to the deferred total and no penny
          // drift leaks into the invariant.
          const amount = disposed >= sharesHeld ? pool : round2(pool * (disposed / sharesHeld));
          if (amount !== 0) releases.push({ date: ev.date, amount });
          pool = round2(pool - amount);
          sharesHeld -= disposed;
        }
      }

      if (pool !== 0 || sharesHeld > 0) {
        openChains.push({ ticker, firstAssignmentDate, sharesHeld, deferredRemaining: pool });
      }
    }
  }

  return { deferredIds, releases, openChains };
}
```

And in `buildRecognitionLedger`, immediately after `const rows = ...`:

```js
  const { deferredIds, releases, openChains } = walkChains(rows);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/__tests__/incomeRecognition.test.js`

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/incomeRecognition.js src/lib/__tests__/incomeRecognition.test.js
git commit -m "feat(income): defer CSP-assignment premium until share disposal

Running-average pool per lifespan chain: assignment adds premium and shares,
disposal releases pro-rata. Only chain-participating assignments defer, so
pre-cutoff trades outside any chain stay recognized in both bases.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Partial disposals, interleaving, rounding, and the invariant

The pool math from Task 4 should already handle all of these. These tests exist to prove it and to lock the behavior against future edits — expect them to pass on the first run, and treat any failure as a real bug in Task 4's code rather than something to patch around.

**Files:**
- Modify: `src/lib/__tests__/incomeRecognition.test.js`

- [ ] **Step 1: Write the tests**

Append to `src/lib/__tests__/incomeRecognition.test.js`:

```js
describe("buildRecognitionLedger — partial disposals and edge cases", () => {
  it("releases pro-rata on a partial disposal of a blended pool", () => {
    // 3 assignments → 300 shares, $1,300 pooled. Sell 100 → release 1/3.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-04-10", contracts: 1, strike: 100, premium_collected: 400 }),
      assign({ id: "a2", close_date: "2026-04-17", contracts: 1, strike: 95,  premium_collected: 600 }),
      assign({ id: "a3", close_date: "2026-04-24", contracts: 1, strike: 90,  premium_collected: 300 }),
      sell({ id: "s1", close_date: "2026-05-08", contracts: 100, premium_collected: 120 }),
    ]);
    expect(monthRow(ledger, "2026-04").deferredAdded).toBe(1300);
    expect(monthRow(ledger, "2026-05").deferredReleased).toBeCloseTo(433.33, 2);
    expect(ledger.outstandingDeferred).toBeCloseTo(866.67, 2);
  });

  it("uses the running denominator when an assignment follows a disposal", () => {
    // Assign 100 sh / $400. Sell 50 → release $200, leaving 50 sh / $200.
    // Assign 100 more / $600 → 150 sh / $800. Sell 150 → release the rest.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 1, strike: 100, premium_collected: 400 }),
      sell({ id: "s1", close_date: "2026-04-06", contracts: 50, premium_collected: 60 }),
      assign({ id: "a2", close_date: "2026-05-06", contracts: 1, strike: 90, premium_collected: 600 }),
      sell({ id: "s2", close_date: "2026-06-06", contracts: 150, premium_collected: 210 }),
    ]);
    expect(monthRow(ledger, "2026-04").deferredReleased).toBe(200);
    expect(monthRow(ledger, "2026-06").deferredReleased).toBe(800);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("gives the closing disposal the rounding residual so releases sum exactly", () => {
    // $100 across 3 shares does not divide evenly.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 3, strike: 10, premium_collected: 100 }),
      sell({ id: "s1", close_date: "2026-04-06", contracts: 100, premium_collected: 5 }),
      sell({ id: "s2", close_date: "2026-05-06", contracts: 100, premium_collected: 5 }),
      sell({ id: "s3", close_date: "2026-06-06", contracts: 100, premium_collected: 5 }),
    ]);
    const released = ledger.months.reduce((s, m) => s + m.deferredReleased, 0);
    expect(round2(released)).toBe(100);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("lets a direct share purchase dilute the pool without adding premium", () => {
    // CSP assign 100 sh / $400, then buy 100 sh outright booking $50 of P&L.
    // Selling 100 of the 200 releases half the pool — and never the $50.
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 1, strike: 100, premium_collected: 400 }),
      trade({ id: "d1", type: "Shares", subtype: "Assigned", close_date: "2026-03-20", contracts: 100, strike: 95, premium_collected: 50 }),
      sell({ id: "s1", close_date: "2026-04-06", contracts: 100, premium_collected: 70 }),
    ]);
    expect(monthRow(ledger, "2026-04").deferredReleased).toBe(200);
    expect(ledger.outstandingDeferred).toBe(200);
  });

  it("defers a negative assignment premium the same way", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", close_date: "2026-03-06", contracts: 1, strike: 100, premium_collected: -150 }),
      sell({ id: "s1", close_date: "2026-05-06", contracts: 100, premium_collected: 90 }),
    ]);
    expect(monthRow(ledger, "2026-03").distributable).toBe(0);
    expect(monthRow(ledger, "2026-05").distributable).toBe(-60);
    expect(ledger.outstandingDeferred).toBe(0);
  });

  it("holds the invariant across a mixed book", () => {
    const ledger = buildRecognitionLedger([
      assign({ id: "a1", ticker: "AAA", close_date: "2026-03-06", contracts: 2, strike: 100, premium_collected: 700 }),
      trade({ id: "e1", ticker: "AAA", subtype: "Expired", close_date: "2026-03-14", premium_collected: 220 }),
      sell({ id: "s1", ticker: "AAA", close_date: "2026-04-17", contracts: 100, premium_collected: 130 }),
      assign({ id: "a2", ticker: "BBB", close_date: "2026-04-02", contracts: 1, strike: 40, premium_collected: 310 }),
      trade({ id: "c1", ticker: "BBB", type: "CC", subtype: "Close", close_date: "2026-05-09", premium_collected: -75 }),
      trade({ id: "e2", ticker: "CCC", subtype: "Expired", close_date: "2026-05-22", premium_collected: 180 }),
    ]);
    expect(round2(ledger.cumulativeBooked - ledger.cumulativeDistributable))
      .toBe(ledger.outstandingDeferred);
    const chainSum = ledger.openChains.reduce((s, c) => s + c.deferredRemaining, 0);
    expect(round2(chainSum)).toBe(ledger.outstandingDeferred);
  });
});
```

Add the `round2` helper the last two tests use — put it near the top of the file, just below the imports:

```js
const round2 = (n) => +n.toFixed(2);
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/__tests__/incomeRecognition.test.js`

Expected: PASS, 16 tests.

If the pro-rata or interleaving test fails, the bug is in `walkChains` in Task 4 — specifically the `disposed >= sharesHeld` branch or the order of the `pool`/`sharesHeld` decrements. Do not adjust the test expectations to match the code; the arithmetic in the comments is the specification.

If the invariant test fails, the most likely cause is a value mismatch between what `walkChains` adds to the pool and what `buildRecognitionLedger` withholds from `distributable`. Both must read `premium_collected` from the same trade row.

- [ ] **Step 3: Run the full suite**

Run: `npm test 2>&1 | tail -20`

Expected: all previously passing tests still pass, plus the 16 here.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/incomeRecognition.test.js
git commit -m "test(income): pin partial disposal, interleaving, rounding, invariant

Locks the running-average denominator (a fixed one under-releases early
partial exits), the closing-disposal residual, direct-purchase dilution, and
the cumulative booked − distributable ≡ outstanding identity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `RecognitionLedger` component

Presentational only — takes a ledger object, renders it. No fetching, no filtering, no state.

**Files:**
- Create: `src/components/RecognitionLedger.jsx`

- [ ] **Step 1: Read the styling conventions**

Read `src/components/IncomeBreakdown.jsx` first. Match its structure. Project rules that are non-negotiable:

- All styling is inline `style={{}}`. No CSS files, no Tailwind, no styled-components.
- **Never hardcode a hex color.** Import `theme` from `../lib/theme` and use tokens: `theme.text.primary/secondary/muted`, `theme.bg.base/surface/elevated`, `theme.border.default/strong`, `theme.green`, `theme.red`, `theme.size.xs/sm/md/lg/xl`, `theme.space[1..6]`, `theme.radius.sm/md/pill`, `theme.font.mono`.
- Dollar formatting comes from `src/lib/format.js` (`formatDollars`, `formatDollarsFull`).

- [ ] **Step 2: Create the component**

Create `src/components/RecognitionLedger.jsx`:

```jsx
import { theme } from "../lib/theme";
import { formatDollarsFull } from "../lib/format";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" → "Jul 2026" */
function monthLabel(month) {
  const [y, m] = month.split("-");
  return `${MONTH_LABELS[Number(m) - 1]} ${y}`;
}

const TH = {
  padding: `${theme.space[2]}px ${theme.space[2]}px`,
  fontSize: theme.size.xs,
  color: theme.text.muted,
  fontWeight: 600,
  textAlign: "right",
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${theme.border.default}`,
};

const TD = {
  padding: `${theme.space[2]}px ${theme.space[2]}px`,
  fontSize: theme.size.md,
  textAlign: "right",
  fontFamily: theme.font.mono,
  whiteSpace: "nowrap",
};

/**
 * Month-by-month booked vs distributable income.
 *
 * @param {object} props
 * @param {object} props.ledger output of buildRecognitionLedger
 */
export function RecognitionLedger({ ledger }) {
  const { months, outstandingDeferred, openChains } = ledger;

  if (months.length === 0) {
    return (
      <div style={{ padding: theme.space[4], color: theme.text.muted, fontSize: theme.size.md }}>
        No closed trades yet.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: theme.space[5] }}>
      {/* Headline — the number this whole view exists to surface */}
      <div
        style={{
          background: theme.bg.elevated,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md,
          padding: theme.space[4],
          marginBottom: theme.space[4],
        }}
      >
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginBottom: theme.space[1] }}>
          RECOGNIZED AHEAD OF BROKERAGE
        </div>
        <div
          style={{
            fontSize: theme.size.xxl,
            fontFamily: theme.font.mono,
            fontWeight: 600,
            color: outstandingDeferred > 0 ? theme.amber : theme.text.primary,
          }}
        >
          {formatDollarsFull(outstandingDeferred)}
        </div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginTop: theme.space[2], lineHeight: 1.5 }}>
          Premium booked as income from assigned puts, still sitting in share cost
          basis at the brokerage. Releases as those shares are called away or sold.
          {openChains.length > 0 && ` Held across ${openChains.length} open position${openChains.length === 1 ? "" : "s"}.`}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "left" }}>Month</th>
              <th style={TH}>Booked</th>
              <th style={TH}>Distributable</th>
              <th style={TH}>Δ</th>
              <th style={TH}>Deferred +</th>
              <th style={TH}>Released −</th>
              <th style={TH}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                <td style={{ ...TD, textAlign: "left", fontFamily: "inherit", color: theme.text.primary }}>
                  {monthLabel(m.month)}
                </td>
                <td style={{ ...TD, color: theme.text.secondary }}>{formatDollarsFull(m.booked)}</td>
                <td style={{ ...TD, color: theme.text.primary, fontWeight: 600 }}>
                  {formatDollarsFull(m.distributable)}
                </td>
                <td style={{ ...TD, color: m.delta === 0 ? theme.text.faint : m.delta > 0 ? theme.amber : theme.green }}>
                  {m.delta === 0 ? "—" : formatDollarsFull(m.delta)}
                </td>
                <td style={{ ...TD, color: m.deferredAdded ? theme.text.secondary : theme.text.faint }}>
                  {m.deferredAdded ? formatDollarsFull(m.deferredAdded) : "—"}
                </td>
                <td style={{ ...TD, color: m.deferredReleased ? theme.green : theme.text.faint }}>
                  {m.deferredReleased ? formatDollarsFull(m.deferredReleased) : "—"}
                </td>
                <td style={{ ...TD, color: m.outstandingAtMonthEnd ? theme.text.secondary : theme.text.faint }}>
                  {m.outstandingAtMonthEnd ? formatDollarsFull(m.outstandingAtMonthEnd) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: theme.space[3], lineHeight: 1.6 }}>
        Booked is what every other view in this app reports. Distributable defers
        assigned-put premium into share cost basis and recognizes it at disposal,
        matching how Fidelity accounts for it. All history, ignoring the date filter.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the theme tokens exist**

Run: `grep -nE "xxl|amber|faint|mono" src/lib/theme.js`

Expected: `theme.size.xxl`, `theme.amber`, `theme.text.faint`, and `theme.font.mono` all resolve. If any is missing, substitute the nearest documented token from `CLAUDE.md` (`theme.size.xl` for `xxl`, `theme.text.subtle` for `faint`) rather than inventing a hex value.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build 2>&1 | tail -15`

Expected: build succeeds. (The component is not rendered anywhere yet — this only proves it parses and its imports resolve.)

- [ ] **Step 5: Commit**

```bash
git add src/components/RecognitionLedger.jsx
git commit -m "feat(income): add RecognitionLedger presentational component

Month table plus the outstanding-deferred headline. Not yet wired up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Wire into HistoryTab

**Files:**
- Modify: `src/components/HistoryTab.jsx:10` (imports), `:52` (state comment), `:179-215` (toggle + branch)

- [ ] **Step 1: Add the imports**

In `src/components/HistoryTab.jsx`, below the existing `IncomeBreakdown` import on line 10:

```js
import { RecognitionLedger } from "./RecognitionLedger";
import { buildRecognitionLedger } from "../lib/incomeRecognition";
```

`useMemo` is already imported on line 1.

- [ ] **Step 2: Build the ledger**

Directly below the `breakdownMode` state declaration (line 53), add:

```js
  // Recognition ledger runs over ALL trades, not the date-filtered TRADES —
  // the point is cumulative drift across the whole book, which a windowed
  // view would hide.
  const recognitionLedger = useMemo(
    () => buildRecognitionLedger(TRADES_ALL),
    [TRADES_ALL]
  );
```

Also update the state comment on line 52 to reflect the third option:

```js
  const [breakdownView, setBreakdownView] = useState("cards"); // "cards" | "breakdown" | "recognition"
```

- [ ] **Step 3: Add the third toggle button**

On line 180, change:

```js
        {[["cards", "Cards"], ["breakdown", "Breakdown"]].map(([v, label]) => {
```

to:

```js
        {[["cards", "Cards"], ["breakdown", "Breakdown"], ["recognition", "Recognition"]].map(([v, label]) => {
```

- [ ] **Step 4: Add the render branch**

On line 204, change:

```jsx
      {breakdownView === "breakdown" ? (
```

to:

```jsx
      {breakdownView === "recognition" ? (
        <RecognitionLedger ledger={recognitionLedger} />
      ) : breakdownView === "breakdown" ? (
```

Leave the existing `IncomeBreakdown` branch and the trailing `) : (` cards branch exactly as they are.

- [ ] **Step 5: Verify the build**

Run: `npm run build 2>&1 | tail -15`

Expected: build succeeds.

Run: `npm test 2>&1 | tail -20`

Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/HistoryTab.jsx
git commit -m "feat(income): add Recognition view to the History tab

Third option beside Cards and Breakdown. Runs over all trades rather than
the active date range, since cumulative drift is the point.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Version bump and ship

**Files:**
- Modify: `package.json:3`, `src/lib/constants.js:35`

- [ ] **Step 1: Confirm the baseline version on main**

Run: `git show origin/main:package.json | grep '"version"'`

This repo uses worktrees, so the local `package.json` may be stale. Increment from what this command prints, never from the local file. At plan time it read `1.172.5`; this is a feature, so the next version is a **minor** bump: `1.173.0`. If the command prints something higher, bump the minor from that instead.

- [ ] **Step 2: Bump both files**

In `package.json`, set `"version": "1.173.0"`.

In `src/lib/constants.js:35`, set `export const VERSION = "1.173.0";`

Both must change in the same commit.

- [ ] **Step 3: Full verification**

Run: `npm test 2>&1 | tail -20`

Expected: all pass, including the 16 `incomeRecognition` tests, the 4 `trading` tests, and the untouched `lifespan-detection` / `lifespan-baseline` suites.

Run: `npm run build 2>&1 | tail -15`

Expected: build succeeds.

- [ ] **Step 4: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: v1.173.0 — deferred CSP-assignment income recognition

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

Per the project's commit workflow, the push must complete before this is reported as done.

- [ ] **Step 5: Verify on the Vercel preview**

Local dev does not serve `api/*`, so this panel cannot be verified locally — it needs real trade data from `/api/data`. Once the deploy lands, open the app, go to Review → History, and click **Recognition**.

Confirm by eye:
1. The outstanding-deferred headline is a positive number (given the heavy July 2026 assignment activity that motivated this work).
2. Cumulative booked minus cumulative distributable across all month rows equals that headline. Sum the two columns; they must reconcile exactly. This is the invariant, and it is the one thing worth checking by hand on real data.
3. Months with no assignment activity show `—` in the Δ, Deferred, and Released columns and identical Booked / Distributable figures.
4. Every other view — Cards, Breakdown, the trades table, the MTD figure in the journal — is unchanged.

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: the extraction (Task 1), `normalizeTrade` (Task 2), the ledger module and its algorithm including the chain-participation rule, trade-row pool values, negative premium, and same-date ordering (Tasks 3–5), the invariant (Task 5 Step 1, Task 8 Step 5), the UI and placement (Tasks 6–7), and the testing section (Tasks 3–5 plus the Task 1 regression baseline). The spec's "explicitly unchanged" list is enforced negatively — no task touches those files, and Task 8 Step 5 item 4 checks it.

**Naming consistency.** `buildRecognitionLedger`, `walkChains`, `deferredIds`, `releases`, `openChains`, `deferredRemaining`, `firstAssignmentDate`, `outstandingAtMonthEnd`, and `deferredAdded` / `deferredReleased` are used identically in the spec, the module, the tests, and the component.

**Known deviation from the spec.** The spec describes `openChains[].sharesHeld` without saying when a chain qualifies as open. The implementation pushes a chain when `pool !== 0 || sharesHeld > 0`, so a fully-disposed chain never appears and a chain holding shares with a zero pool still does. This keeps `openChains` usable as the headline's denominator.
