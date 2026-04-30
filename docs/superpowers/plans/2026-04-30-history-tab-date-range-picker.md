# History Tab Date Range Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "YTD" Review sub-tab to "History" and replace its hardcoded Jan 1–today filter with preset chips (1M · 3M · YTD · 1Y · All · Custom…) plus a calendar popup for arbitrary date range selection.

**Architecture:** A new `resolvePreset(preset, customRange)` pure helper converts the active preset to `[Date, Date]`. `HistoryTab` (renamed from `SummaryTab`) holds `preset` and `customRange` state and feeds them to a new controlled `DateRangePicker` component that renders the chip row and calendar popup. All state lives in `HistoryTab` — `DateRangePicker` is fully controlled.

**Tech Stack:** React 18, Vitest, inline `style={{}}` with `theme` tokens from `src/lib/theme.js`, no new npm packages.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/modes.js` | Modify | Rename `"ytd"` → `"history"` in `REVIEW_SUBVIEWS` and `SUBVIEW_LABELS` |
| `src/components/ReviewView.jsx` | Modify | Update lazy import name and `active === "ytd"` routing condition |
| `src/components/SummaryTab.jsx` | Rename → `HistoryTab.jsx` | Rename file and export; replace hardcoded date filter; add `DateRangePicker` |
| `src/lib/resolvePreset.js` | Create | Pure helper: preset string → `[Date, Date]` range |
| `src/lib/__tests__/resolvePreset.test.js` | Create | Vitest unit tests for `resolvePreset` |
| `src/components/DateRangePicker.jsx` | Create | Preset chips + calendar popup (controlled component) |
| `package.json` + `src/lib/constants.js` | Modify | Version bump 1.98.1 → 1.99.0 |

---

### Task 1: Rename "YTD" → "History" in modes, routing, and file

**Files:**
- Modify: `src/lib/modes.js`
- Modify: `src/components/ReviewView.jsx`
- Rename: `src/components/SummaryTab.jsx` → `src/components/HistoryTab.jsx`

- [ ] **Step 1: Update `modes.js`**

In `src/lib/modes.js`, make these two changes:

```js
// Line 6 — change "ytd" to "history"
export const REVIEW_SUBVIEWS  = ["journal", "monthly", "history"];

// Lines 13-14 — rename the key and label
  history:   "History",
  // remove: ytd: "YTD",
```

Full updated file:
```js
// Top-level modes in the redesigned workspace.
// Focus = command center (home); Explore = drill-downs; Review = reporting & reflection.
export const MODES = ["focus", "explore", "review"];

export const EXPLORE_SUBVIEWS = ["positions", "radar", "earnings", "macro"];
export const REVIEW_SUBVIEWS  = ["journal", "monthly", "history"];

export const SUBVIEW_LABELS = {
  positions: "Positions",
  radar:     "Radar",
  earnings:  "Earnings",
  macro:     "Macro",
  monthly:   "Monthly",
  history:   "History",
  journal:   "Journal",
};

export const MODE_LABELS = {
  focus:   "Focus",
  explore: "Explore",
  review:  "Review",
};

