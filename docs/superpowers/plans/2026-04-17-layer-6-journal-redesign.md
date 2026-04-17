# Layer 6 — Journal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Journal page (`Review → Journal`) around four changes: grouped meta rows on trade cards, a collapsible quick-add bar, a weekly left-rail, and EOD-anchored day structure.

**Architecture:** Four component changes on top of a pure-helper grouping library. Each component ships as its own commit so regressions can be bisected per-surface. Version bump ships last.

**Tech Stack:** React 18, Vite, inline `style={{}}` objects importing from `src/lib/theme.js`. Vitest for pure-helper tests. No CSS files, no Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-17-layer-6-journal-redesign-design.md`

---

## Project-specific rules (apply to every task)

- **All colors from `theme.js`** — see DESIGN.md for the token reference. Allowlist for hardcoded hex (do NOT replace these):
  - `TYPE_COLORS` in `src/lib/constants.js`
  - `MOODS` + `JOURNAL_ENTRY_TYPES` in `src/components/journal/journalConstants.js`
  - Monthly-target progress bar colors in `src/components/journal/JournalEntryCard.jsx`
  - `BB_COLORS` / `SCORE_BG_COLORS` in `src/components/RadarTab.jsx`
- **All spacing from `theme.space[1..6]`** (4/8/12/16/20/24 px).
- **All font sizes from `theme.size.{xs|sm|md|lg|xl|xxl}`** (10/12/14/16/18/28 px).
- **No new behavior beyond what the spec describes.** No new click targets on previously non-interactive elements, no new computed data, no copy edits.
- **Timezone rules:** Journal entries use `entry.entry_date` (ISO date string, e.g. `"2026-04-17"`). Parse with `new Date(entry.entry_date + "T00:00:00")` to avoid UTC-vs-local drift. Week boundaries are computed in browser-local time.
- **Commit workflow:** After each task's commit, run `git push origin main` immediately. Never report done before push succeeds.
- **No version bump per task.** Version bump is reserved for Task 5 (the final task).
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

---

## File structure

**Create:**
- `src/lib/journalGrouping.js` — pure helper: `groupByWeek(entries)` and `weekLabel(weekStart, today)`.
- `src/lib/__tests__/journalGrouping.test.js` — unit tests for the pure helper.
- `src/components/journal/JournalQuickAdd.jsx` — collapsible quick-add bar component.
- `src/components/journal/WeekRail.jsx` — per-week rail component.
- `src/components/journal/EODBand.jsx` — collapsed EOD band component.

**Modify:**
- `src/components/journal/JournalEntryCard.jsx` — meta-row grouped-with-pipes layout; EOD routes to EODBand for collapsed state; hover-reveal Edit/Delete on desktop.
- `src/components/journal/JournalTab.jsx` — remove right panel; add quick-add bar at top; render weekly groups with rail + day headers + EOD band + trade notes.
- `src/components/journal/JournalInlineEditForm.jsx` — no structural change, but the create-mode usage goes away (only edit-mode remains, which already works).
- `src/App.jsx` — wire `useHotkey("mod+n", ...)` scoped to Review → Journal.
- `src/lib/constants.js` — `VERSION` bump 1.49.0 → 1.50.0.
- `package.json` — version bump.

---

## Task 1: Meta row — grouped with pipes

**Goal:** Replace the flat `·`-chain meta row on trade-note cards with a grouped-with-pipes layout. No other changes to the card.

**Files:**
- Modify: `src/components/journal/JournalEntryCard.jsx:397-411` (the metaLine render block)

### Steps

- [ ] **Step 1: Read the current meta row implementation**

Run: `sed -n '360,411p' src/components/journal/JournalEntryCard.jsx`

Confirm the fields computed above are:
- `strike` + `strikeSuffix` (`"p"` / `"c"`)
- `expiry`
- `contracts`
- `entryCostStr` (`@ $N.NN`) and `exitCostStr` (`→ $N.NN`)
- `cashPct` (`N.N% cash`)
- `deltaDisplay` (`Nδ`)
- `rorDisplay` (`N.NN% RoR`)
- `daysDisplay` (`Nd`)
- `keptDisplay` (`N% kept`)
- `plDisplay` (`+$N` / `-$N`)

These computed variables stay unchanged. Only the final JSX render changes.

- [ ] **Step 2: Replace the meta row JSX**

Replace the block at lines 397–411 with the grouped-with-pipes layout.

**Old block (remove):**
```jsx
        const dot = <span style={{ color: theme.text.faint }}>·</span>;
        return (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[2], display: "flex", gap: theme.space[2], flexWrap: "wrap", alignItems: "center" }}>
            {linkedTrade.strike && <span>${linkedTrade.strike}{strikeSuffix}</span>}
            {linkedTrade.expiry && linkedTrade.expiry !== "—" && <>{dot}<span>exp {linkedTrade.expiry}</span></>}
            {linkedTrade.contracts                               && <>{dot}<span>{linkedTrade.contracts} ct</span></>}
            {entryCostStr                                        && <>{dot}<span>{entryCostStr}{exitCostStr ? ` ${exitCostStr}` : ""}</span></>}
            {cashPct                                             && <>{dot}<span>{cashPct}</span></>}
            {deltaDisplay                                        && <>{dot}<span>{deltaDisplay}</span></>}
            {rorDisplay                                          && <>{dot}<span>{rorDisplay}</span></>}
            {daysDisplay                                         && <>{dot}<span>{daysDisplay}</span></>}
            {keptDisplay                                         && <>{dot}<span>{keptDisplay}</span></>}
            {plDisplay                                           && <>{dot}<span style={{ color: linkedTrade.premium >= 0 ? theme.green : theme.red }}>{plDisplay}</span></>}
          </div>
        );
