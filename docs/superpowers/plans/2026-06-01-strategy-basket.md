# Strategy Basket View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tag-driven "Baskets" view that aggregates positions and closed trades carrying a `strategy:*` tag and tracks realized recovery against a derived loss baseline (first use: `strategy:sofi-makeup` recovering the −$26,400 SOFI shares loss).

**Architecture:** A pure, unit-tested resolution library (`src/lib/strategyBasket.js`) turns tagged journal entries + flat position/trade arrays into a normalized member list and reducer metrics. A React tab (`src/components/StrategyBasketTab.jsx`) flattens `DataContext` positions, calls the library, marks open members live via `useQuotes()`, and renders summary cards, a progress bar, an unrealized-cushion line, and a transaction log. Registered as a new explore sub-view, reachable from the chip nav and (final task) from clicking a `strategy:` tag chip on a position row.

**Tech Stack:** React (function components, lazy-loaded), Vitest (`environment: node`, pure-lib tests only — no component test infra in this repo), inline `style={{}}` + `theme` tokens, Supabase journal API.

---

## Design Notes Locked Before Coding

- **Long/short marking convention** (for unrealized cushion): `LEAPS` = long call (you paid `entry_cost`), `CSP` = short put, `CC` = short call (you collected `entry_cost` as credit). PnL while open:
  - Long option: `(mark − entryCost) × contracts × 100`
  - Short option: `(entryCost − mark) × contracts × 100`
- **`entry_cost`** is the per-contract option price (e.g. `1.44`), not a dollar total.
- **`premium_collected`** on a closed trade holds its realized P/L in **dollars** (the loss trade is `−26400`).
- **Member resolution priority (v1):** `trade_id` → closed trade; else tuple `ticker|type|strike|expiry` → open position, then closed trade. `position_id` matching is intentionally omitted in v1 — no current data uses it, and the reshaped position object's `id` availability is unverified. (Deviates from spec step 2 deliberately; documented here.)
- **`buildOccSymbol(ticker, expiryIso, isCall, strike)`** already exists in `src/lib/trading.js:34`. `isCall` is `true` for `LEAPS`/`CC`, `false` for `CSP`.

---

## File Structure

- **Create** `src/lib/strategyBasket.js` — pure resolution + reducers + live-marking. One responsibility: turn data into basket metrics. No React, no fetch.
- **Create** `src/lib/__tests__/strategyBasket.test.js` — unit tests for the above.
- **Create** `src/components/StrategyBasketTab.jsx` — the view. Flattens positions, wires quotes + journal entries, renders UI.
- **Modify** `src/lib/modes.js` — register `baskets` explore sub-view + label.
- **Modify** `src/lib/__tests__/modes.test.js` (create if absent) — assert `baskets` validity.
- **Modify** `src/components/ExploreView.jsx` — lazy-import and render `StrategyBasketTab`; accept + forward a `basketTag` deep-link prop.
- **Modify** `src/App.jsx` — hold `basketTag` state, expose a navigate-to-basket handler, pass it down.
- **Modify** `src/components/OpenPositionsTab.jsx` — make `strategy:` tag chips call the navigate-to-basket handler.

---

## Task 1: Basket resolution + reducers (pure lib)

**Files:**
- Create: `src/lib/strategyBasket.js`
- Test: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/strategyBasket.test.js
import { describe, it, expect } from "vitest";
import { resolveBasket, basketTarget, capitalDeployed, realizedRecovery } from "../strategyBasket";

const openPositions = [
  { ticker: "SOFI", type: "LEAPS", strike: 15,  expiry_date: "2027-01-21", contracts: 20, capital_fronted: 8000, entry_cost: 4.0, open_date: "2026-06-01" },
  { ticker: "COHR", type: "CSP",   strike: 310, expiry_date: "2026-07-02", contracts: 1,  capital_fronted: 31000, entry_cost: 6.0, open_date: "2026-06-01" },
];
const trades = [
  { id: "loss-1", ticker: "SOFI", type: "Shares", subtype: "Sold", strike: null, expiry_date: null, contracts: 3300, open_date: "2026-02-12", close_date: "2026-06-01", premium_collected: -26400, capital_fronted: 85800, entry_cost: 26 },
  { id: "rec-1",  ticker: "COHR", type: "CSP", subtype: "Close", strike: 310, expiry_date: "2026-07-02", contracts: 1, open_date: "2026-05-01", close_date: "2026-05-20", premium_collected: 450, capital_fronted: 31000, entry_cost: 6.0 },
];
const entries = [
  { tags: ["strategy:sofi-makeup", "role:makeup-baseline"], trade_id: "loss-1", ticker: "SOFI", type: "Shares", strike: null, expiry: null },
  { tags: ["strategy:sofi-makeup"], trade_id: null, ticker: "SOFI", type: "LEAPS", strike: 15, expiry: "2027-01-21" },
  { tags: ["strategy:sofi-makeup"], trade_id: null, ticker: "COHR", type: "CSP", strike: 310, expiry: "2026-07-02" },
];

