# Layer 3 — Command Palette (⌘K) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `⌘K` / search-triggered command palette that lets the user jump to any open position or fire a pinned action (Open Journal, New EOD entry, Open Radar, Open Macro) without navigating through modes manually. Mobile users access the same palette via a search icon in the persistent header.

**Architecture:** Build `paletteItems.js` as a pure library that composes the searchable item list from positions + a fixed set of pinned actions. `useHotkey` is a tiny key-listener hook. `CommandPalette.jsx` is a self-contained modal with search, keyboard navigation, and an `onSelect` handler. App.jsx owns the open/closed state, the action dispatcher (which mutates mode/subView/journalIntent), and passes the trigger down to `PersistentHeader` for the mobile icon. The journal "New EOD entry" action works via a one-shot `journalIntent` flag that `JournalTab` consumes in a `useEffect` on mount.

**Tech Stack:** React 18, Vite, Vitest. No new dependencies — pure inline React + theme tokens.

**Out of scope for Layer 3:**
- Journal entry body search (only entry types are palette-actionable; prose search is a later layer)
- Macro widget deep-link jumps (Open Macro navigates to Explore → Macro generically)
- Scroll-to or filter-to target after navigation (palette only routes to the mode/subView)
- Keyboard-accessible palette trigger icon on desktop (⌘K is the canonical path; click-to-open is mobile only)
- Focus-mode keybind (Layer 4)
- DESIGN.md polish pass (Layer 5)

**Reference spec:** `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md` (see "Layer 3 — Command palette (⌘K)")

---

## File structure

### New files
- `src/lib/paletteItems.js` — pure builder + filter
- `src/lib/__tests__/paletteItems.test.js`
- `src/hooks/useHotkey.js` — keydown listener with modifier support
- `src/components/palette/CommandPalette.jsx` — modal UI
- `src/components/palette/PaletteItem.jsx` — single result row

### Modified files
- `src/App.jsx` — palette state, hotkey binding, action dispatcher, `journalIntent` one-shot
- `src/components/PersistentHeader.jsx` — mobile 🔍 trigger
- `src/components/ReviewView.jsx` — forward `journalIntent` prop
- `src/components/journal/JournalTab.jsx` — accept + consume `journalIntent` prop
- `package.json`, `src/lib/constants.js` — version bump

---

## Task 1: paletteItems library

Pure functions that build and filter the palette item list. No React, no hooks.

**Item shape:**
```js
{
  id:       string,     // stable unique key
  kind:     "action" | "position",
  title:    string,     // primary line
  subtitle?: string,    // secondary line (muted)
  action:   string,     // dispatcher key (see Task 4)
  payload?: any,        // action-specific data
  pinned?:  boolean,    // true for always-top items
}
```

