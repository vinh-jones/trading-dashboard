# Makeup Basket — Assigned Shares & Covered Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an assigned CSP's resulting shares lot be declared into a strategy basket (at full strike basis), marked live off the equity quote, and warn when tagged covered calls exceed the declared shares.

**Architecture:** The basket is a tag-driven logical ledger. A makeup shares lot is a single `journal_entries` row tagged `strategy:*` with `type: "Shares"` and `metadata: { shares, basis }`. The resolver builds that member directly from the entry's metadata (never tuple-matching the blended broker position), and marks it as a delta-1 long off the ticker's equity quote. The CSP-close leg is handled by the existing Google Sheets → `/api/sync` pipeline and needs no code. The only new client write is creating the declaration entry via `POST /api/journal-entry`.

**Tech Stack:** React (inline-style components, no CSS/Tailwind), Vitest, Vercel serverless `/api`, Supabase (`journal_entries`).

**Spec:** `docs/superpowers/specs/2026-06-17-makeup-basket-assigned-shares-design.md`

**Key constraint:** `trades`/`positions` are read-only from the app (Sheet-sourced). Local dev does not serve `/api`, so UI tasks are verified with `npm run build`; logic tasks are verified with Vitest.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/strategyBasket.js` | Pure basket resolution + reducers + marking | Modify: declaration path, Shares marking, coverage-warning helper |
| `src/lib/__tests__/strategyBasket.test.js` | Unit tests for the above | Modify: add cases |
| `src/lib/journalApi.js` | Client wrapper for `/api/journal-entry` | Modify: add `createJournalEntry` |
| `src/components/ExploreView.jsx` | Loads `strategyEntries`, renders `StrategyBasketTab` | Modify: reusable reload callback, pass `onEntriesChanged` |
| `src/components/StrategyBasketTab.jsx` | Basket UI | Modify: over-allocation banner + "Add assigned shares" affordance |

---

## Task 1: Resolver — declaration-driven Shares members

**Files:**
- Modify: `src/lib/strategyBasket.js` (add helper after `fromTrade`, ~line 71; branch inside `resolveBasket`, ~line 83)
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the `describe("resolveBasket", ...)` block in `src/lib/__tests__/strategyBasket.test.js`:

```js
it("resolves an open recovery Shares lot from metadata, ignoring the blended position", () => {
  // A blended 300-share GLW position in the feed must NOT be what the basket counts.
  const blended = [
    { ticker: "GLW", type: "Shares", strike: null, expiry_date: null, contracts: 300, capital_fronted: 54000, entry_cost: 180 },
  ];
  const e = [
    { tags: ["strategy:g"], trade_id: null, ticker: "GLW", type: "Shares", strike: null, expiry: null, entry_date: "2026-06-17", metadata: { shares: 100, basis: 190 } },
  ];
  const members = resolveBasket("strategy:g", { openPositions: blended, trades: [], entries: e });
  expect(members).toHaveLength(1);
  expect(members[0]).toMatchObject({
    status: "open", role: "recovery", ticker: "GLW", type: "Shares",
    contracts: 100, entryCost: 190, capitalFronted: 19000, openDate: "2026-06-17",
  });
});