describe("resolveBasket", () => {
  it("splits baseline vs recovery and resolves by trade_id and tuple", () => {
    const members = resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries });
    expect(members).toHaveLength(3);
    const baseline = members.find(m => m.role === "baseline");
    expect(baseline).toMatchObject({ status: "closed", ticker: "SOFI", realized: -26400 });
    const leaps = members.find(m => m.ticker === "SOFI" && m.type === "LEAPS");
    expect(leaps).toMatchObject({ status: "open", role: "recovery", capitalFronted: 8000, entryCost: 4.0, contracts: 20 });
    const cohr = members.find(m => m.ticker === "COHR");
    expect(cohr).toMatchObject({ status: "open", role: "recovery" });
  });

  it("ignores entries that do not carry the tag", () => {
    const extra = [...entries, { tags: ["strategy:other"], trade_id: null, ticker: "AAPL", type: "CSP", strike: 100, expiry: "2026-07-02" }];
    expect(resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries: extra })).toHaveLength(3);
  });

  it("matches a closed recovery trade by tuple when no open position exists", () => {
    const e = [{ tags: ["strategy:x"], trade_id: null, ticker: "COHR", type: "CSP", strike: 310, expiry: "2026-07-02" }];
    const members = resolveBasket("strategy:x", { openPositions: [], trades, entries: e });
    expect(members[0]).toMatchObject({ status: "closed", role: "recovery", realized: 450 });
  });
});

