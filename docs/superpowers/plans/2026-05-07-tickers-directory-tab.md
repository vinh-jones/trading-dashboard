# Tickers Directory Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Tickers" chip to the Explore tab that lists every ticker the user has ever traded, sortable, searchable, with one-click navigation into the existing per-ticker detail view.

**Architecture:** New `TickersTab` component renders rows aggregated by a pure helper `buildTickerDirectory({ trades, positions, lifespans })`. Trades + positions come from the existing `useData()` context (no new fetch). Lifespan summaries fetched once via `GET /api/position-lifespan` (no-ticker mode) when the tab mounts; cached in tab state. Health logic factored out of `TickerHeader.jsx` into `src/lib/tickerHealth.js` so both the header and the directory share it.

**Tech Stack:** React 18 (vite), vitest. No new endpoint, no new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-07-tickers-directory-tab.md](../specs/2026-05-07-tickers-directory-tab.md)

---

## File Structure

**New files:**
- `src/lib/tickerDirectory.js` — pure aggregator: `buildTickerDirectory({ trades, positions, lifespans })` returns sorted row objects
- `src/lib/__tests__/tickerDirectory.test.js`
- `src/lib/tickerHealth.js` — extracted from `TickerHeader.jsx`: `computePositionHealth({ openPositions, quote })` returns `{ color, label, worstCushionState }`
- `src/components/TickersTab.jsx` — the directory UI

**Modified files:**
- `src/lib/modes.js` — add `"tickers"` to `EXPLORE_SUBVIEWS` and `SUBVIEW_LABELS`
- `src/components/ExploreView.jsx` — lazy-import `TickersTab`, render when `subView === "tickers"`, pass `onOpenTickerDetail` through
- `src/components/tickerDetail/TickerHeader.jsx` — replace inline `computeHealth` with import from `tickerHealth.js`
- `package.json` + `src/lib/constants.js` — version bump (1.105.0)

---

## Task 1: Extract health helper (refactor)

**Files:**
- Create: `src/lib/tickerHealth.js`
- Modify: `src/components/tickerDetail/TickerHeader.jsx` lines 30-46 (the existing `computeHealth` function)

The existing `computeHealth` in `TickerHeader.jsx` returns `{ color, label }` based on the worst cushion state across open CSPs. The directory tab needs the raw `worstCushionState` too (so it can render an idle ticker as `—` rather than "Idle"). Extract and slightly generalize.

- [ ] **Step 1: Create the new helper**

Create `src/lib/tickerHealth.js`:

```js
import { theme } from "./theme";
import { computeCushion } from "./cushionBreach";

export function computePositionHealth({ openPositions, quote }) {
  const csps = openPositions?.csps ?? [];
  const last = quote?.last ?? quote?.mid ?? null;

  let worst = "safe";
  for (const p of csps) {
    const c = computeCushion(p.strike, last, p.iv ?? null);
    if (c.cushion_state === "assignment_risk") { worst = "assignment_risk"; break; }
    if (c.cushion_state === "approaching") worst = "approaching";
  }

  const totalOpen = (openPositions?.csps?.length   ?? 0)
                  + (openPositions?.shares?.length ?? 0)
                  + (openPositions?.leaps?.length  ?? 0);

  if (totalOpen === 0) {
    return { color: theme.text.muted, label: "Idle", worstCushionState: null };
  }
  if (worst === "assignment_risk") {
    return { color: theme.red, label: "Risk", worstCushionState: "assignment_risk" };
  }
  if (worst === "approaching") {
    return { color: theme.amber, label: "Watch", worstCushionState: "approaching" };
  }
  return { color: theme.green, label: "Healthy", worstCushionState: "safe" };
}
```

- [ ] **Step 2: Replace inline `computeHealth` in TickerHeader.jsx**

Modify `src/components/tickerDetail/TickerHeader.jsx`:

1. Remove the existing `computeHealth` function (lines 30-46).
2. Add import at top:
   ```jsx
   import { computePositionHealth } from "../../lib/tickerHealth";
   ```
3. Replace the call site `const health = computeHealth(openPositions, quote);` with:
   ```jsx
   const health = computePositionHealth({ openPositions, quote });
   ```

