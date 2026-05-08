# CSP Baseline Survivorship Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Survivorship-correct the CSP baseline rate that powers the cut-and-redeploy benchmark by including assigned + roll-loss CSPs in the sample, switching to capital-day-weighted aggregation, and surfacing data-quality warnings.

**Architecture:** Single-PR backend change. Modify `computeCspBaseline` in `api/_lib/lifespan.js` to handle three CSP subtypes with a `Σ pnl / Σ (capital × days)` aggregator. Widen the matching SQL queries in both API endpoints. Add two warnings to the lifespan's existing warnings array. New isolated test file proves the math.

**Tech Stack:** Vitest, Supabase JS client, plain JS (no transpilation). Test file mirrors patterns in `src/lib/__tests__/`.

**Spec:** [docs/superpowers/specs/2026-05-08-csp-baseline-survivorship-fix-design.md](../specs/2026-05-08-csp-baseline-survivorship-fix-design.md)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `api/_lib/__tests__/lifespan-baseline.test.js` | **Create** | All 9 unit tests for `computeCspBaseline`. Co-located with `api/_lib/lifespan.js`. New `__tests__` directory under `api/_lib/`. |
| `api/_lib/lifespan.js` | **Modify** | Replace `computeCspBaseline` (lines 524-540) with the new aggregator. Append two warning pushes inside `buildLifespan` (around line 332-339). |
| `api/position-lifespan.js` | **Modify** | Widen the baseline SELECT and WHERE (lines 43-51) to include `Roll Loss` and `Assigned` subtypes plus the columns needed to compute realized loss. |
| `api/ticker-detail.js` | **Modify** | Same widening as `position-lifespan.js` (around line 67). The two queries must stay identical. |
| `package.json` | **Modify** | Version bump 1.108.2 → 1.108.3. |
| `src/lib/constants.js` | **Modify** | `VERSION` constant bump to match. |

The `computeCspBaseline` function and its tests are the load-bearing piece. The query widenings are mechanical mirrors. Warnings are additive.

---

### Task 1: Create the test file with all failing tests

**Files:**
- Create: `api/_lib/__tests__/lifespan-baseline.test.js`

This task writes all the tests up front so the implementation in Task 2 can be validated by running the file once. Each test exercises a distinct scenario from the spec.

- [ ] **Step 1: Create the test directory and file**

```bash
mkdir -p api/_lib/__tests__
```

- [ ] **Step 2: Write the test file**

Create `api/_lib/__tests__/lifespan-baseline.test.js` with this exact content:

