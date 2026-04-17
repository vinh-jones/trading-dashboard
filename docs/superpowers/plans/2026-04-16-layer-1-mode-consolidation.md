# Layer 1 — Mode Consolidation & Persistent Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 7-tab layout into a 3-mode workspace (Focus / Explore / Review) with a persistent Tier-1 header that stays visible across every mode. This is Layer 1 of the dashboard redesign — a pure shell reorganization that rehomes existing tab components into modes without modifying their internals.

**Architecture:** Replace `AccountBar` with a new `PersistentHeader` that renders the same five signal slots (Free Cash, VIX, P1 placeholder, MTD, Search/⌘K slot) but in the spec's fixed 5-column grid. Replace the flat `activeTab` state in `App.jsx` with a `(mode, subView)` state pair. Introduce `ModeNav` (3 tabs) and two launcher components (`ExploreView`, `ReviewView`) that route to the existing tab components as their sub-views. Focus mode renders the existing `FocusTab` unchanged for this layer.

**Tech Stack:** React 18, Vite, existing inline-style theme tokens (`src/lib/theme.js`), Vitest for unit tests. No new dependencies.

**Out of scope for Layer 1:**
- P1 alert count badge (deferred to Layer 2 when the focus-items pipeline is consolidated)
- Positions-first Focus view (Layer 2)
- Command palette / ⌘K (Layer 3)
- Focus mode keybind (Layer 4)
- Visual polish / DESIGN.md token pass (Layer 5)

**Reference spec:** `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md`

---

## File Structure

### New files
- `src/lib/modes.js` — mode + sub-view constants, pure helpers
- `src/lib/__tests__/modes.test.js` — unit tests for helpers
- `src/components/PersistentHeader.jsx` — replaces `AccountBar.jsx`
- `src/components/ModeNav.jsx` — 3-tab mode switcher
- `src/components/ExploreView.jsx` — chip-nav launcher, hosts Positions/Radar/Macro
- `src/components/ReviewView.jsx` — chip-nav launcher, hosts Monthly/YTD/Journal

### Modified files
- `src/App.jsx` — replace tab state with mode+subView, render new shell
- `package.json` — version bump
- `src/lib/constants.js` — `VERSION` bump (same version as package.json)

### Deleted files
- `src/components/AccountBar.jsx` — superseded by `PersistentHeader`

---

## Task 1: Mode constants and helpers

**Files:**
- Create: `src/lib/modes.js`
- Create: `src/lib/__tests__/modes.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/modes.test.js`:

```js
import { describe, it, expect } from "vitest";
import { MODES, EXPLORE_SUBVIEWS, REVIEW_SUBVIEWS, defaultSubView, isValidMode, isValidSubView } from "../modes";

describe("modes", () => {
  it("exposes the three top-level modes", () => {
    expect(MODES).toEqual(["focus", "explore", "review"]);
  });

  it("exposes Explore sub-views in order", () => {
    expect(EXPLORE_SUBVIEWS).toEqual(["positions", "radar", "macro"]);
  });

  it("exposes Review sub-views in order with Monthly first", () => {
    expect(REVIEW_SUBVIEWS).toEqual(["monthly", "ytd", "journal"]);
  });

  it("returns the default sub-view for each mode", () => {
    expect(defaultSubView("focus")).toBe(null);
    expect(defaultSubView("explore")).toBe("positions");
    expect(defaultSubView("review")).toBe("monthly");
  });

  it("validates modes", () => {
    expect(isValidMode("focus")).toBe(true);
    expect(isValidMode("explore")).toBe(true);
    expect(isValidMode("review")).toBe(true);
    expect(isValidMode("bogus")).toBe(false);
  });

  it("validates sub-views per mode", () => {
    expect(isValidSubView("explore", "positions")).toBe(true);
    expect(isValidSubView("explore", "monthly")).toBe(false);
    expect(isValidSubView("review", "journal")).toBe(true);
    expect(isValidSubView("review", "radar")).toBe(false);
    expect(isValidSubView("focus", null)).toBe(true);
    expect(isValidSubView("focus", "anything")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/modes.test.js`
Expected: FAIL — `Failed to resolve import "../modes"`

- [ ] **Step 3: Implement `src/lib/modes.js`**