- [ ] **Step 3: Run tests + build to confirm no regression**

Run: `npx vitest run`
Expected: 326/326 pass (current 304 + 22 from prior tasks; no new tests yet — same baseline).

Run: `npx vite build 2>&1 | tail -5`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tickerHealth.js src/components/tickerDetail/TickerHeader.jsx
git commit -m "refactor: extract computePositionHealth from TickerHeader"
```

---

## Task 2: Ticker directory aggregator (TDD)

**Files:**
- Create: `src/lib/tickerDirectory.js`
- Test: `src/lib/__tests__/tickerDirectory.test.js`

Pure function: takes the global `trades` array, the `positions` object (shape: `{ open_csps, assigned_shares, open_leaps }`), and the lifespan summaries array. Returns one row object per distinct ticker, sorted active-first then last-activity desc.

Row shape (per spec):
```js
{
  ticker, status: "active" | "idle",
  lastActivity, cycles, cyclesSuspect,
  lifetimePnl, includesSuspect, capital,
  hasOpenPositions: boolean,
}
```

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/tickerDirectory.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildTickerDirectory } from "../tickerDirectory";

const trade = (overrides) => ({
  id: "t1",
  ticker: "ABC",
  type: "CSP",
  subtype: "Close",
  premium_collected: 100,
  close_date: "2026-01-15",
  data_quality: "trusted",
  ...overrides,
});

const lifespan = (overrides) => ({
  ticker: "ABC",
  data_quality: "trusted",
  ...overrides,
});

const csp = (overrides) => ({
  ticker: "ABC",
  strike: 50,
  capital_fronted: 5000,
  ...overrides,
});

const sharesEntry = (overrides) => ({
  ticker: "ABC",
  cost_basis_total: 10_000,
  positions: [{ description: "lot 1", fronted: 10_000 }],
  active_cc: null,
  open_leaps: [],
  ...overrides,
});

const leap = (overrides) => ({
  ticker: "ABC",
  capital_fronted: 2000,
  ...overrides,
});

const POSITIONS_EMPTY = { open_csps: [], assigned_shares: [], open_leaps: [] };

describe("buildTickerDirectory — empty input", () => {
  it("returns empty array when no trades", () => {
    expect(buildTickerDirectory({ trades: [], positions: POSITIONS_EMPTY, lifespans: [] })).toEqual([]);
  });
});

describe("buildTickerDirectory — basic row shape", () => {
  it("creates one row per distinct ticker", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", premium_collected: 100, close_date: "2026-01-10" }),
        trade({ ticker: "ABC", premium_collected: 200, close_date: "2026-02-10" }),
        trade({ ticker: "XYZ", premium_collected: 50,  close_date: "2026-03-01" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.length).toBe(2);
    const tickers = rows.map((r) => r.ticker).sort();
    expect(tickers).toEqual(["ABC", "XYZ"]);
  });
});

describe("buildTickerDirectory — status detection", () => {
  it("marks ticker active when it has any open position", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: { open_csps: [csp({ ticker: "ABC" })], assigned_shares: [], open_leaps: [] },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").status).toBe("active");
    expect(rows.find((r) => r.ticker === "ABC").hasOpenPositions).toBe(true);
  });

  it("marks ticker idle when it has no open positions", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").status).toBe("idle");
    expect(rows.find((r) => r.ticker === "ABC").hasOpenPositions).toBe(false);
  });

  it("marks ticker active when only LEAPS are open", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: { open_csps: [], assigned_shares: [], open_leaps: [leap({ ticker: "ABC" })] },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").status).toBe("active");
  });
});

describe("buildTickerDirectory — last activity", () => {
  it("returns the most recent close_date across all trades", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", close_date: "2026-01-10" }),
        trade({ ticker: "ABC", close_date: "2026-03-15" }),
        trade({ ticker: "ABC", close_date: "2026-02-01" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").lastActivity).toBe("2026-03-15");
  });

  it("returns null when no closed trades", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC", close_date: null })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC")?.lastActivity).toBe(null);
  });
});

describe("buildTickerDirectory — cycle counts", () => {
  it("counts trusted lifespans only; surfaces suspect count separately", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: POSITIONS_EMPTY,
      lifespans: [
        lifespan({ ticker: "ABC", data_quality: "trusted" }),
        lifespan({ ticker: "ABC", data_quality: "trusted" }),
        lifespan({ ticker: "ABC", data_quality: "suspect" }),
      ],
    });
    const r = rows.find((r) => r.ticker === "ABC");
    expect(r.cycles).toBe(2);
    expect(r.cyclesSuspect).toBe(1);
  });

  it("returns zero cycles for CSP-only ticker", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "GLW" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "GLW").cycles).toBe(0);
    expect(rows.find((r) => r.ticker === "GLW").cyclesSuspect).toBe(0);
  });
});

describe("buildTickerDirectory — lifetime P&L", () => {
  it("sums premium_collected across all closed trades regardless of suspect", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", premium_collected: 100, data_quality: "trusted" }),
        trade({ ticker: "ABC", premium_collected: 200, data_quality: "suspect" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    const r = rows.find((r) => r.ticker === "ABC");
    expect(r.lifetimePnl).toBe(300);
    expect(r.includesSuspect).toBe(true);
  });

  it("includesSuspect is false when no suspect trades or lifespans", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC", data_quality: "trusted" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").includesSuspect).toBe(false);
  });

  it("includesSuspect is true when only a suspect lifespan exists", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC", data_quality: "trusted" })],
      positions: POSITIONS_EMPTY,
      lifespans: [lifespan({ ticker: "ABC", data_quality: "suspect" })],
    });
    expect(rows.find((r) => r.ticker === "ABC").includesSuspect).toBe(true);
  });

  it("excludes trades that aren't closed (no close_date)", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "ABC", close_date: "2026-01-10", premium_collected: 100 }),
        trade({ ticker: "ABC", close_date: null,         premium_collected: 999 }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").lifetimePnl).toBe(100);
  });
});

describe("buildTickerDirectory — capital deployed", () => {
  it("sums CSP capital + shares cost basis + LEAPS capital for active ticker", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: {
        open_csps: [csp({ ticker: "ABC", capital_fronted: 5000 })],
        assigned_shares: [sharesEntry({ ticker: "ABC", cost_basis_total: 10_000 })],
        open_leaps: [leap({ ticker: "ABC", capital_fronted: 2000 })],
      },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").capital).toBe(17_000);
  });

  it("returns 0 for idle ticker", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").capital).toBe(0);
  });

  it("falls through to summing lot.fronted when cost_basis_total is missing", () => {
    const rows = buildTickerDirectory({
      trades: [trade({ ticker: "ABC" })],
      positions: {
        open_csps: [],
        assigned_shares: [{
          ticker: "ABC",
          cost_basis_total: null,
          positions: [{ fronted: 4000 }, { fronted: 1500 }],
          active_cc: null,
          open_leaps: [],
        }],
        open_leaps: [],
      },
      lifespans: [],
    });
    expect(rows.find((r) => r.ticker === "ABC").capital).toBe(5500);
  });
});

describe("buildTickerDirectory — default sort", () => {
  it("places active tickers before idle tickers", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "AAA", close_date: "2026-04-01" }),
        trade({ ticker: "ZZZ", close_date: "2026-05-01" }),
      ],
      positions: { open_csps: [csp({ ticker: "AAA" })], assigned_shares: [], open_leaps: [] },
      lifespans: [],
    });
    expect(rows[0].ticker).toBe("AAA"); // active beats idle even with older activity
    expect(rows[1].ticker).toBe("ZZZ");
  });

  it("within same status, sorts by lastActivity descending", () => {
    const rows = buildTickerDirectory({
      trades: [
        trade({ ticker: "AAA", close_date: "2026-01-01" }),
        trade({ ticker: "BBB", close_date: "2026-05-01" }),
        trade({ ticker: "CCC", close_date: "2026-03-01" }),
      ],
      positions: POSITIONS_EMPTY,
      lifespans: [],
    });
    expect(rows.map((r) => r.ticker)).toEqual(["BBB", "CCC", "AAA"]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/lib/__tests__/tickerDirectory.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/lib/tickerDirectory.js`:

```js
export function buildTickerDirectory({ trades = [], positions = {}, lifespans = [] }) {
  const tradesByTicker     = groupBy(trades, (t) => t.ticker);
  const lifespansByTicker  = groupBy(lifespans, (l) => l.ticker);
  const openTickers        = collectOpenTickers(positions);
  const tickers            = new Set([
    ...Object.keys(tradesByTicker),
    ...openTickers.keys(),
  ]);

  const rows = [];
  for (const ticker of tickers) {
    const tickerTrades    = tradesByTicker[ticker]    ?? [];
    const tickerLifespans = lifespansByTicker[ticker] ?? [];
    const open            = openTickers.get(ticker)   ?? null;

    const closedTrades = tickerTrades.filter((t) => t.close_date);
    const lastActivity = closedTrades.length === 0
      ? null
      : closedTrades.map((t) => t.close_date).sort().at(-1);

    const lifetimePnl = closedTrades.reduce(
      (s, t) => s + (Number(t.premium_collected) || 0), 0
    );

    const cycles         = tickerLifespans.filter((l) => l.data_quality !== "suspect").length;
    const cyclesSuspect  = tickerLifespans.filter((l) => l.data_quality === "suspect").length;

    const includesSuspect =
      tickerTrades.some((t) => t.data_quality === "suspect") ||
      tickerLifespans.some((l) => l.data_quality === "suspect");

    const capital = open ? capitalForTicker(open) : 0;
    const hasOpenPositions = !!open;

    rows.push({
      ticker,
      status: hasOpenPositions ? "active" : "idle",
      lastActivity,
      cycles,
      cyclesSuspect,
      lifetimePnl: round2(lifetimePnl),
      includesSuspect,
      capital: round2(capital),
      hasOpenPositions,
    });
  }

  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "");
  });
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

function collectOpenTickers(positions) {
  const map = new Map();
  const add = (ticker, kind, item) => {
    if (!ticker) return;
    if (!map.has(ticker)) map.set(ticker, { csps: [], shares: [], leaps: [] });
    map.get(ticker)[kind].push(item);
  };
  for (const p of positions.open_csps      ?? []) add(p.ticker, "csps", p);
  for (const s of positions.assigned_shares ?? []) add(s.ticker, "shares", s);
  for (const l of positions.open_leaps     ?? []) add(l.ticker, "leaps", l);
  return map;
}

function capitalForTicker(open) {
  const cspCap   = (open.csps   ?? []).reduce((s, p) => s + (Number(p.capital_fronted) || 0), 0);
  const leapsCap = (open.leaps  ?? []).reduce((s, p) => s + (Number(p.capital_fronted) || 0), 0);
  const sharesCap = (open.shares ?? []).reduce((s, sh) => {
    if (sh.cost_basis_total != null) return s + Number(sh.cost_basis_total);
    return s + (sh.positions ?? []).reduce((ss, lot) => ss + (Number(lot.fronted) || 0), 0);
  }, 0);
  return cspCap + leapsCap + sharesCap;
}

function round2(n) {
  return n == null ? null : +n.toFixed(2);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/__tests__/tickerDirectory.test.js`