```js
import { describe, it, expect } from "vitest";
import { computeCspBaseline } from "../lifespan.js";

// Helpers --------------------------------------------------------------------

const closedCsp = (overrides = {}) => ({
  id: overrides.id ?? "t-close",
  subtype: "Close",
  premium_collected: 50,
  capital_fronted: 5000,
  days_held: 5,
  close_date: "2026-05-01",
  strike: 50,
  contracts: 1,
  spot_at_assignment: null,
  ...overrides,
});

const rollLoss = (overrides = {}) => ({
  ...closedCsp({ id: "t-roll", subtype: "Roll Loss", premium_collected: -500, capital_fronted: 20000, days_held: 7 }),
  ...overrides,
});

const assigned = (overrides = {}) => ({
  ...closedCsp({
    id: "t-assigned",
    subtype: "Assigned",
    premium_collected: 300,
    capital_fronted: 50000,
    days_held: 30,
    strike: 50,
    contracts: 10,
    spot_at_assignment: 48,
  }),
  ...overrides,
});

// Tests ----------------------------------------------------------------------

describe("computeCspBaseline", () => {
  it("Test 1: single closed CSP — rate = premium / (capital × days)", () => {
    const result = computeCspBaseline([
      closedCsp({ premium_collected: 500, capital_fronted: 50000, days_held: 30 }),
    ]);
    // 500 / (50000 * 30) = 500 / 1,500,000 = 0.000333...
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0003333, 7);
    expect(result.sample_size).toBe(1);
    expect(result.dropped_assigned_no_spot).toBe(0);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 2: single assigned CSP with realized loss", () => {
    // strike $50, spot $48, 10 contracts → realizedLoss = (50-48) * 10 * 100 = 2000
    // premium $300, capital $50,000, 30 days
    // pnl = 300 - 2000 = -1700
    // rate = -1700 / 1,500,000 = -0.001133...
    const result = computeCspBaseline([
      assigned({ premium_collected: 300, capital_fronted: 50000, days_held: 30, strike: 50, spot_at_assignment: 48, contracts: 10 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(-0.0011333, 7);
    expect(result.sample_size).toBe(1);
    expect(result.dropped_assigned_no_spot).toBe(0);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 3: assigned CSP with spot equal to strike degenerates to premium-only", () => {
    const result = computeCspBaseline([
      assigned({ premium_collected: 300, capital_fronted: 50000, days_held: 30, strike: 50, spot_at_assignment: 50, contracts: 10 }),
    ]);
    // realizedLoss = 0, pnl = 300, rate = 300 / 1,500,000 = 0.0002
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.0002, 7);
    expect(result.sample_size).toBe(1);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 4 (load-bearing): divergent mixed sample — capital-day-weighted, NOT mean of rates", () => {
    // Position A: $50 / ($5,000 × 5d) = 0.002/cap-day, 25,000 cap-days
    // Position B: $750 / ($50,000 × 30d) = 0.0005/cap-day, 1,500,000 cap-days
    //
    // Capital-day-weighted: (50 + 750) / (25,000 + 1,500,000) = 800 / 1,525,000 ≈ 0.000525
    // Mean-of-rates would give: (0.002 + 0.0005) / 2 = 0.00125 (~2.4× different)
    //
    // We assert the capital-day-weighted answer; the test fails under the old aggregation.
    const result = computeCspBaseline([
      closedCsp({ id: "a", premium_collected: 50,  capital_fronted: 5000,  days_held: 5  }),
      closedCsp({ id: "b", premium_collected: 750, capital_fronted: 50000, days_held: 30 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.000525, 6);
    expect(result.sample_size).toBe(2);
  });

  it("Test 5: Roll Loss with negative premium pulls rate down", () => {
    // closed: +$50 over 25,000 cap-days
    // roll loss: -$500 over 140,000 cap-days
    // weighted = (-450) / 165,000 ≈ -0.002727
    const result = computeCspBaseline([
      closedCsp({ id: "a", premium_collected: 50,   capital_fronted: 5000,  days_held: 5 }),
      rollLoss({  id: "b", premium_collected: -500, capital_fronted: 20000, days_held: 7 }),
    ]);
    expect(result.avg_return_per_capital_day).toBeCloseTo(-0.002727, 6);
    expect(result.sample_size).toBe(2);
  });

  it("Test 6: assigned CSP with NULL spot_at_assignment is dropped", () => {
    const result = computeCspBaseline([
      closedCsp({ id: "a", premium_collected: 50, capital_fronted: 5000, days_held: 5 }),
      assigned({  id: "b", spot_at_assignment: null }),
    ]);
    // Only the closed CSP counts: 50 / 25,000 = 0.002
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.002, 6);
    expect(result.sample_size).toBe(1);
    expect(result.dropped_assigned_no_spot).toBe(1);
  });

  it("Test 7: rows with capital ≤ 0 or days ≤ 0 are skipped", () => {
    const result = computeCspBaseline([
      closedCsp({ id: "a", capital_fronted: 0,  days_held: 5 }),
      closedCsp({ id: "b", capital_fronted: 5000, days_held: 0 }),
      closedCsp({ id: "c", capital_fronted: -1, days_held: 5 }),
    ]);
    expect(result.avg_return_per_capital_day).toBe(0);
    expect(result.sample_size).toBe(0);
  });

  it("Test 8: empty array returns rate 0", () => {
    const result = computeCspBaseline([]);
    expect(result.avg_return_per_capital_day).toBe(0);
    expect(result.sample_size).toBe(0);
    expect(result.dropped_assigned_no_spot).toBe(0);
    expect(result.data_integrity_flag).toBe(0);
  });

  it("Test 9: assigned CSP with spot > strike sets data_integrity_flag", () => {
    // strike $50, spot $52 → realizedLoss = (50-52)*10*100 = -2000 (negative)
    // pnl = 300 - (-2000) = 2300; included with flag.
    const result = computeCspBaseline([
      assigned({ premium_collected: 300, capital_fronted: 50000, days_held: 30, strike: 50, spot_at_assignment: 52, contracts: 10 }),
    ]);
    expect(result.data_integrity_flag).toBe(1);
    expect(result.sample_size).toBe(1);
    // 2300 / 1,500,000 ≈ 0.001533
    expect(result.avg_return_per_capital_day).toBeCloseTo(0.001533, 6);
  });
});
```

