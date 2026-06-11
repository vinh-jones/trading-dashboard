# CSP Selection Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click CSP rows on the Open Positions tab to build a selection and see live aggregates (collateral $ and % of account, max premium, captured premium, weighted avg G/L) in a sticky bottom bar.

**Architecture:** A new pure module `src/lib/cspAggregates.js` does all math (vitest-covered). A new `CspSelectionBar` component renders the fixed bar. `OpenPositionsTab.jsx` holds the selection (`Set` of `positionKey` strings) and rewires CSP-row interaction: row click selects, the ▾ chevron becomes the only expand affordance, expiry-cell click quick-selects that expiry. CCs/LEAPs tabs are untouched.

**Tech Stack:** React 18, inline `style={{}}` with `theme` tokens (no CSS files), vitest. Spec: `docs/superpowers/specs/2026-06-11-csp-selection-calculator-design.md`.

**Worktree discipline (subagents):** ALL work happens in the repo checkout you are told to use — never `cd` to another checkout of this repo, never commit on `main`. Work on branch `feat/csp-selection-calculator`.

**Codebase facts you need (verified 2026-06-11, main @ v1.123.0):**
- `src/components/OpenPositionsTab.jsx` (~1300 lines) contains both `PositionsTable` (shared CSP/CC/LEAP table, ~line 503) and the main `OpenPositionsTab` component (~line 856).
- `PositionsTable` already computes an `enriched` array: `{ pos, dte, dtePct, glDollars, glPct, otmPct, displayValue, holdYield }` per row. `glDollars` is unrealized G/L $ from live option mids (null when no quote).
- `positionKey(pos)` from `src/lib/tags.js` returns `ticker|type|strike|expiry_date` — already imported in OpenPositionsTab.jsx.
- CSP `pos` fields: `ticker`, `strike`, `contracts`, `premium_collected`, `expiry_date`, `open_date`, `type === "CSP"`.
- `account.account_value` is available in `OpenPositionsTab` via `useData()`.
- The file uses `rgba(58,130,246,…)` strings for blue row tints (matches `theme.blue`); follow that convention. Design tokens otherwise: `theme` from `src/lib/theme.js`.
- Tests: `npx vitest run`. Build: `npm run build`. Local dev does NOT serve `/api/*`, so the positions table cannot be browser-verified locally — verification is vitest + build.

---

### Task 0: Branch setup

**Files:** none

- [ ] **Step 0.1: Sync and branch**

```bash
git fetch origin && git checkout main && git pull origin main
git checkout -b feat/csp-selection-calculator
```

Expected: new branch `feat/csp-selection-calculator` tracking a clean, current main.

---

### Task 1: Aggregates module (TDD)

**Files:**
- Create: `src/lib/cspAggregates.js`
- Test: `src/lib/__tests__/cspAggregates.test.js`

- [ ] **Step 1.1: Write the failing tests**

Create `src/lib/__tests__/cspAggregates.test.js`:

```js
import { describe, it, expect } from "vitest";
import { computeCspAggregates } from "../cspAggregates";

// Row shape mirrors PositionsTable's `enriched` items (extra fields are ignored).
const row = (strike, contracts, premium, glDollars) => ({
  pos: { strike, contracts, premium_collected: premium },
  glDollars,
});

describe("computeCspAggregates", () => {
  it("returns an empty result for no rows", () => {
    expect(computeCspAggregates([], 100000)).toEqual({
      count: 0, collateral: null, collateralPct: null, maxPremium: null,
      captured: null, avgGlPct: null, missingMarkCount: 0,
    });
    expect(computeCspAggregates(null, 100000).count).toBe(0);
  });

  it("sums collateral as strike × 100 × contracts", () => {
    const agg = computeCspAggregates([row(107, 1, 462, -681), row(18, 10, 1180, -1450)], null);
    expect(agg.collateral).toBe(107 * 100 * 1 + 18 * 100 * 10); // 10700 + 18000 = 28700
  });

  it("computes collateral % of account when accountValue is present", () => {
    const agg = computeCspAggregates([row(100, 1, 500, 100)], 50000);
    expect(agg.collateral).toBe(10000);
    expect(agg.collateralPct).toBeCloseTo(20.0, 5);
  });

  it("omits collateral % when accountValue is missing or zero", () => {
    expect(computeCspAggregates([row(100, 1, 500, 100)], null).collateralPct).toBeNull();
    expect(computeCspAggregates([row(100, 1, 500, 100)], 0).collateralPct).toBeNull();
  });

  it("sums max premium across all rows regardless of marks", () => {
    const agg = computeCspAggregates([row(100, 1, 462, -681), row(50, 2, 1180, null)], null);
    expect(agg.maxPremium).toBe(462 + 1180);
  });

  it("skips rows with null glDollars from captured and counts them", () => {
    const agg = computeCspAggregates(
      [row(100, 1, 1000, 500), row(50, 1, 800, null), row(60, 1, 200, -100)],
      null,
    );
    expect(agg.captured).toBe(400); // 500 + (-100); the null-mark row skipped
    expect(agg.missingMarkCount).toBe(1);
  });

  it("weights avg G/L by premium of marked rows only", () => {
    // Marked: 1000 prem / +500 gl. Unmarked: 500 prem excluded from denominator.
    const agg = computeCspAggregates([row(100, 1, 1000, 500), row(50, 1, 500, null)], null);
    expect(agg.avgGlPct).toBeCloseTo(50.0, 5); // 500 / 1000, NOT 500 / 1500
  });

  it("returns null captured and avg G/L when no rows have marks", () => {
    const agg = computeCspAggregates([row(100, 1, 500, null), row(50, 1, 300, null)], 10000);
    expect(agg.captured).toBeNull();
    expect(agg.avgGlPct).toBeNull();
    expect(agg.missingMarkCount).toBe(2);
    expect(agg.collateral).toBe(15000); // collateral/premium still computed
    expect(agg.maxPremium).toBe(800);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/cspAggregates.test.js`
Expected: FAIL — "Failed to resolve import ../cspAggregates".

- [ ] **Step 1.3: Write the implementation**

Create `src/lib/cspAggregates.js`:

```js
// Aggregate stats for a user-selected subset of open CSP rows.
// Consumed by the selection calculator bar on the Open Positions tab.
// See docs/superpowers/specs/2026-06-11-csp-selection-calculator-design.md.

/**
 * @param {Array<{pos: {strike, contracts, premium_collected}, glDollars: number|null}>} rows
 *   Selected rows in PositionsTable's `enriched` shape. glDollars is unrealized
 *   G/L $ from live option mids — null when the option has no quote.
 * @param {number|null} accountValue - account_value from /api/data, may be absent.
 * @returns {{count, collateral, collateralPct, maxPremium, captured, avgGlPct, missingMarkCount}}
 *   Dollar fields in $, pct fields in % units. captured/avgGlPct cover only rows
 *   with marks (missingMarkCount reports the rest); avgGlPct's denominator is the
 *   premium of marked rows so the ratio stays internally consistent.
 */
export function computeCspAggregates(rows, accountValue) {
  if (!rows?.length) {
    return {
      count: 0, collateral: null, collateralPct: null, maxPremium: null,
      captured: null, avgGlPct: null, missingMarkCount: 0,
    };
  }

  let collateral = 0, maxPremium = 0, captured = 0, markedPremium = 0, missingMarkCount = 0;
  for (const { pos, glDollars } of rows) {
    collateral += (pos.strike ?? 0) * 100 * (pos.contracts ?? 0);
    maxPremium += pos.premium_collected ?? 0;
    if (glDollars == null) { missingMarkCount += 1; continue; }
    captured       += glDollars;
    markedPremium  += pos.premium_collected ?? 0;
  }

  const allUnmarked = missingMarkCount === rows.length;
  return {
    count: rows.length,
    collateral,
    collateralPct: accountValue ? (collateral / accountValue) * 100 : null,
    maxPremium,
    captured: allUnmarked ? null : captured,
    avgGlPct: !allUnmarked && markedPremium > 0 ? (captured / markedPremium) * 100 : null,
    missingMarkCount,
  };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/cspAggregates.test.js`