```

**New block (insert):**
```jsx
        const dot  = <span style={{ color: theme.text.faint, margin: `0 ${theme.space[1]}px` }}>·</span>;
        const pipe = <span style={{ color: theme.border.strong, margin: `0 ${theme.space[2]}px`, fontWeight: 300 }}>|</span>;

        // Build each group as an array of spans so we can omit empty groups.
        const contractGroup = [
          linkedTrade.strike && <span key="strike">${linkedTrade.strike}{strikeSuffix}</span>,
          linkedTrade.expiry && linkedTrade.expiry !== "—" && <span key="expiry">exp {linkedTrade.expiry}</span>,
          linkedTrade.contracts && <span key="contracts">{linkedTrade.contracts} ct</span>,
        ].filter(Boolean);

        const executionGroup = [
          entryCostStr && <span key="cost">{entryCostStr}{exitCostStr ? ` ${exitCostStr}` : ""}</span>,
          cashPct      && <span key="cash">{cashPct}</span>,
        ].filter(Boolean);

        const performanceGroup = [
          rorDisplay   && <span key="ror">{rorDisplay}</span>,
          deltaDisplay && <span key="delta">{deltaDisplay}</span>,
          daysDisplay  && <span key="days">{daysDisplay}</span>,
          keptDisplay  && <span key="kept">{keptDisplay}</span>,
        ].filter(Boolean);

        const resultGroup = plDisplay
          ? [<span key="pl" style={{ color: linkedTrade.premium >= 0 ? theme.green : theme.red, fontWeight: 600 }}>{plDisplay}</span>]
          : [];

        // Interleave each group's items with `dot` separators.
        const renderGroup = (items) => items.flatMap((node, i) => i === 0 ? [node] : [dot, node]);

        const groups = [contractGroup, executionGroup, performanceGroup, resultGroup].filter(g => g.length > 0);

        return (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[2], display: "flex", flexWrap: "wrap", alignItems: "center" }}>
            {groups.flatMap((group, i) => i === 0 ? renderGroup(group) : [<span key={`pipe-${i}`}>{pipe}</span>, ...renderGroup(group)])}
          </div>
        );