**Files:**
- Create: `src/lib/paletteItems.js`
- Create: `src/lib/__tests__/paletteItems.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/paletteItems.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildPaletteItems, filterPaletteItems } from "../paletteItems";

describe("buildPaletteItems", () => {
  it("returns pinned actions first when no positions", () => {
    const out = buildPaletteItems({ positions: null });
    expect(out.every(it => it.pinned)).toBe(true);
    expect(out.map(it => it.action)).toEqual(expect.arrayContaining([
      "open_journal", "new_eod_entry", "open_radar", "open_macro",
    ]));
  });

  it("emits one item per open CSP", () => {
    const positions = {
      open_csps:  [{ ticker: "NVDA", strike: 485, expiry_date: "2026-05-01" }],
      open_leaps: [], assigned_shares: [], open_spreads: [],
    };
    const out = buildPaletteItems({ positions });
    const csp = out.find(it => it.kind === "position" && it.payload?.ticker === "NVDA");
    expect(csp).toBeTruthy();
    expect(csp.title).toBe("NVDA CSP $485");
  });

  it("emits items for active CCs on assigned shares", () => {
    const positions = {
      open_csps: [],
      open_leaps: [],
      open_spreads: [],
      assigned_shares: [{
        ticker: "AAPL",
        active_cc: { strike: 185, expiry_date: "2026-05-15" },
      }],
    };
    const out = buildPaletteItems({ positions });
    const cc = out.find(it => it.kind === "position" && it.title.startsWith("AAPL CC"));
    expect(cc).toBeTruthy();
    expect(cc.title).toBe("AAPL CC $185");
  });

  it("emits items for LEAPs (top-level and nested)", () => {
    const positions = {
      open_csps: [],
      open_spreads: [],
      open_leaps: [{ ticker: "SPY", strike: 400, expiry_date: "2027-01-15" }],
      assigned_shares: [{
        ticker: "AAPL",
        open_leaps: [{ strike: 150, expiry_date: "2027-06-18" }],
      }],
    };
    const out = buildPaletteItems({ positions });
    const leaps = out.filter(it => it.title.includes("LEAP"));
    expect(leaps.map(it => it.title).sort()).toEqual(["AAPL LEAP $150", "SPY LEAP $400"]);
  });

  it("pinned items always come first in the returned order", () => {
    const positions = {
      open_csps: [{ ticker: "A", strike: 1, expiry_date: "2026-05-01" }],
      open_leaps: [], assigned_shares: [], open_spreads: [],
    };
    const out = buildPaletteItems({ positions });
    const firstNonPinnedIdx = out.findIndex(it => !it.pinned);
    const lastPinnedIdx     = [...out].reverse().findIndex(it => it.pinned);
    expect(firstNonPinnedIdx).toBeGreaterThan(-1);
    expect(out.slice(0, firstNonPinnedIdx).every(it => it.pinned)).toBe(true);
  });
});

describe("filterPaletteItems", () => {
  const items = [
    { id: "a", kind: "action",   title: "Open Journal",     pinned: true,  action: "open_journal" },
    { id: "b", kind: "action",   title: "New EOD entry",    pinned: true,  action: "new_eod_entry" },
    { id: "c", kind: "position", title: "NVDA CSP $485", subtitle: "12 DTE", action: "open_position" },
    { id: "d", kind: "position", title: "TSLA CC $210",  subtitle: "8 DTE",  action: "open_position" },
  ];

  it("empty query returns all items in original order", () => {
    expect(filterPaletteItems(items, "")).toEqual(items);
    expect(filterPaletteItems(items, "   ")).toEqual(items);
  });

  it("filters by title substring (case-insensitive)", () => {
    const out = filterPaletteItems(items, "nvda");
    expect(out.map(it => it.id)).toEqual(["c"]);
  });

  it("matches subtitle as well as title", () => {
    const out = filterPaletteItems(items, "12 DTE");
    expect(out.map(it => it.id)).toEqual(["c"]);
  });

  it("matches on each whitespace-separated token independently (AND)", () => {
    const out = filterPaletteItems(items, "csp nvda");
    expect(out.map(it => it.id)).toEqual(["c"]);
    const miss = filterPaletteItems(items, "csp tsla");
    expect(miss).toEqual([]);
  });

  it("when searching, pinned actions are included only when they match", () => {
    const out = filterPaletteItems(items, "journal");
    expect(out.map(it => it.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/lib/__tests__/paletteItems.test.js` → FAIL (unresolved import).

- [ ] **Step 3: Implement `src/lib/paletteItems.js`**