it("baseline Shares (no metadata.shares) still resolves via trade_id, not the declaration path", () => {
  const members = resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries });
  const baseline = members.find(m => m.role === "baseline");
  expect(baseline).toMatchObject({ status: "closed", ticker: "SOFI", realized: -26400 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: FAIL — the first new test resolves to the blended position (`contracts: 300, entryCost: 180`) instead of `100/190`.

- [ ] **Step 3: Add the `fromDeclaredShares` helper**

In `src/lib/strategyBasket.js`, immediately after the `fromTrade` function (after line 71), add:

```js
// An open recovery shares lot declared directly on a tagged journal entry.
// The basket slice is ASSERTED via metadata (shares + basis), never derived from
// the blended broker position — so a partial or multi-basis lot stays honest, and
// the null-strike/null-expiry tuple-match landmine is avoided entirely.
function fromDeclaredShares(entry, role, meta) {
  const shares = meta.shares;
  const basis = meta.basis;
  return {
    status: "open",
    role,
    ticker: entry.ticker,
    type: "Shares",
    strike: null,
    expiry: null,
    openDate: entry.entry_date ?? null,
    closeDate: null,
    contracts: shares,
    capitalFronted: shares * basis,
    entryCost: basis,
    realized: null,
  };
}
```

- [ ] **Step 4: Add the declaration branch in `resolveBasket`**

In `src/lib/strategyBasket.js`, inside the `for (const entry of entries)` loop, immediately after the `const role = ...` line (line 83), insert:

```js
    // Declared shares lot: a tagged Shares entry carrying its own share-count +
    // basis in metadata resolves directly. Baseline Shares carry no
    // metadata.shares and fall through to the trade_id path below.
    const meta = entry.metadata ?? {};
    if (entry.type === "Shares" && meta.shares != null && meta.basis != null) {
      members.push(fromDeclaredShares(entry, role, meta));
      continue;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: PASS (all existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "Resolve declared Shares basket members from entry metadata"
```

---

## Task 2: Marking — Shares members off the equity quote

**Files:**
- Modify: `src/lib/strategyBasket.js` (`markFor` ~line 134, `memberUnrealized` ~line 149, `unrealizedCushion` ~line 164)
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/lib/__tests__/strategyBasket.test.js`:

```js
describe("Shares marking", () => {
  const sharesLot = { status: "open", role: "recovery", ticker: "GLW", type: "Shares", strike: null, expiry: null, contracts: 100, entryCost: 190 };

  it("marks a Shares lot off the equity ticker quote with a x1 multiplier", () => {
    const quoteMap = new Map([["GLW", { mid: 176.92 }]]);
    expect(memberUnrealized(sharesLot, quoteMap)).toBeCloseTo((176.92 - 190) * 100, 6); // -1308
  });

  it("falls back to last, and is unmarked without a ticker quote", () => {
    expect(memberUnrealized(sharesLot, new Map([["GLW", { last: 180 }]]))).toBeCloseTo((180 - 190) * 100, 6);
    expect(memberUnrealized(sharesLot, new Map())).toBe(null);
  });

  it("unrealizedCushion includes the Shares lot in total and marked count", () => {
    const quoteMap = new Map([["GLW", { mid: 200 }]]);
    const { total, marked, unmarked } = unrealizedCushion([sharesLot], quoteMap);
    expect(total).toBeCloseTo((200 - 190) * 100, 6); // 1000
    expect(marked).toBe(1);
    expect(unmarked).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: FAIL — `memberUnrealized` returns `null` for a `Shares` member (current guard rejects non-option types).

- [ ] **Step 3: Add `SHARES_TYPES` and a Shares branch in `markFor`**

In `src/lib/strategyBasket.js`, replace the type-set declarations and `markFor` (lines 130–140) with:

```js
const SHORT_TYPES = new Set(["CSP", "CC"]);
const LONG_OPTION_TYPES = new Set(["LEAPS"]);
const SHARES_TYPES = new Set(["Shares"]);
const CALL_TYPES = new Set(["LEAPS", "CC"]);

function markFor(member, quoteMap) {
  // Shares mark off the equity quote (keyed by plain ticker), not an OCC symbol.
  if (SHARES_TYPES.has(member.type)) {
    const q = quoteMap.get(member.ticker);
    return q ? (q.mid ?? q.last ?? null) : null;
  }
  const isCall = CALL_TYPES.has(member.type);
  const sym = buildOccSymbol(member.ticker, member.expiry, isCall, member.strike);
  const q = quoteMap.get(sym);
  if (!q) return null;
  return q.mid ?? q.last ?? null;
}
```

- [ ] **Step 4: Add the Shares branch in `memberUnrealized`**

In `src/lib/strategyBasket.js`, replace `memberUnrealized` (lines 149–158) with:

```js
export function memberUnrealized(member, quoteMap) {
  if (member.status !== "open" || member.role !== "recovery") return null;
  const isShares = SHARES_TYPES.has(member.type);
  if (!isShares && !LONG_OPTION_TYPES.has(member.type) && !SHORT_TYPES.has(member.type)) return null;
  const mark = markFor(member, quoteMap);
  if (mark == null) return null;
  // Shares are delta-1 longs: (mark - basis) * shares — no ×100 option multiplier.
  if (isShares) return (mark - member.entryCost) * (member.contracts ?? 0);
  const mult = (member.contracts ?? 0) * 100;
  return SHORT_TYPES.has(member.type)
    ? (member.entryCost - mark) * mult
    : (mark - member.entryCost) * mult;
}
```

- [ ] **Step 5: Let `unrealizedCushion` mark Shares**

In `src/lib/strategyBasket.js`, in `unrealizedCushion` (line 168), replace the skip guard:

```js
    if (!LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
```

with:

```js
    if (!SHARES_TYPES.has(m.type) && !LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: PASS (all existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "Mark declared Shares lots off equity quote in basket cushion"
```

---

## Task 3: Over-allocation warning helper

**Files:**
- Modify: `src/lib/strategyBasket.js` (export a new pure function at end of file)
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/lib/__tests__/strategyBasket.test.js`, and add `shareCoverageWarnings` to the import on line 2:

```js
describe("shareCoverageWarnings", () => {
  it("warns when tagged CC contracts exceed declared shares", () => {
    const members = [
      { status: "open", role: "recovery", ticker: "GLW", type: "Shares", contracts: 100 },
      { status: "open", role: "recovery", ticker: "GLW", type: "CC", contracts: 2 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([
      { ticker: "GLW", declaredShares: 100, ccContracts: 2, coveredShares: 200 },
    ]);
  });

  it("no warning when CCs are covered by declared shares", () => {
    const members = [
      { status: "open", role: "recovery", ticker: "GLW", type: "Shares", contracts: 200 },
      { status: "open", role: "recovery", ticker: "GLW", type: "CC", contracts: 2 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([]);
  });

  it("warns when a CC is tagged before any shares are declared", () => {
    const members = [
      { status: "open", role: "recovery", ticker: "GLW", type: "CC", contracts: 1 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([
      { ticker: "GLW", declaredShares: 0, ccContracts: 1, coveredShares: 100 },
    ]);
  });

  it("ignores closed and baseline members", () => {
    const members = [
      { status: "closed", role: "recovery", ticker: "GLW", type: "CC", contracts: 5 },
      { status: "open", role: "baseline", ticker: "GLW", type: "Shares", contracts: 0 },
    ];
    expect(shareCoverageWarnings(members)).toEqual([]);
  });
});
```

Update line 2's import to include `shareCoverageWarnings`:

```js
import { resolveBasket, basketTarget, capitalDeployed, realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual, shareCoverageWarnings } from "../strategyBasket";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: FAIL — `shareCoverageWarnings is not a function`.

- [ ] **Step 3: Implement `shareCoverageWarnings`**

Append to `src/lib/strategyBasket.js`:

```js
/**
 * Over-allocation check: a basket may tag more covered-call contracts than its
 * declared open shares cover (the broker holds a blended lot, so the basket
 * can't enforce this structurally). Returns one entry per ticker where tagged
 * open CC contracts × 100 exceed declared open shares. Empty array = all clear.
 * @returns {Array<{ticker:string, declaredShares:number, ccContracts:number, coveredShares:number}>}
 */
export function shareCoverageWarnings(members) {
  const byTicker = new Map();
  for (const m of members) {
    if (m.status !== "open" || m.role !== "recovery") continue;
    const slot = byTicker.get(m.ticker) ?? { shares: 0, ccContracts: 0 };
    if (m.type === "Shares") slot.shares += m.contracts ?? 0;
    else if (m.type === "CC") slot.ccContracts += m.contracts ?? 0;
    byTicker.set(m.ticker, slot);
  }
  const warnings = [];
  for (const [ticker, { shares, ccContracts }] of byTicker) {
    if (ccContracts > 0 && ccContracts * 100 > shares) {
      warnings.push({ ticker, declaredShares: shares, ccContracts, coveredShares: ccContracts * 100 });
    }
  }
  return warnings;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "Add CC-vs-shares over-allocation warning helper for baskets"
```

---

## Task 4: `createJournalEntry` API client helper

**Files:**
- Modify: `src/lib/journalApi.js`

- [ ] **Step 1: Add the helper**

Append to `src/lib/journalApi.js` (mirrors `listJournalEntries`' error handling and the existing POST shape used in `JournalQuickAdd.jsx`):

```js
export async function createJournalEntry(payload) {
  const res = await fetch("/api/journal-entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `journal create failed (HTTP ${res.status})`);
  }
  return json.data;
}
```

- [ ] **Step 2: Verify the module still builds**

Run: `npm run build`
Expected: build succeeds (no syntax/import errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/journalApi.js
git commit -m "Add createJournalEntry client helper"
```

---

## Task 5: ExploreView — reusable entries reload + pass `onEntriesChanged`

**Files:**
- Modify: `src/components/ExploreView.jsx` (lines 80–89 load effect; line 124 render)

- [ ] **Step 1: Ensure `useCallback` is imported**

At the top of `src/components/ExploreView.jsx`, confirm the React import includes `useCallback`. If the existing import is `import { useState, useEffect } from "react";`, change it to:

```js
import { useState, useEffect, useCallback } from "react";
```

(If `useCallback` is already imported, leave it.)

- [ ] **Step 2: Extract the loader into a callback**

Replace the load block (lines 80–89):

```js
  const [strategyEntries, setStrategyEntries] = useState([]);
  useEffect(() => {
    if (active !== "baskets") return;
    let cancelled = false;
    listJournalEntries({}).then(rows => {
      if (cancelled) return;
      setStrategyEntries((rows ?? []).filter(r => (r.tags ?? []).some(t => t.startsWith("strategy:"))));
    }).catch(() => { if (!cancelled) setStrategyEntries([]); });
    return () => { cancelled = true; };
  }, [active]);
```

with:

```js
  const [strategyEntries, setStrategyEntries] = useState([]);
  const loadStrategyEntries = useCallback(() => {
    return listJournalEntries({})
      .then(rows => setStrategyEntries((rows ?? []).filter(r => (r.tags ?? []).some(t => t.startsWith("strategy:")))))
      .catch(() => setStrategyEntries([]));
  }, []);
  useEffect(() => {
    if (active !== "baskets") return;
    loadStrategyEntries();
  }, [active, loadStrategyEntries]);
```

- [ ] **Step 3: Pass the reload callback to the basket**

Replace line 124:

```js
          <StrategyBasketTab initialTag={basketTag} entries={strategyEntries} />
```

with:

```js
          <StrategyBasketTab initialTag={basketTag} entries={strategyEntries} onEntriesChanged={loadStrategyEntries} />
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExploreView.jsx
git commit -m "Expose basket entries reload callback to StrategyBasketTab"
```

---

## Task 6: StrategyBasketTab — over-allocation banner + "Add assigned shares" affordance

**Files:**
- Modify: `src/components/StrategyBasketTab.jsx`

- [ ] **Step 1: Update imports and component signature**

In `src/components/StrategyBasketTab.jsx`, update the strategyBasket import (lines 7–10) to add `shareCoverageWarnings`:

```js
import {
  resolveBasket, basketTarget, capitalDeployed,
  realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual,
  shareCoverageWarnings,
} from "../lib/strategyBasket";
```

Add the journal create helper import directly below the existing imports (after line 6):

```js
import { createJournalEntry } from "../lib/journalApi";
```

Change the component signature (line 74):

```js
export function StrategyBasketTab({ initialTag = null, entries = [] }) {
```

to:

```js
export function StrategyBasketTab({ initialTag = null, entries = [], onEntriesChanged }) {
```

- [ ] **Step 2: Compute warnings and add affordance state**

In `src/components/StrategyBasketTab.jsx`, immediately after the `cushion` line (line 100), add:

```js
  const coverageWarnings = useMemo(() => shareCoverageWarnings(members), [members]);

  // "Add assigned shares" affordance state.
  const [showAddShares, setShowAddShares] = useState(false);
  const [addForm, setAddForm] = useState({ ticker: "", shares: "", basis: "" });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState(null);

  const submitAddShares = async () => {
    const ticker = addForm.ticker.trim().toUpperCase();
    const shares = Number(addForm.shares);
    const basis = Number(addForm.basis);
    if (!ticker || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(basis) || basis <= 0) {
      setAddError("Enter a ticker, a positive share count, and a positive basis.");
      return;
    }
    if (!activeTag) { setAddError("No active basket tag."); return; }
    setAddBusy(true);
    setAddError(null);
    try {
      await createJournalEntry({
        entry_type: "position_note",
        ticker,
        type: "Shares",
        strike: null,
        expiry: null,
        entry_date: new Date().toISOString().slice(0, 10),
        tags: [activeTag],
        body: `Assigned ${shares} ${ticker} shares @ $${basis} basis (makeup lot)`,
        source: "Self",
        metadata: { shares, basis },
      });
      setAddForm({ ticker: "", shares: "", basis: "" });
      setShowAddShares(false);
      if (onEntriesChanged) await onEntriesChanged();
    } catch (err) {
      setAddError(err.message || "Failed to add shares.");
    } finally {
      setAddBusy(false);
    }
  };
```

- [ ] **Step 3: Render the warning banner and affordance above the transaction log**

In `src/components/StrategyBasketTab.jsx`, find the "Transaction log" comment (line 220) and insert this block immediately *before* it:

```jsx
      {/* Over-allocation warning: tagged CCs exceed declared shares for a ticker */}
      {coverageWarnings.map(w => (
        <div key={`warn-${w.ticker}`} style={{
          marginBottom: theme.space[2], padding: theme.space[2],
          background: theme.alert.dangerBg, border: `1px solid ${theme.alert.dangerBorder}`,
          borderRadius: theme.radius.sm, fontSize: theme.size.xs, color: theme.text.secondary,
        }}>
          ⚠ {w.ticker}: {w.ccContracts} CC{w.ccContracts > 1 ? "s" : ""} tagged ({w.coveredShares} shares) but only {w.declaredShares} shares declared — over-allocated.
        </div>
      ))}

      {/* Add-assigned-shares affordance */}
      <div style={{ marginBottom: theme.space[3] }}>
        {!showAddShares ? (
          <button onClick={() => { setShowAddShares(true); setAddError(null); }} style={{
            padding: "6px 12px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
            background: theme.bg.surface, color: theme.text.secondary,
            border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
          }}>+ Add assigned shares</button>
        ) : (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: theme.space[2], alignItems: "center",
            padding: theme.space[3], background: theme.bg.surface,
            border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
          }}>
            <input value={addForm.ticker} placeholder="Ticker"
              onChange={e => setAddForm(f => ({ ...f, ticker: e.target.value }))}
              style={{ width: 80, padding: "6px 8px", fontFamily: "inherit", fontSize: theme.size.sm, background: theme.bg.base, color: theme.text.primary, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm }} />
            <input value={addForm.shares} placeholder="Shares" inputMode="numeric"
              onChange={e => setAddForm(f => ({ ...f, shares: e.target.value }))}
              style={{ width: 80, padding: "6px 8px", fontFamily: theme.font.mono, fontSize: theme.size.sm, background: theme.bg.base, color: theme.text.primary, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm }} />
            <input value={addForm.basis} placeholder="Basis $" inputMode="decimal"
              onChange={e => setAddForm(f => ({ ...f, basis: e.target.value }))}
              style={{ width: 90, padding: "6px 8px", fontFamily: theme.font.mono, fontSize: theme.size.sm, background: theme.bg.base, color: theme.text.primary, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm }} />
            <button onClick={submitAddShares} disabled={addBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, cursor: addBusy ? "default" : "pointer", fontFamily: "inherit",
              background: theme.bg.elevated, color: theme.blue,
              border: `1px solid ${theme.blue}`, borderRadius: theme.radius.sm, opacity: addBusy ? 0.6 : 1,
            }}>{addBusy ? "Adding…" : "Add to basket"}</button>
            <button onClick={() => { setShowAddShares(false); setAddError(null); }} disabled={addBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
              background: "transparent", color: theme.text.muted,
              border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
            }}>Cancel</button>
            <span style={{ flexBasis: "100%", fontSize: theme.size.xs, color: addError ? theme.red : theme.text.subtle }}>
              {addError || `Basis = full assignment strike (premium is booked separately). Then close the CSP as Assigned in your sheet and sync to book the premium.`}
            </span>
          </div>
        )}
      </div>

```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Run the full unit suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/StrategyBasketTab.jsx
git commit -m "Add assigned-shares affordance + over-allocation banner to basket"
```

---

## Task 7: Version bump

**Files:**
- Modify: `package.json`, `src/lib/constants.js`

- [ ] **Step 1: Check main's current version**

Run: `git show origin/main:package.json | grep '"version"'`
Expected: prints the current baseline version (e.g. `"version": "1.130.0"`).

- [ ] **Step 2: Bump minor (new feature) in both files**

Increment the minor from the baseline (e.g. `1.130.0` → `1.131.0`). Edit `"version"` in `package.json` and `const VERSION` in `src/lib/constants.js` to the same value.

- [ ] **Step 3: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "Record assigned shares & CCs in makeup basket (v1.131.0)"
git push origin main
```

(Use the actual bumped version in the message.)

---

## Verification Summary

- **Logic (Tasks 1–3):** `npx vitest run src/lib/__tests__/strategyBasket.test.js` — all green.
- **Build (Tasks 4–6):** `npm run build` succeeds; `npx vitest run` full suite green.
- **Manual (post-deploy, since `/api` isn't served locally):** on the deployed app, open Baskets → "Add assigned shares" (e.g. GLW / 100 / 190) → entry appears as an open Shares recovery member at $19,000 deployed, marked live off the GLW quote; tagging a 2nd CC against a 100-share lot shows the over-allocation banner.
