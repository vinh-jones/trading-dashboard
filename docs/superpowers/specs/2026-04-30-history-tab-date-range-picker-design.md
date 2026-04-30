# History Tab — Date Range Picker

**Date:** 2026-04-30
**Status:** Approved

## Overview

Rename the "YTD" Review sub-tab to "History" and replace its hardcoded Jan 1–today filter with a flexible date range picker. The picker has preset chips for common ranges and a "Custom…" option that opens a calendar popup for arbitrary date selection.

Monthly and Journal sub-tabs are unaffected.

## Scope

- `src/lib/modes.js` — rename `"ytd"` → `"history"` in `REVIEW_SUBVIEWS` and `SUBVIEW_LABELS`
- `src/components/ReviewView.jsx` — update sub-view routing to load `HistoryTab` for `"history"`
- `src/components/SummaryTab.jsx` → `src/components/HistoryTab.jsx` — rename file, update component name, replace hardcoded date filter with prop-driven range
- `src/components/DateRangePicker.jsx` — new component (preset chips + calendar popup)
- `src/App.jsx` — update import and prop pass-through for the renamed tab

## Components

### DateRangePicker

**File:** `src/components/DateRangePicker.jsx`

**Props:**
```js
{
  preset: '1m' | '3m' | 'ytd' | '1y' | 'all' | 'custom',  // active preset
  customRange: { start: Date, end: Date } | null,            // set when preset === 'custom'
  onChange: ({ preset, customRange }) => void
}
```

**Rendered structure:**
- A row of chips: `1M · 3M · YTD · 1Y · All · Custom…`
- Clicking a preset chip calls `onChange({ preset: '1m', customRange: null })` immediately — no Apply needed
- "Custom…" chip: when active, displays the chosen range label (e.g. `Jan 15 – Mar 31 ✕`); the ✕ resets to YTD
- When `preset === 'custom'` and no range is confirmed yet, renders the calendar popup below the chip row

**Calendar popup:**
- Single-month grid with prev/next month navigation
- Two-click selection: first click sets start date, second click sets end date
- Hover between clicks highlights the tentative range
- Cancel button dismisses without applying; Apply button calls `onChange({ preset: 'custom', customRange: { start, end } })` and closes the popup
- Clicking outside the popup dismisses it (cancel behavior)
- All styles via inline `style={{}}` using `theme` tokens

### HistoryTab (renamed from SummaryTab)

**File:** `src/components/HistoryTab.jsx`

Replaces the hardcoded date filter:

```js
// Before
const YTD_START = new Date("2026-01-01T00:00:00");
const YTD_END = new Date();
const TRADES = TRADES_ALL.filter(t =>
  t.closeDate && t.closeDate >= YTD_START && t.closeDate <= YTD_END
);

// After
const [preset, setPreset] = useState('ytd');
const [customRange, setCustomRange] = useState(null);

const [rangeStart, rangeEnd] = useMemo(() => resolvePreset(preset, customRange), [preset, customRange]);

const TRADES = TRADES_ALL.filter(t =>
  t.closeDate && t.closeDate >= rangeStart && t.closeDate <= rangeEnd
);
```

`resolvePreset(preset, customRange)` is a pure helper (defined in the same file or a lib util):

| Preset | Start | End |
|--------|-------|-----|
| `1m`   | today − 30 days | today |
| `3m`   | today − 90 days | today |
| `ytd`  | Jan 1 current year | today |
| `1y`   | today − 365 days | today |
| `all`  | `new Date(0)` (epoch) | today |
| `custom` | `customRange.start` | `customRange.end` |

The `DateRangePicker` renders just above the existing type filter pills, with a small label ("Range") to its left.

The summary line (trade count · net P&L) appends the active date range label for clarity, e.g.:
`160 trades · $89.3k net realized · Jan 1 – Apr 30`

## Interaction Details

### Preset chips
- Clicking any preset applies immediately, no confirmation step.
- Active chip: elevated background + primary text (matches existing pill active style).
- Default on mount: `ytd` (preserves current behavior).

### Custom chip
- Before a range is set: renders as `Custom…` with a dashed border.
- After Apply: renders as `Jan 15 – Mar 31 ✕` with active styling.
- Clicking ✕ calls `onChange({ preset: 'ytd', customRange: null })`.

### Calendar popup
- Opens anchored below the chip row.
- First click → sets start (highlighted). Second click → sets end (range highlighted). If second click is before start, the two dates swap.
- Apply is enabled only when both start and end are set.
- Navigating months does not clear the in-progress selection.
- Popup closes on: Apply, Cancel, or click-outside.

## Styling

All styles use inline `style={{}}` with `theme` tokens — no new CSS files, no Tailwind, no hardcoded hex values (except `TYPE_COLORS` which is already exempt per CLAUDE.md).

Calendar grid uses `theme.bg.elevated` for the popup shell, a `theme.blue` tint (low opacity) for in-range cell backgrounds, and solid `theme.blue` for start/end day backgrounds.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/modes.js` | `"ytd"` → `"history"` in `REVIEW_SUBVIEWS` and `SUBVIEW_LABELS` |
| `src/components/ReviewView.jsx` | Route `"history"` → `HistoryTab`; update import |
| `src/components/SummaryTab.jsx` | Rename to `HistoryTab.jsx`; replace hardcoded filter; add `DateRangePicker` |
| `src/components/DateRangePicker.jsx` | New file — preset chips + calendar popup |
| `src/App.jsx` | Update import/prop if it references `SummaryTab` directly (verify during implementation) |

## Out of Scope

- Monthly and Journal sub-tabs are not modified.
- No persistence of the selected range across page reloads (state resets to `ytd` on mount).
- No URL query params for the date range.