Expected: PASS — all describe blocks pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tickerDirectory.js src/lib/__tests__/tickerDirectory.test.js
git commit -m "feat: add tickerDirectory aggregator with sort and suspect-data rules"
```

---

## Task 3: TickersTab UI

**Files:**
- Create: `src/components/TickersTab.jsx`

The component fetches all-tickers lifespan summaries on mount, builds rows via `buildTickerDirectory`, and renders the sortable searchable table. Trades, positions, and quotes come from existing hooks (`useData`, `useQuotes`).

Per the spec:
- Search input filters by case-insensitive ticker prefix.
- Default sort: active first, then lastActivity desc. Click any column header to switch.
- Cycles cell renders `…` while lifespans are loading; renders `?` if the fetch failed.
- Click ticker name → fires `onOpenTickerDetail(ticker)`.

- [ ] **Step 1: Create the component**

Create `src/components/TickersTab.jsx`:

```jsx
import { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { theme } from "../lib/theme";
import { formatDollars, formatExpiry } from "../lib/format";
import { buildTickerDirectory } from "../lib/tickerDirectory";
import { computePositionHealth } from "../lib/tickerHealth";

const SORTABLE_COLS = ["ticker", "status", "lastActivity", "cycles", "lifetimePnl", "capital", "health"];

function HealthDot({ row, quoteMap }) {
  if (!row.hasOpenPositions) return <span style={{ color: theme.text.faint }}>—</span>;

  const open = pickOpenForTicker(row.ticker, useDataPositions());
  // (shadowed — actual open positions are passed in via prop, see usage below)
  return null;
}

// Resolve the open positions for one ticker out of the global positions object.
// Reused inside the table render.
function openPositionsForTicker(positions, ticker) {
  return {
    csps:   (positions?.open_csps      ?? []).filter((p) => p.ticker === ticker),
    shares: (positions?.assigned_shares ?? []).filter((s) => s.ticker === ticker),
    leaps:  (positions?.open_leaps     ?? []).filter((l) => l.ticker === ticker),
  };
}

function quoteFor(quoteMap, ticker) {
  const q = quoteMap?.get?.(ticker);
  if (!q) return null;
  return { last: q.last, mid: q.mid };
}

function HealthCell({ ticker, positions, quoteMap }) {
  const open = openPositionsForTicker(positions, ticker);
  const quote = quoteFor(quoteMap, ticker);
  const h = computePositionHealth({ openPositions: open, quote });
  if (h.label === "Idle") return <span style={{ color: theme.text.faint }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: h.color }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: h.color, display: "inline-block" }} />
      {h.label}
    </span>
  );
}