- [ ] **Step 3: Run tests to verify they all fail (current implementation)**

Run: `npx vitest run api/_lib/__tests__/lifespan-baseline.test.js`

Expected: All 9 tests FAIL. The existing `computeCspBaseline` returns a different shape (no `dropped_assigned_no_spot` or `data_integrity_flag`) and uses the old mean-of-rates math, so most assertions break. Some tests (1, 8) may *partially* pass on the rate value but fail on the missing fields. That's fine — the goal is to confirm the new test file runs and exercises the function.

If tests can't even load (import error, syntax error), fix that before continuing.

- [ ] **Step 4: Commit**

```bash
git add api/_lib/__tests__/lifespan-baseline.test.js
git commit -m "test: add failing tests for survivorship-corrected CSP baseline

Covers the 9 cases from the spec, including the load-bearing Test 4
(divergent capital-days that prove the capital-day-weighted aggregation
differs from the old mean-of-per-trade-rates). Tests fail against the
current computeCspBaseline; will pass after Task 2."
```

---

### Task 2: Replace `computeCspBaseline` with survivorship-corrected aggregator

**Files:**
- Modify: `api/_lib/lifespan.js:524-540`

- [ ] **Step 1: Replace the function**

In `api/_lib/lifespan.js`, find the existing `computeCspBaseline` (currently around lines 524-540):

```js
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

  const avg = returns.length > 0
    ? returns.reduce((s, r) => s + r, 0) / returns.length
    : 0;

  return { avg_return_per_capital_day: avg, sample_size: returns.length };
}
```

Replace it with:

```js
export function computeCspBaseline(cspTrades) {
  let totalPnl = 0;
  let totalCapDays = 0;
  let included = 0;
  let droppedAssignedNoSpot = 0;
  let dataIntegrityFlag = 0;

  for (const t of cspTrades) {
    const premium = parseFloat(t.premium_collected) || 0;
    const capital = parseFloat(t.capital_fronted)   || 0;
    const days    = parseFloat(t.days_held)         || 0;
    if (capital <= 0 || days <= 0) continue;

    let pnl;
    if (t.subtype === "Assigned") {
      const spot      = parseFloat(t.spot_at_assignment);
      const strike    = parseFloat(t.strike) || 0;
      const contracts = parseFloat(t.contracts) || 0;
      if (!Number.isFinite(spot)) {
        droppedAssignedNoSpot++;
        continue;
      }
      const realizedLoss = (strike - spot) * contracts * 100;
      if (realizedLoss < 0) dataIntegrityFlag++;
      pnl = premium - realizedLoss;
    } else {
      pnl = premium;
    }

    totalPnl     += pnl;
    totalCapDays += capital * days;
    included++;
  }

  const avg = totalCapDays > 0 ? totalPnl / totalCapDays : 0;

  return {
    avg_return_per_capital_day: avg,
    sample_size: included,
    dropped_assigned_no_spot: droppedAssignedNoSpot,
    data_integrity_flag: dataIntegrityFlag,
  };
}
```

- [ ] **Step 2: Run the new test file to verify all tests pass**

