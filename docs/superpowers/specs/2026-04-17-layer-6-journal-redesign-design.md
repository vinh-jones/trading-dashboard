# Layer 6 — Journal Redesign — Design Spec

**Date:** 2026-04-17
**Status:** Approved — ready for implementation plan
**Parent:** `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md` (follow-up polish / IA refinement)

---

## Summary

Redesign the Journal page (`Review → Journal`) around four changes: grouped meta rows on trade cards, a collapsible quick-add bar that reclaims the always-open right panel, a weekly left-rail that groups entries by week, and an EOD-anchored day structure where EOD Updates render as posture-accented full-width bands at the top of each day.

## Goals

- **Scan faster.** The dense `·`-chain meta row on trade cards becomes readable at a glance by grouping by meaning (contract | execution | performance | result).
- **Reclaim horizontal space.** The always-open "New Entry" form currently holds ~30% of screen width. Collapsing it to a one-line bar lets the feed fill the width and use that reclaim for the weekly left-rail.
- **Anchor time.** Entries today are a flat reverse-chron list. Weekly rail + EOD day-band gives the eye hooks (week → day → EOD summary → trade notes).
- **Respect data hierarchy.** EOD Updates are daily summaries, not individual trade notes — they should look structurally different from trade notes.

## Non-goals

- No new data fields or computed columns.
- No keyboard navigation between entries (j/k/e) — defer to a later layer.
- No search within journal bodies.
- No pinned entries.
- No changes to the filter row (All types · All tickers · This month).
- No changes to the expanded EOD detail view — only the collapsed band.
- No calendar heatmap / timeline alternate view.

## Components

### 1. Meta row (on trade-note cards)

Replace the single-line `·`-separated meta row with a grouped-with-pipes layout.

**Groups (each optional based on available data):**
- **Contract:** strike, expiry, contracts
- **Execution:** entry cost → exit cost, cash%
- **Performance:** RoR, delta, days, kept%
- **Result:** P&L (green/red, bold)

**Rendering rules:**
- Pipe separator between groups uses `theme.border.strong` color and is slightly wider than the `·` inside groups.
- Inside each group, fields keep `·` separators in `theme.text.faint` (unchanged).
- Groups flex-wrap together — a group does not break mid-group onto a new line. The row as a whole can wrap onto multiple lines if needed.
- Empty groups (no data for that group) render as nothing — not an empty pipe.

**File affected:** `src/components/journal/JournalEntryCard.jsx` — specifically the metaLine render block (currently at ~line 397–411).

### 2. Quick-add bar

Replace the always-open right panel "New Entry" form with a one-line bar at the top of the feed that blooms into the full form on focus.

**Collapsed state (default):**
- Full feed-width, ~36px tall.
- Styling: `background: theme.bg.surface`, `border: 1px solid theme.border.default`, `borderRadius: theme.radius.md`, `padding: theme.space[2] theme.space[3]`.
- Content: `+` icon (`theme.blue`) + "New entry…" placeholder (`theme.text.subtle`) on the left; `⌘N` kbd pill on the right.
- Interactions: click anywhere or press ⌘N to enter bloomed state. Hover tint `rgba(58,130,246,0.06)`.

**Bloomed state:**
- Height expands to contain the full form.
- Border color changes to `theme.blue`.
- Renders the existing form layout: entry type pills (Trade Note · EOD Update · Position Note), link-to-open-position, link-to-closed-trade, title, source, tags, notes, Cancel · Save.
- On successful save or Cancel click, collapses back.
- Esc cancels and collapses.

**Journal type stays inside the form.** Do not move the type selector outside the bloomed area.

**Right panel goes away.** The current always-visible right column is removed from `JournalTab.jsx`. The feed gets full width.

**Files:**
- Create: `src/components/journal/JournalQuickAdd.jsx` — the new bar + bloom component. Wraps/absorbs the form rendering that currently lives in `JournalInlineEditForm.jsx` for the "create new" path.
- Modify: `src/components/journal/JournalTab.jsx` — remove the right panel, add `<JournalQuickAdd />` at the top of the feed.
- Modify: `src/components/journal/JournalInlineEditForm.jsx` — this currently handles both create and edit; after the refactor it only handles edit (inline editing of an existing card). Create path lives in `JournalQuickAdd.jsx`.