```js
// Top-level modes in the redesigned workspace.
// Focus = command center (home); Explore = drill-downs; Review = reporting & reflection.
export const MODES = ["focus", "explore", "review"];

export const EXPLORE_SUBVIEWS = ["positions", "radar", "macro"];
export const REVIEW_SUBVIEWS  = ["monthly", "ytd", "journal"];

export const SUBVIEW_LABELS = {
  positions: "Positions",
  radar:     "Radar",
  macro:     "Macro",
  monthly:   "Monthly",
  ytd:       "YTD",
  journal:   "Journal",
};

export const MODE_LABELS = {
  focus:   "Focus",
  explore: "Explore",
  review:  "Review",
};

export function defaultSubView(mode) {
  if (mode === "explore") return "positions";
  if (mode === "review")  return "monthly";
  return null;
}

export function isValidMode(mode) {
  return MODES.includes(mode);
}

export function isValidSubView(mode, subView) {
  if (mode === "focus")   return subView === null;
  if (mode === "explore") return EXPLORE_SUBVIEWS.includes(subView);
  if (mode === "review")  return REVIEW_SUBVIEWS.includes(subView);
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/modes.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/modes.js src/lib/__tests__/modes.test.js
git commit -m "feat(modes): add mode + sub-view constants for layer 1 redesign"
```

---

## Task 2: PersistentHeader component

Replaces `AccountBar.jsx` with a 5-slot grid per the spec. Logic (data read, VIX band, pipeline calc) is preserved wholesale — only the layout changes. The P1 slot is a placeholder visual (shows `—`) in Layer 1; Layer 2 wires the live count.

**Files:**
- Create: `src/components/PersistentHeader.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/PersistentHeader.jsx`:

```jsx
import { useData } from "../hooks/useData";
import { useLiveVix } from "../hooks/useLiveVix";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { calcPipeline } from "../lib/trading";
import { getVixBand } from "../lib/vixBand";
import { theme } from "../lib/theme";
import { SyncButton } from "./SyncButton";

// Slot wrapper — uniform label/value stacking with optional right-edge divider.
function Slot({ children, divider = true, style }) {
  return (
    <div style={{
      paddingRight:  divider ? theme.space[4] : 0,
      borderRight:   divider ? `1px solid ${theme.border.default}` : "none",
      minWidth:      0,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SlotLabel({ children }) {
  return (
    <div style={{
      fontSize:      theme.size.xs,
      color:         theme.text.muted,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      marginBottom:  2,
    }}>
      {children}
    </div>
  );
}

export function PersistentHeader({ captureRate }) {
  const { account, positions } = useData();
  const windowWidth = useWindowWidth();
  const isMobile    = windowWidth < 600;

  // ── Free cash + VIX band status ─────────────────────────────────────────────
  const freeCashEst    = account.free_cash_est ?? null;
  const freeCashPctEst = account.free_cash_pct_est ?? null;
  const { vix: liveVix, source: vixSource } = useLiveVix(account.vix_current);
  const band = getVixBand(liveVix);
  const status = !band || freeCashPctEst == null ? "unknown"
    : freeCashPctEst < band.floorPct   ? "over"
    : freeCashPctEst > band.ceilingPct ? "under"
    : "ok";
  const deltaAmt = account.account_value != null && band ? (() => {
    if (status === "over")  return (band.floorPct   - freeCashPctEst) * account.account_value;
    if (status === "under") return (freeCashPctEst  - band.ceilingPct) * account.account_value;
    return null;
  })() : null;
  const statusColor = { ok: theme.green, over: theme.red, under: theme.amber, unknown: theme.text.subtle }[status];

  // ── MTD progress ────────────────────────────────────────────────────────────
  const mtd      = account.month_to_date_premium ?? 0;
  const baseline = account.monthly_targets?.baseline ?? 15000;
  const stretch  = account.monthly_targets?.stretch  ?? 25000;
  const progress = Math.min((mtd / baseline) * 100, 100);

  // ── Pipeline ────────────────────────────────────────────────────────────────
  const { grossOpenPremium, expectedPipeline, hasPositions: hasPipeline } = calcPipeline(positions, captureRate);

  // Mobile uses 3 compact slots; desktop uses 5-slot grid.
  const gridCols = isMobile
    ? "1.3fr 0.9fr 0.8fr"
    : "1.4fr 1fr 0.9fr 1.4fr auto";

  return (
    <div style={{
      display:            "grid",
      gridTemplateColumns: gridCols,
      gap:                theme.space[4],
      padding:            `${theme.space[3]}px ${theme.space[5]}px`,
      background:         theme.bg.surface,
      border:             `1px solid ${theme.border.default}`,
      borderRadius:       theme.radius.md,
      marginBottom:       theme.space[5],
      alignItems:         "center",
    }}>

      {/* ── Slot 1: Free cash deployment ─────────────────────────────────── */}
      <Slot>
        <SlotLabel>Free Cash</SlotLabel>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>
          {freeCashEst != null
            ? <>{formatDollarsFull(freeCashEst)}{" "}<span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>({(freeCashPctEst * 100).toFixed(1)}%)</span></>
            : <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>—</span>
          }
        </div>
        {band && (
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 1 }}>
            Target {(band.floorPct * 100).toFixed(0)}–{(band.ceilingPct * 100).toFixed(0)}%
          </div>
        )}
        {status !== "unknown" && (
          <div style={{ fontSize: theme.size.xs, fontWeight: 500, color: statusColor, marginTop: 1 }}>
            {status === "ok"    && "✓ Within band"}
            {status === "over"  && `⚠ ${((band.floorPct - freeCashPctEst) * 100).toFixed(1)}% below floor · ~${formatDollars(deltaAmt)} to free up`}
            {status === "under" && `↓ ${((freeCashPctEst - band.ceilingPct) * 100).toFixed(1)}% above ceiling · ~${formatDollars(deltaAmt)} to deploy`}
          </div>
        )}
        {status === "unknown" && (
          <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 1 }}>Set VIX in account.json</div>
        )}
      </Slot>

      {/* ── Slot 2: VIX + posture band ───────────────────────────────────── */}
      <Slot>
        <SlotLabel>VIX</SlotLabel>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>
          {liveVix != null ? liveVix.toFixed(2) : "—"}
        </div>
        <div style={{ fontSize: theme.size.xs, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
          {band && (
            <span style={{
              padding:      "1px 7px",
              borderRadius: theme.radius.pill,
              border:       `1px solid ${theme.border.strong}`,
              color:        theme.text.secondary,
              fontSize:     theme.size.xs,
            }}>
              {band.sentiment}
            </span>
          )}
          <span style={{ color: vixSource === "live" ? theme.green : theme.text.faint, display: "flex", alignItems: "center", gap: 3 }}>
            {vixSource === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: theme.green, display: "inline-block" }} />}
            {vixSource === "live" ? "live" : vixSource === "manual" ? "manual" : "closed"}
          </span>
        </div>
      </Slot>

      {/* ── Slot 3: P1 alert count (placeholder for layer 1) ─────────────── */}
      <Slot>
        <SlotLabel>Alerts</SlotLabel>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.subtle }}>—</div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 2 }}>wired in Layer 2</div>
      </Slot>

      {/* ── Slot 4: MTD Premium + pipeline (hidden on mobile) ────────────── */}
      {!isMobile && (
        <Slot>
          <SlotLabel>MTD Premium</SlotLabel>
          <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: mtd >= baseline ? theme.green : theme.text.primary }}>
            {formatDollarsFull(mtd)}
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, fontWeight: 400 }}>{" "}/ {formatDollars(baseline)}</span>
          </div>
          <div style={{ height: 4, background: theme.border.default, borderRadius: theme.radius.sm, overflow: "hidden", marginTop: 4 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: progress >= 100 ? theme.green : theme.blueBold, borderRadius: theme.radius.sm, transition: "width 0.3s" }} />
          </div>
          {hasPipeline && (
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>
              Pipeline {formatDollarsFull(grossOpenPremium)} · {formatDollarsFull(expectedPipeline)} est
            </div>
          )}
        </Slot>
      )}

      {/* ── Slot 5: Sync / future ⌘K ─────────────────────────────────────── */}
      <Slot divider={false} style={{ textAlign: "right" }}>
        <SyncButton />
      </Slot>

    </div>
  );
}
```

- [ ] **Step 2: Verify the file parses**

