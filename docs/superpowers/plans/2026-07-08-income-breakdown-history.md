# History Income Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ranked-bar "income breakdown" view to the History tab that shows where realized income came from (by name or by type) for the active date range, toggleable in-place with the existing ticker cards.

**Architecture:** A pure helper (`src/lib/breakdown.js`) does the grouping / top-N-plus-Other rollup / share math (unit-tested, node env). A presentational component (`src/components/IncomeBreakdown.jsx`) renders the Name/Type toggle and the bars. `HistoryTab.jsx` gains a Cards↔Breakdown toggle over the existing cards region and reuses its already-memoized `tickerSummary` / `typeSummary` and `selectedTicker` / `selectedType` state — no new data plumbing.

**Tech Stack:** React 18, inline `style={{}}` with `theme` tokens (no CSS/Tailwind), Vitest (node env, logic-only — no RTL/jsdom), Vite build.

**Baseline:** `origin/main` = v1.167.0. This feature bumps to **v1.168.0**. Worktree: `.claude/worktrees/history-income-breakdown`, branch `feat/history-income-breakdown`. Baseline `npm test` = 792 passing.

---

## File Structure

- **Create** `src/lib/breakdown.js` — pure `buildBreakdownRows(list, opts)`; grouping, magnitude-based top-N + "Other" rollup, share %, max-abs for bar scaling. One responsibility: turn a summary list into display rows.
- **Create** `src/lib/__tests__/breakdown.test.js` — unit tests for the helper (follows `src/lib/__tests__/radarFilter.test.js` pattern).
- **Create** `src/components/IncomeBreakdown.jsx` — presentational bars + Name/Type toggle. No data fetching, no filter state.
- **Modify** `src/components/HistoryTab.jsx` — add `breakdownView` / `breakdownMode` state, wrap the cards region (lines ~173–251) with a Cards↔Breakdown toggle, conditionally render `<IncomeBreakdown/>`.
- **Modify** `package.json` + `src/lib/constants.js` — version bump 1.167.0 → 1.168.0 (same commit).

---

## Task 1: Pure `buildBreakdownRows` helper (TDD)

**Files:**
- Create: `src/lib/breakdown.js`
- Test: `src/lib/__tests__/breakdown.test.js`

The helper is the only logic worth unit-testing (rollup + magnitude cut + share suppression). Everything else is presentational and verified by build/preview, matching this repo's logic-only test culture.

**Contract:**

```
buildBreakdownRows(list, { key, countKey, cap = Infinity, otherNoun = "names", minTotalForShare = 1 })
  → { rows, total, maxAbs }

rows[i] = { id, label, premium, count, isOther, groups, share }
  id       — group id (list item[key]); null for the Other row
  label    — display label (ticker/type string; "Other" for the rollup row)
  premium  — number (can be negative)
  count    — trade count (item[countKey]; summed for Other)
  isOther  — boolean
  groups   — number of rolled-up groups (Other only; undefined otherwise)
  share    — premium/total*100, or null when |total| < minTotalForShare
total   — sum of every input group's premium (pre-cap)
maxAbs  — max |premium| over the shown rows (≥ 1), for bar-width scaling
```

Rules: sort shown rows by premium **descending**; when `cap` is finite and `list.length > cap`, keep the top `cap` **by |premium|** (so a big loss is never hidden), roll the rest into one `Other` row pinned **last**.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/breakdown.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildBreakdownRows } from "../breakdown.js";

const names = (arr) => arr.map(([t, premium, trades]) => ({ ticker: t, premium, trades }));