```js
// Pinned actions are always present and always sorted before position results.
// Each item has a stable `id` so React keys don't collide across rebuilds.
const PINNED_ACTIONS = [
  { id: "action:open_journal",   kind: "action", title: "Open Journal",              subtitle: "Review → Journal",                        action: "open_journal",   pinned: true },
  { id: "action:new_eod_entry",  kind: "action", title: "New EOD entry",             subtitle: "Review → Journal · opens EOD form",       action: "new_eod_entry",  pinned: true },
  { id: "action:open_radar",     kind: "action", title: "Open Radar",                subtitle: "Explore → Radar",                         action: "open_radar",     pinned: true },
  { id: "action:open_macro",     kind: "action", title: "Open Macro summary",        subtitle: "Explore → Macro",                         action: "open_macro",     pinned: true },
];

function cspItems(positions) {
  return (positions?.open_csps || []).map(p => ({
    id:       `pos:csp:${p.ticker}:${p.strike}:${p.expiry_date}`,
    kind:     "position",
    title:    `${p.ticker} CSP $${p.strike}`,
    subtitle: p.expiry_date ? `exp ${p.expiry_date}` : undefined,
    action:   "open_position",
    payload:  { ticker: p.ticker, type: "CSP", position: p },
  }));
}

function ccItems(positions) {
  const rows = [];
  for (const s of (positions?.assigned_shares || [])) {
    if (!s.active_cc) continue;
    rows.push({
      id:       `pos:cc:${s.ticker}:${s.active_cc.strike}:${s.active_cc.expiry_date}`,
      kind:     "position",
      title:    `${s.ticker} CC $${s.active_cc.strike}`,
      subtitle: s.active_cc.expiry_date ? `exp ${s.active_cc.expiry_date}` : undefined,
      action:   "open_position",
      payload:  { ticker: s.ticker, type: "CC", position: { ...s.active_cc, ticker: s.ticker } },
    });
  }
  return rows;
}

function leapItems(positions) {
  const top = (positions?.open_leaps || []).map(l => ({
    id:       `pos:leap:${l.ticker}:${l.strike}:${l.expiry_date}`,
    kind:     "position",
    title:    `${l.ticker} LEAP $${l.strike}`,
    subtitle: l.expiry_date ? `exp ${l.expiry_date}` : undefined,
    action:   "open_position",
    payload:  { ticker: l.ticker, type: "LEAP", position: l },
  }));
  const nested = [];
  for (const s of (positions?.assigned_shares || [])) {
    for (const l of (s.open_leaps || [])) {
      const ticker = l.ticker ?? s.ticker;
      nested.push({
        id:       `pos:leap:${ticker}:${l.strike}:${l.expiry_date}`,
        kind:     "position",
        title:    `${ticker} LEAP $${l.strike}`,
        subtitle: l.expiry_date ? `exp ${l.expiry_date}` : undefined,
        action:   "open_position",
        payload:  { ticker, type: "LEAP", position: { ...l, ticker } },
      });
    }
  }
  return [...top, ...nested];
}

export function buildPaletteItems({ positions }) {
  return [
    ...PINNED_ACTIONS,
    ...cspItems(positions),
    ...ccItems(positions),
    ...leapItems(positions),
  ];
}

// AND-match: every whitespace-separated token must appear in title or subtitle.
// Empty / whitespace query returns all items unchanged.
export function filterPaletteItems(items, query) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return items;
  const tokens = q.split(/\s+/).filter(Boolean);
  return items.filter(it => {
    const hay = `${it.title} ${it.subtitle ?? ""}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
}
```

- [ ] **Step 4: Tests pass**

`npx vitest run src/lib/__tests__/paletteItems.test.js` → 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paletteItems.js src/lib/__tests__/paletteItems.test.js
git commit -m "feat(palette): add paletteItems builder + filter for command palette"
git push origin main
```

---

## Task 2: useHotkey hook

Tiny hook wrapping `window.addEventListener("keydown")`. Supports `mod+<key>` where `mod` matches ⌘ on Mac and Ctrl on other platforms.

**Files:**
- Create: `src/hooks/useHotkey.js`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useHotkey.js`:

```js
import { useEffect } from "react";

// Matches mac's ⌘ and win/linux Ctrl — so "mod+k" Just Works cross-platform.
function matches(event, combo) {
  const parts = combo.toLowerCase().split("+");
  const key   = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");

  if (event.key.toLowerCase() !== key) return false;
  if (wantMod && !(event.metaKey || event.ctrlKey)) return false;
  if (!wantMod && (event.metaKey || event.ctrlKey)) return false;
  if (wantShift !== event.shiftKey) return false;
  return true;
}

// Binds a global keydown handler. `handler` receives the event so callers can
// preventDefault when they want to override a browser shortcut.
export function useHotkey(combo, handler, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event) => {
      if (matches(event, combo)) handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, handler, enabled]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHotkey.js
git commit -m "feat(hotkey): add useHotkey hook with mod+key cross-platform matching"
git push origin main
```

---

## Task 3: PaletteItem component

One row in the palette list. Separate file so `CommandPalette` stays focused on behavior.

**Files:**
- Create: `src/components/palette/PaletteItem.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/palette/PaletteItem.jsx`:

```jsx
import { theme } from "../../lib/theme";