Run: `npx vite build 2>&1 | tail -30`
Expected: build completes without syntax errors from `PersistentHeader.jsx`. (Import into App.jsx comes in Task 6; this step just checks the file parses.)

If the build fails because of the as-yet-untouched App.jsx, that's fine — the important thing is no error references PersistentHeader.jsx.

- [ ] **Step 3: Commit**

```bash
git add src/components/PersistentHeader.jsx
git commit -m "feat(header): add PersistentHeader replacing AccountBar content in 5-slot grid"
```

---

## Task 3: ModeNav component

Three-tab horizontal nav. Clicking a mode calls the `onChange` callback. Active mode gets the accent underline. No P1 badge yet (Layer 2).

**Files:**
- Create: `src/components/ModeNav.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/ModeNav.jsx`:

```jsx
import { MODES, MODE_LABELS } from "../lib/modes";
import { theme } from "../lib/theme";
import { useWindowWidth } from "../hooks/useWindowWidth";

export function ModeNav({ mode, onChange }) {
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
  });

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
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ModeNav.jsx
git commit -m "feat(nav): add ModeNav with Focus/Explore/Review tabs"
```

---

## Task 4: ExploreView launcher

Chip-nav at the top (Positions / Radar / Macro). Chip click swaps the body. Renders existing tab components unchanged. Accepts filter state as props (same shape that `App.jsx` already passes to the tab components).

**Files:**
- Create: `src/components/ExploreView.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/ExploreView.jsx`:

```jsx
import { useData } from "../hooks/useData";
import { EXPLORE_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../lib/modes";
import { theme } from "../lib/theme";
import { OpenPositionsTab } from "./OpenPositionsTab";
import { RadarTab } from "./RadarTab";
import { MacroTab } from "./MacroTab";

// Chip-nav button. Active chip gets the blue accent.
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

export function ExploreView({ subView, onSubViewChange }) {
  const { positions } = useData();
  const active = isValidSubView("explore", subView) ? subView : "positions";

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

      {active === "positions" && <OpenPositionsTab />}
      {active === "radar"     && <RadarTab positions={positions} />}
      {active === "macro"     && <MacroTab />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ExploreView.jsx
git commit -m "feat(explore): add Explore launcher with Positions/Radar/Macro chip nav"
```

---

## Task 5: ReviewView launcher

Chip-nav for Monthly / YTD / Journal. Default sub-view = Monthly. Accepts filter-state props (so `SummaryTab` and `CalendarTab` continue to work). `JournalTab` receives no props (matches current usage).

**Files:**
- Create: `src/components/ReviewView.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/ReviewView.jsx`:

```jsx
import { REVIEW_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../lib/modes";
import { theme } from "../lib/theme";
import { SummaryTab } from "./SummaryTab";
import { CalendarTab } from "./CalendarTab";
import { JournalTab } from "./journal/JournalTab";

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

export function ReviewView({
  subView,
  onSubViewChange,
  selectedTicker, setSelectedTicker,
  selectedType, setSelectedType,
  selectedDuration, setSelectedDuration,
  selectedDay, setSelectedDay,
  captureRate, setCaptureRate,
}) {
  const active = isValidSubView("review", subView) ? subView : "monthly";

  return (
    <div>
      <div style={{
        display:     "flex",
        gap:         theme.space[2],
        marginBottom: theme.space[4],
        overflowX:   "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {REVIEW_SUBVIEWS.map(sv => (
          <Chip key={sv} active={active === sv} onClick={() => onSubViewChange(sv)}>
            {SUBVIEW_LABELS[sv]}
          </Chip>
        ))}
      </div>

      {active === "monthly" && (
        <CalendarTab
          selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
          selectedType={selectedType}     setSelectedType={setSelectedType}
          selectedDay={selectedDay}       setSelectedDay={setSelectedDay}
          captureRate={captureRate}       setCaptureRate={setCaptureRate}
        />
      )}
      {active === "ytd" && (
        <SummaryTab
          selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
          selectedType={selectedType}     setSelectedType={setSelectedType}
          selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
        />
      )}
      {active === "journal" && <JournalTab />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ReviewView.jsx
git commit -m "feat(review): add Review launcher with Monthly/YTD/Journal chip nav"
```