describe("buildBreakdownRows", () => {
  it("sorts rows by premium descending", () => {
    const { rows } = buildBreakdownRows(
      names([["A", 100, 1], ["B", 300, 2], ["C", 200, 1]]),
      { key: "ticker", countKey: "trades" }
    );
    expect(rows.map((r) => r.label)).toEqual(["B", "C", "A"]);
    expect(rows.every((r) => r.isOther === false)).toBe(true);
  });

  it("computes share % that sums to ~100 when all positive", () => {
    const { rows, total } = buildBreakdownRows(
      names([["A", 250, 1], ["B", 250, 1], ["C", 500, 1]]),
      { key: "ticker", countKey: "trades" }
    );
    expect(total).toBe(1000);
    expect(rows.find((r) => r.label === "C").share).toBeCloseTo(50, 5);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 5);
  });

  it("suppresses share (null) when |total| is below the floor", () => {
    const { rows } = buildBreakdownRows(
      names([["A", 500, 1], ["B", -500, 1]]),
      { key: "ticker", countKey: "trades", minTotalForShare: 1 }
    );
    expect(rows.every((r) => r.share === null)).toBe(true);
  });

  it("caps at N and rolls the rest into a single Other row pinned last", () => {
    const list = names(Array.from({ length: 13 }, (_, i) => [`T${i}`, 1300 - i * 100, 1]));
    const { rows } = buildBreakdownRows(list, { key: "ticker", countKey: "trades", cap: 10 });
    expect(rows).toHaveLength(11);
    const other = rows[rows.length - 1];
    expect(other.isOther).toBe(true);
    expect(other.id).toBe(null);
    expect(other.label).toBe("Other");
    expect(other.groups).toBe(3);
    // Other premium == sum of the 3 smallest (T10=300, T11=200, T12=100)
    expect(other.premium).toBe(600);
    expect(other.count).toBe(3);
  });

  it("keeps a large loss visible instead of hiding it in Other (magnitude cut)", () => {
    // 10 tiny gains + one big loss => 11 groups, cap 10.
    const list = names([
      ...Array.from({ length: 10 }, (_, i) => [`G${i}`, 10 + i, 1]),
      ["BIGLOSS", -5000, 1],
    ]);
    const { rows } = buildBreakdownRows(list, { key: "ticker", countKey: "trades", cap: 10 });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("BIGLOSS");           // survived the cut
    const other = rows.find((r) => r.isOther);
    expect(other).toBeTruthy();                    // a tiny gain got rolled up instead
    expect(other.premium).toBeGreaterThan(0);
  });

  it("never rolls up when cap is Infinity (type mode)", () => {
    const list = [
      { type: "CSP", premium: 400, count: 5 },
      { type: "CC", premium: 300, count: 3 },
      { type: "LEAPS", premium: 200, count: 2 },
    ];
    const { rows } = buildBreakdownRows(list, { key: "type", countKey: "count" });
    expect(rows.some((r) => r.isOther)).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it("reports maxAbs from the largest magnitude row", () => {
    const { maxAbs } = buildBreakdownRows(
      names([["A", 100, 1], ["B", -900, 1]]),
      { key: "ticker", countKey: "trades" }
    );
    expect(maxAbs).toBe(900);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- breakdown`
Expected: FAIL — `Failed to resolve import "../breakdown.js"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/breakdown.js`:

```js
// Pure grouping / rollup for the History income-breakdown bars. Extracted from
// HistoryTab so the top-N + "Other" logic and share math are unit-testable
// without a DOM. Input rows are the already-summed group objects HistoryTab
// computes: tickerSummary (key "ticker", countKey "trades") or typeSummary
// (key "type", countKey "count").

/**
 * @param {Array<object>} list group summaries; each has `premium` (number),
 *                             a count field, and an id under `key`.
 * @param {object} opts
 * @param {string} opts.key              id property ("ticker" | "type")
 * @param {string} opts.countKey         count property ("trades" | "count")
 * @param {number} [opts.cap=Infinity]   max named rows before rolling into "Other"
 * @param {string} [opts.otherNoun="names"] noun used in the Other label suffix
 * @param {number} [opts.minTotalForShare=1] suppress share % when |total| below this
 * @returns {{ rows: Array<object>, total: number, maxAbs: number }}
 */
export function buildBreakdownRows(
  list,
  { key, countKey, cap = Infinity, otherNoun = "names", minTotalForShare = 1 } = {}
) {
  const items = list.map((it) => ({
    id: it[key],
    label: String(it[key]),
    premium: it.premium,
    count: it[countKey] ?? 0,
    isOther: false,
  }));

  const total = items.reduce((s, r) => s + r.premium, 0);
  const byPremiumDesc = (a, b) => b.premium - a.premium;

  let shown;
  if (Number.isFinite(cap) && items.length > cap) {
    // Cut by magnitude so a big loss is never hidden in "Other".
    const ranked = [...items].sort((a, b) => Math.abs(b.premium) - Math.abs(a.premium));
    const kept = ranked.slice(0, cap).sort(byPremiumDesc);
    const rest = ranked.slice(cap);
    const other = {
      id: null,
      label: "Other",
      premium: rest.reduce((s, r) => s + r.premium, 0),
      count: rest.reduce((s, r) => s + r.count, 0),
      isOther: true,
      groups: rest.length,
      otherNoun,
    };
    shown = [...kept, other];
  } else {
    shown = items.sort(byPremiumDesc);
  }

  const shareOn = Math.abs(total) >= minTotalForShare;
  const rows = shown.map((r) => ({
    ...r,
    share: shareOn ? (r.premium / total) * 100 : null,
  }));

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.premium)), 1);

  return { rows, total, maxAbs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- breakdown`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/breakdown.js src/lib/__tests__/breakdown.test.js
git commit -m "feat(history): pure buildBreakdownRows helper for income breakdown"
```

---

## Task 2: `IncomeBreakdown` presentational component

**Files:**
- Create: `src/components/IncomeBreakdown.jsx`

No unit test (repo has no RTL/jsdom; presentational components are verified by build + preview). Keep it dumb: it takes summaries + selection + handlers and renders.

- [ ] **Step 1: Write the component**

Create `src/components/IncomeBreakdown.jsx`:

```jsx
import { buildBreakdownRows } from "../lib/breakdown";
import { formatDollars } from "../lib/format";
import { theme } from "../lib/theme";

/**
 * Ranked horizontal-bar breakdown of realized income for the active range.
 * Flips between grouping by ticker ("name") and by trade type ("type").
 * Clicking a bar toggles the matching selection via the injected handlers;
 * the rolled-up "Other" bar is inert.
 */
export function IncomeBreakdown({
  mode,               // "name" | "type"
  onModeChange,       // (mode) => void
  tickerSummary,      // [{ ticker, trades, premium, ... }]
  typeSummary,        // [{ type, count, premium }]
  selectedTicker,
  selectedType,
  onSelectTicker,     // (ticker) => void  (parent handles toggle-off)
  onSelectType,       // (type) => void
}) {
  const isName = mode === "name";
  const { rows, maxAbs } = isName
    ? buildBreakdownRows(tickerSummary, { key: "ticker", countKey: "trades", cap: 10 })
    : buildBreakdownRows(typeSummary, { key: "type", countKey: "count" });

  const MODES = [
    ["name", "By name"],
    ["type", "By type"],
  ];

  return (
    <div style={{ marginBottom: theme.space[5] }}>
      {/* Name | Type toggle */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[3] }}>
        {MODES.map(([m, label]) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                borderRadius: theme.radius.pill,
                fontSize: theme.size.md,
                fontFamily: "inherit",
                cursor: "pointer",
                border: `1px solid ${active ? theme.border.strong : "transparent"}`,
                background: active ? theme.bg.elevated : "transparent",
                color: active ? theme.text.primary : theme.text.muted,
                transition: "background 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: theme.space[2] }}>
        {rows.length === 0 && (
          <div style={{ fontSize: theme.size.md, color: theme.text.subtle }}>
            No realized income in this range.
          </div>
        )}
        {rows.map((r) => {
          const selected = !r.isOther && r.id === (isName ? selectedTicker : selectedType);
          const neg = r.premium < 0;
          const width = Math.max(2, (Math.abs(r.premium) / maxAbs) * 100);
          const clickable = !r.isOther;
          const right = r.isOther
            ? `${formatDollars(r.premium)} · ${r.groups} more`
            : `${formatDollars(r.premium)}${r.share != null ? ` · ${Math.round(r.share)}%` : ""}`;
          return (
            <button
              key={r.label + (r.id ?? "__other__")}
              onClick={clickable ? () => (isName ? onSelectTicker(r.id) : onSelectType(r.id)) : undefined}
              disabled={!clickable}
              style={{
                display: "grid",
                gridTemplateColumns: "64px 1fr auto",
                alignItems: "center",
                gap: theme.space[3],
                width: "100%",
                textAlign: "left",
                padding: `${theme.space[1]}px ${theme.space[2]}px`,
                border: `1px solid ${selected ? theme.blue : "transparent"}`,
                borderRadius: theme.radius.sm,
                background: selected ? theme.bg.elevated : "transparent",
                cursor: clickable ? "pointer" : "default",
                fontFamily: "inherit",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { if (clickable && !selected) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
              onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontSize: theme.size.md,
                fontWeight: 600,
                color: r.isOther ? theme.text.muted : selected ? theme.blue : theme.text.primary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {r.label}
              </span>
              <span style={{ height: 16, background: theme.bg.surface, borderRadius: theme.radius.sm, overflow: "hidden" }}>
                <span style={{
                  display: "block",
                  width: `${width}%`,
                  height: "100%",
                  borderRadius: theme.radius.sm,
                  background: r.isOther ? theme.border.strong : neg ? theme.gradient.loss : theme.gradient.gain,
                  transition: "width 0.3s",
                }} />
              </span>
              <span style={{
                fontSize: theme.size.md,
                fontFamily: theme.font.mono,
                color: neg ? theme.red : theme.text.secondary,
                whiteSpace: "nowrap",
              }}>
                {right}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Note — no standalone verification here**

The component is imported nowhere yet, so `npm run build` would tree-shake it away without parsing it — a build check here proves nothing. Its JSX/imports get their first real verification in Task 3 Step 4 (once HistoryTab imports it). Proceed to commit; do not fabricate a passing check.

- [ ] **Step 3: Commit**

```bash
git add src/components/IncomeBreakdown.jsx
git commit -m "feat(history): IncomeBreakdown bar component (name/type toggle)"
```

---

## Task 3: Wire the Cards↔Breakdown toggle into HistoryTab

**Files:**
- Modify: `src/components/HistoryTab.jsx`

Add two state hooks, an import, a small view toggle above the cards region, and a conditional render. The existing cards grid stays exactly as-is under the `"cards"` branch.

- [ ] **Step 1: Add the import**

At the top of `src/components/HistoryTab.jsx`, after the existing `DateRangePicker` import (line 9), add:

```jsx
import { IncomeBreakdown } from "./IncomeBreakdown";
```

- [ ] **Step 2: Add view state**

Immediately after the `hoveredClear` state (line 48: `const [hoveredClear, setHoveredClear] = useState(false);`), add:

```jsx
  // Cards ↔ Breakdown view for the ticker region (default: cards, unchanged behavior)
  const [breakdownView, setBreakdownView] = useState("cards"); // "cards" | "breakdown"
  const [breakdownMode, setBreakdownMode] = useState("name");  // "name" | "type"
```

- [ ] **Step 3: Add the view toggle + conditional render around the cards grid**

The cards grid is the block starting at `{/* Ticker bar chart ... */}` (line ~173) — the `<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", ... }}>` … `</div>` that closes at line 251.

Wrap it. Replace the **opening** of that block (the comment + the grid `<div ...>` open tag on lines 173–174) with the toggle header plus a conditional that keeps the existing grid under the `"cards"` branch:

```jsx
      {/* Ticker region: Cards ↔ Breakdown toggle */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[3] }}>
        {[["cards", "Cards"], ["breakdown", "Breakdown"]].map(([v, label]) => {
          const active = breakdownView === v;
          return (
            <button
              key={v}
              onClick={() => setBreakdownView(v)}
              style={{
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                borderRadius: theme.radius.pill,
                fontSize: theme.size.md,
                fontFamily: "inherit",
                cursor: "pointer",
                border: `1px solid ${active ? theme.border.strong : "transparent"}`,
                background: active ? theme.bg.elevated : "transparent",
                color: active ? theme.text.primary : theme.text.muted,
                transition: "background 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {breakdownView === "breakdown" ? (
        <IncomeBreakdown
          mode={breakdownMode}
          onModeChange={setBreakdownMode}
          tickerSummary={tickerSummary}
          typeSummary={typeSummary}
          selectedTicker={selectedTicker}
          selectedType={selectedType}
          onSelectTicker={(t) => setSelectedTicker(selectedTicker === t ? null : t)}
          onSelectType={(t) => setSelectedType(selectedType === t ? null : t)}
        />
      ) : (
      /* Ticker bar chart — Q2: gap 8→space[2], marginBottom 20→space[5] */
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: theme.space[2], marginBottom: theme.space[5] }}>
```

Then, at the **close** of the cards grid (the `</div>` on line 251, right before the `{/* Ticker history panel ... */}` comment on line 253), add the closing paren of the ternary:

```jsx
      </div>
      )}
```

Net effect: the toggle header always shows; under `"cards"` the original grid renders verbatim; under `"breakdown"` the new component renders. No other blocks (type chips, ticker-history panel, hold-duration histogram, filter indicator, table) change.

- [ ] **Step 4: Verify the build passes**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 5: Verify tests still pass**

Run: `npm test`
Expected: 792 + 7 (breakdown) = 799 passing, 0 failures.

- [ ] **Step 6: Preview verification (manual, per repo convention)**

Note: local dev doesn't serve `api/*`, but the History tab reads from the bundled data fallback, so it renders locally. Start the dev server (`preview_start`), open the Review → History view:
  - Toggle **Cards → Breakdown**: bars appear, ranked, green.
  - Toggle **By name / By type**: bars regroup; type mode shows CSP/CC/LEAPS/Shares/Spread.
  - Click a name bar: the trades table filters to that ticker; the active-filter indicator shows it; click again clears.
  - Click a type bar: filters by type (the matching type chip activates).
  - Pick a range with a losing name (or verify with a range where HOOD nets negative): its bar renders red with a `-$` label.
  - Default view on load is **Cards**.

Capture a screenshot for the user.

- [ ] **Step 7: Commit**

```bash
git add src/components/HistoryTab.jsx
git commit -m "feat(history): Cards↔Breakdown toggle in the ticker region"
```

---

## Task 4: Version bump + final verification

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Confirm the baseline from main**

Run: `git show origin/main:package.json | grep '"version"'`
Expected: `"version": "1.167.0"` → new version is **1.168.0**.

- [ ] **Step 2: Bump both files**

In `package.json`, change `"version": "1.167.0"` → `"version": "1.168.0"`.
In `src/lib/constants.js` line 34, change `export const VERSION = "1.167.0";` → `export const VERSION = "1.168.0";`.

- [ ] **Step 3: Final full verification**

Run: `npm test && npm run build`
Expected: 799 tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump to v1.168.0 (History income breakdown)"
```

---

## Verification Summary (Definition of Done)

- `src/lib/breakdown.js` exists with `buildBreakdownRows`; `npm test -- breakdown` green (7 tests).
- `IncomeBreakdown.jsx` renders ranked green/red bars, Name/Type toggle, inert "Other" row.
- HistoryTab shows a Cards↔Breakdown toggle; default is Cards; bars reuse existing selection state and filter the table on click.
- Name mode caps at top-10 + "Other" (magnitude cut keeps big losses visible); Type mode never caps.
- Full suite `npm test` = 799 passing; `npm run build` clean.
- Version is 1.168.0 in both `package.json` and `constants.js`.
- No changes to RadarTab or any radar file (no collision with the concurrent radar work).