function StatusCell({ status }) {
  const isActive = status === "active";
  const color = isActive ? theme.green : theme.text.muted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", opacity: isActive ? 1 : 0.5 }} />
      {isActive ? "Active" : "Idle"}
    </span>
  );
}

function PnlCell({ value, includesSuspect }) {
  if (value === 0) return <span style={{ color: theme.text.muted }}>$0</span>;
  const color = value >= 0 ? theme.green : theme.red;
  const sign  = value >= 0 ? "+" : "";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {sign}{formatDollars(value)}
      {includesSuspect && <span style={{ color: theme.amber, marginLeft: 4 }}>*</span>}
    </span>
  );
}

function CyclesCell({ row, lifespanLoading, lifespanError }) {
  if (lifespanLoading) return <span style={{ color: theme.text.faint }}>…</span>;
  if (lifespanError) return <span style={{ color: theme.amber }}>?</span>;
  if (row.cyclesSuspect > 0) {
    return (
      <span>
        {row.cycles}
        <span style={{ color: theme.amber, marginLeft: 4, fontSize: theme.size.xs }}>
          ({row.cyclesSuspect} suspect)
        </span>
      </span>
    );
  }
  return <span>{row.cycles}</span>;
}

const COL_DEFS = [
  { key: "ticker",       label: "TICKER",        align: "left",  flex: 1 },
  { key: "status",       label: "STATUS",        align: "left"  },
  { key: "lastActivity", label: "LAST ACTIVITY", align: "left"  },
  { key: "cycles",       label: "CYCLES",        align: "right" },
  { key: "lifetimePnl",  label: "LIFETIME P&L",  align: "right" },
  { key: "capital",      label: "CAPITAL",       align: "right" },
  { key: "health",       label: "HEALTH",        align: "left"  },
];

function compareRows(a, b, sortKey, sortDir) {
  let av, bv;
  switch (sortKey) {
    case "ticker":       av = a.ticker;        bv = b.ticker;        break;
    case "status":       av = a.status;        bv = b.status;        break;
    case "lastActivity": av = a.lastActivity;  bv = b.lastActivity;  break;
    case "cycles":       av = a.cycles;        bv = b.cycles;        break;
    case "lifetimePnl":  av = a.lifetimePnl;   bv = b.lifetimePnl;   break;
    case "capital":      av = a.capital;       bv = b.capital;       break;
    case "health":
      // sort by hasOpenPositions desc, then status (treats idle as last)
      av = a.hasOpenPositions ? 1 : 0;
      bv = b.hasOpenPositions ? 1 : 0;
      break;
    default: return 0;
  }
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string") {
    const cmp = av.localeCompare(bv);
    return sortDir === "desc" ? -cmp : cmp;
  }
  return sortDir === "desc" ? bv - av : av - bv;
}