---

## Task 6: Refactor App.jsx to use modes

Replace the `activeTab` state with `(mode, subView)` plus legacy-preserving behavior. Remove the old tab bar, AccountBar import, and direct tab rendering. Render new shell: `PersistentHeader` → `ModeNav` → filter-chip bar (preserved) → active mode view.

**Files:**
- Modify: `src/App.jsx`
- Delete: `src/components/AccountBar.jsx`

- [ ] **Step 1: Rewrite `src/App.jsx`**

Replace the entire contents with:

```jsx
import { useState, useEffect } from "react";
// Static JSON fallbacks — replaced by /api/data on mount in prod (see useEffect below).
const tradesData    = { trades: [] };
const positionsData = { open_csps: [], assigned_shares: [], open_leaps: [], open_spreads: [] };
const accountData   = {};

import { normalizeTrade } from "./lib/trading";
import { TYPE_COLORS, VERSION } from "./lib/constants";
import { theme } from "./lib/theme";
import { defaultSubView, isValidMode, isValidSubView } from "./lib/modes";
import { DataContext } from "./hooks/useData";

import { PersistentHeader } from "./components/PersistentHeader";
import { ModeNav } from "./components/ModeNav";
import { FocusTab } from "./components/FocusTab";
import { ExploreView } from "./components/ExploreView";
import { ReviewView } from "./components/ReviewView";

export default function TradeDashboard() {
  const [trades,    setTrades]    = useState(() => tradesData.trades.map(normalizeTrade));
  const [positions, setPositions] = useState(() => positionsData);
  const [account,   setAccount]   = useState(() => accountData);

  function refreshData(data) {
    if (data.trades)    setTrades(data.trades.map(normalizeTrade));
    if (data.positions) setPositions(data.positions);
    if (data.account)   setAccount(prev => ({ ...prev, ...data.account }));
  }

  async function deleteTrade(trade) {
    setTrades(prev => prev.filter(t => t !== trade));
    if (trade.id && import.meta.env.PROD) {
      try {
        await fetch(`/api/delete-trade?id=${encodeURIComponent(trade.id)}`, { method: "DELETE" });
      } catch (err) {
        console.warn("[deleteTrade] failed:", err.message);
      }
    }
  }

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    fetch("/api/data")
      .then(r => r.json())
      .then(data => { if (data.ok) refreshData(data); })
      .catch(err => console.warn("[TradeDashboard] /api/data fetch failed:", err.message));
  }, []);

  // ── Mode + sub-view state ─────────────────────────────────────────────────
  // Focus is the default home mode per spec.
  const [mode, setModeRaw]       = useState("focus");
  const [subView, setSubViewRaw] = useState(defaultSubView("focus"));

  function setMode(next) {
    if (!isValidMode(next)) return;
    setModeRaw(next);
    setSubViewRaw(defaultSubView(next));
  }

  function setSubView(next) {
    if (!isValidSubView(mode, next)) return;
    setSubViewRaw(next);
  }

  // ── Filter state — preserved from prior shell ─────────────────────────────
  const [selectedTicker,   setSelectedTicker]   = useState(null);
  const [selectedType,     setSelectedType]     = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [selectedDay,      setSelectedDay]      = useState(null);
  const [captureRate,      setCaptureRate]      = useState(0.60);

  // Filter chips are relevant only to Review sub-views (Monthly, YTD).
  const showFilterChips =
    mode === "review" &&
    (subView === "monthly" || subView === "ytd") &&
    (selectedTicker || selectedType || selectedDuration != null);

  return (
    <DataContext.Provider value={{ trades, positions, account, refreshData, deleteTrade }}>
      <div style={{
        fontFamily: theme.font.mono,
        background: theme.bg.base,
        color:      theme.text.secondary,
        minHeight:  "100vh",
        padding:    theme.space[5],
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: theme.text.primary, marginBottom: 4, letterSpacing: "0.5px" }}>
            TRADE DASHBOARD
          </h1>
          <div style={{
            fontSize:     theme.size.sm,
            color:        theme.text.subtle,
            marginBottom: theme.space[4],
            display:      "flex",
            alignItems:   "center",
            gap:          theme.space[3],
          }}>
            <span>as of {account.last_updated}</span>
            <span style={{ fontSize: theme.size.xs, color: theme.border.strong }}>v{VERSION}</span>
          </div>

          <PersistentHeader captureRate={captureRate} />
          <ModeNav mode={mode} onChange={setMode} />

          {showFilterChips && (
            <div style={{
              display:      "flex",
              alignItems:   "center",
              gap:          theme.space[2],
              marginBottom: theme.space[4],
              fontSize:     theme.size.md,
              color:        theme.text.muted,
              padding:      `${theme.space[2]}px ${theme.space[3]}px`,
              background:   theme.bg.surface,
              borderRadius: theme.radius.md,
              border:       `1px solid ${theme.border.default}`,
            }}>
              <span style={{ color: theme.text.subtle }}>Filters:</span>
              {selectedTicker && (
                <span style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: theme.blue, fontWeight: 500 }}>
                  {selectedTicker}
                  <span onClick={() => setSelectedTicker(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
                </span>
              )}
              {selectedType && (
                <span style={{ background: TYPE_COLORS[selectedType]?.bg || theme.bg.elevated, border: `1px solid ${TYPE_COLORS[selectedType]?.border || theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: TYPE_COLORS[selectedType]?.text || theme.text.primary, fontWeight: 500 }}>
                  {selectedType}
                  <span onClick={() => setSelectedType(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
                </span>
              )}
              {selectedDuration != null && subView === "ytd" && (
                <span style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: theme.blue, fontWeight: 500 }}>
                  {["0-1d", "2-3d", "4-7d", "8-14d", "15-30d", "30d+"][selectedDuration]}
                  <span onClick={() => setSelectedDuration(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
                </span>
              )}
              <button
                onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); setSelectedDay(null); }}
                style={{
                  background:    "transparent",
                  border:        "none",
                  color:         theme.text.muted,
                  cursor:        "pointer",
                  fontSize:      theme.size.sm,
                  fontFamily:    "inherit",
                  marginLeft:    "auto",
                  textDecoration:"underline",
                }}
              >
                Clear all
              </button>
            </div>
          )}

          {mode === "focus"   && <FocusTab />}
          {mode === "explore" && (
            <ExploreView
              subView={subView}
              onSubViewChange={setSubView}
            />
          )}
          {mode === "review" && (
            <ReviewView
              subView={subView}
              onSubViewChange={setSubView}
              selectedTicker={selectedTicker}     setSelectedTicker={setSelectedTicker}
              selectedType={selectedType}         setSelectedType={setSelectedType}
              selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
              selectedDay={selectedDay}           setSelectedDay={setSelectedDay}
              captureRate={captureRate}           setCaptureRate={setCaptureRate}
            />
          )}
        </div>
      </div>
    </DataContext.Provider>
  );
}
```

- [ ] **Step 2: Delete the superseded AccountBar component**

```bash
git rm src/components/AccountBar.jsx
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests PASS (focusEngine, trading, vixBand, modes).