export function PaletteItem({ item, active, onClick, onMouseEnter }) {
  const isAction = item.kind === "action";
  return (
    <div
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           theme.space[3],
        padding:       `${theme.space[2]}px ${theme.space[3]}px`,
        cursor:        "pointer",
        background:    active ? theme.bg.elevated : "transparent",
        borderLeft:    active ? `2px solid ${theme.blue}` : "2px solid transparent",
      }}
    >
      <span style={{
        fontSize:      theme.size.xs,
        color:         isAction ? theme.blue : theme.text.subtle,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        minWidth:      52,
      }}>
        {isAction ? "Action" : "Position"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: theme.size.md,
          color:    theme.text.primary,
          fontWeight: 500,
        }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{
            fontSize: theme.size.xs,
            color:    theme.text.muted,
            marginTop: 1,
          }}>
            {item.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/palette/PaletteItem.jsx
git commit -m "feat(palette): add PaletteItem row component"
git push origin main
```

---

## Task 4: CommandPalette modal

The palette itself: modal overlay, search input, keyboard nav, empty states.

**Files:**
- Create: `src/components/palette/CommandPalette.jsx`

- [ ] **Step 1: Create the modal**

Create `src/components/palette/CommandPalette.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { theme } from "../../lib/theme";
import { filterPaletteItems } from "../../lib/paletteItems";
import { PaletteItem } from "./PaletteItem";

export function CommandPalette({ open, items, onClose, onSelect }) {
  const [query,     setQuery]     = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  // Reset state + focus the input every time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Defer focus one tick so the input actually exists in the DOM.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => filterPaletteItems(items, query), [items, query]);

  // Clamp the active index when the result set shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) onSelect(item);
      return;
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset:    0,
        zIndex:   1000,
        background: "rgba(0, 0, 0, 0.6)",
        display:    "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Command palette"
        style={{
          width:         "min(640px, 92vw)",
          maxHeight:     "70vh",
          background:    theme.bg.surface,
          border:        `1px solid ${theme.border.strong}`,
          borderRadius:  theme.radius.md,
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          fontFamily:    theme.font.mono,
          boxShadow:     "0 20px 40px rgba(0,0,0,0.4)",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
          placeholder="Search positions, actions…"
          autoFocus
          style={{
            padding:    `${theme.space[3]}px ${theme.space[4]}px`,
            fontSize:   theme.size.md,
            fontFamily: "inherit",
            background: theme.bg.base,
            color:      theme.text.primary,
            border:     "none",
            borderBottom: `1px solid ${theme.border.default}`,
            outline:    "none",
          }}
        />
        <div role="listbox" style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{
              padding:   theme.space[4],
              textAlign: "center",
              color:     theme.text.subtle,
              fontSize:  theme.size.sm,
            }}>
              No matches.
            </div>
          ) : (
            filtered.map((item, i) => (
              <PaletteItem
                key={item.id}
                item={item}
                active={i === activeIdx}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setActiveIdx(i)}
              />
            ))
          )}
        </div>
        <div style={{
          padding:      `${theme.space[2]}px ${theme.space[3]}px`,
          borderTop:    `1px solid ${theme.border.default}`,
          fontSize:     theme.size.xs,
          color:        theme.text.subtle,
          display:      "flex",
          gap:          theme.space[4],
          background:   theme.bg.base,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/palette/CommandPalette.jsx
git commit -m "feat(palette): add CommandPalette modal with search + keyboard nav"
git push origin main
```

---

## Task 5: Add journalIntent prop path (App → ReviewView → JournalTab)

"New EOD entry" action needs to tell `JournalTab` to set `entryType = "eod_update"` on arrival. One-shot intent: App sets it, JournalTab consumes it in a `useEffect` and calls back to clear.

**Files:**
- Modify: `src/components/journal/JournalTab.jsx`
- Modify: `src/components/ReviewView.jsx`

- [ ] **Step 1: Update `src/components/journal/JournalTab.jsx`**

Change the signature line:

```jsx
export function JournalTab() {
```

to:

```jsx
export function JournalTab({ journalIntent, onJournalIntentConsumed }) {
```

Then, immediately after the existing `entryType` / `setEntryType` state declaration (search for `const [entryType, setEntryType] = useState("trade_note");`), add:

```jsx
  // Consume an incoming intent exactly once (fired by the command palette).
  useEffect(() => {
    if (journalIntent === "eod_update") {
      setEntryType("eod_update");
      onJournalIntentConsumed?.();
    }
  }, [journalIntent, onJournalIntentConsumed]);
```

(`useEffect` is already imported at the top of the file.)

- [ ] **Step 2: Update `src/components/ReviewView.jsx`**

Change the signature to accept and forward the two new props:

Find:
```jsx
export function ReviewView({
  subView,
  onSubViewChange,
  selectedTicker, setSelectedTicker,
  selectedType, setSelectedType,
  selectedDuration, setSelectedDuration,
  selectedDay, setSelectedDay,
  captureRate, setCaptureRate,
}) {
```

Replace with:
```jsx
export function ReviewView({
  subView,
  onSubViewChange,
  selectedTicker, setSelectedTicker,
  selectedType, setSelectedType,
  selectedDuration, setSelectedDuration,
  selectedDay, setSelectedDay,
  captureRate, setCaptureRate,
  journalIntent, onJournalIntentConsumed,
}) {
```

Find:
```jsx
      {active === "journal" && <JournalTab />}
```

Replace with:
```jsx
      {active === "journal" && (
        <JournalTab
          journalIntent={journalIntent}
          onJournalIntentConsumed={onJournalIntentConsumed}
        />
      )}
```

- [ ] **Step 3: Verify build**

`npx vite build 2>&1 | tail -6` — should succeed.

- [ ] **Step 4: Commit**

```bash
git add src/components/journal/JournalTab.jsx src/components/ReviewView.jsx
git commit -m "feat(journal): accept one-shot journalIntent prop for EOD-entry handoff"
git push origin main
```

---

## Task 6: Mount palette in App.jsx

Wire palette state + `⌘K` hotkey + action dispatcher + journalIntent.

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports near the top of App.jsx**

Find the existing imports block ending with:
```jsx
import { useFocusItems } from "./hooks/useFocusItems";
```

Add directly below:
```jsx
import { useHotkey } from "./hooks/useHotkey";
import { buildPaletteItems } from "./lib/paletteItems";
import { CommandPalette } from "./components/palette/CommandPalette";
```

- [ ] **Step 2: Add palette state + dispatcher near the other mode state**

Find the block starting with `// ── Mode + sub-view state ──`. Directly **before** that block, add:

```jsx
  // ── Command palette state ────────────────────────────────────────────────
  const [paletteOpen,   setPaletteOpen]   = useState(false);
  const [journalIntent, setJournalIntent] = useState(null);

  useHotkey("mod+k", (e) => {
    e.preventDefault();
    setPaletteOpen(true);
  });

  const paletteItems = useMemo(() => buildPaletteItems({ positions }), [positions]);

```

You also need to import `useMemo` — find the top-level `import { useState, useEffect } from "react";` line and change it to:

```jsx
import { useState, useEffect, useMemo } from "react";
```

- [ ] **Step 3: Add the dispatcher function**

After the two `setMode` / `setSubView` function definitions (still inside `TradeDashboard`), add:

```jsx
  function handlePaletteSelect(item) {
    setPaletteOpen(false);
    switch (item.action) {
      case "open_journal":
        setMode("review");
        setSubViewRaw("journal");
        return;
      case "new_eod_entry":
        setMode("review");
        setSubViewRaw("journal");
        setJournalIntent("eod_update");
        return;
      case "open_radar":
        setMode("explore");
        setSubViewRaw("radar");
        return;
      case "open_macro":
        setMode("explore");
        setSubViewRaw("macro");
        return;
      case "open_position":
        // Layer 3: route to Explore → Positions; scroll-to is a later layer.
        setMode("explore");
        setSubViewRaw("positions");
        return;
      default:
        return;
    }
  }
```

(Using `setSubViewRaw` so sub-view mutations stick even when current mode differs from the new one.)

- [ ] **Step 4: Pass `journalIntent` through ReviewView**

Find the `ReviewView` render block:
```jsx
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
```

Replace with:
```jsx
          {mode === "review" && (
            <ReviewView
              subView={subView}
              onSubViewChange={setSubView}
              selectedTicker={selectedTicker}     setSelectedTicker={setSelectedTicker}
              selectedType={selectedType}         setSelectedType={setSelectedType}
              selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
              selectedDay={selectedDay}           setSelectedDay={setSelectedDay}
              captureRate={captureRate}           setCaptureRate={setCaptureRate}
              journalIntent={journalIntent}
              onJournalIntentConsumed={() => setJournalIntent(null)}
            />
          )}
```

- [ ] **Step 5: Pass palette trigger to PersistentHeader**

Find:
```jsx
          <PersistentHeader captureRate={captureRate} p1Count={focus.p1Count} />
```

Replace with:
```jsx
          <PersistentHeader
            captureRate={captureRate}
            p1Count={focus.p1Count}
            onOpenPalette={() => setPaletteOpen(true)}
          />
```

- [ ] **Step 6: Mount the palette itself**

Find the closing `</div>` of the `DataContext.Provider`-inner wrapper (it's right before `</DataContext.Provider>`). Directly **after** that inner `</div>`, **before** `</DataContext.Provider>`, add:

```jsx
          <CommandPalette
            open={paletteOpen}
            items={paletteItems}
            onClose={() => setPaletteOpen(false)}
            onSelect={handlePaletteSelect}
          />
```

(The palette renders as a fixed-position overlay so its position in the tree doesn't affect layout.)

- [ ] **Step 7: Verify build + existing tests**

```bash
npx vite build 2>&1 | tail -6
npx vitest run
```

Expected: build succeeds; all tests pass (68 from before + 10 new palette tests = 78).

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat(palette): mount CommandPalette with cmd+k hotkey and action dispatcher"
git push origin main
```

---

## Task 7: Mobile palette trigger in PersistentHeader

Desktop users get ⌘K; mobile users get a 🔍 icon. Keep it minimal — only render on mobile widths.

**Files:**
- Modify: `src/components/PersistentHeader.jsx`

- [ ] **Step 1: Update signature + render trigger**

Find the signature line:
```jsx
export function PersistentHeader({ captureRate, p1Count = 0 }) {
```

Replace with:
```jsx
export function PersistentHeader({ captureRate, p1Count = 0, onOpenPalette }) {
```

Find the final `{/* ── Slot 5: Sync / future ⌘K ─────...*/}` block:

```jsx
      {/* ── Slot 5: Sync / future ⌘K ─────────────────────────────────────── */}
      <Slot divider={false} style={{ textAlign: "right" }}>
        <SyncButton />
      </Slot>
```

Replace with:

```jsx
      {/* ── Slot 5: Search (mobile) + Sync ───────────────────────────────── */}
      <Slot divider={false} style={{ textAlign: "right", display: "flex", gap: theme.space[2], justifyContent: "flex-end", alignItems: "center" }}>
        {isMobile && onOpenPalette && (
          <button
            onClick={onOpenPalette}
            aria-label="Open command palette"
            style={{
              background:    theme.bg.base,
              border:        `1px solid ${theme.border.strong}`,
              borderRadius:  theme.radius.sm,
              color:         theme.text.secondary,
              padding:       "6px 10px",
              cursor:        "pointer",
              fontSize:      theme.size.md,
              fontFamily:    "inherit",
            }}
          >
            🔍
          </button>
        )}
        <SyncButton />
      </Slot>
```

(The `isMobile` variable is already defined earlier in the component from `useWindowWidth`.)

- [ ] **Step 2: Verify build**

`npx vite build 2>&1 | tail -6` — should succeed.

- [ ] **Step 3: Commit**

```bash
git add src/components/PersistentHeader.jsx
git commit -m "feat(palette): add mobile search button to PersistentHeader"
git push origin main
```

---

## Task 8: Version bump + smoke verify + push

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Check origin's current version**

```bash
git fetch origin main
git show origin/main:package.json | grep '"version"'
```

- [ ] **Step 2: Bump to 1.47.0**

Layer 3 is a feature. Bump minor: `1.46.x` → `1.47.0`. If origin is ahead of 1.46 when you check, increment from there instead.

Edit `package.json` — change the `"version"` field.
Edit `src/lib/constants.js` — change `export const VERSION`.

- [ ] **Step 3: Run full test suite + build**

```bash
npx vitest run
npx vite build 2>&1 | tail -6
```

Expected: 78 tests pass (68 + 10 new palette tests). Build succeeds.

- [ ] **Step 4: Visual verification via preview**

Local preview can't render without env vars (known). Skip local verification and rely on prod smoke-test.

- [ ] **Step 5: Commit + push**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.47.0 for layer 3 command palette"
git push origin main
```

- [ ] **Step 6: Prod smoke-test**

After Vercel deploys (~1-2 min), load the live URL and verify:

1. Press `⌘K` (macOS) or `Ctrl+K` (other) — palette opens, input focused, pinned actions visible.
2. Type `nvda` (or any open-position ticker) — filter narrows to matching positions.
3. Press `↓` / `↑` — selection moves through filtered list.
4. Press `Enter` on "Open Journal" — palette closes, app navigates to Review → Journal.
5. Press `⌘K` again, select "New EOD entry" — lands in Review → Journal and the entry-type is `eod_update` (EOD form visible).
6. Press `⌘K` again, select "Open Radar" / "Open Macro" — lands in the right Explore sub-view.
7. Press `Esc` while palette is open — it closes without navigating.
8. On mobile (or with narrow viewport), the 🔍 button in the persistent header opens the same palette.

If any step fails, the issue is almost certainly in Task 6 (App.jsx wiring). Investigate via the browser console and file a follow-up commit.

---

## Acceptance criteria

- [ ] New `paletteItems` lib passes all 10 tests
- [ ] `⌘K` / `Ctrl+K` opens the palette from any mode
- [ ] `Esc` closes the palette
- [ ] Arrow keys navigate results; `Enter` fires the highlighted item
- [ ] Pinned actions (Open Journal, New EOD entry, Open Radar, Open Macro) route to the correct mode/subView
- [ ] "New EOD entry" sets JournalTab's entryType to `eod_update` on arrival
- [ ] Position search returns filtered results for open CSPs, CCs, LEAPs (top-level and nested)
- [ ] Mobile 🔍 button in PersistentHeader opens the palette
- [ ] All prior tests still pass (68 → 78 total)
- [ ] Version bumped in both `package.json` and `src/lib/constants.js`
- [ ] Pushed to `origin/main` and Vercel deploys successfully

## Spec requirements addressed by Layer 3

| Spec requirement                                          | Coverage |
|-----------------------------------------------------------|----------|
| ⌘K command palette                                         | ✅ Tasks 2, 4, 6 |
| Pinned: New EOD journal entry                              | ✅ Tasks 1, 5, 6 |
| Pinned: Open Journal                                       | ✅ Tasks 1, 6 |
| Pinned: Open Radar / Open Macro                            | ✅ Tasks 1, 6 |
| Keyboard-accessible without typing (pinned items top)     | ✅ Task 1 (pinned first), Task 4 (arrow nav) |
| Position search                                            | ✅ Task 1 (items), Task 4 (filter) |
| Mobile: 🔍 replaces ⌘K in header top-row                   | ✅ Task 7 |

## Deferred (explicit)

- **Journal entry body text search** — the spec's "note" form. Scope creep for Layer 3.
- **Ticker-first view** — typing "NVDA" surfaces all position subrows, which is fine for MVP. Future layer can add a synthetic "NVDA — X positions" grouping row.
- **Scroll-to target after navigation** — palette routes to the right mode/subView; positional auto-scroll is a later polish.
- **Desktop-visible palette button** — desktop users use ⌘K; a clickable hint chip can be added in Layer 5 with the DESIGN.md pass.

## Notes

- The palette mounts always (even when closed) because `CommandPalette` short-circuits with `if (!open) return null`. This keeps the hotkey live without any registration dance.
- `handlePaletteSelect` uses `setSubViewRaw` rather than the validated `setSubView` because the palette's actions are trusted inputs; validation would reject legitimate transitions when the current mode differs from the target mode's valid-subview list.
- `journalIntent` is deliberately scoped to a single string state rather than an event queue. There's exactly one intent type (`"eod_update"`) and one consumer (`JournalTab`); a pub/sub system would be overkill.