export function defaultSubView(mode) {
  if (mode === "explore") return "positions";
  if (mode === "review")  return "journal";
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

- [ ] **Step 2: Rename `SummaryTab.jsx` to `HistoryTab.jsx` and update its export name**

```bash
git mv src/components/SummaryTab.jsx src/components/HistoryTab.jsx
```

Then open `src/components/HistoryTab.jsx` and change the function declaration on line 9:

```js
// Before:
export function SummaryTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDuration, setSelectedDuration }) {

// After:
export function HistoryTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDuration, setSelectedDuration }) {
```

- [ ] **Step 3: Update `ReviewView.jsx`**

Replace the entire file with:

```jsx
import { Suspense } from "react";
import { REVIEW_SUBVIEWS, SUBVIEW_LABELS, isValidSubView } from "../lib/modes";
import { theme } from "../lib/theme";
import { lazyNamed } from "../lib/lazyNamed";

const HistoryTab  = lazyNamed(() => import("./HistoryTab"),         "HistoryTab");
const CalendarTab = lazyNamed(() => import("./CalendarTab"),        "CalendarTab");
const JournalTab  = lazyNamed(() => import("./journal/JournalTab"), "JournalTab");

function TabLoading() {
  return (
    <div style={{
      padding:   theme.space[5],
      color:     theme.text.muted,
      fontSize:  theme.size.sm,
      textAlign: "center",
    }}>
      Loading…
    </div>
  );
}

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
  journalIntent, onJournalIntentConsumed,
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

      <Suspense fallback={<TabLoading />}>
        {active === "monthly" && (
          <CalendarTab
            selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
            selectedType={selectedType}     setSelectedType={setSelectedType}
            selectedDay={selectedDay}       setSelectedDay={setSelectedDay}
            captureRate={captureRate}       setCaptureRate={setCaptureRate}
          />
        )}
        {active === "history" && (
          <HistoryTab
            selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
            selectedType={selectedType}     setSelectedType={setSelectedType}
            selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
          />
        )}
        {active === "journal" && (
          <JournalTab
            journalIntent={journalIntent}
            onJournalIntentConsumed={onJournalIntentConsumed}
          />
        )}
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser**

Run `npm run dev`. Open the app, click **Review** → confirm the sub-tab now reads **History** (not YTD). Confirm the tab still loads trade data correctly. Check console for errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modes.js src/components/ReviewView.jsx src/components/HistoryTab.jsx
git commit -m "feat: rename YTD tab to History"
git push origin main
```

---

### Task 2: Create `resolvePreset` helper with tests (TDD)

**Files:**
- Create: `src/lib/resolvePreset.js`
- Create: `src/lib/__tests__/resolvePreset.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/resolvePreset.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolvePreset } from "../resolvePreset";

// Pin system clock to 2026-04-30 noon for deterministic results
const FIXED = new Date("2026-04-30T12:00:00");

describe("resolvePreset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ytd: start is Jan 1 of current year, end is end of today", () => {
    const [start, end] = resolvePreset("ytd", null);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);   // January
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("1m: start is 30 days before today at midnight", () => {
    const [start, end] = resolvePreset("1m", null);
    const expected = new Date("2026-03-31T00:00:00");
    expect(start.getFullYear()).toBe(expected.getFullYear());
    expect(start.getMonth()).toBe(expected.getMonth());
    expect(start.getDate()).toBe(expected.getDate());
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
  });

  it("3m: start is 90 days before today at midnight", () => {
    const [start] = resolvePreset("3m", null);
    const expected = new Date(FIXED);
    expected.setDate(expected.getDate() - 90);
    expect(start.getDate()).toBe(expected.getDate());
    expect(start.getMonth()).toBe(expected.getMonth());
    expect(start.getHours()).toBe(0);
  });

  it("1y: start is one year before today at midnight", () => {
    const [start] = resolvePreset("1y", null);
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(30);
    expect(start.getHours()).toBe(0);
  });

  it("all: start is Unix epoch", () => {
    const [start] = resolvePreset("all", null);
    expect(start.getTime()).toBe(0);
  });

  it("custom: uses customRange.start as-is, sets end to 23:59:59 of customRange.end", () => {
    const customRange = {
      start: new Date("2026-01-15T00:00:00"),
      end:   new Date("2026-03-31T00:00:00"),
    };
    const [start, end] = resolvePreset("custom", customRange);
    expect(start.getTime()).toBe(customRange.start.getTime());
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(2);   // March
    expect(end.getDate()).toBe(31);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("custom with null customRange falls back to ytd behavior", () => {
    const [start] = resolvePreset("custom", null);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });

  it("unknown preset falls back to ytd behavior", () => {
    const [start] = resolvePreset("bogus", null);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm run test -- resolvePreset
```

Expected: `Cannot find module '../resolvePreset'` or similar — confirms tests are wired up correctly.

- [ ] **Step 3: Implement `resolvePreset`**

Create `src/lib/resolvePreset.js`:

```js
/**
 * Converts a date range preset + optional custom range into a [start, end] Date pair.
 * @param {string} preset  - 'ytd' | '1m' | '3m' | '1y' | 'all' | 'custom'
 * @param {{ start: Date, end: Date } | null} customRange
 * @returns {[Date, Date]}
 */
export function resolvePreset(preset, customRange) {
  const today = new Date();
  today.setHours(23, 59, 59, 999); // end of today

  switch (preset) {
    case "1m": {
      const start = new Date(today);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return [start, today];
    }
    case "3m": {
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      start.setHours(0, 0, 0, 0);
      return [start, today];
    }
    case "1y": {
      const start = new Date(today);
      start.setFullYear(start.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      return [start, today];
    }
    case "all": {
      return [new Date(0), today];
    }
    case "custom": {
      if (!customRange) {
        // Fall back to ytd until user picks a range
        const start = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
        return [start, today];
      }
      const end = new Date(customRange.end);
      end.setHours(23, 59, 59, 999);
      return [customRange.start, end];
    }
    case "ytd":
    default: {
      const start = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
      return [start, today];
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm run test -- resolvePreset
```

Expected output: all 8 tests PASS with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resolvePreset.js src/lib/__tests__/resolvePreset.test.js
git commit -m "feat: add resolvePreset helper with tests"
git push origin main
```

---

### Task 3: Wire date range state into HistoryTab

**Files:**
- Modify: `src/components/HistoryTab.jsx`

- [ ] **Step 1: Add import and module-level date formatter**

At the top of `src/components/HistoryTab.jsx`, add the import for `resolvePreset`:

```js
// Add after the existing imports (around line 8)
import { resolvePreset } from "../lib/resolvePreset";
```

Add this helper function immediately before the `HistoryTab` function declaration (outside the component):

```js
/** Formats a Date as "Jan 1" etc. for the summary line label. */
function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Replace hardcoded date filter with state-driven range**

Inside `HistoryTab`, replace lines 13–15 (the hardcoded YTD filter) with:

```js
// Remove these three lines:
//   const YTD_START = new Date("2026-01-01T00:00:00");
//   const YTD_END   = new Date();
//   const TRADES = TRADES_ALL.filter(t => t.closeDate && t.closeDate >= YTD_START && t.closeDate <= YTD_END);

// Replace with:
const [preset,      setPreset]      = useState("ytd");
const [customRange, setCustomRange] = useState(null);

const [rangeStart, rangeEnd] = useMemo(
  () => resolvePreset(preset, customRange),
  [preset, customRange]
);

const TRADES = TRADES_ALL.filter(
  t => t.closeDate && t.closeDate >= rangeStart && t.closeDate <= rangeEnd
);
```

- [ ] **Step 3: Update the summary line to show the active date range**

Find this JSX block (around line 95 in the original, now a bit lower):

```jsx
<div style={{ fontSize: theme.size.lg, color: theme.text.muted, marginBottom: theme.space[5] }}>
  {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)} net realized
</div>
```

Replace it with:

```jsx
<div style={{ fontSize: theme.size.lg, color: theme.text.muted, marginBottom: theme.space[5] }}>
  {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)} net realized
  <span style={{ color: theme.text.subtle }}>
    {" "}· {fmtDate(rangeStart)} – {fmtDate(rangeEnd)}
  </span>
</div>
```

- [ ] **Step 4: Verify in browser**

Run `npm run dev`. Open Review → History. Confirm:
- The tab still shows the same data as before (YTD default is unchanged)
- The summary line now shows a date range, e.g. `160 trades · $89.3k net realized · Jan 1 – Apr 30`
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/components/HistoryTab.jsx
git commit -m "feat: wire date range state into HistoryTab (ytd default)"
git push origin main
```

---

### Task 4: Create DateRangePicker component — preset chips

**Files:**
- Create: `src/components/DateRangePicker.jsx`
- Modify: `src/components/HistoryTab.jsx`

- [ ] **Step 1: Create `DateRangePicker.jsx` with preset chips**

Create `src/components/DateRangePicker.jsx`:

```jsx
import { useEffect, useRef, useState } from "react";
import { theme } from "../lib/theme";

const PRESETS = [
  { key: "1m",  label: "1M"  },
  { key: "3m",  label: "3M"  },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1Y"  },
  { key: "all", label: "All" },
];

/** Format a Date as "Jan 15" for chip label and calendar display. */
function fmtChipDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Preset chip row + optional calendar popup for custom date range selection.
 *
 * Props:
 *   preset:      'ytd' | '1m' | '3m' | '1y' | 'all' | 'custom'
 *   customRange: { start: Date, end: Date } | null
 *   onChange:    ({ preset, customRange }) => void
 */
export function DateRangePicker({ preset, customRange, onChange }) {
  const isCustom = preset === "custom";
  const hasRange = isCustom && customRange != null;

  const customChipLabel = hasRange
    ? `${fmtChipDate(customRange.start)} – ${fmtChipDate(customRange.end)} ✕`
    : "Custom…";

  function handlePresetClick(key) {
    onChange({ preset: key, customRange: null });
  }

  function handleCustomChipClick() {
    if (hasRange) {
      // ✕ — clear back to YTD
      onChange({ preset: "ytd", customRange: null });
    } else {
      // Open calendar picker
      onChange({ preset: "custom", customRange: null });
    }
  }

  return (
    <div style={{ marginBottom: theme.space[4] }}>
      {/* Chip row */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
        <span style={{
          fontSize:      theme.size.sm,
          color:         theme.text.muted,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          flexShrink:    0,
        }}>
          Range
        </span>

        {PRESETS.map(({ key, label }) => {
          const active = preset === key;
          return (
            <button
              key={key}
              onClick={() => handlePresetClick(key)}
              style={{
                padding:      "4px 12px",
                borderRadius: theme.radius.pill,
                fontSize:     theme.size.sm,
                fontFamily:   "inherit",
                cursor:       "pointer",
                background:   active ? theme.bg.elevated : "transparent",
                color:        active ? theme.blue : theme.text.muted,
                border:       `1px solid ${active ? theme.blue : theme.border.default}`,
                fontWeight:   active ? 600 : 400,
                transition:   "all 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}

        {/* Custom chip */}
        <button
          onClick={handleCustomChipClick}
          style={{
            padding:      "4px 12px",
            borderRadius: theme.radius.pill,
            fontSize:     theme.size.sm,
            fontFamily:   "inherit",
            cursor:       "pointer",
            background:   isCustom ? theme.bg.elevated : "transparent",
            color:        isCustom ? theme.blue : theme.text.muted,
            border:       isCustom
              ? `1px solid ${theme.blue}`
              : `1px dashed ${theme.border.strong}`,
            fontWeight:   isCustom ? 600 : 400,
            transition:   "all 0.15s",
          }}
        >
          {customChipLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `DateRangePicker` to `HistoryTab`**

In `src/components/HistoryTab.jsx`, add the import near the top:

```js
import { DateRangePicker } from "./DateRangePicker";
```

Then inside the `return (...)`, add `DateRangePicker` as the very first child of the outer `<div>`, just above the existing summary line `<div>`:

```jsx
return (
  <div>
    <DateRangePicker
      preset={preset}
      customRange={customRange}
      onChange={({ preset: p, customRange: cr }) => {
        setPreset(p);
        setCustomRange(cr);
      }}
    />

    {/* summary line — already updated in Task 3 */}
    <div style={{ fontSize: theme.size.lg, color: theme.text.muted, marginBottom: theme.space[5] }}>
      {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)} net realized
      <span style={{ color: theme.text.subtle }}>
        {" "}· {fmtDate(rangeStart)} – {fmtDate(rangeEnd)}
      </span>
    </div>

    {/* ... rest of existing JSX unchanged ... */}
  </div>
);
```

- [ ] **Step 3: Verify in browser**

Run `npm run dev`. Open Review → History. Confirm:
- "Range" label + six chips appear above the summary line
- YTD chip is active by default (elevated background, blue text)
- Clicking 1M changes the trade count and P&L total (fewer trades if <30 days of data)
- Clicking All shows all-time trades
- Summary line date range updates when switching presets
- Custom… chip is dashed/inactive
- No console errors

- [ ] **Step 4: Commit**

```bash
git add src/components/DateRangePicker.jsx src/components/HistoryTab.jsx
git commit -m "feat: add DateRangePicker preset chips to History tab"
git push origin main
```

---

### Task 5: Add calendar popup to DateRangePicker

**Files:**
- Modify: `src/components/DateRangePicker.jsx`

- [ ] **Step 1: Add calendar constants and helpers at the top of `DateRangePicker.jsx`**

Add these after the existing `fmtChipDate` function:

```js
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_ABBREVS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Returns an array of Date | null for a single-month grid.
 * Leading nulls pad to the correct weekday column.
 */
function buildCalendarGrid(year, month) {
  const firstDay    = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

/** True if two Dates refer to the same calendar day. */
function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}
```

- [ ] **Step 2: Replace the `DateRangePicker` function with the full version including calendar state and popup**

Replace the entire `export function DateRangePicker(...)` block with:

```jsx
export function DateRangePicker({ preset, customRange, onChange }) {
  const isCustom = preset === "custom";
  const hasRange = isCustom && customRange != null;

  // Calendar popup state
  const now = new Date();
  const [calYear,      setCalYear]      = useState(now.getFullYear());
  const [calMonth,     setCalMonth]     = useState(now.getMonth());
  const [pendingStart, setPendingStart] = useState(null); // first clicked date
  const [pendingEnd,   setPendingEnd]   = useState(null); // second clicked date
  const [hoverDate,    setHoverDate]    = useState(null);
  const containerRef = useRef(null);

  // Reset calendar state when popup opens
  useEffect(() => {
    if (isCustom && !hasRange) {
      const n = new Date();
      setCalYear(n.getFullYear());
      setCalMonth(n.getMonth());
      setPendingStart(null);
      setPendingEnd(null);
      setHoverDate(null);
    }
  }, [isCustom, hasRange]);

  // Close popup on click-outside
  useEffect(() => {
    if (!isCustom || hasRange) return;
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onChange({ preset: "ytd", customRange: null });
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isCustom, hasRange, onChange]);

  // Chip label when a custom range is confirmed
  const customChipLabel = hasRange
    ? `${fmtChipDate(customRange.start)} – ${fmtChipDate(customRange.end)} ✕`
    : "Custom…";

  function handlePresetClick(key) {
    onChange({ preset: key, customRange: null });
  }

  function handleCustomChipClick() {
    if (hasRange) {
      onChange({ preset: "ytd", customRange: null }); // ✕ — clear
    } else {
      onChange({ preset: "custom", customRange: null }); // open calendar
    }
  }

  // Calendar nav
  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  // Two-click date selection
  function handleDayClick(date) {
    if (!pendingStart || (pendingStart && pendingEnd)) {
      // Start fresh
      setPendingStart(date);
      setPendingEnd(null);
    } else {
      // Second click
      if (date < pendingStart) {
        setPendingEnd(pendingStart);
        setPendingStart(date);
      } else {
        setPendingEnd(date);
      }
    }
  }

  // Per-day style: determines start, end, in-range, hover-range
  function getDayBg(date) {
    if (!date) return {};
    const isStart = sameDay(date, pendingStart);
    const isEnd   = sameDay(date, pendingEnd);

    if (isStart || isEnd) {
      return {
        background:   theme.blue,
        color:        "#fff",
        borderRadius: theme.radius.sm,
      };
    }

    // Determine effective range (confirmed or hover-preview)
    let rangeMin = null;
    let rangeMax = null;
    if (pendingStart && pendingEnd) {
      rangeMin = pendingStart;
      rangeMax = pendingEnd;
    } else if (pendingStart && hoverDate) {
      rangeMin = pendingStart < hoverDate ? pendingStart : hoverDate;
      rangeMax = pendingStart < hoverDate ? hoverDate    : pendingStart;
    }

    if (rangeMin && rangeMax && date > rangeMin && date < rangeMax) {
      return {
        background:   `${theme.blue}22`,
        color:        theme.blue,
        borderRadius: 2,
      };
    }

    return { color: theme.text.secondary };
  }

  function handleApply() {
    if (pendingStart && pendingEnd) {
      onChange({ preset: "custom", customRange: { start: pendingStart, end: pendingEnd } });
    }
  }

  function handleCancel() {
    onChange({ preset: "ytd", customRange: null });
  }

  const calendarGrid = buildCalendarGrid(calYear, calMonth);
  const canApply = pendingStart && pendingEnd;

  return (
    <div ref={containerRef} style={{ marginBottom: theme.space[4] }}>
      {/* Chip row */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
        <span style={{
          fontSize:      theme.size.sm,
          color:         theme.text.muted,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          flexShrink:    0,
        }}>
          Range
        </span>

        {PRESETS.map(({ key, label }) => {
          const active = preset === key;
          return (
            <button
              key={key}
              onClick={() => handlePresetClick(key)}
              style={{
                padding:      "4px 12px",
                borderRadius: theme.radius.pill,
                fontSize:     theme.size.sm,
                fontFamily:   "inherit",
                cursor:       "pointer",
                background:   active ? theme.bg.elevated : "transparent",
                color:        active ? theme.blue : theme.text.muted,
                border:       `1px solid ${active ? theme.blue : theme.border.default}`,
                fontWeight:   active ? 600 : 400,
                transition:   "all 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}

        {/* Custom chip */}
        <button
          onClick={handleCustomChipClick}
          style={{
            padding:      "4px 12px",
            borderRadius: theme.radius.pill,
            fontSize:     theme.size.sm,
            fontFamily:   "inherit",
            cursor:       "pointer",
            background:   isCustom ? theme.bg.elevated : "transparent",
            color:        isCustom ? theme.blue : theme.text.muted,
            border:       isCustom
              ? `1px solid ${theme.blue}`
              : `1px dashed ${theme.border.strong}`,
            fontWeight:   isCustom ? 600 : 400,
            transition:   "all 0.15s",
          }}
        >
          {customChipLabel}
        </button>
      </div>

      {/* Calendar popup — shown when Custom is active and no range is confirmed yet */}
      {isCustom && !hasRange && (
        <div style={{
          marginTop:    theme.space[3],
          background:   theme.bg.elevated,
          border:       `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md,
          padding:      theme.space[4],
          display:      "inline-block",
          minWidth:     220,
          userSelect:   "none",
        }}>
          {/* Month navigation header */}
          <div style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            marginBottom:   theme.space[3],
          }}>
            <button
              onClick={prevMonth}
              style={{
                background:   "transparent",
                border:       "none",
                color:        theme.text.muted,
                cursor:       "pointer",
                fontSize:     theme.size.md,
                padding:      `0 ${theme.space[2]}px`,
                lineHeight:   1,
              }}
            >
              ‹
            </button>
            <span style={{ fontSize: theme.size.sm, fontWeight: 600, color: theme.text.primary }}>
              {MONTH_NAMES[calMonth]} {calYear}
            </span>
            <button
              onClick={nextMonth}
              style={{
                background:   "transparent",
                border:       "none",
                color:        theme.text.muted,
                cursor:       "pointer",
                fontSize:     theme.size.md,
                padding:      `0 ${theme.space[2]}px`,
                lineHeight:   1,
              }}
            >
              ›
            </button>
          </div>

          {/* Day-of-week header row */}
          <div style={{
            display:             "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap:                 2,
            marginBottom:        4,
          }}>
            {DAY_ABBREVS.map(d => (
              <div key={d} style={{
                textAlign:  "center",
                fontSize:   theme.size.xs,
                color:      theme.text.subtle,
                fontWeight: 600,
                padding:    "2px 0",
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{
            display:             "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap:                 2,
          }}>
            {calendarGrid.map((date, i) => {
              if (!date) {
                return <div key={`empty-${i}`} />;
              }
              const dayBg = getDayBg(date);
              return (
                <div
                  key={date.getDate()}
                  onClick={() => handleDayClick(date)}
                  onMouseEnter={() => setHoverDate(date)}
                  onMouseLeave={() => setHoverDate(null)}
                  style={{
                    textAlign:    "center",
                    fontSize:     theme.size.xs,
                    padding:      "4px 2px",
                    cursor:       "pointer",
                    transition:   "background 0.1s",
                    ...dayBg,
                  }}
                >
                  {date.getDate()}
                </div>
              );
            })}
          </div>

          {/* Footer: hint + Cancel/Apply */}
          <div style={{
            marginTop:      theme.space[3],
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
          }}>
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
              {!pendingStart
                ? "Click a start date"
                : !pendingEnd
                  ? "Click an end date"
                  : `${fmtChipDate(pendingStart)} – ${fmtChipDate(pendingEnd)}`}
            </span>
            <div style={{ display: "flex", gap: theme.space[2] }}>
              <button
                onClick={handleCancel}
                style={{
                  padding:      `${theme.space[1]}px ${theme.space[3]}px`,
                  borderRadius: theme.radius.sm,
                  fontSize:     theme.size.sm,
                  fontFamily:   "inherit",
                  cursor:       "pointer",
                  background:   "transparent",
                  color:        theme.text.muted,
                  border:       `1px solid ${theme.border.default}`,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={!canApply}
                style={{
                  padding:      `${theme.space[1]}px ${theme.space[3]}px`,
                  borderRadius: theme.radius.sm,
                  fontSize:     theme.size.sm,
                  fontFamily:   "inherit",
                  cursor:       canApply ? "pointer" : "not-allowed",
                  background:   canApply ? theme.blue : theme.border.default,
                  color:        canApply ? "#fff" : theme.text.muted,
                  border:       "none",
                  transition:   "all 0.15s",
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser — full calendar flow**

Run `npm run dev`. Open Review → History. Test this sequence:

1. Click **Custom…** — calendar popup appears below the chips
2. Click a start date (e.g. Jan 15) — that day highlights in blue, hint reads "Click an end date"
3. Hover over other days — range highlights in blue tint
4. Click an end date (e.g. Mar 31) — both ends blue, hint shows the range, Apply becomes active
5. Click **Apply** — popup closes, chip now shows "Jan 15 – Mar 31 ✕", trade data and summary line update
6. Click the chip (with ✕) — clears back to YTD chip
7. Open Custom again, click **Cancel** — popup closes, YTD is restored
8. Open Custom, click outside the popup — same as Cancel

Check console for errors after each step.

- [ ] **Step 4: Run all tests to confirm nothing regressed**

```bash
npm run test
```

Expected: all existing tests plus the new `resolvePreset` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/DateRangePicker.jsx
git commit -m "feat: add calendar popup to DateRangePicker for custom date ranges"
git push origin main
```

---

### Task 6: Version bump

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Confirm current version on main**

```bash
git show origin/main:package.json | grep '"version"'
```

Expected: `"version": "1.98.1"` — bump to `1.99.0` (new feature).

- [ ] **Step 2: Update `package.json`**

Change line with `"version"`:

```json
"version": "1.99.0",
```

- [ ] **Step 3: Update `src/lib/constants.js`**

Change the `VERSION` constant:

```js
export const VERSION = "1.99.0";
```

- [ ] **Step 4: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.99.0"
git push origin main
```