Fix any breakage before continuing. Nothing in this refactor should touch lib behavior, so failures likely indicate a stray import of `AccountBar` elsewhere — grep for it:

```bash
npx grep -rn "AccountBar" src/
```

If that returns anything other than the commit-removed file reference in `.git`, remove the import.

- [ ] **Step 4: Run the build**

Run: `npx vite build 2>&1 | tail -30`
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): switch shell to 3-mode workspace with PersistentHeader"
```

(The AccountBar deletion was staged in Step 2; it's now part of this commit.)

---

## Task 7: Version bump, visual verification, push

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Check main's current version**

Per `CLAUDE.md`, always rebase version off of origin/main.

```bash
git fetch origin main
git show origin/main:package.json | grep '"version"'
```

- [ ] **Step 2: Decide the new version**

Layer 1 is a feature (new IA), not a bugfix. Bump the **minor** version: `1.44.4` → `1.45.0`. If origin/main is already past `1.45.0` when you run Step 1, bump its minor instead.

- [ ] **Step 3: Update `package.json`**

Edit `package.json` line 4 (the `"version"` field) to the new version string.

- [ ] **Step 4: Update `src/lib/constants.js`**

Find the line `export const VERSION = "..."` and update its value to match `package.json`. Run:

```bash
npx grep -n "VERSION" src/lib/constants.js
```

to locate it, then Edit with:
- `old_string`: `export const VERSION = "1.44.4";`
- `new_string`: `export const VERSION = "1.45.0";`

(Adjust if the old value is different when you read the file.)

- [ ] **Step 5: Visual verification via preview**

Local preview requires env vars (Supabase, Google AI). If they're not configured, the app renders an empty shell, which is still sufficient to visually verify Layer 1's structural changes.

Start the dev server:

```bash
npm run dev
```

Open http://localhost:5173 and verify:

1. **Header:** 5-slot grid at the top (Free Cash / VIX / Alerts / MTD / Sync). On mobile width (<600px) the MTD slot collapses away, leaving 3+Sync.
2. **Mode nav:** three tabs (Focus / Explore / Review), Focus is selected by default.
3. **Focus mode:** existing FocusTab content renders (may show empty states without data — acceptable).
4. **Click Explore:** chip row appears (Positions / Radar / Macro), Positions is selected by default, `OpenPositionsTab` renders.
5. **Click each chip:** Radar and Macro sub-views load.
6. **Click Review:** chip row appears (Monthly / YTD / Journal), Monthly is selected by default, `CalendarTab` renders.
7. **Click each Review chip:** YTD and Journal sub-views load.
8. **Filter chips row** is absent until you interact with Monthly/YTD — it's not on Focus or Explore or Journal. (Setting a filter from Monthly/YTD should make the row appear and persist within Review.)

If any of the above fails, return to the responsible task (Tasks 2–6) and fix the component before proceeding.

- [ ] **Step 6: Run the full test suite one more time**

```bash
npx vitest run
```
Expected: all PASS.

- [ ] **Step 7: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.45.0 for layer 1 mode consolidation"
git push origin main
```