### 3. Weekly left-rail + day grouping

Group entries by week (Sun–Sat). Render a left rail per week with week label + range + entry count. Add a day header above each day's entries.

**Rail appearance:**
- Width: 110px on desktop. On mobile (<600px), rail becomes a horizontal strip above the week's entries.
- Sticky behavior: `position: sticky; top: 0` within the rail's week section — label stays visible while scrolling that week's entries.

**Rail label rules:**
- This week (contains today): "This Week"
- Last week: "Last Week"
- 2 weeks back: "2 weeks ago"
- 3+ weeks back: "Week of Apr 6" (absolute date of the week's Sunday)

**Rail secondary lines:**
- Date range: "Apr 13 – 19" (`theme.text.subtle`, size sm)
- Entry count: "5 entries" (`theme.blue`, size xs)

**Day headers (inside each week):**
- Rendered above each day's entries.
- Format: "Apr 15, Wednesday" (`theme.text.subtle`, size sm, uppercase letter-spacing).
- Days with an EOD: the EOD band visually anchors the day; the day header sits just above the band, tight spacing.
- Days without an EOD: just the day header; trade notes follow.

**Files:**
- Create: `src/components/journal/WeekRail.jsx` — rail component.
- Create: `src/lib/journalGrouping.js` — pure helper: `groupByWeek(entries) → [{ weekStart, weekEnd, label, days: [{ date, entries }]}]`.
- Modify: `src/components/journal/JournalTab.jsx` — call the grouping helper, render rail + feed in a two-column layout per week.

### 4. EOD band

EOD Update entries get a distinct collapsed representation: a full-feed-width banded card anchored at the top of their day.

**Appearance (collapsed):**
- Full feed-width. Height ~52px.
- `background: theme.bg.surface`, `borderRadius: theme.radius.md`.
- Left border: 3px solid, colored by floor status. The mapping already exists in `src/components/journal/journalHelpers.js` via `eodFloorLabel(entry.metadata.floor_status)` which returns `{ color }` — reuse it. Values: `"within"` → `theme.green`, `"above"` → `theme.amber`, `"below"` → `theme.red`. For EOD entries without `metadata.floor_status`, fall back to `theme.border.default` (no colored accent).
- Content row (left to right):
  - "EOD UPDATE" badge + floor-status chip (e.g. "↓ floor", "✓ in band", "↑ ceiling") via `eodFloorLabel()`
  - Inline stat pills: `VIX <value>`, `Cash <pct>`, `MTD <dollars>` — pulled from `entry.metadata` (`vix`, `cash_pct`, `mtd_realized` or equivalent existing fields; check current EOD metadata schema during implementation)
  - Date, right-aligned

**Interactions:**
- Click anywhere on the band expands it to the existing full EOD detail view (no change to the expanded layout).
- Hover tint `rgba(58,130,246,0.06)`.

**Position:** Always rendered first in its day's entry group, before any trade notes for that day.

**Days without an EOD:** No band rendered. The day header from the timeline appears; trade notes follow normally. Asymmetry is intentional — it honestly signals "no EOD was logged".

**Files:**
- Create: `src/components/journal/EODBand.jsx` — the collapsed EOD band. Takes the EOD entry as a prop. Falls back to the existing `JournalEntryCard.jsx` expanded rendering when expanded.
- Modify: `src/components/journal/JournalEntryCard.jsx` — detect EOD type and delegate collapsed rendering to `EODBand.jsx`. Expanded rendering stays here, unchanged.
- Modify: `src/components/journal/JournalTab.jsx` — within each day's group, render the day's EOD band first (if any), then the day's trade notes.

## States & interactions

### Card hover states

All clickable cards (trade note, EOD band, quick-add bar) use hover tint `rgba(58,130,246,0.06)` per DESIGN.md. No other behavioral changes.

### Trade-note actions

Currently Edit/Delete buttons are always visible at the bottom-right of each card. **Change:** on desktop (>600px) they fade in on hover (`opacity 0 → 1` on card hover, `transition: opacity 0.15s`). On mobile (<600px) they stay always-visible. No behavioral change — still wired to the same handlers.

### Keyboard

- **⌘N** — focus the quick-add bar and enter bloomed state. Wired through existing `useHotkey("mod+n", ...)` hook. Handler is guarded against input-focus by existing `isEditableTarget` logic.
- **Esc** — while bloomed, collapse the quick-add bar without saving.
- Scope of ⌘N: only when mode === "review" AND subView === "journal". In any other view it's a no-op.

### Scroll behavior

- Week rail: sticky within its week section only — not sticky across the entire feed.
- Quick-add bar: scrolls with the feed (not sticky). ⌘N scrolls to top and focuses.

### Empty states

- **No entries at all:** centered `text.subtle` message — "Start your journal — press ⌘N or click the bar above."
- **No entries this week:** week section renders the rail but the feed body shows "No entries this week." in `text.subtle`. Rail entry count shows "0 entries".
- **Day with trade notes but no EOD:** day header renders; no band. Trade notes follow.
- **Day with only EOD (no trade notes):** EOD band renders; nothing else for that day.

## File structure

**Create:**
- `src/components/journal/JournalQuickAdd.jsx` — the bar + bloom component.
- `src/components/journal/WeekRail.jsx` — the week rail component.
- `src/components/journal/EODBand.jsx` — the collapsed EOD band.
- `src/lib/journalGrouping.js` — pure grouping helper (`groupByWeek(entries)`).

**Modify:**
- `src/components/journal/JournalTab.jsx` — absorb all 4 new pieces: remove right panel, add quick-add bar at top, add grouping + rail + day headers, route EOD to band.
- `src/components/journal/JournalEntryCard.jsx` — meta-row refactor (grouped-with-pipes); EOD routing to band for collapsed state; hover-reveal Edit/Delete on desktop.
- `src/components/journal/JournalInlineEditForm.jsx` — trim to edit-only (the create path moves to `JournalQuickAdd.jsx`).
- `src/App.jsx` — wire `useHotkey("mod+n", ...)` scoped to Review → Journal.
- `src/lib/constants.js` — `VERSION` bump 1.49.0 → 1.50.0.
- `package.json` — version bump.

## Sequencing

Ship as 5 commits, one per component + version bump:

1. **Commit 1:** Meta row refactor (`JournalEntryCard.jsx`). Smallest change, proves the visual direction in isolation.
2. **Commit 2:** Quick-add bloom. New `JournalQuickAdd.jsx`, trimmed `JournalInlineEditForm.jsx`, right panel removed from `JournalTab.jsx`. Wire ⌘N in `App.jsx`.
3. **Commit 3:** Weekly grouping + left rail. New `journalGrouping.js` helper, `WeekRail.jsx` component, `JournalTab.jsx` rewired to render by week.
4. **Commit 4:** EOD band. New `EODBand.jsx`, `JournalEntryCard.jsx` routes EOD to band for collapsed state, `JournalTab.jsx` renders band first per day.
5. **Commit 5:** Version bump to 1.50.0 + final push.

Each commit ships to main. Version bump reserved for commit 5 per repo convention.

## Verification

The change is visual and interactive; no automated test coverage for visual output. Verification is:

- **Each commit:** implementer verifies `git diff` contains only the scoped changes (no new behaviors beyond what's specified). No hardcoded hex outside CLAUDE.md allowlist. All tokens from DESIGN.md.
- **Final:** user loads prod and spot-checks: meta row readability, quick-add bloom interaction, week rail stickiness, EOD band rendering with posture colors, ⌘N hotkey, Esc cancellation, hover-reveal Edit/Delete.

## Out of scope (explicit)

- Keyboard navigation between entries (j/k/e)
- Search within journal bodies
- Pinned entries
- Filtering by clicking the week rail
- Moving the entry-type selector outside the bloomed form
- Calendar heatmap or alternate timeline views
- Bulk actions (multi-select, bulk delete)
- Changes to the filter row
- Changes to the expanded EOD detail view
- Mobile sidebar / responsive rework beyond the week-rail-to-strip collapse

## Success criteria

- Journal feed uses full feed width by default (no always-open right panel).
- Meta rows on trade cards show grouped-with-pipes layout.
- Entries are visually grouped by week with a sticky left rail.
- Days with EOD entries show the EOD as an accented band at the top of the day.
- ⌘N opens the quick-add; Esc closes it.
- No hardcoded hex outside CLAUDE.md allowlist in any of the modified files.
- Version shipped as 1.50.0 to main.
