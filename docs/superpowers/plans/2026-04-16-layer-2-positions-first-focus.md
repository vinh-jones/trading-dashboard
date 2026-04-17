# Layer 2 — Positions-First Focus View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the alerts-first Focus view with a positions-first feed where each row shows a position + its alert tags + proximity-to-target progress bar. Wire the P1 alert count live to the PersistentHeader and the ModeNav Focus-tab badge. Hoist the focus-items pipeline to `App.jsx` so header, nav, and Focus view all read from a single source. Apply the pending Review sub-nav reorder (Journal first).

**Architecture:** Introduce `useFocusItems()` at the App level — it fetches `marketContext`, consumes `useQuotes`/`useRollAnalysis`/`useLiveVix`, and calls `generateFocusItems` once. The resulting items plus the raw data flow down as props to FocusTab, PersistentHeader, and ModeNav. A new pure library `positionAttention.js` builds the sorted "attention list" (position + alert tags + proximity-to-target). FocusTab becomes a thin composition: `AlertsBanner` (non-position P1s) + `PositionsFeed` (attention list) + existing rules/macro-calendar panels. No changes to `focusEngine.js` rule logic.

**Tech Stack:** React 18, Vite, Vitest. Extends Layer 1's `src/lib/modes.js`, `PersistentHeader`, `ModeNav`.

**Out of scope for Layer 2:**
- Today's G/L delta column (requires open-price data not in the quote shape — defer until the API surfaces it)
- Gemini macro posture-shift P3 card (needs shift-detection in the macro pipeline — later layer)
- Focus right-rail position detail panel on desktop (spec says ship empty-until-click; no scope needed yet)
- ⌘K command palette (Layer 3)
- Focus-mode keybind (Layer 4)
- Visual polish pass / DESIGN.md tokens (Layer 5)

**Reference spec:** `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md`

---

## File Structure

### New files
- `src/lib/positionAttention.js` — pure functions: target, proximity, attention list assembly
- `src/lib/__tests__/positionAttention.test.js`
- `src/hooks/useFocusItems.js` — hoisted pipeline (marketContext + quotes + rolls + focus items)
- `src/components/focus/PositionRow.jsx`
- `src/components/focus/PositionsFeed.jsx`
- `src/components/focus/AlertsBanner.jsx`

### Modified files
- `src/components/FocusTab.jsx` — consumes `focusItems` prop, composes new children
- `src/components/PersistentHeader.jsx` — accepts `p1Count` prop, replaces "—" placeholder
- `src/components/ModeNav.jsx` — accepts `p1Count` prop, shows badge on Focus tab
- `src/App.jsx` — calls `useFocusItems`, passes focusItems + p1Count down
- `src/lib/modes.js` — reorder `REVIEW_SUBVIEWS`, update `defaultSubView("review")`
- `src/lib/__tests__/modes.test.js` — update for reordered sub-nav
- `package.json` — version bump
- `src/lib/constants.js` — `VERSION` bump

---

## Task 1: Extract position attention library

Pure functions for target-per-DTE, proximity-to-target, and the attention-list builder. No React.