Run: `npx vitest run api/_lib/__tests__/lifespan-baseline.test.js`

Expected: All 9 tests PASS.

If any fail, inspect the failure carefully — do NOT change the test to match a wrong implementation. The tests encode the spec.

- [ ] **Step 3: Run the full test suite to make sure nothing else broke**

Run: `npx vitest run`

Expected: All previously-passing tests still pass. The shape change to the return value adds new fields (additive); existing consumers only read `avg_return_per_capital_day` and `sample_size`, which still exist.

- [ ] **Step 4: Commit**

```bash
git add api/_lib/lifespan.js
git commit -m "feat: survivorship-corrected, capital-day-weighted CSP baseline

Replaces computeCspBaseline with an aggregator that:
- Includes Close, Roll Loss, and Assigned subtypes (was Close-only)
- Uses Σ pnl / Σ (capital × days), not mean of per-trade rates
- Cut-frames assigned CSPs: pnl = premium − (strike − spot) × shares
- Drops assigned CSPs with NULL spot_at_assignment (counter exposed)
- Flags data integrity issues when spot > strike on an assigned CSP

The function still returns avg_return_per_capital_day and sample_size,
so existing consumers (cut-and-redeploy benchmark) keep working. New
fields (dropped_assigned_no_spot, data_integrity_flag) are additive."
```

---

### Task 3: Widen the query in `api/position-lifespan.js`

**Files:**
- Modify: `api/position-lifespan.js:43-51`

The new compute layer needs new columns (`subtype`, `strike`, `contracts`, `spot_at_assignment`) and a wider subtype filter. Without this query update, the new logic has nothing to chew on.

- [ ] **Step 1: Update the query**

In `api/position-lifespan.js`, find the baseline query (currently around lines 43-51):

```js
const cspBaselineResult = await supabase
  .from("trades")
  .select("id, premium_collected, capital_fronted, days_held, close_date")
  .eq("type", "CSP")
  .eq("subtype", "Close")
  .gt("days_held", 0)
  .gt("capital_fronted", 0)
  .order("close_date", { ascending: false })
  .limit(60);
```

Replace with:

```js
const cspBaselineResult = await supabase
  .from("trades")
  .select("id, subtype, premium_collected, capital_fronted, days_held, close_date, strike, contracts, spot_at_assignment")
  .eq("type", "CSP")
  .in("subtype", ["Close", "Roll Loss", "Assigned"])
  .gt("days_held", 0)
  .gt("capital_fronted", 0)
  .order("close_date", { ascending: false })
  .limit(60);
```

- [ ] **Step 2: Verify no test regressions**

Run: `npx vitest run`

