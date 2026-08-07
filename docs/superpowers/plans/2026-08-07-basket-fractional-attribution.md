# Basket Fractional Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a strategy basket own a *slice* of a blended trade — "4 of 12 contracts" — instead of all-or-nothing.

**Architecture:** A tagged journal entry gains `metadata.contracts`, the count the basket owns. `resolveBasket` divides it by the resolved trade's own `contracts` column to get a weight, then scales `realized`, `capitalFronted`, and `contracts` on the member. Because `memberUnrealized` already multiplies by `contracts`, open members scale with no second code path. A new form on the basket tab writes these entries, and the transactions table groups rows by type with per-group subtotals.

**Tech Stack:** React 18 (inline `style={{}}` objects, `theme` tokens — no CSS files), Vitest, Supabase Postgres, Vercel.

**Spec:** [docs/superpowers/specs/2026-08-07-basket-fractional-attribution-design.md](../specs/2026-08-07-basket-fractional-attribution-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/strategyBasket.js` | Pure resolution + reducers. Gains `attributionWeight()` (private) and `groupMembersByType()` (exported). | Modify |
| `src/lib/__tests__/strategyBasket.test.js` | Vitest coverage for the above. | Modify |
| `src/components/StrategyBasketTab.jsx` | The attribution form + type-grouped table. | Modify |
| `package.json`, `src/lib/constants.js` | Version bump to 1.177.0. | Modify |

No new files. `strategyBasket.js` is ~270 lines and cohesive; the additions keep it under 340.

**Baseline version confirmed:** `git show origin/main:package.json` → `1.176.0` (PR #185 landed mid-planning). New feature → **1.177.0**. Re-check at Task 7 — main moves.

---

### Task 1: Weight helper + scaled closed members

**Files:**
- Modify: `src/lib/strategyBasket.js:58-77` (`fromTrade`), `src/lib/strategyBasket.js:108-135` (`resolveBasket`)
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("resolveBasket", ...)` block in `src/lib/__tests__/strategyBasket.test.js`, before its closing `});`:

```js
  it("scales a closed member's realized P/L by metadata.contracts / trade.contracts", () => {
    const t = [{ id: "dram-cc", ticker: "DRAM", type: "CC", strike: 63, expiry_date: "2026-08-28", contracts: 12, premium_collected: 1740, capital_fronted: 61548, entry_cost: 1.45, roi: 2.8, kept_pct: 0.5, days_held: 7 }];
    const e = [{ tags: ["strategy:w"], trade_id: "dram-cc", ticker: "DRAM", type: "CC", strike: 63, expiry: "2026-08-28", metadata: { contracts: 4 } }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m.realized).toBeCloseTo(580, 6);
    expect(m.capitalFronted).toBeCloseTo(20516, 6);
    expect(m.contracts).toBeCloseTo(4, 6);
    expect(m.attribution).toEqual({ owned: 4, total: 12 });
  });

  it("leaves per-unit values unscaled when attributed", () => {
    const t = [{ id: "dram-cc", ticker: "DRAM", type: "CC", strike: 63, expiry_date: "2026-08-28", contracts: 12, premium_collected: 1740, capital_fronted: 61548, entry_cost: 1.45, roi: 2.8, kept_pct: 0.5, days_held: 7 }];
    const e = [{ tags: ["strategy:w"], trade_id: "dram-cc", ticker: "DRAM", type: "CC", strike: 63, expiry: "2026-08-28", metadata: { contracts: 4 } }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m).toMatchObject({ entryCost: 1.45, roi: 2.8, keptPct: 0.5, daysHeld: 7, strike: 63 });
  });

  it("resolves whole (weight 1) when the entry declares no contracts", () => {
    const t = [{ id: "dram-cc", ticker: "DRAM", type: "CC", strike: 63, expiry_date: "2026-08-28", contracts: 12, premium_collected: 1740, capital_fronted: 61548 }];
    const e = [{ tags: ["strategy:w"], trade_id: "dram-cc", ticker: "DRAM", type: "CC", strike: 63, expiry: "2026-08-28" }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m.realized).toBe(1740);
    expect(m.attribution).toBeNull();
  });

  it("resolves whole when the trade carries no usable contract count", () => {
    // Older Shares rows have a null contracts column — there is no denominator.
    const t = [{ id: "old", ticker: "IREN", type: "Shares", strike: null, expiry_date: null, contracts: null, premium_collected: 4548, capital_fronted: 26000 }];
    const e = [{ tags: ["strategy:w"], trade_id: "old", ticker: "IREN", type: "Shares", strike: null, expiry: null, metadata: { contracts: 50 } }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m.realized).toBe(4548);
    expect(m.attribution).toBeNull();
  });

  it("clamps an over-declared count to the whole trade", () => {
    const t = [{ id: "c", ticker: "GLW", type: "CC", strike: 160, expiry_date: "2026-08-07", contracts: 4, premium_collected: 1028, capital_fronted: 64668 }];
    const e = [{ tags: ["strategy:w"], trade_id: "c", ticker: "GLW", type: "CC", strike: 160, expiry: "2026-08-07", metadata: { contracts: 9 } }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m.realized).toBe(1028);
    expect(m.attribution).toEqual({ owned: 4, total: 4 });
  });

  it("ignores a zero or negative declared count", () => {
    const t = [{ id: "c", ticker: "GLW", type: "CC", strike: 160, expiry_date: "2026-08-07", contracts: 4, premium_collected: 1028, capital_fronted: 64668 }];
    const e = [{ tags: ["strategy:w"], trade_id: "c", ticker: "GLW", type: "CC", strike: 160, expiry: "2026-08-07", metadata: { contracts: 0 } }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m.realized).toBe(1028);
    expect(m.attribution).toBeNull();
  });

  it("scales a fractional share lot (25 of a 100-share lot)", () => {
    const t = [{ id: "glw-lot", ticker: "GLW", type: "Shares", strike: null, expiry_date: null, contracts: 100, premium_collected: 1650, capital_fronted: 14100 }];
    const e = [{ tags: ["strategy:w"], trade_id: "glw-lot", ticker: "GLW", type: "Shares", strike: null, expiry: null, metadata: { contracts: 25 } }];
    const [m] = resolveBasket("strategy:w", { trades: t, entries: e });
    expect(m.realized).toBeCloseTo(412.5, 6);
    expect(m.contracts).toBeCloseTo(25, 6);
  });

  it("still takes the declared-open-shares path when shares AND basis are present", () => {
    // metadata.contracts must not hijack an open declared lot.
    const e = [{ tags: ["strategy:w"], trade_id: null, ticker: "GLW", type: "Shares", strike: null, expiry: null, entry_date: "2026-06-17", metadata: { shares: 100, basis: 190, contracts: 25 } }];
    const [m] = resolveBasket("strategy:w", { openPositions: [], trades: [], entries: e });
    expect(m).toMatchObject({ status: "open", contracts: 100, entryCost: 190, capitalFronted: 19000 });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js
```

Expected: FAIL — the first test errors on `expected 1740 to be close to 580`, and `m.attribution` is `undefined` rather than `null`.

- [ ] **Step 3: Add the weight helper**

In `src/lib/strategyBasket.js`, insert directly above `function fromOpenPosition` (currently line 32):

```js
// The slice of a shared trade a basket owns, asserted on the tagged journal
// entry as metadata.contracts. The denominator is the resolved trade's own
// contracts column — never stored, so the two can't drift apart. Returns null
// (meaning "the whole thing", today's behavior) when the entry declares
// nothing, when the declared count is not a positive number, or when the
// source carries no usable count to divide by.
function attributionWeight(entry, source) {
  const owned = Number(entry?.metadata?.contracts);
  const total = Number(source?.contracts);
  if (!Number.isFinite(owned) || owned <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const capped = Math.min(owned, total);
  return { weight: capped / total, owned: capped, total };
}
```

- [ ] **Step 4: Scale the closed-member builder**

Replace `fromTrade` in `src/lib/strategyBasket.js` (currently lines 58-77) with:

```js
function fromTrade(trade, role, attr = null) {
  const w = attr ? attr.weight : 1;
  const contracts = trade.contracts ?? null;
  return {
    status: "closed",
    role,
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: toIsoDate(trade.close_date ?? trade.closeDate) ?? trade.close ?? null,
    contracts: contracts == null ? null : contracts * w,
    capitalFronted: (trade.capital_fronted ?? trade.fronted ?? 0) * w,
    entryCost: trade.entry_cost ?? null,
    exitCost: trade.exit_cost ?? null,
    daysHeld: trade.days_held ?? trade.days ?? null,
    roi: trade.roi ?? null,
    keptPct: trade.kept_pct ?? null,
    realized: (trade.premium_collected ?? trade.premium ?? 0) * w,
    // {owned, total} when this member is a slice; null when it owns the trade whole.
    attribution: attr ? { owned: attr.owned, total: attr.total } : null,
  };
}
```

- [ ] **Step 5: Pass the weight through both closed-trade branches**

In `resolveBasket` (currently lines 122-131), replace the `tradeId` branch and the `closedMatch` branch:

```js
    const tradeId = entry.trade_id ?? entry.metadata?.trade_id;
    if (tradeId) {
      const t = trades.find(tr => tr.id === tradeId);
      if (t) { members.push(fromTrade(t, role, attributionWeight(entry, t))); continue; }
    }
    const openMatch = openPositions.find(p => tupleMatch(entry, p));
    if (openMatch) { members.push(fromOpenPosition(openMatch, role)); continue; }
    const closedMatch = trades.find(tr => tupleMatch(entry, tr));
    if (closedMatch) { members.push(fromTrade(closedMatch, role, attributionWeight(entry, closedMatch))); continue; }
```

- [ ] **Step 6: Add `attribution: null` to the two other member builders**

So every member has the field. In `fromOpenPosition`, add after `isCredit: pos.is_credit ?? null,`:

```js
    attribution: null,
```

In `fromDeclaredShares`, add after `realized: null,`:

```js
    attribution: null,
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js
```

Expected: PASS, all tests in the file (the 8 new ones plus every pre-existing one — the whole-trade path must be unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "feat(basket): scale closed members by metadata.contracts"
```

---

### Task 2: Scale open members too

**Files:**
- Modify: `src/lib/strategyBasket.js` (`fromOpenPosition`, `resolveBasket` open branch)
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing test**

Append inside `describe("resolveBasket", ...)`:

```js
  it("scales an open member, and its unrealized P/L follows the scaled contract count", () => {
    const open = [{ ticker: "IREN", type: "CC", strike: 50, expiry_date: "2026-08-21", contracts: 8, capital_fronted: 29600, entry_cost: 0.70, open_date: "2026-07-27" }];
    const e = [{ tags: ["strategy:w"], trade_id: null, ticker: "IREN", type: "CC", strike: 50, expiry: "2026-08-21", metadata: { contracts: 4 } }];
    const [m] = resolveBasket("strategy:w", { openPositions: open, trades: [], entries: e });
    expect(m).toMatchObject({ status: "open", entryCost: 0.70 });
    expect(m.contracts).toBeCloseTo(4, 6);
    expect(m.capitalFronted).toBeCloseTo(14800, 6);
    expect(m.attribution).toEqual({ owned: 4, total: 8 });

    // Short CC: (entry - mark) * contracts * 100 → (0.70 - 0.20) * 4 * 100 = 200
    const sym = buildOccSymbol("IREN", "2026-08-21", true, 50);
    const quoteMap = new Map([[sym, { mid: 0.20 }]]);
    expect(memberUnrealized(m, quoteMap)).toBeCloseTo(200, 6);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js -t "scales an open member"
```

Expected: FAIL — `contracts` is 8, `capitalFronted` is 29600, `memberUnrealized` returns 400.

- [ ] **Step 3: Scale the open-member builder**

Replace `fromOpenPosition` in `src/lib/strategyBasket.js` with:

```js
function fromOpenPosition(pos, role, attr = null) {
  const w = attr ? attr.weight : 1;
  const contracts = pos.contracts ?? null;
  return {
    status: "open",
    role,
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: contracts == null ? null : contracts * w,
    capitalFronted: (pos.capital_fronted ?? 0) * w,
    // Spreads carry the per-share price in `credit`, not `entry_cost`.
    entryCost: pos.entry_cost ?? pos.credit ?? null,
    realized: null,
    // Vertical-spread second leg (null on non-spreads) — needed to mark both legs.
    longStrike: pos.long_strike ?? null,
    right: pos.right ?? null,
    isCredit: pos.is_credit ?? null,
    attribution: attr ? { owned: attr.owned, total: attr.total } : null,
  };
}
```

- [ ] **Step 4: Pass the weight through the open branch**

In `resolveBasket`, replace the `openMatch` line:

```js
    const openMatch = openPositions.find(p => tupleMatch(entry, p));
    if (openMatch) { members.push(fromOpenPosition(openMatch, role, attributionWeight(entry, openMatch))); continue; }
```

- [ ] **Step 5: Run the whole file to verify it passes**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js
```

Expected: PASS. `memberUnrealized` needed no change — it multiplies by `member.contracts`, which is now scaled.

- [ ] **Step 6: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "feat(basket): scale open members and their mark-to-market by attribution"
```

---

### Task 3: Reducers and coverage warnings under attribution

No production code should be needed here — this task proves the reducers inherit the scaling. If a test fails, fix the reducer; do not adjust the expectation.

**Files:**
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the tests**

Append a new top-level `describe` block at the end of the file:

```js
describe("reducers under fractional attribution", () => {
  const trades = [
    { id: "glw-lot", ticker: "GLW", type: "Shares", strike: null, expiry_date: null, contracts: 100, close_date: "2026-08-07", premium_collected: 1650, capital_fronted: 14100 },
    { id: "glw-cc",  ticker: "GLW", type: "CC", strike: 157.5, expiry_date: "2026-08-07", contracts: 4, close_date: "2026-08-07", premium_collected: 2008, capital_fronted: 63512 },
  ];
  const entries = [
    { tags: ["strategy:f"], trade_id: "glw-lot", ticker: "GLW", type: "Shares", strike: null, expiry: null, metadata: { contracts: 25 } },
    { tags: ["strategy:f"], trade_id: "glw-cc",  ticker: "GLW", type: "CC", strike: 157.5, expiry: "2026-08-07", metadata: { contracts: 1 } },
  ];
  const members = resolveBasket("strategy:f", { openPositions: [], trades, entries });

  it("realizedRecovery sums the scaled slices", () => {
    // 1650 * 25/100 = 412.50 ; 2008 * 1/4 = 502.00
    expect(realizedRecovery(members)).toBeCloseTo(914.5, 6);
  });

  it("capitalDeployed counts open members only, so attributed closed legs add nothing", () => {
    expect(capitalDeployed(members)).toBe(0);
  });

  it("capitalDeployed scales an attributed OPEN member", () => {
    const open = [{ ticker: "IREN", type: "CC", strike: 50, expiry_date: "2026-08-21", contracts: 8, capital_fronted: 29600, entry_cost: 0.70 }];
    const e = [{ tags: ["strategy:d"], trade_id: null, ticker: "IREN", type: "CC", strike: 50, expiry: "2026-08-21", metadata: { contracts: 2 } }];
    expect(capitalDeployed(resolveBasket("strategy:d", { openPositions: open, trades: [], entries: e }))).toBeCloseTo(7400, 6);
  });

  it("shareCoverageWarnings compares scaled CCs against scaled shares", () => {
    // 2 of 8 CCs (200 shares) against a declared 300-share lot → covered, no warning.
    const open = [{ ticker: "GLW", type: "CC", strike: 160, expiry_date: "2026-08-07", contracts: 8, capital_fronted: 64000, entry_cost: 1.0 }];
    const e = [
      { tags: ["strategy:c"], trade_id: null, ticker: "GLW", type: "CC", strike: 160, expiry: "2026-08-07", metadata: { contracts: 2 } },
      { tags: ["strategy:c"], trade_id: null, ticker: "GLW", type: "Shares", strike: null, expiry: null, metadata: { shares: 300, basis: 150 } },
    ];
    expect(shareCoverageWarnings(resolveBasket("strategy:c", { openPositions: open, trades: [], entries: e }))).toEqual([]);
  });

  it("shareCoverageWarnings still fires when the scaled CCs exceed declared shares", () => {
    const open = [{ ticker: "GLW", type: "CC", strike: 160, expiry_date: "2026-08-07", contracts: 8, capital_fronted: 64000, entry_cost: 1.0 }];
    const e = [
      { tags: ["strategy:c2"], trade_id: null, ticker: "GLW", type: "CC", strike: 160, expiry: "2026-08-07", metadata: { contracts: 4 } },
      { tags: ["strategy:c2"], trade_id: null, ticker: "GLW", type: "Shares", strike: null, expiry: null, metadata: { shares: 300, basis: 150 } },
    ];
    const [w] = shareCoverageWarnings(resolveBasket("strategy:c2", { openPositions: open, trades: [], entries: e }));
    expect(w).toMatchObject({ ticker: "GLW", declaredShares: 300, ccContracts: 4, coveredShares: 400 });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js
```

Expected: PASS with no production changes. If `shareCoverageWarnings` fails, the bug is real — fix it there, not in the test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/strategyBasket.test.js
git commit -m "test(basket): cover reducers and share coverage under attribution"
```

---

### Task 4: `groupMembersByType` helper

**Files:**
- Modify: `src/lib/strategyBasket.js` (append near `shareCoverageWarnings`)
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing test**

Add the import at the top of the test file — replace the existing import line with:

```js
import { resolveBasket, basketTarget, capitalDeployed, realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual, shareCoverageWarnings, groupMembersByType } from "../strategyBasket";
```

Then append a new top-level `describe` at the end of the file:

```js
describe("groupMembersByType", () => {
  const mk = (type, ticker = "X") => ({ type, ticker, status: "closed", role: "recovery" });

  it("groups members by type in a fixed display order", () => {
    const groups = groupMembersByType([mk("Shares"), mk("CSP"), mk("CC"), mk("CSP")]);
    expect(groups.map(g => g.type)).toEqual(["CC", "CSP", "Shares"]);
    expect(groups.find(g => g.type === "CSP").members).toHaveLength(2);
  });

  it("preserves the incoming order within a group", () => {
    const a = mk("CSP", "AAA"), b = mk("CSP", "BBB");
    expect(groupMembersByType([b, a]).find(g => g.type === "CSP").members).toEqual([b, a]);
  });

  it("sorts unknown types after the known ones, alphabetically", () => {
    const groups = groupMembersByType([mk("Zebra"), mk("CC"), mk("Apple")]);
    expect(groups.map(g => g.type)).toEqual(["CC", "Apple", "Zebra"]);
  });

  it("buckets a null type as Other", () => {
    expect(groupMembersByType([mk(null)]).map(g => g.type)).toEqual(["Other"]);
  });

  it("returns an empty array for no members", () => {
    expect(groupMembersByType([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js -t "groupMembersByType"
```

Expected: FAIL — `groupMembersByType is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/strategyBasket.js`, after `shareCoverageWarnings`:

```js
// Display order for type groups in the transactions table. Anything not listed
// (a future type, or a null) sorts after these, alphabetically.
const TYPE_DISPLAY_ORDER = ["CC", "CSP", "Shares", "LEAPS", "Spread"];

/**
 * Bucket members by type for the transactions table, in a stable display order.
 * Order WITHIN each bucket is the order they arrived in, so an active column
 * sort upstream is preserved.
 * @returns {Array<{type: string, members: Array}>}
 */
export function groupMembersByType(members) {
  const byType = new Map();
  for (const m of members) {
    const key = m.type ?? "Other";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(m);
  }
  const rank = (t) => {
    const i = TYPE_DISPLAY_ORDER.indexOf(t);
    return i === -1 ? TYPE_DISPLAY_ORDER.length : i;
  };
  return [...byType.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || String(a[0]).localeCompare(String(b[0])))
    .map(([type, ms]) => ({ type, members: ms }));
}
```

- [ ] **Step 4: Run the full test file**

```bash
npx vitest run src/lib/__tests__/strategyBasket.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "feat(basket): add groupMembersByType for the transactions table"
```

---

### Task 5: "Attribute a closed trade" form

**Files:**
- Modify: `src/components/StrategyBasketTab.jsx`

There is no test in this task: `vitest` has no DOM harness in this repo and local `vite` does not serve `/api/*`, so the form cannot be exercised locally. It is verified after deploy (Task 8).

- [ ] **Step 1: Show cents when an amount is not whole**

Fractional slices produce half-dollar amounts, and rounding `$212.50` to `$213` in a "quarter of" context reads as a bug. Replace `fmtMoney` at `src/components/StrategyBasketTab.jsx:16-20`:

```js
function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  // Fractional attributions land on half dollars; show cents only when they exist.
  const isWhole = Math.abs(abs - Math.round(abs)) < 0.005;
  const body = isWhole
    ? Math.round(abs).toLocaleString()
    : abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${body}`;
}
```

- [ ] **Step 2: Add a count formatter**

Append directly below `fmtMoney`:

```js
// Attributed counts can be fractional after scaling (25 of a 100-share lot);
// show a decimal only when there is one. 4 → "4", 4.5 → "4.5".
function fmtCount(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
```

- [ ] **Step 3: Add the form state and derived trade lists**

In `StrategyBasketTab`, directly after the `submitAddShares` function (ends at line 146):

```js
  // "Attribute a closed trade" affordance state — claims a slice (N of M) of a
  // blended trade for this basket.
  const [showAttribute, setShowAttribute] = useState(false);
  const [attrForm, setAttrForm] = useState({ ticker: "", tradeId: "", count: "" });
  const [attrBusy, setAttrBusy] = useState(false);
  const [attrError, setAttrError] = useState(null);

  // Only trades with a positive contract count can be sliced — there is no
  // denominator otherwise, and the resolver would silently take them whole.
  const attributableTickers = useMemo(() => {
    const set = new Set();
    for (const t of (trades ?? [])) if (Number(t.contracts) > 0) set.add(t.ticker);
    return [...set].sort();
  }, [trades]);

  const attributableTrades = useMemo(() => {
    if (!attrForm.ticker) return [];
    return (trades ?? [])
      .filter(t => t.ticker === attrForm.ticker && Number(t.contracts) > 0)
      .sort((a, b) => String(b.close_date ?? "").localeCompare(String(a.close_date ?? "")))
      .slice(0, 40);
  }, [trades, attrForm.ticker]);

  const attrTrade = attributableTrades.find(t => t.id === attrForm.tradeId) ?? null;
  const attrCount = Number(attrForm.count);
  const attrValid = attrTrade != null && Number.isFinite(attrCount)
    && attrCount > 0 && attrCount <= Number(attrTrade.contracts);
  const attrPreview = attrValid
    ? (attrTrade.premium ?? 0) * attrCount / Number(attrTrade.contracts)
    : null;

  const submitAttribution = async () => {
    if (!activeTag) { setAttrError("No active basket tag."); return; }
    if (!attrTrade) { setAttrError("Pick a trade."); return; }
    const total = Number(attrTrade.contracts);
    if (!attrValid) { setAttrError(`Enter a count between 1 and ${total}.`); return; }
    setAttrBusy(true);
    setAttrError(null);
    try {
      const unit = attrTrade.type === "Shares" ? "shares" : "contracts";
      await createJournalEntry({
        entry_type: "position_note",
        ticker: attrTrade.ticker,
        type: attrTrade.type,
        strike: attrTrade.strike ?? null,
        expiry: attrTrade.expiry_date ?? null,
        entry_date: new Date().toISOString().slice(0, 10),
        trade_id: attrTrade.id,
        tags: [activeTag],
        body: `Attributed ${attrCount} of ${total} ${unit} to the basket (${fmtMoney(attrPreview)}).`,
        source: "Self",
        metadata: { contracts: attrCount },
      });
      setAttrForm({ ticker: "", tradeId: "", count: "" });
      setShowAttribute(false);
      if (onEntriesChanged) await onEntriesChanged();
    } catch (err) {
      setAttrError(err.message || "Failed to attribute trade.");
    } finally {
      setAttrBusy(false);
    }
  };

  // "CC $157.50 · 08/07 · 4 ct · +$2,008"
  const attrTradeLabel = (t) => {
    const strike = t.strike != null ? `$${t.strike} · ` : "";
    const unit = t.type === "Shares" ? "sh" : "ct";
    return `${t.type} ${strike}${fmtDate(t.close_date)} · ${t.contracts} ${unit} · ${fmtMoney(t.premium ?? 0)}`;
  };
```

- [ ] **Step 4: Render the form**

Line numbers below shifted when Step 3 inserted code — locate by content. Find the `+ Add assigned shares` button and add a sibling button immediately after it, inside the same flex row:

```jsx
          <button onClick={() => { setShowAttribute(v => !v); setAttrError(null); }} style={{
            padding: "4px 10px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
            background: "transparent", color: theme.text.secondary,
            border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
          }}>+ Attribute a closed trade</button>
```

Then, immediately after the closing `)}` of the existing `{showAddShares && ( ... )}` block — the one ending with the "Basis = full assignment strike" hint — add:

```jsx
        {showAttribute && (
          <div style={{
            display: "flex", gap: theme.space[2], alignItems: "center", flexWrap: "wrap",
            marginTop: theme.space[2], padding: theme.space[3],
            background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.md,
          }}>
            <select value={attrForm.ticker}
              onChange={e => setAttrForm({ ticker: e.target.value, tradeId: "", count: "" })}
              style={{
                width: 100, padding: "6px 8px", fontSize: theme.size.sm, fontFamily: "inherit",
                background: theme.bg.elevated, color: theme.text.primary,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
              }}>
              <option value="">Ticker…</option>
              {attributableTickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={attrForm.tradeId} disabled={!attrForm.ticker}
              onChange={e => setAttrForm(f => ({ ...f, tradeId: e.target.value, count: "" }))}
              style={{
                flex: "1 1 280px", minWidth: 0, padding: "6px 8px", fontSize: theme.size.sm, fontFamily: "inherit",
                background: theme.bg.elevated, color: theme.text.primary,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
                opacity: attrForm.ticker ? 1 : 0.5,
              }}>
              <option value="">{attrForm.ticker ? "Trade…" : "Pick a ticker first"}</option>
              {attributableTrades.map(t => <option key={t.id} value={t.id}>{attrTradeLabel(t)}</option>)}
            </select>
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>I own</span>
            <input value={attrForm.count} placeholder="N" inputMode="decimal" disabled={!attrTrade}
              onChange={e => setAttrForm(f => ({ ...f, count: e.target.value }))}
              style={{
                width: 56, padding: "6px 8px", fontSize: theme.size.sm, fontFamily: theme.font.mono,
                background: theme.bg.elevated, color: theme.text.primary,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
                opacity: attrTrade ? 1 : 0.5,
              }} />
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
              of {attrTrade ? `${attrTrade.contracts} ${attrTrade.type === "Shares" ? "sh" : "ct"}` : "—"}
            </span>
            <span style={{
              fontSize: theme.size.sm, fontFamily: theme.font.mono,
              color: attrPreview == null ? theme.text.subtle : attrPreview >= 0 ? theme.green : theme.red,
            }}>→ {attrPreview == null ? "—" : fmtMoney(attrPreview)}</span>
            <button onClick={submitAttribution} disabled={attrBusy || !attrValid} style={{
              padding: "6px 12px", fontSize: theme.size.sm, fontFamily: "inherit",
              cursor: (attrBusy || !attrValid) ? "default" : "pointer",
              background: theme.bg.elevated, color: theme.blue,
              border: `1px solid ${theme.blue}`, borderRadius: theme.radius.sm,
              opacity: (attrBusy || !attrValid) ? 0.6 : 1,
            }}>{attrBusy ? "Adding…" : "Add to basket"}</button>
            <button onClick={() => { setShowAttribute(false); setAttrError(null); }} disabled={attrBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
              background: "transparent", color: theme.text.muted,
              border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
            }}>Cancel</button>
            <span style={{ flexBasis: "100%", fontSize: theme.size.xs, color: attrError ? theme.red : theme.text.subtle }}>
              {attrError || "The basket is credited this share of the trade's P/L. The trade's own contract count is the denominator — it is never stored, so the two can't drift."}
            </span>
          </div>
        )}
```

- [ ] **Step 5: Verify it builds**

```bash
npm run build
```

Expected: build succeeds, no unresolved-import or syntax errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/StrategyBasketTab.jsx
git commit -m "feat(basket): add 'attribute a closed trade' form"
```

---

### Task 6: Type-grouped transactions table

**Files:**
- Modify: `src/components/StrategyBasketTab.jsx`

- [ ] **Step 1: Import the helper and `Fragment`**

Change line 1:

```js
import { Fragment, useMemo, useState } from "react";
```

Add `groupMembersByType` to the `strategyBasket` import block (lines 7-11):

```js
import {
  resolveBasket, basketTarget, capitalDeployed,
  realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual,
  shareCoverageWarnings, groupMembersByType,
} from "../lib/strategyBasket";
```

- [ ] **Step 2: Show the slice in the Detail column**

Inside `Row`, replace the `detail` assignment (currently lines 425-427):

```js
              const sliceLabel = m.attribution
                ? `${fmtCount(m.attribution.owned)} of ${fmtCount(m.attribution.total)} ${m.type === "Shares" ? "sh" : "ct"} · `
                : "";
              const detail = m.role === "baseline"
                ? "Baseline loss"
                : `${strikeLabel != null ? `${strikeLabel} · ` : ""}${sliceLabel}${open ? "open" : "closed"}${pctOfTarget}`;
```

- [ ] **Step 3: Add the type-subtotal label**

Directly after the `GroupLabel` definition (ends line 412), add:

```jsx
            // Per-type subtotal inside an Open/Closed group. G/L means
            // mark-to-market for open rows and realized for closed ones, which
            // is why the Open/Closed split stays the OUTER grouping — a
            // subtotal spanning both would be meaningless.
            const TypeLabel = (type, count, subtotal) => (
              <div style={{
                display: "flex", gap: theme.space[2], alignItems: "center",
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                background: theme.bg.base, fontSize: theme.size.xs, letterSpacing: "0.4px",
              }}>
                <span style={{ color: TYPE_COLORS[type]?.text ?? theme.text.secondary }}>{type}</span>
                <span style={{ color: theme.text.subtle }}>· {count}</span>
                <span style={{
                  marginLeft: "auto", fontFamily: theme.font.mono,
                  color: subtotal >= 0 ? theme.green : theme.red,
                }}>{fmtMoney(subtotal)}</span>
              </div>
            );

            // One Open/Closed section: its label, then a labelled subtotal per
            // type. A section holding a single type needs no per-type header.
            const Section = (label, list) => {
              if (list.length === 0) return null;
              const groups = groupMembersByType(list);
              const subtotal = (ms) => ms.reduce((s, m) => s + (derive(m).gl ?? 0), 0);
              return (
                <>
                  {showGroupLabels && GroupLabel(label, list.length)}
                  {groups.map(({ type, members: ms }) => (
                    <Fragment key={`${label}-${type}`}>
                      {groups.length > 1 && TypeLabel(type, ms.length, subtotal(ms))}
                      {ms.map(Row)}
                    </Fragment>
                  ))}
                </>
              );
            };
```

- [ ] **Step 4: Render through the sections**

Replace the four render lines (currently 463-466):

```jsx
                {Section("Open", openRecovery)}
                {Section("Closed", closedRecovery)}
```

- [ ] **Step 5: Verify it builds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: PASS across the whole repo — no other suite touches these files, so a failure elsewhere is a real regression.

- [ ] **Step 7: Commit**

```bash
git add src/components/StrategyBasketTab.jsx
git commit -m "feat(basket): group transactions by type with per-group subtotals"
```

---

### Task 7: Version bump, push, deploy

**Files:**
- Modify: `package.json`, `src/lib/constants.js:35`

- [ ] **Step 1: Re-confirm the baseline from main**

```bash
git show origin/main:package.json | grep '"version"'
```

Expected: `1.176.0`. If it is higher, bump the minor from THAT number instead — this repo uses worktrees, the local file can lag, and PR #185 already moved this target once mid-planning.

- [ ] **Step 2: Bump both files to 1.177.0**

In `package.json`, set `"version": "1.177.0"`. In `src/lib/constants.js:35`, set `export const VERSION = "1.177.0";`.

- [ ] **Step 3: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: v1.177.0 — fractional attribution for strategy baskets"
git push origin main
```

Expected: push succeeds. The change is not done until this completes.

- [ ] **Step 4: Confirm the deploy**

Wait for the Vercel production deploy, then load the dashboard and confirm the footer shows `v1.176.0`.

---

### Task 8: Load the nine attributions

Data only — no deploy, no version bump. Runs against Supabase project `bzfhheqqkwqqwsiqyqzk` after Task 7 is live.

- [ ] **Step 1: Verify the target trades still carry the expected counts**

```sql
select id, ticker, type, strike, expiry_date, contracts, close_date, premium_collected
from trades
where id in (
  'ac6b36fd-d391-4230-be1b-f05db932597a','b3de308e-917d-40d7-be7b-e944523b7e53',
  '8f3ddea7-eb09-428a-a752-7ba35d8e65f1','c67642a7-cdf3-4e3b-afa2-27e86ec81a5f',
  '535ed37d-adff-4ef4-8bab-d1f202edab69','72c802b6-fef5-4c9c-b1ac-99432fdeefa0',
  'd9a02ebe-0d95-487c-be2c-ba0093fd051f','e27264a6-565b-41c8-bc6c-85e110f93e8d'
) order by ticker, close_date;
```

Expected: 8 rows. The four GLW Shares lots have `contracts = 100`, both GLW CCs `4`, DRAM `12`, IREN `8`. **If any count differs, stop** — the premium totals in Step 2 were computed against these and the credits would be wrong.

Note `8791840b-498d-4bc9-b8ab-27da65b45b00` is deliberately absent: it is a $141-basis GLW Shares row opened *and* closed on 8/03 with zero P/L, a same-day assignment artifact superseded by `c67642a7`. Do not tag it.

- [ ] **Step 2: Insert the eight new entries**

```sql
insert into journal_entries
  (entry_type, ticker, type, strike, expiry, entry_date, trade_id, tags, source, body, metadata)
values
  ('position_note','GLW','Shares',null,null,'2026-08-07','ac6b36fd-d391-4230-be1b-f05db932597a',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 25 of 100 shares to the basket ($165.00 basis lot, -$187.50).','{"contracts":25}'::jsonb),
  ('position_note','GLW','Shares',null,null,'2026-08-07','b3de308e-917d-40d7-be7b-e944523b7e53',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 25 of 100 shares to the basket ($167.50 basis lot, -$250.00).','{"contracts":25}'::jsonb),
  ('position_note','GLW','Shares',null,null,'2026-08-07','8f3ddea7-eb09-428a-a752-7ba35d8e65f1',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 25 of 100 shares to the basket ($148.00 basis lot, +$237.50).','{"contracts":25}'::jsonb),
  ('position_note','GLW','Shares',null,null,'2026-08-07','c67642a7-cdf3-4e3b-afa2-27e86ec81a5f',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 25 of 100 shares to the basket ($141.00 basis lot, +$412.50).','{"contracts":25}'::jsonb),
  ('position_note','GLW','CC',160,'2026-08-07','2026-08-07','535ed37d-adff-4ef4-8bab-d1f202edab69',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 1 of 4 contracts to the basket (+$257.00).','{"contracts":1}'::jsonb),
  ('position_note','GLW','CC',157.5,'2026-08-07','2026-08-07','72c802b6-fef5-4c9c-b1ac-99432fdeefa0',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 1 of 4 contracts to the basket (+$502.00).','{"contracts":1}'::jsonb),
  ('position_note','DRAM','CC',63,'2026-08-28','2026-08-07','d9a02ebe-0d95-487c-be2c-ba0093fd051f',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 4 of 12 contracts to the basket (+$580.00).','{"contracts":4}'::jsonb),
  ('position_note','IREN','CC',50,'2026-08-21','2026-08-07','e27264a6-565b-41c8-bc6c-85e110f93e8d',
   array['strategy:sofi-makeup']::text[],'Self',
   'Attributed 4 of 8 contracts to the basket (+$256.00).','{"contracts":4}'::jsonb);
```

- [ ] **Step 3: Amend the IREN entry that is already in the basket at full value**

This entry exists and currently credits the basket the whole $560. It must be amended, never duplicated.

```sql
update journal_entries
set metadata = coalesce(metadata, '{}'::jsonb) || '{"contracts":4}'::jsonb,
    body = 'Retroactively tagged into SOFI makeup basket — IREN CC $50 exp 8/21, 4 of 8 contracts (+$280.00).'
where id = '1c31ffdf-b4ce-45f6-be1e-119468145fb3';
```

- [ ] **Step 4: Verify every attribution resolves and totals correctly**

```sql
select j.ticker, j.type, t.contracts as total,
       (j.metadata->>'contracts')::numeric as owned,
       t.premium_collected as full_pl,
       round(t.premium_collected * (j.metadata->>'contracts')::numeric / t.contracts, 2) as credited
from journal_entries j
join trades t on t.id = j.trade_id
where j.tags && array['strategy:sofi-makeup']::text[]
  and j.metadata ? 'contracts'
order by j.ticker, t.close_date;
```

Expected: 9 rows, every `credited` matching the spec's table — GLW -187.50 / -250.00 / +237.50 / +412.50 / +257.00 / +502.00, DRAM +580.00, IREN +280.00 / +256.00. Sum: **+$2,087.50**. No null `total` (that would mean the resolver takes the trade whole).

- [ ] **Step 5: Verify on the dashboard**

Open the Strategy Basket tab on `strategy:sofi-makeup`:

1. The nine rows appear with their slice in the Detail column ("4 of 12 ct").
2. Rows are grouped by type within Open and Closed, each type group showing a subtotal.
3. These nine entries now contribute **+$2,087.50**. Only one of them was in the basket before — the IREN entry, at its full $560 — so Realized recovery should move by **+$1,527.50** net. Record the before/after.
4. Open the "+ Attribute a closed trade" form, pick a ticker and a trade, type a count, and confirm the live preview matches `premium × count / contracts`. Cancel without submitting.

---

## Rollback

Every change is additive. To undo the data:

```sql
delete from journal_entries
where tags && array['strategy:sofi-makeup']::text[]
  and metadata ? 'contracts'
  and id <> '1c31ffdf-b4ce-45f6-be1e-119468145fb3';

update journal_entries set metadata = metadata - 'contracts'
where id = '1c31ffdf-b4ce-45f6-be1e-119468145fb3';
```

Entries with no `metadata.contracts` resolve whole, exactly as before, so reverting the data alone restores the previous numbers without reverting the code.