describe("reducers", () => {
  const members = resolveBasket("strategy:sofi-makeup", { openPositions, trades, entries });
  it("basketTarget = abs of baseline realized", () => {
    expect(basketTarget(members)).toBe(26400);
  });
  it("capitalDeployed = sum of open recovery capitalFronted", () => {
    expect(capitalDeployed(members)).toBe(39000);
  });
  it("realizedRecovery = sum of closed recovery realized (zero here, all open)", () => {
    expect(realizedRecovery(members)).toBe(0);
  });
  it("realizedRecovery counts closed recovery members", () => {
    const closedRec = [{ status: "closed", role: "recovery", realized: 450 }, { status: "closed", role: "baseline", realized: -26400 }];
    expect(realizedRecovery(closedRec)).toBe(450);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: FAIL — "Failed to resolve import ../strategyBasket" / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/strategyBasket.js
// Pure basket resolution: tagged journal entries + flat position/trade arrays
// → normalized member list and reducer metrics. No React, no fetch, no quotes.

const BASELINE_TAG = "role:makeup-baseline";

function tupleMatch(a, b) {
  return (
    a.ticker === b.ticker &&
    String(a.type) === String(b.type) &&
    Number(a.strike) === Number(b.strike) &&
    String(a.expiry ?? a.expiry_date) === String(b.expiry ?? b.expiry_date)
  );
}

function fromOpenPosition(pos, role) {
  return {
    status: "open",
    role,
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: pos.contracts ?? null,
    capitalFronted: pos.capital_fronted ?? 0,
    entryCost: pos.entry_cost ?? null,
    realized: null,
  };
}

function fromTrade(trade, role) {
  return {
    status: "closed",
    role,
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: trade.close_date ?? null,
    contracts: trade.contracts ?? null,
    capitalFronted: trade.capital_fronted ?? 0,
    entryCost: trade.entry_cost ?? null,
    realized: trade.premium_collected ?? 0,
  };
}

/**
 * Resolve a strategy tag into a normalized member list.
 * @param {string} tag
 * @param {{openPositions: Array, trades: Array, entries: Array}} sources
 * @returns {Array} normalized members
 */
export function resolveBasket(tag, { openPositions = [], trades = [], entries = [] }) {
  const members = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.tags) || !entry.tags.includes(tag)) continue;
    const role = entry.tags.includes(BASELINE_TAG) ? "baseline" : "recovery";

    if (entry.trade_id) {
      const t = trades.find(tr => tr.id === entry.trade_id);
      if (t) { members.push(fromTrade(t, role)); continue; }
    }
    const openMatch = openPositions.find(p => tupleMatch(entry, p));
    if (openMatch) { members.push(fromOpenPosition(openMatch, role)); continue; }
    const closedMatch = trades.find(tr => tupleMatch(entry, tr));
    if (closedMatch) { members.push(fromTrade(closedMatch, role)); continue; }
    // Unresolved entry (tag points at nothing in current data) — skip silently.
  }
  return members;
}

export function basketTarget(members) {
  return members
    .filter(m => m.role === "baseline" && m.status === "closed")
    .reduce((sum, m) => sum + Math.abs(m.realized ?? 0), 0);
}

export function capitalDeployed(members) {
  return members
    .filter(m => m.role === "recovery" && m.status === "open")
    .reduce((sum, m) => sum + (m.capitalFronted ?? 0), 0);
}

export function realizedRecovery(members) {
  return members
    .filter(m => m.role === "recovery" && m.status === "closed")
    .reduce((sum, m) => sum + (m.realized ?? 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "feat: add strategy-basket resolution and reducers"
```

---

## Task 2: Unrealized cushion (live marking, pure)

**Files:**
- Modify: `src/lib/strategyBasket.js`
- Modify: `src/lib/__tests__/strategyBasket.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/strategyBasket.test.js`:

```js
import { unrealizedCushion } from "../strategyBasket";
import { buildOccSymbol } from "../trading";

describe("unrealizedCushion", () => {
  const longLeaps  = { status: "open", role: "recovery", ticker: "SOFI", type: "LEAPS", strike: 15,  expiry: "2027-01-21", contracts: 20, entryCost: 4.0 };
  const shortCsp   = { status: "open", role: "recovery", ticker: "COHR", type: "CSP",   strike: 310, expiry: "2026-07-02", contracts: 1,  entryCost: 6.0 };
  const leapsSym = buildOccSymbol("SOFI", "2027-01-21", true,  15);
  const cspSym   = buildOccSymbol("COHR", "2026-07-02", false, 310);

  it("long option gains when mark > entry, short option gains when mark < entry", () => {
    const quoteMap = new Map([
      [leapsSym, { mid: 5.0 }],   // long: (5.0-4.0)*20*100 = 2000
      [cspSym,   { mid: 4.0 }],   // short: (6.0-4.0)*1*100 = 200
    ]);
    const { total, marked, unmarked } = unrealizedCushion([longLeaps, shortCsp], quoteMap);
    expect(total).toBe(2200);
    expect(marked).toBe(2);
    expect(unmarked).toBe(0);
  });

  it("falls back to last, and counts unmarked members without blocking the total", () => {
    const quoteMap = new Map([[leapsSym, { last: 4.5 }]]); // long: (4.5-4.0)*20*100 = 1000; csp unmarked
    const { total, marked, unmarked } = unrealizedCushion([longLeaps, shortCsp], quoteMap);
    expect(total).toBe(1000);
    expect(marked).toBe(1);
    expect(unmarked).toBe(1);
  });

  it("only marks open recovery members", () => {
    const baseline = { status: "closed", role: "baseline", ticker: "SOFI", type: "Shares" };
    const { total, marked } = unrealizedCushion([baseline], new Map());
    expect(total).toBe(0);
    expect(marked).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: FAIL — `unrealizedCushion` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/strategyBasket.js`:

```js
import { buildOccSymbol } from "./trading";

const SHORT_TYPES = new Set(["CSP", "CC"]);
const LONG_OPTION_TYPES = new Set(["LEAPS"]);

function markFor(member, quoteMap) {
  const isCall = member.type === "LEAPS" || member.type === "CC";
  const sym = buildOccSymbol(member.ticker, member.expiry, isCall, member.strike);
  const q = quoteMap.get(sym);
  if (!q) return null;
  return q.mid ?? q.last ?? null;
}

/**
 * Live mark-to-market cushion for open recovery members.
 * @returns {{total:number, marked:number, unmarked:number}}
 */
export function unrealizedCushion(members, quoteMap) {
  let total = 0, marked = 0, unmarked = 0;
  for (const m of members) {
    if (m.status !== "open" || m.role !== "recovery") continue;
    if (!LONG_OPTION_TYPES.has(m.type) && !SHORT_TYPES.has(m.type)) { continue; }
    const mark = markFor(m, quoteMap);
    if (mark == null) { unmarked += 1; continue; }
    const mult = (m.contracts ?? 0) * 100;
    const pnl = SHORT_TYPES.has(m.type)
      ? (m.entryCost - mark) * mult
      : (mark - m.entryCost) * mult;
    total += pnl;
    marked += 1;
  }
  return { total, marked, unmarked };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/strategyBasket.test.js`
Expected: PASS (all cases including Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/lib/strategyBasket.js src/lib/__tests__/strategyBasket.test.js
git commit -m "feat: add unrealized cushion marking to strategy basket"
```

---

## Task 3: Register `baskets` explore sub-view

**Files:**
- Modify: `src/lib/modes.js:5` (EXPLORE_SUBVIEWS) and `src/lib/modes.js:11-19` (SUBVIEW_LABELS)
- Test: `src/lib/__tests__/modes.test.js` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/modes.test.js` (or append the `it` block if the file exists):

```js
import { describe, it, expect } from "vitest";
import { EXPLORE_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../modes";

describe("baskets sub-view registration", () => {
  it("is a valid explore sub-view with a label", () => {
    expect(EXPLORE_SUBVIEWS).toContain("baskets");
    expect(SUBVIEW_LABELS.baskets).toBe("Baskets");
    expect(isValidSubView("explore", "baskets")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/modes.test.js`
Expected: FAIL — `EXPLORE_SUBVIEWS` does not contain `"baskets"`.

- [ ] **Step 3: Make it pass**

In `src/lib/modes.js`, add `"baskets"` to the end of `EXPLORE_SUBVIEWS`:

```js
export const EXPLORE_SUBVIEWS = ["positions", "tickers", "radar", "earnings", "macro", "baskets"];
```

And add to `SUBVIEW_LABELS`:

```js
  macro:     "Macro",
  baskets:   "Baskets",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/modes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modes.js src/lib/__tests__/modes.test.js
git commit -m "feat: register baskets explore sub-view"
```

---

## Task 4: StrategyBasketTab component

No component-test infra exists (Vitest is `environment: node`, no testing-library). Verify in the browser via the preview workflow.

**Files:**
- Create: `src/components/StrategyBasketTab.jsx`

- [ ] **Step 1: Write the component**

```jsx
// src/components/StrategyBasketTab.jsx
import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { theme } from "../lib/theme";
import { TYPE_COLORS } from "../lib/constants";
import { getOpenCSPs, getOpenCCs, getOpenLEAPs } from "../lib/positionSchema";
import {
  resolveBasket, basketTarget, capitalDeployed,
  realizedRecovery, unrealizedCushion,
} from "../lib/strategyBasket";

const STRATEGY_PREFIX = "strategy:";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

function flattenOpen(positions) {
  return [
    ...getOpenCSPs(positions).map(p => ({ ...p, type: "CSP" })),
    ...getOpenCCs(positions).map(p => ({ ...p, type: "CC" })),
    ...getOpenLEAPs(positions).map(p => ({ ...p, type: "LEAPS" })),
  ];
}

function Card({ label, value, sub, valueColor }) {
  return (
    <div style={{
      flex: "1 1 160px", padding: theme.space[3],
      background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
    }}>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
      <div style={{ fontSize: theme.size.lg, fontFamily: theme.font.mono, color: valueColor ?? theme.text.primary, marginTop: theme.space[1] }}>{value}</div>
      {sub && <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function StrategyBasketTab({ initialTag = null, entries = [] }) {
  const { positions, trades } = useData();
  const { quoteMap } = useQuotes();

  const strategyTags = useMemo(() => {
    const set = new Set();
    for (const e of entries) {
      for (const t of (e.tags ?? [])) if (t.startsWith(STRATEGY_PREFIX)) set.add(t);
    }
    return [...set].sort();
  }, [entries]);

  const [selectedTag, setSelectedTag] = useState(initialTag ?? strategyTags[0] ?? null);
  const activeTag = (initialTag && strategyTags.includes(initialTag)) ? initialTag : (selectedTag ?? strategyTags[0] ?? null);

  const openPositions = useMemo(() => flattenOpen(positions), [positions]);
  const members = useMemo(
    () => activeTag ? resolveBasket(activeTag, { openPositions, trades: trades ?? [], entries }) : [],
    [activeTag, openPositions, trades, entries],
  );

  const target    = basketTarget(members);
  const deployed  = capitalDeployed(members);
  const realized  = realizedRecovery(members);
  const cushion   = unrealizedCushion(members, quoteMap);
  const pct = target > 0 ? Math.max(0, Math.min(100, (realized / target) * 100)) : 0;

  if (strategyTags.length === 0) {
    return <div style={{ padding: theme.space[5], color: theme.text.muted }}>No positions tagged with a <code>strategy:</code> tag yet.</div>;
  }

  return (
    <div>
      {/* Tag selector */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap" }}>
        {strategyTags.map(t => (
          <button key={t} onClick={() => setSelectedTag(t)} style={{
            padding: "6px 14px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
            background: t === activeTag ? theme.bg.elevated : theme.bg.surface,
            color: t === activeTag ? theme.blue : theme.text.muted,
            border: `1px solid ${t === activeTag ? theme.blue : theme.border.default}`,
            borderRadius: theme.radius.pill,
          }}>{t.replace(STRATEGY_PREFIX, "")}</button>
        ))}
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", marginBottom: theme.space[4] }}>
        <Card label="Target to recover" value={target > 0 ? fmtMoney(target) : "—"} />
        <Card label="Capital deployed" value={fmtMoney(deployed)} />
        <Card label="Realized recovery" value={fmtMoney(realized)} valueColor={realized >= 0 ? theme.green : theme.red} />
        <Card
          label="Unrealized cushion"
          value={cushion.marked > 0 ? fmtMoney(cushion.total) : "—"}
          valueColor={cushion.total >= 0 ? theme.green : theme.red}
          sub={cushion.unmarked > 0 ? `${cushion.unmarked} unmarked (mark-to-market)` : "mark-to-market"}
        />
      </div>

      {/* Progress bar (realized only) */}
      {target > 0 ? (
        <div style={{ marginBottom: theme.space[5] }}>
          <div style={{ height: 10, background: theme.bg.surface, borderRadius: theme.radius.pill, overflow: "hidden", border: `1px solid ${theme.border.default}` }}>
            <div style={{ width: `${pct}%`, height: "100%", background: theme.green, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: theme.space[1] }}>
            {fmtMoney(realized)} of {fmtMoney(target)} recovered ({pct.toFixed(1)}%)
          </div>
        </div>
      ) : (
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[5] }}>
          No baseline set — tag the loss trade with <code>role:makeup-baseline</code> to enable the progress bar.
        </div>
      )}

      {/* Transaction log */}
      <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginBottom: theme.space[2], textTransform: "uppercase", letterSpacing: "0.4px" }}>Transactions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {members.length === 0 && <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>No members.</div>}
        {members.map((m, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: theme.space[3],
            padding: `${theme.space[2]}px ${theme.space[3]}px`,
            background: theme.bg.surface, fontSize: theme.size.sm,
          }}>
            <span style={{ width: 70, fontFamily: theme.font.mono, color: theme.text.muted }}>{m.closeDate ?? m.openDate ?? ""}</span>
            <span style={{ width: 56, fontWeight: 600 }}>{m.ticker}</span>
            <span style={{ width: 64, color: TYPE_COLORS[m.type]?.text ?? theme.text.secondary }}>{m.type}</span>
            <span style={{ flex: 1, color: theme.text.subtle }}>
              {m.role === "baseline" ? "Baseline loss" : m.status === "open" ? "Open" : "Closed"}
              {m.strike != null ? ` · $${m.strike}` : ""}
            </span>
            <span style={{ width: 90, textAlign: "right", fontFamily: theme.font.mono,
              color: m.realized == null ? theme.text.muted : m.realized >= 0 ? theme.green : theme.red }}>
              {m.realized == null ? fmtMoney(-(m.capitalFronted)) : fmtMoney(m.realized)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StrategyBasketTab;
```

- [ ] **Step 2: Verify it compiles (lint/build)**

Run: `npx vite build` (or `npm run build`)
Expected: build succeeds (component is not yet wired into a route, but must parse/import cleanly). If `TYPE_COLORS[m.type]?.text` shape differs, adjust to the actual `TYPE_COLORS` value shape after reading `src/lib/constants.js`.

- [ ] **Step 3: Commit**

```bash
git add src/components/StrategyBasketTab.jsx
git commit -m "feat: add StrategyBasketTab component"
```

---

## Task 5: Wire the tab into ExploreView and fetch tagged entries

**Files:**
- Modify: `src/components/ExploreView.jsx`

- [ ] **Step 1: Load tagged journal entries for the basket**

ExploreView needs the journal entries that carry `strategy:*` tags so `StrategyBasketTab` can build the tag list and resolve members. Add a small hook at the top of `ExploreView.jsx` that loads them once, lazily, only when the basket sub-view is active.

Add imports near the top of `src/components/ExploreView.jsx`:

```jsx
import { useEffect, useState } from "react";
import { listJournalEntries } from "../lib/journalApi";
```

Add the lazy component declaration alongside the others (after line 12):

```jsx
const StrategyBasketTab = lazyNamed(() => import("./StrategyBasketTab"), "StrategyBasketTab");
```

- [ ] **Step 2: Load entries + render the tab**

Inside the `ExploreView` function body, after `const active = ...` (around line 73), add:

```jsx
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

Then add a render block inside the `<Suspense>` next to the others (after the `macro` line ~104):

```jsx
        {active === "baskets" && (
          <StrategyBasketTab initialTag={basketTag} entries={strategyEntries} />
        )}
```

Add `basketTag` to the `ExploreView` props destructure (line 51-61):

```jsx
export function ExploreView({
  subView,
  onSubViewChange,
  positionIntent,
  onPositionIntentConsumed,
  detailTicker,
  basketTag,
  onOpenTickerDetail,
  onCloseTickerDetail,
  onShowJournalEntry,
  onTagPosition,
}) {
```

(`basketTag` is `null` until Task 6 wires the deep-link; the tab falls back to its own tag selector.)

- [ ] **Step 3: Verify `listJournalEntries({})` returns all entries**

Read `src/lib/journalApi.js:8` to confirm an empty/absent filter returns all entries (the resolver needs every `strategy:*` entry, including the `role:makeup-baseline` one). If `listJournalEntries` requires a non-empty filter, pass `{ limit: 1000 }` or the appropriate "all" form instead. Adjust the call accordingly.

- [ ] **Step 4: Browser verification (preview workflow)**

Start the dev server (preview_start), open the app, switch to Explore → Baskets chip. Confirm:
- The `sofi-makeup` tag chip appears and is selected.
- Target shows `$26,400` **only after Task 7's data action**; before that it shows `—` with the baseline hint (expected at this point).
- The three open recovery members (SOFI LEAPS, COHR CSP, VRT CSP) appear in the transaction log with capital shown.
- No console errors (preview_console_logs).
- Capture a screenshot (preview_screenshot).

- [ ] **Step 5: Commit**

```bash
git add src/components/ExploreView.jsx
git commit -m "feat: wire StrategyBasketTab into explore nav"
```

---

## Task 6: Deep-link from a `strategy:` tag chip on a position row

**Files:**
- Modify: `src/App.jsx` (state + handler + props)
- Modify: `src/components/ExploreView.jsx` (already accepts `basketTag` from Task 5)
- Modify: `src/components/OpenPositionsTab.jsx` (chip onClick → navigate)

- [ ] **Step 1: Add basketTag state + navigate handler in App**

In `src/App.jsx`, alongside `const [detailTicker, setDetailTicker] = useState(null);` (line 91), add:

```jsx
  const [basketTag, setBasketTag] = useState(null);
```

Add a handler near the other navigation handlers (e.g. after the `onOpenTickerDetail` definition around line 283-290):

```jsx
  function openBasket(tag) {
    setBasketTag(tag);
    setSubViewRaw("baskets");
  }
```

- [ ] **Step 2: Pass basketTag + opener into ExploreView**

In the `<ExploreView ... />` usage (around line 279), add:

```jsx
                basketTag={basketTag}
```

`OpenPositionsTab` receives the opener via the existing `onTagPosition` path? No — `onTagPosition` opens the tagging UI. Add a distinct prop. In the same `<ExploreView />` props is not where positions tab props live; `OpenPositionsTab` is rendered inside ExploreView. So thread a new prop through ExploreView to OpenPositionsTab.

In `src/components/ExploreView.jsx`, add `onOpenBasket` to the props destructure and pass it to `OpenPositionsTab`:

```jsx
        {active === "positions" && (
          <OpenPositionsTab
            positionIntent={positionIntent}
            onPositionIntentConsumed={onPositionIntentConsumed}
            onOpenTickerDetail={onOpenTickerDetail}
            onShowJournalEntry={onShowJournalEntry}
            onTagPosition={onTagPosition}
            onOpenBasket={onOpenBasket}
          />
        )}
```

And in `src/App.jsx` `<ExploreView />`, add `onOpenBasket={openBasket}`.

- [ ] **Step 3: Make the strategy chip navigate in OpenPositionsTab**

Locate where `PositionTagChip` is rendered in `src/components/OpenPositionsTab.jsx` (the strategic-tags rendering inside `PositionsTable`). Thread `onOpenBasket` down to `PositionsTable` (add to its props at line ~421) and, for chips whose tag starts with `strategy:`, set the chip's `onClick` to `() => onOpenBasket?.(tag)`. Example wiring at the chip render site:

```jsx
<PositionTagChip
  key={t.tag}
  tag={t.tag}
  compact
  onClick={t.tag.startsWith("strategy:") && onOpenBasket ? () => onOpenBasket(t.tag) : undefined}
/>
```

(If chips already have an `onClick` for another purpose, prefer the strategy-navigation only when the tag is a `strategy:` tag; otherwise keep existing behavior.)

- [ ] **Step 4: Browser verification**

Reload preview. On the Positions tab, click a `sofi-makeup` chip on the SOFI LEAPS / COHR / VRT row. Confirm it navigates to Explore → Baskets with `sofi-makeup` preselected. Check console for errors and screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/ExploreView.jsx src/components/OpenPositionsTab.jsx
git commit -m "feat: deep-link strategy tag chips to the basket view"
```

---

## Task 7: Rollout data action — tag the loss trade + vocabulary

Not code. Executed against Supabase project `bzfhheqqkwqqwsiqyqzk` (trading-dashboard). Do this so the SOFI basket shows a real target.

- [ ] **Step 1: Add the role tag to the vocabulary**

```sql
INSERT INTO tag_vocabulary (tag, category, description, deprecated)
VALUES ('role:makeup-baseline', 'role', 'Marks the realized-loss trade that a strategy basket is recovering.', false)
ON CONFLICT (tag) DO NOTHING;
```

- [ ] **Step 2: Tag the loss trade via a linked journal entry**

```sql
INSERT INTO journal_entries (entry_type, trade_id, ticker, type, entry_date, tags, body, source)
VALUES (
  'position_note',
  '55bc138b-6b44-4e7f-a72f-181f2dd52aa0',
  'SOFI', 'Shares', '2026-06-01',
  ARRAY['strategy:sofi-makeup','role:makeup-baseline'],
  '', 'manual'
);
```

- [ ] **Step 3: Verify the basket target resolves**

Reload the Baskets view. Confirm **Target to recover = $26,400**, the progress bar renders (realized recovery / 26,400), and the loss trade appears in the transaction log as the baseline row. Screenshot.

---

## Task 8: Version bump + final verification

**Files:**
- Modify: `package.json` (version), `src/lib/constants.js` (`VERSION`)

- [ ] **Step 1: Get the current main version**

Run: `git show origin/main:package.json | grep '"version"'`
Bump the **minor** version (new feature): `x.(Y+1).0`. Use that number for both files.

- [ ] **Step 2: Update both version locations**

Edit `package.json` `"version"` and `const VERSION` in `src/lib/constants.js` to the new number.

- [ ] **Step 3: Run the full test suite + build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 4: Commit + push**

```bash
git add package.json src/lib/constants.js
git commit -m "feat(baskets): strategy basket recovery tracker (vX.Y.0)"
git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** baseline-vs-recovery split (T1), trade_id + tuple resolution (T1), capital/realized reducers (T1), unrealized cushion separate line w/ graceful degrade (T2), explore placement (T3/T5), tag selector (T4), transaction log (T4), deep-link from chip (T6), one-time data action incl. `role:makeup-baseline` + vocab (T7). `position_id` resolution intentionally dropped for v1 (documented under Design Notes) — no current data uses it.
- **Multiple-baseline summation:** handled by `basketTarget` summing all baseline members (spec edge case).
- **No-baseline behavior:** `target === 0` path renders the hint and omits the bar (T4 component).
- **Shape risk to confirm during T4:** `TYPE_COLORS[type]` value shape (`.text`?) — read `src/lib/constants.js` and adjust the one access site. `listJournalEntries({})` "return all" semantics — confirm in T5 step 3.