Expected: All tests still pass. (Query changes don't affect unit tests; this is a sanity check.)

- [ ] **Step 3: Commit**

```bash
git add api/position-lifespan.js
git commit -m "feat: widen CSP baseline query in position-lifespan endpoint

Pulls in Close + Roll Loss + Assigned subtypes plus the columns needed
to compute cut-framing realized loss (strike, contracts, spot_at_assignment).
Pairs with the survivorship-corrected computeCspBaseline."
```

---

### Task 4: Mirror the query change in `api/ticker-detail.js`

**Files:**
- Modify: `api/ticker-detail.js:67` (the baseline query, identical shape to the one in position-lifespan.js)

The two endpoints share the baseline. They MUST run identical queries — otherwise the dashboard will show inconsistent rates depending on which endpoint a screen consumes.

- [ ] **Step 1: Locate the query**

Run: `grep -n "csp_baseline\|baselineResult" api/ticker-detail.js`

Find the corresponding `supabase.from("trades")...` block (likely near line 67).

- [ ] **Step 2: Apply the same widening as Task 3**

The replacement should match Task 3's new query exactly:

```js
.from("trades")
.select("id, subtype, premium_collected, capital_fronted, days_held, close_date, strike, contracts, spot_at_assignment")
.eq("type", "CSP")
.in("subtype", ["Close", "Roll Loss", "Assigned"])
.gt("days_held", 0)
.gt("capital_fronted", 0)
.order("close_date", { ascending: false })
.limit(60);
```

If the existing query in `ticker-detail.js` differs in ordering or limit from `position-lifespan.js`, preserve those differences only if they were intentional. As of writing, both should use `order close_date desc / limit 60`.

- [ ] **Step 3: Verify no test regressions**

Run: `npx vitest run`

Expected: All tests still pass.

- [ ] **Step 4: Commit**

```bash
git add api/ticker-detail.js
git commit -m "feat: widen CSP baseline query in ticker-detail endpoint

Mirrors the position-lifespan endpoint widening so both screens use
the same survivorship-corrected sample. Without this, the dashboard
would show different baseline rates depending on which endpoint the
screen consumed."
```

---

### Task 5: Surface the new warnings in `buildLifespan`

**Files:**
- Modify: `api/_lib/lifespan.js:332-339` (the warnings block inside `buildLifespan`)

When the baseline encountered dropped rows or data integrity issues, the user should see this in `data_completeness.warnings` on the lifespan view.

- [ ] **Step 1: Locate the warnings block**

In `api/_lib/lifespan.js`, find the existing warnings construction (currently around lines 332-339):

```js
const warnings = [...(raw._orphanWarnings ?? [])];
if (daysActive < 1)
  warnings.push("days_active < 1: same-day assignment and exit; rate-based metrics are null");
if (sample_size < 10)
  warnings.push(
    `CSP baseline uses only ${sample_size} sample${sample_size === 1 ? "" : "s"} (< 10); ` +
    "cut-and-redeploy estimate is low-confidence"
  );
```

- [ ] **Step 2: Append the two new warnings**

Add these two `if` blocks immediately after the existing `sample_size < 10` block:

```js
if (cspBaseline.dropped_assigned_no_spot > 0)
  warnings.push(
    `CSP baseline dropped ${cspBaseline.dropped_assigned_no_spot} assigned CSP(s) ` +
    `with missing spot_at_assignment data; baseline may slightly understate downside`
  );
if (cspBaseline.data_integrity_flag > 0)
  warnings.push(
    `CSP baseline saw ${cspBaseline.data_integrity_flag} assigned CSP(s) ` +
    `with spot_at_assignment > strike; this should not happen and likely indicates ` +
    `a data issue (wrong spot logged, or trade miscategorized as Assigned)`
  );
```

The block already destructures `const { avg_return_per_capital_day, sample_size } = cspBaseline;` near line 289 — but `cspBaseline` itself is in scope, so we can reference the new fields directly without re-destructuring.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`

Expected: All tests pass. (No test asserts on warnings content yet, so this is purely a sanity check.)

- [ ] **Step 4: Commit**

```bash
git add api/_lib/lifespan.js
git commit -m "feat: surface CSP baseline data warnings on lifespan view

Two new warnings appended to data_completeness.warnings:
- When assigned CSPs are dropped due to missing spot_at_assignment
- When assigned CSPs have spot > strike (likely data corruption)

Helps users notice when the cut-and-redeploy baseline is being
distorted by data quality issues."
```

---

### Task 6: Version bump

**Files:**
- Modify: `package.json` (the `"version"` field, currently `1.108.2`)
- Modify: `src/lib/constants.js` (the `VERSION` constant, currently `1.108.2`)

Per CLAUDE.md, every behavior-changing commit must bump both files in the same commit. This is a fix → patch bump.

- [ ] **Step 1: Verify the baseline version**

Run: `git show origin/main:package.json | grep '"version"'`

Expected output: `"version": "1.108.2",` (or higher if main has moved). The new version is `previous + 0.0.1`.

If main has moved to a newer version since this plan was written, base the bump on whatever main shows, not on `1.108.2`.

- [ ] **Step 2: Update `package.json`**

Find the line `"version": "1.108.2",` and change to `"version": "1.108.3",` (or matching bump if main moved).

- [ ] **Step 3: Update `src/lib/constants.js`**

Find the line `export const VERSION = "1.108.2";` and change to `export const VERSION = "1.108.3";` (matching the package.json bump).

- [ ] **Step 4: Run all tests one last time**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.108.3 for CSP baseline fix"
```

---

### Task 7: Push, open PR, merge

**Files:** none (git operations only)

Per CLAUDE.md: "After creating a PR, merge it immediately (no need to ask)."

- [ ] **Step 1: Push the branch**

Run: `git push -u origin <current-branch-name>`

(Replace `<current-branch-name>` with whatever branch the worktree is on, e.g. `claude/competent-lewin-1fd1f6` or `spec/csp-baseline-survivorship-fix`. Use `git branch --show-current` if unsure.)

Expected: branch pushed; URL to create PR shown.

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "fix: survivorship-corrected CSP baseline (v1.108.3)" --body "$(cat <<'EOF'
## Summary
- Includes assigned + roll-loss CSPs in the baseline sample (was Close-only — survivorship bias)
- Switches from mean-of-per-trade-rates to capital-day-weighted aggregation (Σ pnl / Σ cap-days)
- Cut-frames assigned CSPs: pnl = premium − (strike − spot_at_assignment) × shares
- Skips assigned CSPs with NULL spot_at_assignment; surfaces a warning
- Flags data integrity issues when spot > strike on an assigned CSP

## Why
The baseline was reporting ~0.54%/cap-day (~197% annualized), which is implausibly high for a wheel strategy. Two structural bugs caused it: assigned CSPs were excluded (only winners counted), and the aggregation was an unweighted mean of per-trade rates (small short trades over-weighted relative to large long trades). Both fixes are needed; this PR ships them together.

Expected impact: rate drops to a more credible range (rough estimate 0.20–0.35%/cap-day, ≈73–128% annualized). Some prior \"wheel outperformed\" verdicts will flip — that's a correction of bias, not a regression.

## Spec
[docs/superpowers/specs/2026-05-08-csp-baseline-survivorship-fix-design.md](../blob/main/docs/superpowers/specs/2026-05-08-csp-baseline-survivorship-fix-design.md)

## Test plan
- [x] 9 new unit tests in api/_lib/__tests__/lifespan-baseline.test.js
- [x] Existing test suite still passes
- [ ] Spot-check IREN lifespan post-deploy: rate is materially lower than 0.0054, verdict text updates accordingly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Merge the PR**

Run: `gh pr merge <PR_NUMBER> --squash`

(Replace `<PR_NUMBER>` with the number from Step 2. The `--delete-branch` flag may fail in a worktree if main is checked out elsewhere — leave it off.)

Expected: "Pull request was merged" (or "was already merged" if auto-merge fired).

- [ ] **Step 4: Verify the merge**

Run: `gh pr view <PR_NUMBER> --json state,mergedAt`

Expected: `"state": "MERGED"` and a non-null `mergedAt`.

---

## Self-Review

**Spec coverage:**
- Goal 1 (mixed subtypes) → Tasks 1, 2, 3, 4 ✓
- Goal 2 (capital-day-weighted) → Task 2 (replacement aggregator) + Task 1 Test 4 (proves it) ✓
- Goal 3 (cut-framing for assignments) → Task 2 + Task 1 Tests 2, 3, 9 ✓
- Goal 4 (transparent NULL handling) → Task 2 (`dropped_assigned_no_spot`) + Task 5 (warning surface) + Task 1 Test 6 ✓
- Acceptance #5 (manual IREN spot-check) → covered in PR test plan checklist ✓

**Placeholder scan:** No TBD/TODO/"similar to". Each step shows actual code or actual command.

**Type consistency:** `computeCspBaseline` returns `{ avg_return_per_capital_day, sample_size, dropped_assigned_no_spot, data_integrity_flag }` — used identically in tests (Task 1) and consumer (Task 5).

**Branch hygiene:** Plan does not assume which branch the worktree is on — Task 7 uses `git branch --show-current`. Spec was committed on `spec/csp-baseline-survivorship-fix`; the implementation can either continue there or be done on a new branch.