Expected: 8 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/cspAggregates.js src/lib/__tests__/cspAggregates.test.js
git commit -m "Add CSP selection aggregates module"
```

---

### Task 2: Selection bar component

**Files:**
- Create: `src/components/CspSelectionBar.jsx`

No unit test — purely presentational, verified via build + post-deploy. All math is in Task 1's tested module.

- [ ] **Step 2.1: Create the component**

Create `src/components/CspSelectionBar.jsx`:

```jsx
import { theme } from "../lib/theme";
import { formatDollarsFull } from "../lib/format";

// Selection-tint blue, same rgba(58,130,246,…) family OpenPositionsTab already
// uses for row highlights (matches theme.blue).
const BAR_BORDER = "rgba(58,130,246,0.40)";

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
        letterSpacing: "0.5px", fontWeight: 500, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: color ?? theme.text.primary, whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

// Sticky aggregate readout for the CSP selection calculator. Renders nothing
// until ≥1 row is selected. Desktop: one line of stats. Mobile: count + clear
// line, then a 2×2 stat grid. Right side intentionally ends with the clear
// button — a future "Save as cohort" action slots in before it.
export function CspSelectionBar({ agg, isMobile, onClear }) {
  if (!agg || agg.count === 0) return null;

  const capturedColor = agg.captured == null ? theme.text.muted
    : agg.captured >= 0 ? theme.green : theme.red;

  const collateralValue = (
    <>
      {formatDollarsFull(agg.collateral)}
      {agg.collateralPct != null && (
        <span style={{ color: theme.text.muted, fontWeight: 400 }}>
          {" "}({agg.collateralPct.toFixed(1)}%{isMobile ? "" : " of acct"})
        </span>
      )}
    </>
  );
  const capturedValue = agg.captured != null ? formatDollarsFull(agg.captured) : "—";
  const avgGlValue    = agg.avgGlPct != null ? `${agg.avgGlPct.toFixed(1)}%` : "—";
  const markNote = agg.missingMarkCount > 0 ? (
    <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, whiteSpace: "nowrap" }}>
      *{agg.missingMarkCount} no mark
    </span>
  ) : null;

  const clearBtn = (
    <button
      onClick={onClear}
      style={{
        background: "transparent", border: "none", cursor: "pointer", padding: 0,
        color: theme.text.muted, fontSize: theme.size.sm, fontFamily: "inherit", whiteSpace: "nowrap",
      }}
    >
      ✕ clear
    </button>
  );

  const shell = {
    position:     "fixed",
    left:         "50%",
    transform:    "translateX(-50%)",
    bottom:       `calc(env(safe-area-inset-bottom, 0px) + ${theme.space[3]}px)`,
    zIndex:       50,
    background:   theme.bg.elevated,
    border:       `1px solid ${BAR_BORDER}`,
    borderRadius: theme.radius.md,
    boxShadow:    "0 6px 24px rgba(0,0,0,0.5)",
    padding:      `${theme.space[2]}px ${theme.space[4]}px`,
    fontFamily:   theme.font.mono,
  };

  if (isMobile) {
    return (
      <div style={{ ...shell, width: "calc(100vw - 16px)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: theme.space[2] }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.primary }}>
            <span style={{ color: theme.blue, fontWeight: 700 }}>{agg.count}</span> selected {markNote}
          </span>
          {clearBtn}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${theme.space[1]}px ${theme.space[4]}px` }}>
          <Stat label="Collateral"  value={collateralValue} />
          <Stat label="Max premium" value={formatDollarsFull(agg.maxPremium)} color={theme.green} />
          <Stat label="Captured"    value={capturedValue} color={capturedColor} />
          <Stat label="Avg G/L"     value={avgGlValue} color={capturedColor} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...shell, display: "flex", alignItems: "center", gap: theme.space[5] }}>
      <Stat label="Selected"    value={agg.count} color={theme.blue} />
      <Stat label="Collateral"  value={collateralValue} />
      <Stat label="Max premium" value={formatDollarsFull(agg.maxPremium)} color={theme.green} />
      <Stat label="Captured"    value={capturedValue} color={capturedColor} />
      <Stat label="Avg G/L"     value={avgGlValue} color={capturedColor} />
      {markNote}
      {clearBtn}
    </div>
  );
}
```

- [ ] **Step 2.2: Verify it builds**

Run: `npm run build`
Expected: `✓ built` with no errors. (Component is not imported yet — this just catches syntax issues.)

- [ ] **Step 2.3: Commit**

```bash
git add src/components/CspSelectionBar.jsx
git commit -m "Add CspSelectionBar sticky aggregate readout"
```

---

### Task 3: Wire selection into OpenPositionsTab

**Files:**
- Modify: `src/components/OpenPositionsTab.jsx`

All edits below use exact content anchors (line numbers from main @ v1.123.0 are approximate). Edit order matters only in that 3.1–3.8 should all land before the build check.

- [ ] **Step 3.1: Add imports**

After the existing line:
```js
import { computeHoldYield } from "../lib/holdYield";
```
add:
```js
import { computeCspAggregates } from "../lib/cspAggregates";
import { CspSelectionBar } from "./CspSelectionBar";
```

- [ ] **Step 3.2: Extend PositionsTable signature (~line 506)**

Replace:
```js
function PositionsTable({ rows, positionType, quoteMap, cspEntryYieldBenchmark, isMobile, highlightedTicker, onOpenTickerDetail, strategicTagsByPos, onShowJournalEntry, onTagPosition, onOpenBasket }) {
```
with:
```js
function PositionsTable({ rows, positionType, quoteMap, cspEntryYieldBenchmark, isMobile, highlightedTicker, onOpenTickerDetail, strategicTagsByPos, onShowJournalEntry, onTagPosition, onOpenBasket, selectable, selectedKeys, setSelectedKeys, accountValue }) {
```

- [ ] **Step 3.3: Add selection handlers + aggregates after the `sorted` computation (~line 641)**

Directly after the closing of the `const sorted = …` statement (ends with `});`), insert:

```js
  // ── Selection calculator (CSPs tab only) ──────────────────────────────────
  // Selection is keyed by positionKey so it survives re-sorts and quote
  // refreshes; a key whose position closed simply stops matching any row.
  function toggleRow(pos) {
    const key = positionKey(pos);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Expiry-cell quick-select: if every row of this expiry is selected,
  // deselect them all; otherwise select them all.
  function toggleExpiry(expiryDate) {
    const keys = enriched.filter(r => r.pos.expiry_date === expiryDate).map(r => positionKey(r.pos));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const allSelected = keys.every(k => next.has(k));
      keys.forEach(k => { if (allSelected) next.delete(k); else next.add(k); });
      return next;
    });
  }

  const selectedRows = selectable ? enriched.filter(r => selectedKeys.has(positionKey(r.pos))) : [];
  const selectionAgg = selectable ? computeCspAggregates(selectedRows, accountValue) : null;
```

- [ ] **Step 3.4: Compute per-row selection state (~line 688)**

After:
```js
            const isExpanded = canExpand && expandedRowKey === rowKey;
```
add:
```js
            const isSelected  = selectable && selectedKeys.has(positionKey(pos));
            const rowBg       = isSelected ? "rgba(58,130,246,0.14)" : highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent";
            const rowHoverBg  = isSelected ? "rgba(58,130,246,0.18)" : highlightedTicker === pos.ticker ? "rgba(58,130,246,0.15)" : `${TYPE_COLORS.CSP.bg}22`;
```

- [ ] **Step 3.5: Rewire the main row `<tr>` (~line 713)**

Replace:
```jsx
                <tr
                  style={{
                    borderBottom: (hasTagRow || isExpanded) ? "none" : `1px solid ${theme.border.default}`,
                    borderLeft:   rowHighlightColor ? `3px solid ${rowHighlightColor}` : "3px solid transparent",
                    cursor:       canExpand ? "pointer" : "default",
                    background:   highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent",
                    transition:   "background 0.4s",
                  }}
                  onClick={canExpand ? () => setExpandedRowKey(isExpanded ? null : rowKey) : undefined}
                  onMouseEnter={e => (e.currentTarget.style.background = highlightedTicker === pos.ticker ? "rgba(58,130,246,0.15)" : `${TYPE_COLORS.CSP.bg}22`)}
                  onMouseLeave={e => (e.currentTarget.style.background = highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent")}
                >
```
with:
```jsx
                <tr
                  style={{
                    borderBottom: (hasTagRow || isExpanded) ? "none" : `1px solid ${theme.border.default}`,
                    borderLeft:   rowHighlightColor ? `3px solid ${rowHighlightColor}` : isSelected ? `3px solid ${theme.blue}` : "3px solid transparent",
                    cursor:       (selectable || canExpand) ? "pointer" : "default",
                    background:   rowBg,
                    transition:   "background 0.4s",
                  }}
                  onClick={selectable ? () => toggleRow(pos) : canExpand ? () => setExpandedRowKey(isExpanded ? null : rowKey) : undefined}
                  onMouseEnter={e => (e.currentTarget.style.background = rowHoverBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                >
```
Note: `rowHighlightColor` (green target-hit / red assignment-risk left border) keeps precedence over the blue selection border — those carry risk information; selection still shows via background tint.

- [ ] **Step 3.6: Expiry cell becomes a quick-select control (~line 753)**

Replace:
```jsx
                  {!isMobile && td(formatExpiry(pos.expiry_date),                   { color: theme.text.muted })}
```
with:
```jsx
                  {!isMobile && (
                    <td
                      onClick={selectable ? (e) => { e.stopPropagation(); toggleExpiry(pos.expiry_date); } : undefined}
                      title={selectable ? "Select all CSPs with this expiry" : undefined}
                      style={{
                        padding: `${theme.space[2]}px ${theme.space[2]}px`,
                        color: theme.text.muted,
                        cursor: selectable ? "pointer" : undefined,
                        textDecoration: selectable ? "underline dotted" : "none",
                        textUnderlineOffset: 3,
                      }}
                    >
                      {formatExpiry(pos.expiry_date)}
                    </td>
                  )}
```

- [ ] **Step 3.7: Chevron cell becomes the expand control (~line 765)**

Replace:
```jsx
                  {canExpand && td(
                    <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>{isExpanded ? "▴" : "▾"}</span>,
                    { width: 30, textAlign: "center", padding: "9px 4px" }
                  )}
```
with:
```jsx
                  {canExpand && (
                    <td
                      onClick={(e) => { e.stopPropagation(); setExpandedRowKey(isExpanded ? null : rowKey); }}
                      title={isExpanded ? "Collapse" : "Expand details"}
                      style={{ width: 40, textAlign: "center", padding: "9px 8px", cursor: "pointer" }}
                    >
                      <span style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>{isExpanded ? "▴" : "▾"}</span>
                    </td>
                  )}
```
(`stopPropagation` + own handler works on both the CSPs tab — where row click now selects — and the CCs tab, where row click still expands. The hit target grows from 30×~26 to 40×~30 with a larger glyph, since this is now the only expand affordance on CSP rows.)

- [ ] **Step 3.8: Tag row follows the same click rule (~line 771)**

In the `{hasTagRow && (` `<tr>` immediately below the main row, replace:
```jsx
                      background:   highlightedTicker === pos.ticker ? "rgba(58,130,246,0.10)" : "transparent",
                    }}
                    onClick={canExpand ? () => setExpandedRowKey(isExpanded ? null : rowKey) : undefined}
```
with:
```jsx
                      background:   rowBg,
                    }}
                    onClick={selectable ? () => toggleRow(pos) : canExpand ? () => setExpandedRowKey(isExpanded ? null : rowKey) : undefined}
```

- [ ] **Step 3.9: Render the bar (~line 848)**

`PositionsTable`'s return ends with:
```jsx
        </tbody>
      </table>
    </div>
  );
}
```
Replace with:
```jsx
        </tbody>
      </table>
      {selectable && (
        <CspSelectionBar
          agg={selectionAgg}
          isMobile={isMobile}
          onClear={() => setSelectedKeys(new Set())}
        />
      )}
    </div>
  );
}
```
(The bar uses `position: fixed`, so rendering inside the overflow container is fine.)

- [ ] **Step 3.10: Add selection state in OpenPositionsTab (~line 864)**

After:
```js
  const [positionTab, setPositionTab] = useState("csps");
```
add:
```js
  // Selection calculator state — Set of positionKey strings (CSPs tab only).
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
```

- [ ] **Step 3.11: Clear selection on tab switch (~line 1055)**

In the position-tab buttons, replace:
```jsx
                  onClick={() => setPositionTab(t.key)}
```
with:
```jsx
                  onClick={() => { setPositionTab(t.key); setSelectedKeys(new Set()); }}
```

- [ ] **Step 3.12: Pass the new props (~line 1064)**

Replace:
```jsx
          <PositionsTable
            rows={activeTab?.rows ?? []}
            positionType={positionTab}
            quoteMap={quoteMap}
            cspEntryYieldBenchmark={cspEntryYieldBenchmark}
```
with:
```jsx
          <PositionsTable
            rows={activeTab?.rows ?? []}
            positionType={positionTab}
            quoteMap={quoteMap}
            cspEntryYieldBenchmark={cspEntryYieldBenchmark}
            selectable={positionTab === "csps"}
            selectedKeys={selectedKeys}
            setSelectedKeys={setSelectedKeys}
            accountValue={account?.account_value ?? null}
```
(The remaining props — `isMobile` through `onOpenBasket` — stay as they are.)

- [ ] **Step 3.13: Verify**

Run: `npx vitest run`
Expected: full suite passes (459 = 451 existing + 8 new).

Run: `npm run build`
Expected: `✓ built`, no errors or new warnings.

- [ ] **Step 3.14: Commit**

```bash
git add src/components/OpenPositionsTab.jsx
git commit -m "Wire CSP selection calculator into Open Positions table

Row click now selects on the CSPs tab (expand moved to a direct chevron
click); expiry-cell click quick-selects all rows of that expiry; sticky
CspSelectionBar shows collateral, max premium, captured, weighted avg G/L."
```

---

### Task 4: Version bump, PR, merge

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 4.1: Get the version baseline from origin/main (NEVER the local file)**

```bash
git fetch origin && git show origin/main:package.json | grep '"version"'
```
Expected: `"version": "1.123.0"` (if different, increment minor from whatever it shows).

- [ ] **Step 4.2: Bump minor version in BOTH files**

New feature → minor bump → `1.124.0` (adjust if baseline moved):
- `package.json`: `"version": "1.124.0"`
- `src/lib/constants.js`: `export const VERSION = "1.124.0";`

- [ ] **Step 4.3: Final verification**

Run: `npx vitest run && npm run build`
Expected: all tests pass, build clean.

- [ ] **Step 4.4: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "Bump version to 1.124.0"
git push -u origin feat/csp-selection-calculator
```

- [ ] **Step 4.5: PR and merge immediately (user's standing workflow — no need to ask)**

```bash
/opt/homebrew/bin/gh pr create \
  --title "CSP selection calculator (v1.124.0)" \
  --body "Click CSP rows to build a selection; a sticky bar shows aggregate collateral (\$ and % of account), max premium, captured premium, and capital-weighted avg G/L. Expiry-cell click quick-selects that expiry. Expand moves to a direct chevron click. Spec: docs/superpowers/specs/2026-06-11-csp-selection-calculator-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
/opt/homebrew/bin/gh pr merge --squash --delete-branch
```
Expected: PR merged into main, local checkout back on main and fast-forwarded. Report the PR URL and version number.

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Row click toggles selection, blue tint | 3.4, 3.5 |
| Expand only via chevron, larger hit target | 3.7 |
| Expiry-cell quick-select toggle | 3.3, 3.6 |
| Inner click targets keep working | existing `stopPropagation` untouched; 3.6/3.7 add their own |
| Selection keyed by positionKey, survives sort/refresh | 3.3, 3.4 |
| Clear on tab switch / ✕ | 3.11, 3.9 |
| CCs/LEAPs unchanged | `selectable` gate in 3.5/3.6/3.8/3.12 |
| Sticky bottom bar, desktop one-line | Task 2 |
| Mobile 2×2 grid | Task 2 |
| Cohort-ready (room for save button) | Task 2 comment + layout |
| Math definitions + missing-mark handling | Task 1 |
| `*n no mark` annotation | Task 2 |
| account_value missing → no % | Task 1, Task 2 |
| Vitest + build verification | 1.2/1.4, 3.13, 4.3 |
| Minor version bump from origin/main | Task 4 |