**Files:**
- Create: `src/lib/positionAttention.js`
- Create: `src/lib/__tests__/positionAttention.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/positionAttention.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  targetProfitPctForDtePct,
  proximityFraction,
  buildAttentionList,
} from "../positionAttention";

describe("targetProfitPctForDtePct", () => {
  it(">80% DTE left → 50% target", () => {
    expect(targetProfitPctForDtePct(90)).toBe(50);
    expect(targetProfitPctForDtePct(81)).toBe(50);
  });
  it("41–79% DTE left → 60% target", () => {
    expect(targetProfitPctForDtePct(80)).toBe(60);
    expect(targetProfitPctForDtePct(50)).toBe(60);
    expect(targetProfitPctForDtePct(41)).toBe(60);
  });
  it("≤40% DTE left → 80% target", () => {
    expect(targetProfitPctForDtePct(40)).toBe(80);
    expect(targetProfitPctForDtePct(10)).toBe(80);
    expect(targetProfitPctForDtePct(0)).toBe(80);
  });
});

describe("proximityFraction", () => {
  it("clamps negative G/L to 0", () => {
    expect(proximityFraction(-5, 60)).toBe(0);
  });
  it("clamps at 1 when at or past target", () => {
    expect(proximityFraction(60, 60)).toBe(1);
    expect(proximityFraction(75, 60)).toBe(1);
  });
  it("returns ratio between 0 and 1 when approaching", () => {
    expect(proximityFraction(30, 60)).toBe(0.5);
    expect(proximityFraction(45, 60)).toBe(0.75);
  });
  it("returns 0 when target is not positive", () => {
    expect(proximityFraction(10, 0)).toBe(0);
    expect(proximityFraction(10, null)).toBe(0);
  });
});

describe("buildAttentionList", () => {
  const baseCsp = {
    ticker: "NVDA",
    expiry_date: "2026-05-01",
    open_date:   "2026-04-01",
    strike:      450,
    contracts:   1,
    premium_collected: 300,
  };
  const items = [
    { id: "a", priority: "P1", rule: "cc_deeply_itm", ticker: "NVDA", title: "NVDA deeply ITM" },
    { id: "b", priority: "P2", rule: "rule_60_60",    ticker: "TSLA", title: "TSLA 60/60 hit" },
  ];

  it("emits one entry per open position", () => {
    const positions = { open_csps: [baseCsp], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), items);
    expect(out.length).toBe(1);
    expect(out[0].ticker).toBe("NVDA");
  });

  it("attaches matching alerts to the row (by ticker)", () => {
    const positions = { open_csps: [baseCsp, { ...baseCsp, ticker: "TSLA" }], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), items);
    const nvda = out.find(r => r.ticker === "NVDA");
    const tsla = out.find(r => r.ticker === "TSLA");
    expect(nvda.alertTags.map(t => t.priority)).toEqual(["P1"]);
    expect(tsla.alertTags.map(t => t.priority)).toEqual(["P2"]);
  });

  it("derives priority from the highest-priority alert (P1 > P2 > P3 > none)", () => {
    const positions = { open_csps: [baseCsp], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), items);
    expect(out[0].priority).toBe("P1");
  });

  it("sorts rows by priority then by proximity descending then by DTE ascending", () => {
    const low   = { ...baseCsp, ticker: "A", expiry_date: "2026-06-01" };
    const high  = { ...baseCsp, ticker: "B", expiry_date: "2026-04-30" };
    const urgent = { ...baseCsp, ticker: "C", expiry_date: "2026-05-10" };
    const itemsMixed = [
      { id: "x", priority: "P1", rule: "expiring_soon", ticker: "C", title: "C expiring" },
    ];
    const positions = { open_csps: [low, high, urgent], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), itemsMixed);
    // P1 first (C), then non-alerted sorted by proximity desc then DTE asc.
    expect(out.map(r => r.ticker)[0]).toBe("C");
  });

  it("returns an empty list when positions is null", () => {
    expect(buildAttentionList(null, new Map(), [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/positionAttention.test.js`
Expected: FAIL — `Failed to resolve import "../positionAttention"`

- [ ] **Step 3: Implement the library**

Create `src/lib/positionAttention.js`:

```js
import { calcDTE, buildOccSymbol } from "./trading.js";

// ── Target profit % based on how much DTE remains (per user's 60/60 framework) ──
// >80% of DTE left  → take ~50% profit fast and redeploy
// 41–79%            → standard 60/60
// ≤40%              → late stage, take 80%
export function targetProfitPctForDtePct(dtePct) {
  if (dtePct == null) return null;
  if (dtePct > 80) return 50;
  if (dtePct > 40) return 60;
  return 80;
}

// Fraction of the way from 0% G/L to target, clamped to [0, 1]. Null/negative → 0.
export function proximityFraction(currentPct, targetPct) {
  if (currentPct == null || !targetPct || targetPct <= 0) return 0;
  if (currentPct <= 0) return 0;
  if (currentPct >= targetPct) return 1;
  return currentPct / targetPct;
}

// Priority ordering — smaller number = more urgent
const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };

function dtePctFor(pos, dte) {
  if (!pos.open_date || !pos.expiry_date || dte == null) return null;
  const openMs   = new Date(pos.open_date   + "T00:00:00").getTime();
  const expiryMs = new Date(pos.expiry_date + "T00:00:00").getTime();
  const totalDays = Math.max(1, Math.round((expiryMs - openMs) / (1000 * 60 * 60 * 24)));
  return totalDays > 0 ? (dte / totalDays) * 100 : null;
}

// Compute G/L% for a short (CSP or CC) from premium collected + current option mid.
// LEAPs handled separately (returns null here — Layer 2 keeps LEAP rows minimal).
function shortOptionGlPct(pos, quoteMap, isCC) {
  if (!pos.premium_collected || !pos.strike || !pos.expiry_date || !pos.contracts) return null;
  const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC, pos.strike);
  const q   = quoteMap.get(sym);
  if (!q || q.mid == null) return null;
  const glDollars = pos.premium_collected - (q.mid * pos.contracts * 100);
  return (glDollars / pos.premium_collected) * 100;
}

function higherPriority(a, b) {
  const ar = PRIORITY_RANK[a] ?? 99;
  const br = PRIORITY_RANK[b] ?? 99;
  return ar <= br ? a : b;
}

function buildRow(pos, type, quoteMap, focusItems) {
  const dte    = calcDTE(pos.expiry_date);
  const dtePct = dtePctFor(pos, dte);
  const target = targetProfitPctForDtePct(dtePct);
  const isCC   = type === "CC";
  const isLeap = type === "LEAP";
  const glPct  = isLeap ? null : shortOptionGlPct(pos, quoteMap, isCC);
  const proximity = proximityFraction(glPct, target);

  const alertTags = focusItems
    .filter(it => it.ticker === pos.ticker)
    .map(it => ({ id: it.id, priority: it.priority, rule: it.rule, title: it.title }));

  const priority = alertTags.reduce(
    (best, t) => higherPriority(best, t.priority),
    null
  );

  return {
    ticker:    pos.ticker,
    type,                    // "CSP" | "CC" | "LEAP"
    strike:    pos.strike,
    dte,
    dtePct,
    glPct,
    targetPct: target,
    proximity,
    alertTags,
    priority,
    position:  pos,          // keep original for downstream drill-in
  };
}

export function buildAttentionList(positions, quoteMap, focusItems) {
  if (!positions) return [];
  const csps   = (positions.open_csps   || []).map(p => buildRow(p, "CSP",  quoteMap, focusItems));

  // Covered calls live inside assigned_shares; active_cc doesn't carry its own
  // ticker, so inject the parent's ticker.
  const ccs    = [];
  for (const shareRow of (positions.assigned_shares || [])) {
    if (shareRow.active_cc) {
      const cc = { ...shareRow.active_cc, ticker: shareRow.ticker };
      ccs.push(buildRow(cc, "CC", quoteMap, focusItems));
    }
  }

  // LEAPs live at top level AND nested under assigned_shares (covered LEAPs).
  const nestedLeaps = (positions.assigned_shares || [])
    .flatMap(s => (s.open_leaps || []).map(l => ({ ...l, ticker: l.ticker ?? s.ticker })));
  const topLevelLeaps = (positions.open_leaps || []).map(p => ({ ...p }));
  const leaps = [...topLevelLeaps, ...nestedLeaps].map(p => buildRow(p, "LEAP", quoteMap, focusItems));

  const rows = [...csps, ...ccs, ...leaps];

  rows.sort((a, b) => {
    const ar = PRIORITY_RANK[a.priority] ?? 99;
    const br = PRIORITY_RANK[b.priority] ?? 99;
    if (ar !== br) return ar - br;
    // No alerts on either — sort by proximity desc (closer to target first), then DTE asc.
    if (b.proximity !== a.proximity) return b.proximity - a.proximity;
    return (a.dte ?? Infinity) - (b.dte ?? Infinity);
  });

  return rows;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/__tests__/positionAttention.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/positionAttention.js src/lib/__tests__/positionAttention.test.js
git commit -m "feat(attention): add position attention list with proximity-to-target"
```