export function TickersTab({ onOpenTickerDetail }) {
  const { trades, positions } = useData();
  const { quoteMap } = useQuotes();

  const [lifespans, setLifespans] = useState([]);
  const [lifespanLoading, setLifespanLoading] = useState(true);
  const [lifespanError,   setLifespanError]   = useState(null);

  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    let cancelled = false;
    setLifespanLoading(true);
    setLifespanError(null);

    fetch("/api/position-lifespan")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) setLifespans(json.lifespans ?? []);
        else setLifespanError(json.error || "Unknown error");
      })
      .catch((err) => { if (!cancelled) setLifespanError(err.message); })
      .finally(() => { if (!cancelled) setLifespanLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const directory = useMemo(
    () => buildTickerDirectory({ trades, positions, lifespans }),
    [trades, positions, lifespans]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const subset = q
      ? directory.filter((r) => r.ticker.toLowerCase().startsWith(q))
      : directory;
    if (!sortKey) return subset;
    return [...subset].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [directory, search, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: theme.space[3], marginBottom: theme.space[3],
      }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tickers…"
          style={{
            padding: `${theme.space[1]}px ${theme.space[3]}px`,
            background: theme.bg.elevated,
            border: `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.sm,
            color: theme.text.primary,
            fontFamily: "inherit", fontSize: theme.size.sm,
            minWidth: 200,
          }}
        />
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          {filtered.length} ticker{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {lifespanError && (
        <div style={{
          padding: theme.space[2], marginBottom: theme.space[3],
          fontSize: theme.size.xs, color: theme.amber,
          background: `${theme.amber}1a`, border: `1px solid ${theme.amber}55`,
          borderRadius: theme.radius.sm,
        }}>
          Cycle counts unavailable: {lifespanError}
        </div>
      )}

      {directory.length === 0 ? (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm, padding: theme.space[3] }}>
          No tickers traded yet.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
              {COL_DEFS.map((c) => {
                const isActive = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    style={{
                      padding: `${theme.space[2]}px ${theme.space[2]}px`,
                      textAlign: c.align,
                      color: isActive ? theme.text.primary : theme.text.muted,
                      fontWeight: isActive ? 600 : 500,
                      fontSize: theme.size.xs,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                      cursor: "pointer", userSelect: "none",
                    }}
                  >
                    {c.label}
                    <span style={{ marginLeft: 4, opacity: isActive ? 0.8 : 0.25, fontSize: theme.size.xs }}>
                      {isActive ? (sortDir === "desc" ? "▼" : "▲") : "⇅"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.ticker} style={{
                borderBottom: `1px solid ${theme.border.default}`,
                borderLeft: row.hasOpenPositions ? `3px solid ${theme.green}` : "3px solid transparent",
              }}>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}>
                  <button
                    onClick={() => onOpenTickerDetail?.(row.ticker)}
                    style={{
                      background: "transparent", border: "none", padding: 0,
                      color: theme.text.primary, fontFamily: "inherit",
                      fontSize: theme.size.sm, fontWeight: 700,
                      cursor: onOpenTickerDetail ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => { if (onOpenTickerDetail) e.currentTarget.style.color = theme.blue; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = theme.text.primary; }}
                  >
                    {row.ticker}
                  </button>
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm }}>
                  <StatusCell status={row.status} />
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, color: theme.text.muted }}>
                  {row.lastActivity ? formatExpiry(row.lastActivity) : "—"}
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, textAlign: "right", color: theme.text.primary }}>
                  <CyclesCell row={row} lifespanLoading={lifespanLoading} lifespanError={lifespanError} />
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, textAlign: "right" }}>
                  <PnlCell value={row.lifetimePnl} includesSuspect={row.includesSuspect} />
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, textAlign: "right", color: row.capital === 0 ? theme.text.muted : theme.text.primary }}>
                  {row.capital === 0 ? "$0" : formatDollars(row.capital)}
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm }}>
                  <HealthCell ticker={row.ticker} positions={positions} quoteMap={quoteMap} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

Notes on the implementation above:

- The `HealthDot` placeholder near the top is unused — delete it before committing. The actual health rendering is in `HealthCell`. (This stub is a leftover from drafting; it's intentionally called out so the engineer removes it.)
- The `useDataPositions` reference inside the unused `HealthDot` is non-existent — delete the entire `HealthDot` function before saving.

Final pre-commit check on this file: search for `HealthDot` and `useDataPositions` and remove the unused stub block.

- [ ] **Step 2: Build sanity-check**

Run: `npx vite build 2>&1 | tail -10`
Expected: clean build (no warnings about undefined `useDataPositions`).

- [ ] **Step 3: Commit**

```bash
git add src/components/TickersTab.jsx
git commit -m "feat: add TickersTab directory with sort, search, and click-through"
```

---

## Task 4: Wire the Tickers chip into Explore

**Files:**
- Modify: `src/lib/modes.js`
- Modify: `src/components/ExploreView.jsx`

- [ ] **Step 1: Add "tickers" to the explore subviews**

Modify `src/lib/modes.js`:

1. Add `"tickers"` to `EXPLORE_SUBVIEWS`:
   ```js
   export const EXPLORE_SUBVIEWS = ["positions", "tickers", "radar", "earnings", "macro"];
   ```
2. Add label:
   ```js
   export const SUBVIEW_LABELS = {
     positions: "Positions",
     tickers:   "Tickers",
     radar:     "Radar",
     earnings:  "Earnings",
     macro:     "Macro",
     monthly:   "Monthly",
     history:   "History",
     journal:   "Journal",
   };
   ```

- [ ] **Step 2: Render TickersTab from ExploreView**

Modify `src/components/ExploreView.jsx`:

1. Add lazy import alongside the others:
   ```jsx
   const TickersTab = lazyNamed(() => import("./TickersTab"), "TickersTab");
   ```
2. Add a render branch inside the existing `<Suspense>` block, after the `OpenPositionsTab` line and before the `RadarTab` line:
   ```jsx
   {active === "tickers" && (
     <TickersTab onOpenTickerDetail={onOpenTickerDetail} />
   )}
   ```

The `onOpenTickerDetail` prop is already plumbed into `ExploreView` from `App.jsx` (it was added in the per-ticker detail feature) — no `App.jsx` changes needed.

- [ ] **Step 3: Verify**

Run: `npx vitest run`
Expected: all pre-existing modes tests still pass. The `modes.test.js` file may include an assertion about `EXPLORE_SUBVIEWS` length — if so, update it (find by `grep -n "EXPLORE_SUBVIEWS" src/lib/__tests__/modes.test.js`).

Run: `npx vite build 2>&1 | tail -5`
Expected: clean build.

- [ ] **Step 4: Update modes test if needed**

If Step 3 surfaced a failing test in `src/lib/__tests__/modes.test.js`, the most likely failure is an assertion that `EXPLORE_SUBVIEWS` has 4 entries. Read the test, change the expected count to 5, and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modes.js src/components/ExploreView.jsx src/lib/__tests__/modes.test.js
git commit -m "feat: add Tickers chip to Explore subviews"
```

(If `modes.test.js` wasn't modified, remove it from the `git add`.)

---

## Task 5: End-to-end verification + version bump

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Check current main version**

Run: `git fetch origin main && git show origin/main:package.json | grep '"version"'`
Note the version (e.g. `1.104.0`). Bump minor: `1.105.0`.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass — including the new `tickerDirectory.test.js` (Task 2).

- [ ] **Step 3: Live verification in browser preview**

Use the preview tooling (`mcp__Claude_Preview__preview_start` with the `trading-dashboard` config from `.claude/launch.json`).

After the page reloads (note: localhost ports may need reload via `window.location.reload()` to pick up Vite HMR reset):

1. Navigate to **Explore** → confirm the chip nav shows `Positions / Tickers / Radar / Earnings / Macro`.
2. Click **Tickers**. Confirm:
   - Search input visible at top with placeholder
   - Table renders with columns: TICKER / STATUS / LAST ACTIVITY / CYCLES / LIFETIME P&L / CAPITAL / HEALTH
   - Cycles cell shows `…` initially, then a number once the lifespan fetch completes
3. Type `IR` (or whatever prefix matches a real ticker) into search → table filters.
4. Click a column header → sort indicator appears, table re-orders.
5. Click a ticker symbol → URL becomes `#/ticker/SYMBOL` and the detail view loads.
6. Click breadcrumb → returns to Tickers tab (note: depending on routing implementation, you may end up on Positions; that's per the existing detail-view close behavior).

For idle ticker discovery: confirm at least one Idle row appears (any ticker with closed trades but zero open positions).

- [ ] **Step 4: Bump version**

Modify `package.json`:
```json
"version": "1.105.0",
```

Modify `src/lib/constants.js` line with `VERSION`:
```js
export const VERSION = "1.105.0";
```

- [ ] **Step 5: Commit + push + open PR + auto-merge**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.105.0 (Tickers directory tab)"
git push origin <branch-name>

gh pr create --title "feat: Tickers directory tab (v1.105.0)" --body "$(cat <<'EOF'
## Summary
- New "Tickers" chip under Explore lists every ticker the user has ever traded
- Sortable, searchable; columns: status, last activity, cycle count, lifetime P&L, capital, health
- Click any ticker to open the existing detail view (#/ticker/SYMBOL)
- Idle tickers (no open positions, but with trade history) are now discoverable in the UI

## Spec / Plan
- [docs/superpowers/specs/2026-05-07-tickers-directory-tab.md](docs/superpowers/specs/2026-05-07-tickers-directory-tab.md)
- [docs/superpowers/plans/2026-05-07-tickers-directory-tab.md](docs/superpowers/plans/2026-05-07-tickers-directory-tab.md)

## Test plan
- [ ] Tickers chip appears between Positions and Radar
- [ ] Search filters by ticker prefix
- [ ] Each column header sorts ascending/descending
- [ ] Ticker click opens detail view via hash route
- [ ] Idle ticker (CSP-only or fully closed) appears with status Idle, capital $0
- [ ] Suspect-data tickers show suspect indicator on cycles count and lifetime P&L
EOF
)"

# Then auto-merge
gh pr merge --squash --auto
```

---

## Self-Review

**Spec coverage:**
- Layout (search, count, columns) → Task 3 ✓
- Sort defaults + interactive sort → Task 3 (`compareRows`, `handleSort`) ✓
- Status detection → Task 2 (tested) ✓
- Lifetime P&L with suspect inclusion → Task 2 (tested) ✓
- Capital deployed sum (CSP + shares + LEAPS) → Task 2 (tested with cost_basis_total fallback) ✓
- Cycles trusted/suspect split → Task 2 (tested) ✓
- Health = reused logic → Task 1 (extracted) + Task 3 (`HealthCell`) ✓
- Loading / error states for cycles → Task 3 (`CyclesCell`) ✓
- Empty state → Task 3 ("No tickers traded yet.") ✓
- Tab placement between Positions and Radar → Task 4 ✓
- Click-through to `#/ticker/SYMBOL` → Task 3 (uses `onOpenTickerDetail` prop, which already calls `replaceState` in App.jsx from the prior feature) ✓
- Default sort active-first then last-activity desc → Task 2 (tested) ✓
- Performance (no virtualization, no new endpoint) → Tasks 2/3 satisfy ✓

**Placeholder scan:**
- The intentional `HealthDot` stub in Task 3 step 1 is called out for removal explicitly with a "Final pre-commit check" instruction. Not a placeholder in the rendered output.
- No "TBD" / "later" anywhere in the steps.

**Type consistency:**
- `computePositionHealth({ openPositions, quote })` defined in Task 1, called identically in Task 3.
- `buildTickerDirectory({ trades, positions, lifespans })` defined in Task 2, called identically in Task 3.
- Row shape (`status`, `lastActivity`, `cycles`, `cyclesSuspect`, `lifetimePnl`, `includesSuspect`, `capital`, `hasOpenPositions`) consistent across Task 2 tests, Task 2 implementation, Task 3 render.
- `onOpenTickerDetail` prop name matches the existing prop already plumbed from `App.jsx` → `ExploreView` → `OpenPositionsTab`.