Per `CLAUDE.md`, the push is required — the change is not "done" until it's pushed.

- [ ] **Step 8: Smoke-test production**

Wait for Vercel to deploy (~1–2 min). Load the production URL and re-run the visual verification checklist from Step 5. The live environment has real data, so the header should show real Free Cash / VIX / MTD values.

If production fails in a way that dev didn't, it's almost certainly a prod-only import path issue. Check the browser console and fix in a follow-up commit.

---

## Acceptance criteria

Layer 1 is complete when:

- [ ] Three modes (Focus / Explore / Review) render correctly on desktop and mobile
- [ ] Each Explore sub-view (Positions, Radar, Macro) functions identically to the pre-refactor tab
- [ ] Each Review sub-view (Monthly, YTD, Journal) functions identically to the pre-refactor tab
- [ ] Focus mode shows the existing FocusTab unchanged
- [ ] PersistentHeader shows Free Cash / VIX / Alerts (placeholder) / MTD / Sync on desktop; 3 slots + Sync on mobile
- [ ] All prior Vitest tests still pass (focusEngine, trading, vixBand)
- [ ] New modes tests pass
- [ ] Version is bumped in both `package.json` and `src/lib/constants.js`
- [ ] Commit is pushed to `origin/main` and Vercel deploys successfully

## Spec requirements addressed by Layer 1

| Spec section                      | Layer 1 coverage |
|-----------------------------------|------------------|
| IA: 7 tabs → 3 modes              | ✅ Tasks 3–6     |
| Persistent header (Tier-1 slots)  | ✅ Task 2 (P1 count placeholder; live count in Layer 2) |
| Explore chip launcher             | ✅ Task 4        |
| Review sub-nav (Monthly/YTD/Journal) | ✅ Task 5     |
| Focus as home (default mode)      | ✅ Task 6        |
| Keep all existing feature logic   | ✅ No lib / hook modifications anywhere |
| Mobile compact header             | ✅ Task 2 (width < 600 collapses) |

## Out-of-scope (defer to later layers)

- Positions-first Focus content (Layer 2)
- P1 alert count wired live to header + ModeNav badge (Layer 2)
- Proximity-to-target progress bars (Layer 2)
- Non-position alert banner (Layer 2)
- Gemini posture-shift P3 cards in Focus (Layer 2)
- ⌘K command palette (Layer 3)
- Focus mode / `F` keybind (Layer 4)
- DESIGN.md token pass (Layer 5)