---

## Task 2: useFocusItems hook (hoisted pipeline)

Single pipeline that will feed FocusTab, PersistentHeader, and ModeNav. Encapsulates marketContext fetch + focusEngine call.

**Files:**
- Create: `src/hooks/useFocusItems.js`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useFocusItems.js`:

```js
import { useEffect, useMemo, useState } from "react";
import marketContextDev from "../data/market-context.json";
import { useData } from "./useData";
import { useLiveVix } from "./useLiveVix";
import { useQuotes } from "./useQuotes";
import { useRollAnalysis } from "./useRollAnalysis";
import { generateFocusItems, categorizeFocusItems } from "../lib/focusEngine";

// One-shot pipeline. Call at App.jsx level and pass results down to consumers
// (FocusTab, PersistentHeader, ModeNav) so the fetch side-effects only happen once.
export function useFocusItems() {
  const { positions, account } = useData();
  const { vix: liveVix } = useLiveVix(account?.vix_current);
  const { quoteMap, refreshedAt: quotesRefreshedAt } = useQuotes();
  const { rollMap } = useRollAnalysis();

  const [marketContext, setMarketContext] = useState(null);
  const [mcLoading, setMcLoading]         = useState(true);
  const [notifiedMap, setNotifiedMap]     = useState(() => new Map());

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setMarketContext(marketContextDev);
      setMcLoading(false);
      return;
    }
    fetch("/api/focus-context")
      .then(r => r.json())
      .then(data => {
        if (!data.ok) return;
        if (data.marketContext) setMarketContext(data.marketContext);
        if (Array.isArray(data.alertState)) {
          setNotifiedMap(new Map(data.alertState.map(a => [a.alert_id, { firstFiredAt: a.first_fired_at }])));
        }
      })
      .catch(err => console.warn("[useFocusItems] focus-context fetch failed:", err.message))
      .finally(() => setMcLoading(false));
  }, []);

  const items = useMemo(
    () => generateFocusItems(positions, account, marketContext, liveVix, quoteMap, rollMap),
    [positions, account, marketContext, liveVix, quoteMap, rollMap]
  );

  const categorized = useMemo(() => categorizeFocusItems(items), [items]);

  const p1Count = categorized.focus.length;

  return {
    items,
    categorized,
    p1Count,
    // Ambient data consumers may need
    quoteMap,
    quotesRefreshedAt,
    rollMap,
    liveVix,
    marketContext,
    mcLoading,
    notifiedMap,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useFocusItems.js
git commit -m "feat(focus): add useFocusItems hook for hoisted pipeline"
```

---

## Task 3: AlertsBanner component

Non-position-tied alerts (cash below floor, etc.) render as a thin banner row above the positions feed.

**Files:**
- Create: `src/components/focus/AlertsBanner.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/focus/AlertsBanner.jsx`:

```jsx
import { theme } from "../../lib/theme";

// Non-position alerts are those whose focusItem has no matching ticker in the
// positions tree, or whose rule is inherently ambient (cash_below_floor,
// macro_overlap-without-ticker). The parent filters and passes these in.
export function AlertsBanner({ alerts }) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div style={{
      display:      "flex",
      flexDirection:"column",
      gap:          theme.space[1],
      marginBottom: theme.space[4],
    }}>
      {alerts.map(a => (
        <div key={a.id} style={{
          display:      "flex",
          alignItems:   "baseline",
          gap:          theme.space[2],
          padding:      `${theme.space[2]}px ${theme.space[3]}px`,
          background:   a.priority === "P1" ? "rgba(248,81,73,0.08)" : theme.bg.surface,
          border:       `1px solid ${a.priority === "P1" ? theme.red : theme.border.default}`,
          borderLeft:   `3px solid ${a.priority === "P1" ? theme.red : theme.amber}`,
          borderRadius: theme.radius.sm,
          fontSize:     theme.size.sm,
        }}>
          <span style={{
            fontSize:      theme.size.xs,
            fontWeight:    700,
            letterSpacing: "0.08em",
            color:         a.priority === "P1" ? theme.red : theme.amber,
            minWidth:      22,
          }}>
            {a.priority}
          </span>
          <span style={{ color: theme.text.primary, fontWeight: 500 }}>{a.title}</span>
          {a.detail && (
            <span style={{ color: theme.text.muted, fontSize: theme.size.xs, marginLeft: theme.space[2] }}>
              {a.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

Note: the two `rgba(...)` colors for P1 banner backgrounds are the only non-token colors introduced. They derive from `theme.red` at 8% alpha for a tinted banner background — a pattern already used in the existing codebase (see `AccountBar` → `PersistentHeader` diff, which tints slot colors). If you want, extract them into `theme.alert` later (Layer 5 polish); keep inline for now.

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/AlertsBanner.jsx
git commit -m "feat(focus): add AlertsBanner for non-position P1 alerts"
```

---

## Task 4: PositionRow component

Renders one position in the attention feed: ticker + alert tags, meta line, G/L%, proximity bar.

**Files:**
- Create: `src/components/focus/PositionRow.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/focus/PositionRow.jsx`:

```jsx
import { theme } from "../../lib/theme";
import { TYPE_COLORS } from "../../lib/constants";
import { formatExpiry } from "../../lib/format";

function priorityStripColor(priority) {
  if (priority === "P1") return theme.red;
  if (priority === "P2") return theme.amber;
  return "transparent";
}

function glColor(glPct, targetPct) {
  if (glPct == null) return theme.text.muted;
  if (glPct < 0) return theme.red;
  if (targetPct != null && glPct >= targetPct) return theme.green;
  if (targetPct != null && glPct >= targetPct * 0.7) return theme.amber;
  return theme.text.secondary;
}

function proximityBarColor(fraction) {
  if (fraction >= 1) return theme.green;
  if (fraction >= 0.7) return theme.amber;
  return theme.blueBold;
}

function AlertTag({ tag }) {
  const isP1 = tag.priority === "P1";
  return (
    <span style={{
      fontSize:      theme.size.xs,
      padding:       "1px 6px",
      borderRadius:  theme.radius.pill,
      background:    isP1 ? "rgba(248,81,73,0.15)" : theme.bg.elevated,
      color:         isP1 ? theme.red : theme.amber,
      border:        `1px solid ${isP1 ? theme.red : theme.border.strong}`,
      fontWeight:    600,
      letterSpacing: "0.03em",
    }}>
      {tag.priority}
    </span>
  );
}

export function PositionRow({ row }) {
  const { ticker, type, strike, dte, dtePct, glPct, targetPct, proximity, alertTags, priority } = row;

  const typeColor = TYPE_COLORS[type] ?? { text: theme.text.primary, bg: theme.bg.surface };

  return (
    <div style={{
      display:         "grid",
      gridTemplateColumns: "1fr auto",
      gap:             theme.space[3],
      alignItems:      "center",
      padding:         `${theme.space[2]}px ${theme.space[3]}px`,
      borderBottom:    `1px solid ${theme.border.default}`,
      borderLeft:      `3px solid ${priorityStripColor(priority)}`,
      background:      priority === "P1" ? "rgba(248,81,73,0.04)" : "transparent",
    }}>

      {/* ── Left: ticker + tags + meta ─────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
          <span style={{
            fontSize: theme.size.md,
            fontWeight: 700,
            color: theme.text.primary,
            letterSpacing: "0.02em",
          }}>
            {ticker}
          </span>
          <span style={{
            fontSize:      theme.size.xs,
            padding:       "1px 6px",
            borderRadius:  theme.radius.sm,
            background:    typeColor.bg,
            color:         typeColor.text,
            border:        `1px solid ${typeColor.border ?? theme.border.strong}`,
          }}>
            {type}
          </span>
          {alertTags.map(t => <AlertTag key={t.id} tag={t} />)}
        </div>
        <div style={{
          fontSize:   theme.size.xs,
          color:      theme.text.muted,
          marginTop:  2,
        }}>
          {strike != null && <>${strike} · </>}
          {dte != null && <>{dte}d</>}
          {dtePct != null && <> · {dtePct.toFixed(0)}% DTE left</>}
        </div>
      </div>

      {/* ── Right: G/L% + proximity bar ─────────────────────────────── */}
      <div style={{ textAlign: "right", minWidth: 110 }}>
        <div style={{
          fontSize:   theme.size.md,
          fontWeight: 700,
          color:      glColor(glPct, targetPct),
          letterSpacing: "0.02em",
        }}>
          {glPct != null ? `${glPct > 0 ? "+" : ""}${glPct.toFixed(0)}%` : "—"}
        </div>
        {targetPct != null && glPct != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
              {glPct.toFixed(0)}/{targetPct}
            </span>
            <div style={{
              width:        44,
              height:       3,
              background:   theme.border.default,
              borderRadius: theme.radius.sm,
              overflow:     "hidden",
            }}>
              <div style={{
                width:      `${Math.round(proximity * 100)}%`,
                height:     "100%",
                background: proximityBarColor(proximity),
                transition: "width 0.3s",
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/PositionRow.jsx
git commit -m "feat(focus): add PositionRow with inline alert tags and proximity bar"
```

---

## Task 5: PositionsFeed component

Container that wraps the list of rows with a header label. Accepts the attention list and renders rows.

**Files:**
- Create: `src/components/focus/PositionsFeed.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/focus/PositionsFeed.jsx`:

```jsx
import { theme } from "../../lib/theme";
import { PositionRow } from "./PositionRow";

export function PositionsFeed({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{
        padding:      theme.space[5],
        background:   theme.bg.surface,
        border:       `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.md,
        color:        theme.text.subtle,
        fontSize:     theme.size.sm,
        textAlign:    "center",
      }}>
        No open positions.
      </div>
    );
  }

  return (
    <div style={{
      background:   theme.bg.surface,
      border:       `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      overflow:     "hidden",
      marginBottom: theme.space[4],
    }}>
      <div style={{
        fontSize:      theme.size.xs,
        color:         theme.text.muted,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        padding:       `${theme.space[2]}px ${theme.space[3]}px`,
        borderBottom:  `1px solid ${theme.border.default}`,
        background:    theme.bg.base,
      }}>
        Positions · by urgency
      </div>
      {rows.map(row => (
        <PositionRow key={`${row.ticker}-${row.type}-${row.strike}-${row.dte}`} row={row} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/PositionsFeed.jsx
git commit -m "feat(focus): add PositionsFeed container wrapping PositionRows"
```

---

## Task 6: Rewrite FocusTab to consume hoisted pipeline + render new feed

Accept `focusItems`, `categorized`, `quoteMap`, `positions`, etc. as props. Drop all local fetching. Compose `AlertsBanner + PositionsFeed` above the preserved rules/macro-events panels.

**Files:**
- Modify: `src/components/FocusTab.jsx`

- [ ] **Step 1: Rewrite `src/components/FocusTab.jsx`**

Replace the entire file contents with:

```jsx
import { useState } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { theme } from "../lib/theme";
import { buildAttentionList } from "../lib/positionAttention";
import { formatExpiry } from "../lib/format";
import { AlertsBanner } from "./focus/AlertsBanner";
import { PositionsFeed } from "./focus/PositionsFeed";

// Data-freshness chip preserved from the previous shell
function DataFreshnessInfo({ quotesRefreshedAt, contextAsOf, positionsLastUpdated }) {
  const [hovered, setHovered] = useState(false);
  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };
  const rows = [
    { label: "Quotes",         value: fmt(quotesRefreshedAt),          note: "30 min cache · market hours only" },
    { label: "Market context", value: fmt(contextAsOf),                note: "updated by ingest job" },
    { label: "Positions",      value: positionsLastUpdated || "—",     note: "daily snapshot" },
  ];
  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: theme.size.xs, color: theme.text.faint, cursor: "default", userSelect: "none" }}>
        ⓘ data freshness
      </span>
      {hovered && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px`,
          zIndex: 100, minWidth: 300, pointerEvents: "none",
        }}>
          {rows.map(({ label, value, note }) => (
            <div key={label} style={{ display: "flex", gap: theme.space[3], alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, minWidth: 100, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: theme.size.xs, color: theme.text.primary, fontFamily: theme.font.mono }}>{value}</span>
              <span style={{ fontSize: theme.size.xs, color: theme.text.faint }}>{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Separates non-position alerts (cash, macro, cluster) from per-position ones.
// Position-backed alerts render as tags on rows; these render as the banner.
function isNonPositionAlert(item, tickersWithPositions) {
  if (!item.ticker) return true;
  return !tickersWithPositions.has(item.ticker);
}

export function FocusTab({
  focusItems,
  categorized,
  quoteMap,
  quotesRefreshedAt,
  marketContext,
}) {
  const { positions, account } = useData();
  const isMobile = useWindowWidth() < 600;

  const rows = buildAttentionList(positions, quoteMap, focusItems);

  const tickersWithPositions = new Set(rows.map(r => r.ticker));
  const bannerAlerts = (focusItems || [])
    .filter(it => it.priority === "P1" || it.priority === "P2")
    .filter(it => isNonPositionAlert(it, tickersWithPositions));

  const macroEvents = marketContext?.macroEvents ?? [];

  const panelStyle = {
    background:   theme.bg.surface,
    border:       `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.md,
    padding:      isMobile ? theme.space[3] : theme.space[4],
    marginBottom: theme.space[4],
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
        <DataFreshnessInfo
          quotesRefreshedAt={quotesRefreshedAt}
          contextAsOf={marketContext?.asOf}
          positionsLastUpdated={account?.last_updated}
        />
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          {categorized?.focus?.length ?? 0} P1 · {categorized?.watching?.length ?? 0} P2 · {categorized?.info?.length ?? 0} P3
        </div>
      </div>

      <AlertsBanner alerts={bannerAlerts} />
      <PositionsFeed rows={rows} />

      {macroEvents.length > 0 && (
        <div style={panelStyle}>
          <div style={{
            fontSize:      theme.size.xs,
            color:         theme.text.muted,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom:  theme.space[2],
          }}>
            Macro calendar
          </div>
          <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, display: "grid", gap: 4 }}>
            {macroEvents.slice(0, 8).map((evt, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: theme.space[3] }}>
                <span>{formatExpiry(evt._date ?? evt.date)} — {evt.label ?? evt.title ?? evt.type}</span>
                {evt.forecast != null && <span style={{ color: theme.text.subtle }}>fc: {evt.forecast}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Sanity-check the rewrite**

Run: `npx vite build 2>&1 | tail -10`
Expected: build succeeds.

If it fails, most likely cause: old imports (`useLiveVix`, `useQuotes`, etc.) that are no longer referenced — they should all be gone. `grep -n "useLiveVix\|useQuotes\|useRollAnalysis\|generateFocusItems" src/components/FocusTab.jsx` — expected empty.

- [ ] **Step 3: Commit**

```bash
git add src/components/FocusTab.jsx
git commit -m "feat(focus): rewrite FocusTab as positions-first feed with banner alerts"
```

---

## Task 7: Wire P1 count to PersistentHeader + ModeNav

PersistentHeader accepts `p1Count`; ModeNav accepts `p1Count` and renders a red badge on the Focus tab when count > 0. App.jsx calls `useFocusItems()` once and passes data down.

**Files:**
- Modify: `src/components/PersistentHeader.jsx`
- Modify: `src/components/ModeNav.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Update `src/components/PersistentHeader.jsx`**

Change the component signature from `PersistentHeader({ captureRate })` to `PersistentHeader({ captureRate, p1Count })`, and replace the placeholder Slot-3 block with a real P1 indicator.

Find this block:
```jsx
      {/* ── Slot 3: P1 alert count (placeholder for layer 1) ─────────────── */}
      <Slot>
        <SlotLabel>Alerts</SlotLabel>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.subtle }}>—</div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 2 }}>wired in Layer 2</div>
      </Slot>
```

Replace with:
```jsx
      {/* ── Slot 3: P1 alert count ───────────────────────────────────────── */}
      <Slot>
        <SlotLabel>Alerts</SlotLabel>
        {p1Count > 0 ? (
          <>
            <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.red }}>
              P1 · {p1Count}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>
              needs action today
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.green }}>
              ✓ clear
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>
              no P1 alerts
            </div>
          </>
        )}
      </Slot>
```

Also update the signature line at the top:
```jsx
export function PersistentHeader({ captureRate, p1Count = 0 }) {
```

- [ ] **Step 2: Update `src/components/ModeNav.jsx`**

Change signature to `ModeNav({ mode, onChange, p1Count = 0 })` and render a red badge on the Focus tab when `p1Count > 0`.

Full new file contents:

```jsx
import { MODES, MODE_LABELS } from "../lib/modes";
import { theme } from "../lib/theme";
import { useWindowWidth } from "../hooks/useWindowWidth";

export function ModeNav({ mode, onChange, p1Count = 0 }) {
  const windowWidth = useWindowWidth();
  const isMobile    = windowWidth < 600;

  const buttonStyle = (m) => ({
    padding:       isMobile ? "10px 14px" : "10px 24px",
    fontSize:      theme.size.md,
    fontFamily:    "inherit",
    cursor:        "pointer",
    fontWeight:    mode === m ? 600 : 400,
    color:         mode === m ? theme.text.primary : theme.text.muted,
    background:    "transparent",
    border:        "none",
    borderBottom:  mode === m ? `2px solid ${theme.blue}` : "2px solid transparent",
    transition:    "all 0.15s",
    letterSpacing: "0.3px",
    whiteSpace:    "nowrap",
    display:       "inline-flex",
    alignItems:    "center",
    gap:           6,
  });

  const badgeStyle = {
    fontSize:      theme.size.xs,
    fontWeight:    700,
    padding:       "0 6px",
    borderRadius:  theme.radius.pill,
    background:    theme.red,
    color:         theme.text.primary,
    letterSpacing: "0.03em",
  };

  return (
    <div
      role="tablist"
      aria-label="Workspace modes"
      style={{
        display:                 "flex",
        gap:                     0,
        borderBottom:            `1px solid ${theme.border.default}`,
        marginBottom:            theme.space[5],
        overflowX:               "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {MODES.map(m => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          style={buttonStyle(m)}
          onClick={() => onChange(m)}
        >
          {MODE_LABELS[m]}
          {m === "focus" && p1Count > 0 && (
            <span style={badgeStyle}>{p1Count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update `src/App.jsx`**

Two changes: import `useFocusItems`, call it, and pass `p1Count` + focus props into consumers.

Find this import block:
```jsx
import { PersistentHeader } from "./components/PersistentHeader";
import { ModeNav } from "./components/ModeNav";
import { FocusTab } from "./components/FocusTab";
import { ExploreView } from "./components/ExploreView";
import { ReviewView } from "./components/ReviewView";
```

Add below it:
```jsx
import { useFocusItems } from "./hooks/useFocusItems";
```

Find the state block that starts with `// ── Mode + sub-view state ──` and add this line directly above it:

```jsx
  // ── Focus pipeline — hoisted so header / nav / tab all read from one source ──
  const focus = useFocusItems();
```

Find the header render:
```jsx
          <PersistentHeader captureRate={captureRate} />
          <ModeNav mode={mode} onChange={setMode} />
```

Replace with:
```jsx
          <PersistentHeader captureRate={captureRate} p1Count={focus.p1Count} />
          <ModeNav mode={mode} onChange={setMode} p1Count={focus.p1Count} />
```

Find:
```jsx
          {mode === "focus"   && <FocusTab />}
```

Replace with:
```jsx
          {mode === "focus"   && (
            <FocusTab
              focusItems={focus.items}
              categorized={focus.categorized}
              quoteMap={focus.quoteMap}
              quotesRefreshedAt={focus.quotesRefreshedAt}
              marketContext={focus.marketContext}
            />
          )}
```

- [ ] **Step 4: Verify build + existing tests**

```bash
npx vite build 2>&1 | tail -10
npx vitest run
```

Expected: build succeeds; all prior tests pass (56 from Layer 1 + the new positionAttention tests).

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/PersistentHeader.jsx src/components/ModeNav.jsx
git commit -m "feat(focus): wire P1 count to PersistentHeader and ModeNav via useFocusItems"
```

---

## Task 8: Review sub-nav reorder — Journal first

**Files:**
- Modify: `src/lib/modes.js`
- Modify: `src/lib/__tests__/modes.test.js`

- [ ] **Step 1: Update `src/lib/modes.js`**

Find:
```js
export const REVIEW_SUBVIEWS  = ["monthly", "ytd", "journal"];
```

Replace with:
```js
export const REVIEW_SUBVIEWS  = ["journal", "monthly", "ytd"];
```

Find:
```js
export function defaultSubView(mode) {
  if (mode === "explore") return "positions";
  if (mode === "review")  return "monthly";
  return null;
}
```

Replace with:
```js
export function defaultSubView(mode) {
  if (mode === "explore") return "positions";
  if (mode === "review")  return "journal";
  return null;
}
```

- [ ] **Step 2: Update `src/lib/__tests__/modes.test.js`**

Find:
```js
  it("exposes Review sub-views in order with Monthly first", () => {
    expect(REVIEW_SUBVIEWS).toEqual(["monthly", "ytd", "journal"]);
  });
```

Replace with:
```js
  it("exposes Review sub-views in order with Journal first", () => {
    expect(REVIEW_SUBVIEWS).toEqual(["journal", "monthly", "ytd"]);
  });
```

Find:
```js
    expect(defaultSubView("review")).toBe("monthly");
```

Replace with:
```js
    expect(defaultSubView("review")).toBe("journal");
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/__tests__/modes.test.js
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/modes.js src/lib/__tests__/modes.test.js
git commit -m "feat(review): default Review sub-view to Journal, reorder chips"
```

---

## Task 9: Version bump, full verification, push

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Check origin/main's current version**

```bash
git fetch origin main
git show origin/main:package.json | grep '"version"'
```

- [ ] **Step 2: Bump minor version**

Layer 2 is a feature layer. Bump `1.45.0` → `1.46.0`. If origin/main is past `1.46.0` when you check, bump from there instead.

Edit `package.json`:
- `old_string`: `"version": "1.45.0",`
- `new_string`: `"version": "1.46.0",`

Edit `src/lib/constants.js`:
- `old_string`: `export const VERSION = "1.45.0";`
- `new_string`: `export const VERSION = "1.46.0";`

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS (5 suites: focusEngine, trading, vixBand, modes, positionAttention).

- [ ] **Step 4: Run build**

```bash
npx vite build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Visual verification**

```bash
npm run dev
```

Open http://localhost:5173 and verify:

1. **Persistent header slot 3:** now shows `P1 · N` in red when P1 alerts exist, or `✓ clear` in green when none. The "wired in Layer 2" caption is gone.
2. **Mode nav:** if P1 > 0, a red badge with the count appears next to "Focus" in the top tab bar.
3. **Focus mode renders positions-first:**
   - An `AlertsBanner` at the top for any non-position P1/P2 (e.g. cash below floor).
   - A `PositionsFeed` below showing every open CSP/CC/LEAP with inline priority strip, ticker, alert tag pills, G/L%, and proximity bar (`54/60` with a small progress line).
   - Macro calendar card preserved at the bottom when events exist.
4. **Sort order:** P1-tagged rows (red strip) on top; P2-tagged rows (amber strip) next; then untagged rows sorted by proximity-to-target descending.
5. **Review mode:** the Journal chip is now leftmost and selected by default; Monthly and YTD are to its right.
6. **Explore mode:** unchanged from Layer 1.

If dev env lacks data, the Focus view will show "No open positions" — that's fine, proves the empty state renders.

- [ ] **Step 6: Commit version bump + push**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.46.0 for layer 2 positions-first focus"
git push origin main
```

(All prior Layer 2 commits can be pushed along with this one, or each task pushed individually — either works.)

- [ ] **Step 7: Smoke-test production**

Wait for Vercel (~1–2 min), load the live URL, and re-run the checklist from Step 5. In prod the data is real, so you should see actual positions with alert tags and proximity bars.

If anything in prod differs from dev, the likely causes are: (a) the `/api/focus-context` endpoint isn't returning the expected `marketContext` shape, or (b) `quoteMap` is empty. Investigate via Network tab and fix in a follow-up commit.

---

## Acceptance criteria

- [ ] All prior tests plus the new `positionAttention` suite pass
- [ ] Focus view renders as positions-first with alert tags inline and proximity bars
- [ ] Non-position P1 alerts render as a banner above the feed
- [ ] PersistentHeader slot 3 shows live P1 count (red) or "✓ clear" (green)
- [ ] ModeNav Focus tab shows a red count badge when P1 > 0
- [ ] Review sub-nav is reordered Journal · Monthly · YTD; Journal is default
- [ ] No regressions in Explore or Review modes
- [ ] Version bumped in both `package.json` and `src/lib/constants.js`
- [ ] Commit pushed to `origin/main`

## Spec requirements addressed by Layer 2

| Spec section                              | Coverage |
|-------------------------------------------|----------|
| Focus view — positions-first              | ✅ Task 5, 6 |
| Inline alert tags per position            | ✅ Task 4 |
| Proximity-to-target with dynamic target   | ✅ Task 1, 4 |
| Non-position alerts as banner             | ✅ Task 3, 6 |
| P1 count in persistent header             | ✅ Task 7 |
| P1 badge on Focus mode tab                | ✅ Task 7 |
| Push-notification-aware visual weighting  | ✅ Task 4 (proximity bars dominate; P1 strip is restrained) |
| Review sub-nav Journal-first              | ✅ Task 8 |

## Deferred (explicit)

- **Today's G/L delta column** — quote shape has `{ mid, last, bid, ask }` but no open-price; defer until `/api/quotes` returns open.
- **Gemini posture-shift P3 cards** — requires shift-detection in the macro pipeline; separate layer.
- **Focus right-rail detail panel on desktop** — spec says ship empty-until-click; nothing to build.
- **Extract duplicated Chip component** — Layer 5 polish pass.

## Notes for the implementer

- Focus-tab previous `rulesOpen` reference panel and `infoExpanded` collapse logic were dropped in Task 6. If the user wants them back, they can be re-added in a follow-up PR — they were power-user aids, not required by the spec.
- `notifiedMap` from `/api/focus-context` is returned by `useFocusItems` but not consumed in Layer 2. It's there for push-notification-aware highlighting in a future layer.
- The attention list's `position` field carries the full original position object — downstream Layer 2.1+ work (right-rail detail panel, click-to-drill) will use it.