```

- [ ] **Step 3: Verify no other file needs changes**

Run: `git diff src/components/journal/JournalEntryCard.jsx`

Expected: only lines 397–411 area changed. No new imports needed (`theme.border.strong` already available via the existing `theme` import).

- [ ] **Step 4: Manual smoke-check (user will verify on prod)**

Since the preview server has no data, a visual check is not possible from this session. The implementer should verify:
- The diff is limited to the metaLine block.
- No new imports, state, or handlers were introduced.
- The `keyboard-accessible Edit/Delete buttons at card bottom still render (they're not in the metaLine block).

- [ ] **Step 5: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add src/components/journal/JournalEntryCard.jsx
git commit -m "$(cat <<'EOF'
style(journal): group meta row into contract | execution | performance | result

Replaces the flat · chain with a pipe-separated layout that groups
related fields. Field set and values are unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify push: `git log origin/main -1 --oneline` — expected commit message starts with `style(journal): group meta row`.

---

## Task 2: Quick-add bar — extract + bloom

**Goal:** Extract the "New Entry" form from the right panel in `JournalTab.jsx` into a new `JournalQuickAdd.jsx` component. Render it as a collapsed bar at the top of the feed that blooms into the full form on click / ⌘N. Remove the two-column layout.

**Files:**
- Create: `src/components/journal/JournalQuickAdd.jsx`
- Modify: `src/components/journal/JournalTab.jsx`
- Modify: `src/App.jsx`

### Steps

- [ ] **Step 1: Read the current right panel markup**

Run: `sed -n '491,759p' src/components/journal/JournalTab.jsx`

This is the block that will move into `JournalQuickAdd.jsx`. It contains:
- The "New Entry" header + entry type selector
- All three form bodies (Trade Note / EOD Update / Position Note)
- Save/Cancel buttons
- All state and handlers specific to the "create" form (formTitle, formBody, formSource, formTags, formDate, saving, saveError, entryType, linkedTrade, linkedPosition, etc.)

The existing state for these is declared higher up in `JournalTab.jsx` (around lines 33–90). Those state declarations and their handlers move into `JournalQuickAdd.jsx` wholesale.

- [ ] **Step 2: Create `src/components/journal/JournalQuickAdd.jsx` scaffolding**

Create the file with this structure — a collapsed-by-default bar that renders the form inline when `isOpen === true`.

```jsx
import { useState, useEffect, useRef } from "react";
import { theme } from "../../lib/theme";

export function JournalQuickAdd({
  isOpen,
  onOpen,
  onClose,
  // All props previously used by the form block go here — pass them through
  // from JournalTab. This component is a thin structural wrapper around the
  // existing form JSX.
  trades,
  positions,
  account,
  journalIntent,
  onJournalIntentConsumed,
  onEntryCreated,
}) {
  const barRef = useRef(null);

  // Esc closes the bloomed state
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Collapsed bar
  if (!isOpen) {
    return (
      <button
        ref={barRef}
        onClick={onOpen}
        style={{
          display: "flex", alignItems: "center", gap: theme.space[2], width: "100%",
          padding: `${theme.space[2]}px ${theme.space[3]}px`,
          background: theme.bg.surface,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md,
          color: theme.text.subtle,
          fontFamily: "inherit",
          fontSize: theme.size.sm,
          cursor: "text",
          marginBottom: theme.space[4],
          textAlign: "left",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(58,130,246,0.06)"}
        onMouseLeave={(e) => e.currentTarget.style.background = theme.bg.surface}
      >
        <span style={{ color: theme.blue, fontWeight: 600 }}>+</span>
        <span>New entry…</span>
        <span style={{
          marginLeft: "auto",
          background: theme.bg.elevated,
          border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.sm,
          padding: `2px ${theme.space[1]}px`,
          fontSize: theme.size.xs,
          color: theme.text.muted,
        }}>⌘N</span>
      </button>
    );
  }

  // Bloomed form — the existing form JSX extracted from JournalTab goes here.
  // See Step 3 for the extraction details.
  return (
    <div style={{
      background: theme.bg.surface,
      border: `1px solid ${theme.blue}`,
      borderRadius: theme.radius.md,
      padding: theme.space[4],
      marginBottom: theme.space[4],
    }}>
      {/* TASK-2-FORM-SLOT: the existing form JSX (entry type selector + all three
          form bodies + Save/Cancel) is placed here in Step 3. */}
    </div>
  );
}
```

- [ ] **Step 3: Move the form JSX and its state into `JournalQuickAdd.jsx`**

Cut the entire right-panel block from `JournalTab.jsx` (lines 491 to the closing of the outer `<div style={{ flex: "0 0 340px", minWidth: 300 }}>`). Paste it into the `TASK-2-FORM-SLOT` location inside `JournalQuickAdd.jsx`.

Along with the JSX, move these pieces of state and their setters into `JournalQuickAdd.jsx`:
- `entryType`, `hoveredType`, `linkedPosition`, `linkedTrade`
- `formTitle`, `formSource`, `formTags`, `formDate`, `formBody`
- `saving`, `saveError`
- `cancelHovered`, `saveHovered`, `moodHovered`, `focusedInput`

Move these handlers as well:
- `resetForm`
- `handleLinkTrade`
- `handleSave` (the create path — should call `props.onEntryCreated()` on success so the parent can refresh its feed and close the bloom)
- `posSelectEl`

The `JournalQuickAdd` component takes `onEntryCreated` as a callback prop. On successful save, call it and then `onClose()`. The parent (`JournalTab`) refreshes the feed in its `onEntryCreated` handler.

The entry type pills' Cancel button calls `props.onClose()` instead of the old `resetForm()`-only behavior — it resets local form state AND collapses the bar.

**Keep the `journalIntent === "eod_update"` useEffect logic** — it should stay in `JournalQuickAdd.jsx` since `entryType` lives there. When consumed, it also sets `isOpen=true` via `onOpen()`.

- [ ] **Step 4: Update `JournalTab.jsx`**

Remove the right panel and the outer two-column flex wrapper. The feed becomes a single column that takes full width.

At the top of the feed (before the filter bar), render `<JournalQuickAdd />`.

**Add this state at the top of `JournalTab.jsx` (near the other `useState` calls):**
```jsx
const [quickAddOpen, setQuickAddOpen] = useState(false);
```

**Replace the return block (starting at line ~413) with this structure:**
```jsx
  return (
    <div style={{ width: "100%", minWidth: 0 }}>

      <JournalQuickAdd
        isOpen={quickAddOpen}
        onOpen={() => setQuickAddOpen(true)}
        onClose={() => setQuickAddOpen(false)}
        trades={trades}
        positions={positions}
        account={account}
        journalIntent={journalIntent}
        onJournalIntentConsumed={onJournalIntentConsumed}
        onEntryCreated={() => {
          reloadEntries();     // existing function in JournalTab — renames if needed
          setQuickAddOpen(false);
        }}
      />

      {/* Filter bar — UNCHANGED (currently at lines 422–452) */}
      {/* Feed content — UNCHANGED (currently at lines 454–488) */}

    </div>
  );
}
```

Note: `reloadEntries` is the existing data-reload function in `JournalTab`. If it's currently named differently (e.g. `loadEntries`, `fetchEntries`), use that name.

Remove the unused `JournalInlineEditForm` import from `JournalTab.jsx` only if it's no longer used (it is still used for inline edit mode, so KEEP the import).

Remove these imports from `JournalTab.jsx` that are no longer used there (they move into `JournalQuickAdd.jsx`):
- `JOURNAL_ENTRY_TYPES`, `JOURNAL_INPUT_ST`, `JOURNAL_LABEL_ST` (if no longer referenced in JournalTab after move)
- `buildAutoTitle` (if no longer referenced)
- `JournalField`, `JournalAutoTextarea` (if no longer referenced)
- `computeEodMetadata` (if no longer referenced)

Run `grep -n '<JournalField\|<JournalAutoTextarea\|JOURNAL_ENTRY_TYPES\|JOURNAL_INPUT_ST\|JOURNAL_LABEL_ST\|buildAutoTitle\|computeEodMetadata' src/components/journal/JournalTab.jsx` after the move — anything still matched in JournalTab stays imported. Remove the rest.

`JournalQuickAdd.jsx` imports them instead.

- [ ] **Step 5: Wire ⌘N hotkey in `src/App.jsx`**

The existing `useHotkey` hook already guards against input-focus. We add a new hotkey that sets `mode="review"`, `subView="journal"`, AND opens the quick-add.

For the "open quick-add" part, we need a mechanism for App to tell JournalTab to open its bar. Use the existing `journalIntent` pattern — add a new intent value `"new_entry"`.

**In `src/App.jsx`:** Add a new hotkey binding near the existing `useHotkey("mod+k", ...)` call.

Old block (around line 60):
```jsx
  useHotkey("mod+k", (e) => {
    e.preventDefault();
    setPaletteOpen(true);
  });

  useHotkey("f", () => setMode("focus"));
  useHotkey("e", () => setMode("explore"));
  useHotkey("r", () => setMode("review"));
```

New block — add ⌘N after the existing hotkeys:
```jsx
  useHotkey("mod+k", (e) => {
    e.preventDefault();
    setPaletteOpen(true);
  });

  useHotkey("f", () => setMode("focus"));
  useHotkey("e", () => setMode("explore"));
  useHotkey("r", () => setMode("review"));

  useHotkey("mod+n", (e) => {
    e.preventDefault();
    setMode("review");
    setSubViewRaw("journal");
    setJournalIntent("new_entry");
  });
```

- [ ] **Step 6: Handle `"new_entry"` intent in `JournalQuickAdd.jsx`**

In the existing `journalIntent` useEffect (moved into `JournalQuickAdd.jsx` in Step 3), extend it to handle the new intent value:

```jsx
useEffect(() => {
  if (journalIntent === "eod_update") {
    setEntryType("eod_update");
    onOpen();
    onJournalIntentConsumed?.();
  } else if (journalIntent === "new_entry") {
    onOpen();
    onJournalIntentConsumed?.();
  }
}, [journalIntent, onJournalIntentConsumed, onOpen]);
```

- [ ] **Step 7: Verify no regressions in edit mode**

`JournalInlineEditForm` is still used for inline editing in `JournalTab.jsx`. Inline edit state (`inlineEditId`, `inlineTitle`, `inlineBody`, `inlineTags`, `inlineSource`, `inlineMood`, `inlineSaving`, `inlineError`) stays in `JournalTab.jsx` along with `handleEdit`, `handleDelete`, `handleInlineSave`, `handleInlineCancel`. Do NOT move these.

Run `grep -n 'inlineEditId\|handleInlineSave\|handleInlineCancel\|JournalInlineEditForm' src/components/journal/JournalTab.jsx` — expect multiple matches, all within JournalTab. No matches in JournalQuickAdd.jsx.

- [ ] **Step 8: Verify no stray hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/journal/JournalQuickAdd.jsx src/components/journal/JournalTab.jsx`

Expected: 0 matches (neither file is in the allowlist).

- [ ] **Step 9: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add src/components/journal/JournalQuickAdd.jsx src/components/journal/JournalTab.jsx src/App.jsx
git commit -m "$(cat <<'EOF'
feat(journal): collapsible quick-add bar, remove always-open form panel

Extracts the New Entry form into JournalQuickAdd.jsx as a collapsed-
by-default bar that blooms into the full form on click, ⌘N, or an
incoming palette intent. Removes the right-side panel entirely — feed
now uses full width.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`

---

## Task 3: Weekly grouping + left rail

**Goal:** Group journal entries by week (Sun–Sat) and render a left rail per week. Add day headers above each day's entries within a week.

**Files:**
- Create: `src/lib/journalGrouping.js`
- Create: `src/lib/__tests__/journalGrouping.test.js`
- Create: `src/components/journal/WeekRail.jsx`
- Modify: `src/components/journal/JournalTab.jsx`

### Steps

- [ ] **Step 1: Write the failing test for `groupByWeek`**

Create `src/lib/__tests__/journalGrouping.test.js`:

```js
import { describe, it, expect } from "vitest";
import { groupByWeek, weekLabel } from "../journalGrouping";

describe("groupByWeek", () => {
  it("returns empty array for empty input", () => {
    expect(groupByWeek([])).toEqual([]);
  });

  it("groups a single entry into one week with one day", () => {
    const entries = [{ id: 1, entry_date: "2026-04-17" }];
    const result = groupByWeek(entries);
    expect(result).toHaveLength(1);
    expect(result[0].days).toHaveLength(1);
    expect(result[0].days[0].date).toBe("2026-04-17");
    expect(result[0].days[0].entries).toHaveLength(1);
  });

  it("groups entries from the same day under one day bucket", () => {
    const entries = [
      { id: 1, entry_date: "2026-04-17" },
      { id: 2, entry_date: "2026-04-17" },
    ];
    const result = groupByWeek(entries);
    expect(result[0].days).toHaveLength(1);
    expect(result[0].days[0].entries).toHaveLength(2);
  });

  it("splits across weeks at Sunday boundary", () => {
    // Apr 12 2026 is a Sunday (start of a new week).
    // Apr 11 2026 is a Saturday (end of previous week).
    const entries = [
      { id: 1, entry_date: "2026-04-12" },  // new week
      { id: 2, entry_date: "2026-04-11" },  // previous week
    ];
    const result = groupByWeek(entries);
    expect(result).toHaveLength(2);
  });

  it("sorts weeks newest-first and days within a week newest-first", () => {
    const entries = [
      { id: 1, entry_date: "2026-04-10" },  // older week
      { id: 2, entry_date: "2026-04-17" },  // newer week (Fri)
      { id: 3, entry_date: "2026-04-15" },  // newer week (Wed)
    ];
    const result = groupByWeek(entries);
    expect(result).toHaveLength(2);
    // Newer week first
    expect(result[0].days[0].date).toBe("2026-04-17");
    expect(result[0].days[1].date).toBe("2026-04-15");
    expect(result[1].days[0].date).toBe("2026-04-10");
  });

  it("reports weekStart (Sunday) and weekEnd (Saturday) for each group", () => {
    const entries = [{ id: 1, entry_date: "2026-04-17" }];  // Friday
    const result = groupByWeek(entries);
    expect(result[0].weekStart).toBe("2026-04-12");  // preceding Sunday
    expect(result[0].weekEnd).toBe("2026-04-18");    // following Saturday
  });

  it("preserves entry order within a day (as passed in)", () => {
    const entries = [
      { id: "a", entry_date: "2026-04-17" },
      { id: "b", entry_date: "2026-04-17" },
      { id: "c", entry_date: "2026-04-17" },
    ];
    const result = groupByWeek(entries);
    expect(result[0].days[0].entries.map(e => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("weekLabel", () => {
  it("returns 'This Week' when today is inside the week", () => {
    // today = Fri Apr 17 2026 → inside the week 04-12 to 04-18
    expect(weekLabel("2026-04-12", "2026-04-17")).toBe("This Week");
  });

  it("returns 'Last Week' for the preceding week", () => {
    // today = Fri Apr 17 2026 → prev week is 04-05 to 04-11
    expect(weekLabel("2026-04-05", "2026-04-17")).toBe("Last Week");
  });

  it("returns '2 weeks ago' for two-weeks-back", () => {
    expect(weekLabel("2026-03-29", "2026-04-17")).toBe("2 weeks ago");
  });

  it("returns 'Week of MMM DD' for three-or-more weeks back", () => {
    expect(weekLabel("2026-03-22", "2026-04-17")).toBe("Week of Mar 22");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/journalGrouping.test.js`
Expected: FAIL with "Failed to resolve import '../journalGrouping'".

- [ ] **Step 3: Write `src/lib/journalGrouping.js`**

```js
// Pure helpers for grouping journal entries by week + day.
//
// Dates are ISO date strings like "2026-04-17". Week boundaries are Sunday–Saturday,
// computed in browser-local time to match the user's perception of "today".

function parseLocalDate(iso) {
  // Appending T00:00:00 keeps the Date in the browser's local zone.
  return new Date(iso + "T00:00:00");
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sundayOfWeek(d) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - copy.getDay());  // getDay() → 0 (Sun) .. 6 (Sat)
  return copy;
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function groupByWeek(entries) {
  if (!entries || entries.length === 0) return [];

  const weekMap = new Map();  // key = weekStart ISO, value = { weekStart, weekEnd, dayMap }

  for (const entry of entries) {
    const date     = parseLocalDate(entry.entry_date);
    const weekStart = sundayOfWeek(date);
    const weekEnd   = addDays(weekStart, 6);
    const weekKey   = toISODate(weekStart);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        weekStart: weekKey,
        weekEnd:   toISODate(weekEnd),
        dayMap:    new Map(),
      });
    }
    const week = weekMap.get(weekKey);

    const dayKey = entry.entry_date;
    if (!week.dayMap.has(dayKey)) {
      week.dayMap.set(dayKey, { date: dayKey, entries: [] });
    }
    week.dayMap.get(dayKey).entries.push(entry);
  }

  // Sort weeks newest-first
  const weeks = [...weekMap.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  // Within each week, sort days newest-first; within each day, preserve input order
  return weeks.map(w => ({
    weekStart: w.weekStart,
    weekEnd:   w.weekEnd,
    days:      [...w.dayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
  }));
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekLabel(weekStartISO, todayISO) {
  const todaySunday = sundayOfWeek(parseLocalDate(todayISO));
  const thisWeekStart = toISODate(todaySunday);

  if (weekStartISO === thisWeekStart) return "This Week";

  const lastWeekStart = toISODate(addDays(todaySunday, -7));
  if (weekStartISO === lastWeekStart) return "Last Week";

  const twoWeeksAgoStart = toISODate(addDays(todaySunday, -14));
  if (weekStartISO === twoWeeksAgoStart) return "2 weeks ago";

  const d = parseLocalDate(weekStartISO);
  return `Week of ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/journalGrouping.test.js`
Expected: PASS — all 11 tests pass.

- [ ] **Step 5: Create `src/components/journal/WeekRail.jsx`**

```jsx
import { theme } from "../../lib/theme";

export function WeekRail({ label, rangeLabel, entryCount }) {
  return (
    <div style={{
      width: 110, flexShrink: 0,
      padding: `${theme.space[3]}px 0 0`,
      position: "sticky", top: 0, alignSelf: "flex-start",
    }}>
      <div style={{
        color: theme.text.primary, fontSize: theme.size.xs, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.5px",
        marginBottom: theme.space[1],
      }}>
        {label}
      </div>
      <div style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>
        {rangeLabel}
      </div>
      <div style={{ color: theme.blue, fontSize: theme.size.xs, marginTop: theme.space[1] }}>
        {entryCount} {entryCount === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire grouping into `JournalTab.jsx`**

Import the helper and component:
```jsx
import { groupByWeek, weekLabel } from "../../lib/journalGrouping";
import { WeekRail } from "./WeekRail";
```

Add a helper for the range label (Sun–Sat short form):
```jsx
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function rangeLabel(weekStartISO, weekEndISO) {
  const s = new Date(weekStartISO + "T00:00:00");
  const e = new Date(weekEndISO + "T00:00:00");
  const sameMonth = s.getMonth() === e.getMonth();
  const sMonth = MONTH_ABBR[s.getMonth()];
  const eMonth = MONTH_ABBR[e.getMonth()];
  if (sameMonth) return `${sMonth} ${s.getDate()} – ${e.getDate()}`;
  return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}`;
}
```

Replace the old feed-render block (currently the `{!loading && entries.map(entry => ...)}` block at line 472) with a grouped render:

```jsx
{!loading && entries.length > 0 && (() => {
  const weeks = groupByWeek(entries);
  const today = new Date();
  const todayISOStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  return weeks.map(week => {
    const totalEntries = week.days.reduce((sum, d) => sum + d.entries.length, 0);
    return (
      <div key={week.weekStart} style={{ display: "flex", gap: theme.space[4], marginBottom: theme.space[5], alignItems: "flex-start" }}>
        <WeekRail
          label={weekLabel(week.weekStart, todayISOStr)}
          rangeLabel={rangeLabel(week.weekStart, week.weekEnd)}
          entryCount={totalEntries}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {week.days.map(day => (
            <div key={day.date} style={{ marginBottom: theme.space[3] }}>
              <div style={{
                fontSize: theme.size.sm, color: theme.text.subtle,
                textTransform: "uppercase", letterSpacing: "0.5px",
                marginBottom: theme.space[2],
              }}>
                {new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "long" })}
              </div>
              {day.entries.map(entry =>
                entry.id === inlineEditId
                  ? <JournalInlineEditForm
                      key={entry.id}
                      entry={entry}
                      title={inlineTitle}           onTitleChange={e => setInlineTitle(e.target.value)}
                      body={inlineBody}             onBodyChange={e => setInlineBody(e.target.value)}
                      tags={inlineTags}             onTagsChange={e => setInlineTags(e.target.value)}
                      source={inlineSource}         onSourceChange={setInlineSource}
                      mood={inlineMood}             onMoodChange={setInlineMood}
                      onSave={() => handleInlineSave(entry.entry_type, entry)}
                      onCancel={handleInlineCancel}
                      saving={inlineSaving}
                      error={inlineError}
                    />
                  : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  });
})()}
```

- [ ] **Step 7: Mobile fallback**

On mobile (<600px), the week rail should collapse to a horizontal strip above each week's entries rather than a side column. Use the existing `useWindowWidth` hook.

Add near the top of `JournalTab`:
```jsx
import { useWindowWidth } from "../../hooks/useWindowWidth";
// ... inside component:
const isMobile = useWindowWidth() < 600;
```

In the week-render block, change the outer flex container direction based on `isMobile`:

```jsx
<div key={week.weekStart} style={{
  display: "flex",
  flexDirection: isMobile ? "column" : "row",
  gap: isMobile ? theme.space[2] : theme.space[4],
  marginBottom: theme.space[5],
  alignItems: "flex-start",
}}>
```

And in `WeekRail`, make `width` conditional — but rather than threading `isMobile` down, just let the rail take `width: 110` on desktop and let it be a natural-width block on mobile (flex-direction column will just stack it). The `position: sticky` on mobile is still fine — it just becomes a no-op since there's no horizontal offset.

That said, mobile rail looks a bit heavy at 110px wide with only week info. Accept this as a known mobile rough edge; refine in a follow-up if needed. Leave the component as-is.

- [ ] **Step 8: Verify no stray hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/journal/WeekRail.jsx src/components/journal/JournalTab.jsx src/lib/journalGrouping.js`
Expected: 0 matches.

- [ ] **Step 9: Run all tests**

Run: `npm test`
Expected: all tests pass, including the 11 new `journalGrouping` tests.

- [ ] **Step 10: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add src/lib/journalGrouping.js src/lib/__tests__/journalGrouping.test.js src/components/journal/WeekRail.jsx src/components/journal/JournalTab.jsx
git commit -m "$(cat <<'EOF'
feat(journal): weekly grouping with left rail + day headers

Groups entries by Sun-Sat week with a sticky left rail showing week
label, date range, and entry count. Adds day headers above each day's
entries within a week.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`

---

## Task 4: EOD band

**Goal:** Render EOD Update entries as a full-width banded card anchored at the top of their day, with a floor-status colored left border. Trade notes stack beneath.

**Files:**
- Create: `src/components/journal/EODBand.jsx`
- Modify: `src/components/journal/JournalEntryCard.jsx`
- Modify: `src/components/journal/JournalTab.jsx`

### Steps

- [ ] **Step 1: Read the existing EOD stinger-line code**

Run: `sed -n '116,143p' src/components/journal/JournalEntryCard.jsx`

Confirm the stinger line renders: `VIX N`, `Cash N% [floor label]`, `MTD $N`, activity label. Uses `md.vix`, `md.free_cash_pct`, `md.mtd_realized`, and `eodFloorLabel(md.floor_status)`.

- [ ] **Step 2: Create `src/components/journal/EODBand.jsx`**

```jsx
import { useState } from "react";
import { theme } from "../../lib/theme";
import { eodFloorLabel, fmtEntryDate } from "./journalHelpers";
import { JournalEntryCard } from "./JournalEntryCard";

export function EODBand({ entry, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const md = entry.metadata ?? {};
  const floorLbl = eodFloorLabel(md.floor_status);

  // Expanded state delegates to the existing expanded view inside JournalEntryCard
  // by forcing a flag. Simplest approach: render JournalEntryCard when expanded.
  if (expanded) {
    return (
      <div>
        <div
          onClick={() => setExpanded(false)}
          style={{ cursor: "pointer" }}
        >
          <JournalEntryCard entry={entry} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
    );
  }

  const borderColor = floorLbl?.color ?? theme.border.default;

  return (
    <div
      onClick={() => setExpanded(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: theme.space[3],
        padding: `${theme.space[3]}px ${theme.space[4]}px`,
        background: hovered ? "rgba(58,130,246,0.06)" : theme.bg.surface,
        border: `1px solid ${theme.border.default}`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: theme.radius.md,
        marginBottom: theme.space[2],
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      {/* Left: badge + mood */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexShrink: 0 }}>
        <span style={{ color: theme.green, fontSize: theme.size.xs, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
          EOD Update
        </span>
        {entry.mood && <span style={{ fontSize: theme.size.md, lineHeight: 1 }}>{entry.mood}</span>}
      </div>

      {/* Middle: stat pills */}
      <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], flex: 1, flexWrap: "wrap", fontSize: theme.size.sm, color: theme.text.subtle }}>
        {md.vix != null && <span>VIX <span style={{ color: theme.text.primary, fontWeight: 600 }}>{md.vix}</span></span>}
        {md.free_cash_pct != null && (
          <span>
            Cash <span style={{ color: theme.text.primary, fontWeight: 600 }}>{md.free_cash_pct}%</span>
            {floorLbl && <span style={{ color: floorLbl.color, marginLeft: theme.space[1] }}>{floorLbl.text}</span>}
          </span>
        )}
        {md.mtd_realized != null && (
          <span>MTD <span style={{ color: theme.green, fontWeight: 600 }}>${md.mtd_realized.toLocaleString()}</span></span>
        )}
      </div>

      {/* Right: date */}
      <span style={{ color: theme.text.muted, fontSize: theme.size.sm, flexShrink: 0 }}>
        {fmtEntryDate(entry.entry_date)}
      </span>
    </div>
  );
}
```

Notes:
- When `metadata` is missing (legacy EOD entry), `floorLbl` is null and the border falls back to `theme.border.default`. Still renders as a band with the badge + date.
- Expanded state re-uses `JournalEntryCard` — which renders the existing rich expanded view when `hasMeta` is true.

- [ ] **Step 3: Update `JournalTab.jsx` to route EOD entries to the band**

Import EODBand:
```jsx
import { EODBand } from "./EODBand";
```

In the `week.days.map(day => ...)` block (added in Task 3), split each day's entries into EOD entries and non-EOD entries, render the EOD band first:

Replace:
```jsx
{day.entries.map(entry =>
  entry.id === inlineEditId
    ? <JournalInlineEditForm ... />
    : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
)}
```

With:
```jsx
{(() => {
  const eodEntries   = day.entries.filter(e => e.entry_type === "eod_update");
  const otherEntries = day.entries.filter(e => e.entry_type !== "eod_update");
  return [
    ...eodEntries.map(entry =>
      entry.id === inlineEditId
        ? <JournalInlineEditForm
            key={entry.id}
            entry={entry}
            title={inlineTitle}           onTitleChange={e => setInlineTitle(e.target.value)}
            body={inlineBody}             onBodyChange={e => setInlineBody(e.target.value)}
            tags={inlineTags}             onTagsChange={e => setInlineTags(e.target.value)}
            source={inlineSource}         onSourceChange={setInlineSource}
            mood={inlineMood}             onMoodChange={setInlineMood}
            onSave={() => handleInlineSave(entry.entry_type, entry)}
            onCancel={handleInlineCancel}
            saving={inlineSaving}
            error={inlineError}
          />
        : <EODBand key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
    ),
    ...otherEntries.map(entry =>
      entry.id === inlineEditId
        ? <JournalInlineEditForm
            key={entry.id}
            entry={entry}
            title={inlineTitle}           onTitleChange={e => setInlineTitle(e.target.value)}
            body={inlineBody}             onBodyChange={e => setInlineBody(e.target.value)}
            tags={inlineTags}             onTagsChange={e => setInlineTags(e.target.value)}
            source={inlineSource}         onSourceChange={setInlineSource}
            mood={inlineMood}             onMoodChange={setInlineMood}
            onSave={() => handleInlineSave(entry.entry_type, entry)}
            onCancel={handleInlineCancel}
            saving={inlineSaving}
            error={inlineError}
          />
        : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
    ),
  ];
})()}
```

- [ ] **Step 4: Hover-reveal Edit/Delete on desktop (JournalEntryCard)**

Locate the Edit/Delete row at the bottom of `JournalEntryCard.jsx` (search for `onEdit` and `onDelete` usage — likely a button row near line 440+).

Add a new hover state at the top of the component:

```jsx
const [actionsHovered, setActionsHovered] = useState(false);
```

Wrap the existing card-root `<div>` with `onMouseEnter={() => setActionsHovered(true)} onMouseLeave={() => setActionsHovered(false)}`.

Change the Edit/Delete button row's style to include conditional opacity — only on desktop:

```jsx
// at top of component, or via useWindowWidth hook:
import { useWindowWidth } from "../../hooks/useWindowWidth";
const isMobile = useWindowWidth() < 600;

// on the button row wrapper:
style={{
  // ... existing styles
  opacity: isMobile || actionsHovered ? 1 : 0,
  transition: "opacity 0.15s",
}}
```

If the existing card already has an `onMouseEnter/onMouseLeave` handler for its own hover tint (`cardHovered`), add `setActionsHovered` alongside — don't duplicate the event listener.

- [ ] **Step 5: Verify no stray hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/journal/EODBand.jsx src/components/journal/JournalEntryCard.jsx src/components/journal/JournalTab.jsx`

Expected: only matches inside the monthly-target progress bar color logic in `JournalEntryCard.jsx` (allowlisted). Anything else is a violation.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/vinhjones/trading-dashboard
git add src/components/journal/EODBand.jsx src/components/journal/JournalEntryCard.jsx src/components/journal/JournalTab.jsx
git commit -m "$(cat <<'EOF'
feat(journal): EOD band at top of each day + hover-reveal card actions

EOD Update entries render as a full-width banded card with a floor-status
colored left border, anchored at the top of their day. Edit/Delete buttons
on trade-note cards fade in on hover (desktop) and stay always-visible on
mobile.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Verify: `git log origin/main -1 --oneline`

---

## Task 5: Version bump and ship

**Files:**
- Modify: `src/lib/constants.js`
- Modify: `package.json`

### Steps

- [ ] **Step 1: Confirm current main version**

Run: `git show origin/main:package.json | grep '"version"'`

Expected: `"version": "1.49.0",`

If different, use the actual value as the baseline. Bump the minor — e.g. `1.49.0 → 1.50.0`.

- [ ] **Step 2: Bump `package.json`**

Edit `package.json`:
```json
"version": "1.50.0",
```

- [ ] **Step 3: Bump `src/lib/constants.js`**

Edit `src/lib/constants.js`:
```js
export const VERSION = "1.50.0";
```

- [ ] **Step 4: Run tests one last time**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit and push**

```bash
cd /Users/vinhjones/trading-dashboard
git add package.json src/lib/constants.js
git commit -m "$(cat <<'EOF'
chore(release): v1.50.0 — layer 6 journal redesign

Groups meta row by category, collapses the New Entry form into a
⌘N-triggered bar, groups entries by week with a left rail, and renders
EOD Updates as floor-status-accented day anchors.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 6: Confirm push succeeded**

Run: `git log origin/main -1 --oneline`
Expected: starts with the commit hash of the release commit with message `chore(release): v1.50.0`.
