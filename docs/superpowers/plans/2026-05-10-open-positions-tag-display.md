# Open Positions — Strategic Tag Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `earnings-play` / `signal` / `macro` journal-entry tags on open positions — compact chip after the ticker on the collapsed row, full clickable list in the expanded row, plus a `+ Tag` shortcut to add tags without leaving the table.

**Architecture:** Client-side join. Fetch journal entries for the user's open-position tickers, filter to strategic prefixes, group by position key in JS. Tags render via the existing `TagChip` component. Click-through and `+ Tag` reuse the existing `journalIntent` cross-tab signaling pattern by extending it from a string to a discriminated union (`{ kind, ... }`). The expanded row already exists for CSP/CC; we hang a "Strategic context" block above the existing `PriceTargetPanel`.

**Tech Stack:** React 18, Supabase JS client, Vitest, inline-style theming via `theme.js`.

**Spec:** [docs/superpowers/specs/2026-05-10-open-positions-tag-display-design.md](docs/superpowers/specs/2026-05-10-open-positions-tag-display-design.md)

**Pre-existing infrastructure to reuse (don't reinvent):**
- `CATEGORY_COLORS`, `categoryFromTag()` in [src/lib/tagConstants.js](src/lib/tagConstants.js) — already covers all 6 vocabulary categories. **Skip the spec's "add `TAG_CATEGORY_COLORS` to journalConstants.js" entry — that map already exists.**
- `TagChip` component in [src/components/journal/TagChip.jsx](src/components/journal/TagChip.jsx) — already styles tags by category. Reuse for the expanded-row chip list. The compact collapsed-row chip is small enough that we render it inline rather than via `TagChip` (so we can show the suffix only).
- `TagInput` in [src/components/journal/TagInput.jsx](src/components/journal/TagInput.jsx) — used inside QuickAdd; we just need to focus its input from the intent effect.
- `journalIntent` plumbing through `App.jsx` → `ReviewView.jsx` → `JournalTab.jsx` → `JournalQuickAdd.jsx`.
- Expanded-row scaffold in [OpenPositionsTab.jsx:654-665](src/components/OpenPositionsTab.jsx:654) (currently rendering `CushionPanel` + `PriceTargetPanel`).

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/lib/tags.js` | Modify | Add `STRATEGIC_TAG_PREFIXES`, pure `groupStrategicTagsByPosition` helper, async `fetchStrategicTagsForOpenPositions` orchestrator. |
| `src/lib/__tests__/tags.test.js` | Create | Unit tests for `groupStrategicTagsByPosition` (pure). |
| `src/components/PositionTagChip.jsx` | Create | Small presentational chip. Two modes: compact (collapsed row, suffix-only label) and full (expanded row, full label, clickable). |
| `src/App.jsx` | Modify | Migrate `journalIntent` from string to `{ kind, ... }`. Add `onShowJournalEntry` and `onTagPosition` handlers; thread to ExploreView. |
| `src/components/ExploreView.jsx` | Modify | Thread `onShowJournalEntry` and `onTagPosition` props to `OpenPositionsTab`. |
| `src/components/journal/JournalQuickAdd.jsx` | Modify | Read `journalIntent.kind` (was string). New branch for `tag_position`: pre-fill linkedPosition + open + focus TagInput. Relax body-required for `entry_type === "position_note"`. |
| `src/components/journal/JournalTab.jsx` | Modify | Read `journalIntent.kind`. New effect for `show_entry`: scroll to `journal-entry-${id}`, mark that card `defaultExpanded`. Wrap each card with `<div id="journal-entry-${id}">`. |
| `src/components/OpenPositionsTab.jsx` | Modify | Fetch strategic tags via `useEffect`; pass map to `PositionsTable`; render compact chip after ticker; render Strategic context block + `+ Tag` button in expanded row. New props: `onShowJournalEntry`, `onTagPosition`. |
| `src/lib/constants.js` | Modify | Bump `VERSION` to `1.111.0`. |
| `package.json` | Modify | Bump `version` to `1.111.0`. |

---

## Task 1: Pure tag-grouping helper + tests

**Files:**
- Modify: `src/lib/tags.js`
- Create: `src/lib/__tests__/tags.test.js`

This task lays down the data primitive: take a list of journal entries and a list of open positions, produce a map from position-key → list of strategic tags with their source-entry id. Pure, no Supabase. Deterministic. Tested.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/tags.test.js` with the following:

```js
import { describe, it, expect } from "vitest";
import { groupStrategicTagsByPosition, STRATEGIC_TAG_PREFIXES } from "../tags";

const positions = {
  open_csps: [
    { ticker: "SOFI", type: "CSP", strike: 14, expiry_date: "2026-06-19" },
    { ticker: "NVDA", type: "CSP", strike: 485, expiry_date: "2026-05-30" },
  ],
  open_leaps: [
    { ticker: "GOOGL", type: "LEAPS", strike: 230, expiry_date: "2027-01-15" },
  ],
  assigned_shares: [
    {
      ticker: "AAPL",
      active_cc: { ticker: "AAPL", type: "CC", strike: 220, expiry_date: "2026-05-23" },
    },
  ],
};

const entries = [
  // SOFI CSP — strategic earnings-play, should appear
  { id: "e1", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["earnings-play:path-c-standard", "signal:ryan"], created_at: "2026-05-08T10:00:00Z" },
  // SOFI CSP — second entry adds a macro tag, should union
  { id: "e2", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["macro:fed", "position-action:opened-csp"], created_at: "2026-05-09T10:00:00Z" },
  // NVDA CSP — only excluded categories, should produce empty result for NVDA
  { id: "e3", ticker: "NVDA", type: "CSP", strike: 485, expiry: "2026-05-30", tags: ["framework:60-60-applied", "drift:fatigue", "position-action:rolled-out"], created_at: "2026-05-09T10:00:00Z" },
  // AAPL — but tagged on Shares, not the CC. Match should hit Shares key.
  { id: "e4", ticker: "AAPL", type: "Shares", strike: null, expiry: null, tags: ["signal:independent"], created_at: "2026-05-09T10:00:00Z" },
  // AAPL CC — separate entry, should hit CC key
  { id: "e5", ticker: "AAPL", type: "CC", strike: 220, expiry: "2026-05-23", tags: ["earnings-play"], created_at: "2026-05-09T10:00:00Z" },
  // GOOGL LEAPS — should match LEAPS position
  { id: "e6", ticker: "GOOGL", type: "LEAPS", strike: 230, expiry: "2027-01-15", tags: ["macro:fed"], created_at: "2026-05-09T10:00:00Z" },
  // Unrelated ticker — should be ignored
  { id: "e7", ticker: "ZZZZ", type: "CSP", strike: 5, expiry: "2026-06-19", tags: ["signal:ryan"], created_at: "2026-05-09T10:00:00Z" },
];

describe("STRATEGIC_TAG_PREFIXES", () => {
  it("includes earnings-play, signal, macro and excludes others", () => {
    expect(STRATEGIC_TAG_PREFIXES).toEqual(["earnings-play", "signal", "macro"]);
  });
});

describe("groupStrategicTagsByPosition", () => {
  it("matches CSP positions by ticker+type+strike+expiry and unions strategic tags across entries", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const sofi = map.get("SOFI|CSP|14|2026-06-19");
    expect(sofi).toBeTruthy();
    const tags = sofi.map(t => t.tag).sort();
    expect(tags).toEqual(["earnings-play:path-c-standard", "macro:fed", "signal:ryan"]);
  });

  it("excludes position-action, framework, and drift categories", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const nvda = map.get("NVDA|CSP|485|2026-05-30");
    expect(nvda).toBeFalsy();
  });

  it("matches Shares positions by ticker+type only (no strike/expiry)", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const shares = map.get("AAPL|Shares");
    expect(shares).toBeTruthy();
    expect(shares.map(t => t.tag)).toEqual(["signal:independent"]);
  });

  it("matches CC positions independently from their parent shares", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const cc = map.get("AAPL|CC|220|2026-05-23");
    expect(cc).toBeTruthy();
    expect(cc.map(t => t.tag)).toEqual(["earnings-play"]);
  });

  it("matches LEAPS positions", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const leaps = map.get("GOOGL|LEAPS|230|2027-01-15");
    expect(leaps).toBeTruthy();
    expect(leaps.map(t => t.tag)).toEqual(["macro:fed"]);
  });

  it("ignores entries for tickers with no open position", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    expect([...map.keys()].some(k => k.startsWith("ZZZZ"))).toBe(false);
  });

  it("dedupes the same tag appearing in multiple entries; clicking that tag should jump to the most recent", () => {
    const dupEntries = [
      { id: "old", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["signal:ryan"], created_at: "2026-05-01T10:00:00Z" },
      { id: "new", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["signal:ryan"], created_at: "2026-05-09T10:00:00Z" },
    ];
    const map = groupStrategicTagsByPosition(dupEntries, positions);
    const sofi = map.get("SOFI|CSP|14|2026-06-19");
    expect(sofi).toHaveLength(1);
    expect(sofi[0].tag).toBe("signal:ryan");
    expect(sofi[0].entryId).toBe("new"); // most recent
  });

  it("returns an empty map when no entries match", () => {
    const map = groupStrategicTagsByPosition([], positions);
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, verify failure**

Run: `npm test -- src/lib/__tests__/tags.test.js`
Expected: FAIL — `groupStrategicTagsByPosition is not exported` (or similar) and `STRATEGIC_TAG_PREFIXES is not exported`.

- [ ] **Step 3: Add the exports to `src/lib/tags.js`**

Append to `src/lib/tags.js` (after the existing `getTagUsageStats` function):

```js
// ── Strategic-tag display for open positions ─────────────────────────────────

export const STRATEGIC_TAG_PREFIXES = ["earnings-play", "signal", "macro"];

function tagPrefix(tag) {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(0, i);
}

function isStrategic(tag) {
  return STRATEGIC_TAG_PREFIXES.includes(tagPrefix(tag));
}

function positionKey(p) {
  if (p.type === "Shares") return `${p.ticker}|Shares`;
  return `${p.ticker}|${p.type}|${p.strike}|${p.expiry_date ?? p.expiry}`;
}

function entryKey(e) {
  if (e.type === "Shares") return `${e.ticker}|Shares`;
  return `${e.ticker}|${e.type}|${e.strike}|${e.expiry}`;
}

/**
 * Group strategic tags from journal entries by position key.
 *
 * @param {Array} entries  - Journal entries with {id, ticker, type, strike, expiry, tags, created_at}.
 * @param {Object} positions - {open_csps, open_leaps, assigned_shares} as held in app state.
 * @returns {Map<string, Array<{tag, entryId, createdAt}>>} - Position key → strategic tags. Deduped per position; for duplicate tags, the most recent entry id is retained.
 */
export function groupStrategicTagsByPosition(entries, positions) {
  // Build the set of valid position keys we want to surface tags for.
  const validKeys = new Set();
  (positions?.open_csps ?? []).forEach(p => validKeys.add(positionKey(p)));
  (positions?.open_leaps ?? []).forEach(p => validKeys.add(positionKey(p)));
  (positions?.assigned_shares ?? []).forEach(s => {
    validKeys.add(positionKey({ ticker: s.ticker, type: "Shares" }));
    if (s.active_cc) validKeys.add(positionKey({ ...s.active_cc, type: "CC" }));
  });

  // Walk entries newest-first; for each strategic tag, keep the first occurrence
  // (which is the most recent thanks to the sort).
  const sorted = [...entries].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)));

  const out = new Map(); // posKey → Map<tag, {tag, entryId, createdAt}>
  for (const e of sorted) {
    const key = entryKey(e);
    if (!validKeys.has(key)) continue;
    if (!Array.isArray(e.tags)) continue;
    for (const tag of e.tags) {
      if (!isStrategic(tag)) continue;
      let posBucket = out.get(key);
      if (!posBucket) { posBucket = new Map(); out.set(key, posBucket); }
      if (!posBucket.has(tag)) {
        posBucket.set(tag, { tag, entryId: e.id, createdAt: e.created_at });
      }
    }
  }

  // Materialize inner Maps to arrays.
  const result = new Map();
  for (const [k, bucket] of out) result.set(k, [...bucket.values()]);
  return result;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- src/lib/__tests__/tags.test.js`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tags.js src/lib/__tests__/tags.test.js
git commit -m "feat(tags): add groupStrategicTagsByPosition helper

Pure helper: takes journal entries and the positions object, groups
strategic tags (earnings-play, signal, macro) by position key.
Excludes position-action, framework, drift. Dedupes per position;
duplicate tags keep the most recent entry's id (for click-through).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: PositionTagChip presentational component

**Files:**
- Create: `src/components/PositionTagChip.jsx`

A small clickable chip for tag display. Two visual modes:
- `compact={true}` (collapsed row): smaller, suffix-only label, category-colored border, low-contrast bg.
- `compact={false}` (expanded row): full tag text, same as the existing `TagChip` styling (we delegate to `TagChip` for this case to avoid duplicate styling).

This component is purely presentational. The parent passes the `onClick` handler that triggers click-through navigation.

- [ ] **Step 1: Create the file with the component**

Create `src/components/PositionTagChip.jsx`:

```jsx
import { theme } from "../lib/theme";
import { CATEGORY_COLORS, categoryFromTag } from "../lib/tagConstants";
import { TagChip } from "./journal/TagChip";

function tagSuffix(tag) {
  const i = tag.indexOf(":");
  return i === -1 ? tag : tag.slice(i + 1);
}

/**
 * Tag chip for an open-position row.
 *
 * - compact: short label (suffix only when prefixed; full when not), inline next to ticker.
 * - !compact: full TagChip styling, used inside the expanded-row "Strategic context" block.
 *
 * onClick is forwarded to the wrapper. The chip stops event propagation so
 * clicking a chip on a collapsed row doesn't also toggle the row's expand state.
 */
export function PositionTagChip({ tag, onClick, compact = false }) {
  const cat    = categoryFromTag(tag);
  const colors = CATEGORY_COLORS[cat];

  if (!compact) {
    // Expanded-row form: defer to TagChip for consistent styling.
    return (
      <span
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        style={{ cursor: onClick ? "pointer" : "default", display: "inline-flex" }}
      >
        <TagChip tag={tag} size="sm" />
      </span>
    );
  }

  // Compact collapsed-row form.
  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        fontSize:     theme.size.xs,
        fontFamily:   theme.font.mono,
        color:        colors.text,
        background:   theme.bg.elevated,
        border:       `1px solid ${colors.border}`,
        borderRadius: theme.radius.pill,
        padding:      "1px 7px",
        lineHeight:   1.3,
        whiteSpace:   "nowrap",
        cursor:       onClick ? "pointer" : "default",
        marginLeft:   theme.space[1],
      }}
      title={tag}
    >
      {tagSuffix(tag)}
    </span>
  );
}

/** Compact "+N" overflow indicator for collapsed rows with multiple tags. */
export function PositionTagOverflow({ count, onClick }) {
  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        fontSize:     theme.size.xs,
        fontFamily:   theme.font.mono,
        color:        theme.text.muted,
        background:   theme.bg.elevated,
        border:       `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.pill,
        padding:      "1px 6px",
        marginLeft:   theme.space[1],
        cursor:       onClick ? "pointer" : "default",
      }}
    >
      +{count}
    </span>
  );
}
```

- [ ] **Step 2: Verify the file compiles by running `npm run build`**

Run: `npm run build`
Expected: build succeeds with no errors. (No tests yet; visual integration happens in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/components/PositionTagChip.jsx
git commit -m "feat(positions): add PositionTagChip + PositionTagOverflow components

Compact chip for collapsed position rows (suffix-only label,
category-colored border) and a +N overflow chip. Full-form chip
delegates to existing TagChip. Click handlers stopPropagation so
they don't toggle the row's expand state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Migrate `journalIntent` from string to discriminated union

**Files:**
- Modify: `src/App.jsx:89, 105, 136`
- Modify: `src/components/journal/JournalQuickAdd.jsx:172-182`

Today `journalIntent` is `"new_entry" | "eod_update" | null`. After this task it becomes:

```js
| { kind: "new_entry" }
| { kind: "eod_update" }
| { kind: "show_entry", entryId: string }     // wired in Task 4
| { kind: "tag_position", position: object }  // wired in Task 5
| null
```

This task only does the **migration of existing call sites + consumer**. New `kind`s are wired in later tasks. Behavior must remain identical at the end of this task.

- [ ] **Step 1: Update App.jsx hotkey handler**

In [src/App.jsx:102-106](src/App.jsx:102), replace:

```js
  useHotkey("n", () => {
    setMode("review");
    setSubViewRaw("journal");
    setJournalIntent("new_entry");
  });
```

with:

```js
  useHotkey("n", () => {
    setMode("review");
    setSubViewRaw("journal");
    setJournalIntent({ kind: "new_entry" });
  });
```

- [ ] **Step 2: Update App.jsx palette select handler**

In [src/App.jsx:133-137](src/App.jsx:133), replace:

```js
      case "new_eod_entry":
        setMode("review");
        setSubViewRaw("journal");
        setJournalIntent("eod_update");
        return;
```

with:

```js
      case "new_eod_entry":
        setMode("review");
        setSubViewRaw("journal");
        setJournalIntent({ kind: "eod_update" });
        return;
```

- [ ] **Step 3: Update JournalQuickAdd.jsx consumer**

In [src/components/journal/JournalQuickAdd.jsx:172-182](src/components/journal/JournalQuickAdd.jsx:172), replace:

```js
  // ── Journal intent handling (moved from JournalTab, extended for new_entry) ──
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

with:

```js
  // ── Journal intent handling — discriminated by .kind ──
  useEffect(() => {
    if (!journalIntent) return;
    if (journalIntent.kind === "eod_update") {
      setEntryType("eod_update");
      onOpen();
      onJournalIntentConsumed?.();
    } else if (journalIntent.kind === "new_entry") {
      onOpen();
      onJournalIntentConsumed?.();
    }
    // "show_entry" and "tag_position" are handled in their respective consumers
    // (JournalTab for show_entry; this file's Task 5 for tag_position).
  }, [journalIntent, onJournalIntentConsumed, onOpen]);
```

- [ ] **Step 4: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Smoke-test the existing behavior**

Run: `npm run dev`
Open the browser. Press `n` — the journal QuickAdd composer should open with `trade_note` selected (the default), as before.
Open the command palette (Cmd+K) → "New EOD Entry" — composer opens with `eod_update` selected, as before.

(No automated test for this — the behavior is just "the composer opens." Once we add `show_entry` and `tag_position` consumers, those have their own observable behavior to test.)

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/journal/JournalQuickAdd.jsx
git commit -m "refactor: migrate journalIntent from string to {kind} object

Pure shape migration — no behavior change. Lays the groundwork for
adding 'show_entry' and 'tag_position' intent variants in subsequent
commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `kind: "show_entry"` consumer in JournalTab

**Files:**
- Modify: `src/components/journal/JournalTab.jsx`

Add an effect that, when an intent of `kind: "show_entry"` arrives, finds the entry in the rendered list, scrolls it into view, and renders that one card with `defaultExpanded={true}`. Wrap each card with a stable `id="journal-entry-${id}"` so we can target it by DOM id.

- [ ] **Step 1: Add target-entry state and intent effect to JournalTab**

In [src/components/journal/JournalTab.jsx](src/components/journal/JournalTab.jsx), after the `inlineError` state declaration (around line 54), add:

```js
  // Target entry id for "show_entry" intent — used to scroll-into-view + auto-expand.
  const [targetEntryId, setTargetEntryId] = useState(null);
```

Then, just before the `useEffect(() => { fetchEntries(); }, ...)` block (around line 78), add:

```js
  // Handle "show_entry" intent: scroll and auto-expand the matching card.
  useEffect(() => {
    if (journalIntent?.kind !== "show_entry") return;
    const id = journalIntent.entryId;
    setTargetEntryId(id);
    onJournalIntentConsumed?.();
    // Scroll once the card is in the DOM. We retry briefly because the card
    // may not be rendered yet if filters/data aren't loaded.
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(`journal-entry-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (++tries < 20) setTimeout(tick, 100);
    };
    tick();
  }, [journalIntent, onJournalIntentConsumed]);
```

- [ ] **Step 2: Wrap each card with a DOM id**

In [src/components/journal/JournalTab.jsx:285-287](src/components/journal/JournalTab.jsx:285), replace:

```js
                          : entry.entry_type === "eod_update"
                            ? <EODBand key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
                            : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />;
```

with:

```js
                          : (
                            <div key={entry.id} id={`journal-entry-${entry.id}`}>
                              {entry.entry_type === "eod_update"
                                ? <EODBand entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
                                : <JournalEntryCard entry={entry} onEdit={handleEdit} onDelete={handleDelete} defaultExpanded={entry.id === targetEntryId} />}
                            </div>
                          );
```

(Note: `EODBand` doesn't accept `defaultExpanded` — its inner `JournalEntryCard` already has its own expansion state per [EODBand.jsx](src/components/journal/EODBand.jsx). For v1 we don't auto-expand EODs from intent navigation; EOD entries surface enough of their content in the collapsed form. If we later want to expand them, that's a follow-up.)

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`. In the browser console:

```js
// Inspect that journal entries now have stable DOM ids
document.querySelectorAll('[id^="journal-entry-"]').length
```

Navigate to Review → Journal — the count should equal the number of rendered entries.

(Full end-to-end click-from-position-row navigation is verified in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/components/journal/JournalTab.jsx
git commit -m "feat(journal): handle show_entry intent — scroll + auto-expand

When journalIntent.kind === 'show_entry', JournalTab finds the matching
card by DOM id (journal-entry-\${id}), scrolls it into view, and renders
its JournalEntryCard with defaultExpanded=true. Retries briefly while
data loads, then gives up.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: `kind: "tag_position"` consumer in JournalQuickAdd + relax body-required for position_note

**Files:**
- Modify: `src/components/journal/JournalQuickAdd.jsx`

Two changes:
1. New branch in the intent effect that pre-fills the form for tagging a position (entryType=position_note, linkedPosition set, autotitle, focus the TagInput).
2. Relax the body-required save check for `position_note` entries — for those, the tag *is* the content.

- [ ] **Step 1: Add a ref for the TagInput container**

`TagInput` doesn't currently accept a ref. Rather than refactor `TagInput`, we focus its inner input via a wrapping div + a query selector. Add this near the top of `JournalQuickAdd` (just below the existing `useState`/`useMemo` block, around line 47):

```js
  const tagFieldRef = useRef(null);
```

And import `useRef` at the top of the file:

```js
import { useState, useEffect, useMemo, useRef } from "react";
```

- [ ] **Step 2: Add a Tags field to the position_note block**

The `position_note` block at [JournalQuickAdd.jsx:528-542](src/components/journal/JournalQuickAdd.jsx:528) currently has Position, Title, and Notes — but no Tags field. Add one (between Title and Notes), wrapped in a div so we can find its inner input via ref.

Replace the existing position_note block:

```jsx
      {/* ── Position Note fields ── */}
      {entryType === "position_note" && (
        <>
          {posSelectEl("Position", false)}
          <JournalField label="Title">
            <input
              type="text" style={JOURNAL_INPUT_ST} value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Auto-filled from position, or enter manually"
            />
          </JournalField>
          <JournalField label="Notes">
            <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={120} placeholder="Ongoing observations, roll considerations, delta watch..." />
          </JournalField>
        </>
      )}
```

with:

```jsx
      {/* ── Position Note fields ── */}
      {entryType === "position_note" && (
        <>
          {posSelectEl("Position", false)}
          <JournalField label="Title">
            <input
              type="text" style={JOURNAL_INPUT_ST} value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Auto-filled from position, or enter manually"
            />
          </JournalField>
          <JournalField label="Tags">
            <div ref={tagFieldRef}>
              <TagInput value={formTags} onChange={setFormTags} vocabulary={vocabulary} />
            </div>
          </JournalField>
          <JournalField label="Notes (optional for position notes)">
            <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={120} placeholder="Ongoing observations, roll considerations, delta watch..." />
          </JournalField>
        </>
      )}
```

- [ ] **Step 3: Add the `tag_position` branch to the intent effect**

In the intent effect modified in Task 3, extend the conditional chain (after the `new_entry` branch):

```js
  // ── Journal intent handling — discriminated by .kind ──
  useEffect(() => {
    if (!journalIntent) return;
    if (journalIntent.kind === "eod_update") {
      setEntryType("eod_update");
      onOpen();
      onJournalIntentConsumed?.();
    } else if (journalIntent.kind === "new_entry") {
      onOpen();
      onJournalIntentConsumed?.();
    } else if (journalIntent.kind === "tag_position") {
      const pos = journalIntent.position;
      setEntryType("position_note");
      setLinkedPosition(pos);
      setLinkedTrade(null);
      setFormTitle(buildAutoTitle("position_note", pos, null));
      setFormTags([]);
      setFormBody("");
      onOpen();
      onJournalIntentConsumed?.();
      // Focus the TagInput once the composer opens.
      setTimeout(() => {
        const input = tagFieldRef.current?.querySelector("input");
        input?.focus();
      }, 50);
    }
  }, [journalIntent, onJournalIntentConsumed, onOpen]);
```

- [ ] **Step 4: Relax body-required for position_note**

In [src/components/journal/JournalQuickAdd.jsx:213-217](src/components/journal/JournalQuickAdd.jsx:213), find:

```js
  async function handleSave() {
    const isEOD = entryType === "eod_update";
    const titleToSave = isEOD ? `EOD — ${formDate}` : formTitle.trim();
    if (!isEOD && !titleToSave) { setSaveError("Title is required."); return; }
    if (!formBody.trim())       { setSaveError("Notes are required."); return; }
```

Replace the body-check with a position-note-aware version:

```js
  async function handleSave() {
    const isEOD          = entryType === "eod_update";
    const isPositionNote = entryType === "position_note";
    const titleToSave    = isEOD ? `EOD — ${formDate}` : formTitle.trim();
    if (!isEOD && !titleToSave) { setSaveError("Title is required."); return; }
    if (!isPositionNote && !formBody.trim()) { setSaveError("Notes are required."); return; }
```

And in the payload itself (around [JournalQuickAdd.jsx:247](src/components/journal/JournalQuickAdd.jsx:247)), the `body: formBody.trim()` line: leave it as-is. An empty trimmed body is allowed for position_note now and will save as an empty string, which is fine.

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual smoke test**

Run `npm run dev`. Open the browser console and dispatch a fake intent (since the UI affordance comes in Task 6):

```js
// In React devtools, find the App component and call its setJournalIntent prop with:
// { kind: "tag_position", position: {ticker: "SOFI", type: "CSP", strike: 14, expiry_date: "2026-06-19"} }
```

Or simpler — wait for Task 6 to wire up the `+ Tag` button and verify there.

- [ ] **Step 7: Commit**

```bash
git add src/components/journal/JournalQuickAdd.jsx
git commit -m "feat(journal): handle tag_position intent + allow empty body for position_note

New 'tag_position' intent branch prefills the composer with
entryType=position_note, the linked position, an auto-generated title,
and empty body/tags, then focuses the TagInput.

Body is no longer required when entry_type === 'position_note' — for
those, the tag is the content. Title still required.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Open Positions table integration

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/ExploreView.jsx`
- Modify: `src/components/OpenPositionsTab.jsx`

This is the integration task. It ties the helper, the chip, and the intents together into the actual user-visible feature. Bite-sized substeps.

- [ ] **Step 1: Add `onShowJournalEntry` and `onTagPosition` handlers to App.jsx**

In [src/App.jsx](src/App.jsx), inside `TradeDashboard`, add two callbacks near the other handlers (just below `handlePaletteSelect`, around line 156):

```js
  function handleShowJournalEntry(entryId) {
    setMode("review");
    setSubViewRaw("journal");
    setJournalIntent({ kind: "show_entry", entryId });
  }

  function handleTagPosition(position) {
    setMode("review");
    setSubViewRaw("journal");
    setJournalIntent({ kind: "tag_position", position });
  }
```

Then in the `<ExploreView ... />` invocation (around line 264-282), thread both:

```jsx
            {mode === "explore" && (
              <ExploreView
                subView={subView}
                onSubViewChange={setSubView}
                positionIntent={positionIntent}
                onPositionIntentConsumed={() => setPositionIntent(null)}
                detailTicker={detailTicker}
                onOpenTickerDetail={(ticker) => {
                  setDetailTicker(ticker);
                  setSubViewRaw("ticker-detail");
                  window.history.replaceState(null, "", `#/ticker/${ticker}`);
                }}
                onCloseTickerDetail={() => {
                  setDetailTicker(null);
                  setSubViewRaw("positions");
                  window.history.replaceState(null, "", " ");
                }}
                onShowJournalEntry={handleShowJournalEntry}
                onTagPosition={handleTagPosition}
              />
            )}
```

- [ ] **Step 2: Thread the new props through ExploreView**

In [src/components/ExploreView.jsx:51-58](src/components/ExploreView.jsx:51), update the prop destructuring:

```jsx
export function ExploreView({
  subView,
  onSubViewChange,
  positionIntent,
  onPositionIntentConsumed,
  detailTicker,
  onOpenTickerDetail,
  onCloseTickerDetail,
  onShowJournalEntry,
  onTagPosition,
}) {
```

Then in [src/components/ExploreView.jsx:91-95](src/components/ExploreView.jsx:91), update the `OpenPositionsTab` invocation:

```jsx
        {active === "positions" && (
          <OpenPositionsTab
            positionIntent={positionIntent}
            onPositionIntentConsumed={onPositionIntentConsumed}
            onOpenTickerDetail={onOpenTickerDetail}
            onShowJournalEntry={onShowJournalEntry}
            onTagPosition={onTagPosition}
          />
        )}
```

- [ ] **Step 3: Update OpenPositionsTab signature + add tag-fetch hook**

In [src/components/OpenPositionsTab.jsx:679](src/components/OpenPositionsTab.jsx:679), update the signature to accept the new props:

```js
export function OpenPositionsTab({ positionIntent, onPositionIntentConsumed, onOpenTickerDetail, onShowJournalEntry, onTagPosition }) {
```

Then add a hook that fetches strategic tags whenever the positions/tickers change. Locate a good spot — just below the existing `useState`/`useEffect` block in `OpenPositionsTab`, before the `return` statement of the component.

First, add the imports at the top of the file:

```js
import { supabase } from "../lib/supabase";
import { groupStrategicTagsByPosition } from "../lib/tags";
```

Then add the hook (near the other state hooks inside `OpenPositionsTab`, around line 700):

```js
  const [strategicTagsByPos, setStrategicTagsByPos] = useState(new Map());

  useEffect(() => {
    const tickers = [
      ...(open_csps        ?? []).map(p => p.ticker),
      ...(open_leaps       ?? []).map(p => p.ticker),
      ...(assigned_shares  ?? []).map(s => s.ticker),
    ];
    const uniqTickers = [...new Set(tickers)];
    if (uniqTickers.length === 0) {
      setStrategicTagsByPos(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, ticker, type, strike, expiry, tags, created_at")
        .in("ticker", uniqTickers)
        .not("tags", "is", null);
      if (cancelled) return;
      if (error) { console.warn("[OpenPositionsTab] tag fetch failed:", error.message); setStrategicTagsByPos(new Map()); return; }
      setStrategicTagsByPos(groupStrategicTagsByPosition(data ?? [], { open_csps, open_leaps, assigned_shares }));
    })();
    return () => { cancelled = true; };
  }, [open_csps, open_leaps, assigned_shares]);
```

- [ ] **Step 4: Pass the tag map and click handlers into PositionsTable**

In [src/components/OpenPositionsTab.jsx:861](src/components/OpenPositionsTab.jsx:861), find the `<PositionsTable ... />` invocations (there will be one per position-tab section: csps, ccs, leaps). Update each to receive new props:

```jsx
<PositionsTable
  rows={...}
  positionType={...}
  quoteMap={quoteMap}
  isMobile={isMobile}
  highlightedTicker={highlightedTicker}
  onOpenTickerDetail={onOpenTickerDetail}
  strategicTagsByPos={strategicTagsByPos}
  onShowJournalEntry={onShowJournalEntry}
  onTagPosition={onTagPosition}
/>
```

(Run `grep -n "<PositionsTable" src/components/OpenPositionsTab.jsx` first to find all invocations and update them all.)

Then update the `PositionsTable` function signature at [OpenPositionsTab.jsx:418](src/components/OpenPositionsTab.jsx:418):

```js
function PositionsTable({ rows, positionType, quoteMap, isMobile, highlightedTicker, onOpenTickerDetail, strategicTagsByPos, onShowJournalEntry, onTagPosition }) {
```

- [ ] **Step 5: Build the position-key helper inside PositionsTable**

Inside `PositionsTable`, add a helper to build a position's key consistent with the helper in `tags.js`. Place it near the top of the function body (below the `useState`/`useEffect` declarations):

```js
  function posKey(pos) {
    if (pos.type === "Shares") return `${pos.ticker}|Shares`;
    return `${pos.ticker}|${pos.type}|${pos.strike}|${pos.expiry_date ?? pos.expiry}`;
  }
```

- [ ] **Step 6: Render the compact chip after the ticker on the collapsed row**

In [src/components/OpenPositionsTab.jsx:610-636](src/components/OpenPositionsTab.jsx:610), the ticker `<td>` contains a `<button>` for the ticker plus cushion-state markers. Add the chip(s) after the cushion marker spans.

Add the import at the top of the file:

```js
import { PositionTagChip, PositionTagOverflow } from "./PositionTagChip";
```

Inside the row render (around line 596-636), just above the existing `td(...)` for the ticker, compute the tag list (sorted into category-priority order so the chosen "first" chip is deterministic):

```js
            const TAG_ORDER = ["earnings-play", "signal", "macro"];
            const sortedTags = [...(strategicTagsByPos.get(posKey(pos)) ?? [])].sort((a, b) => {
              const pa = a.tag.split(":")[0];
              const pb = b.tag.split(":")[0];
              const da = TAG_ORDER.indexOf(pa);
              const db = TAG_ORDER.indexOf(pb);
              if (da !== db) return da - db;
              return a.tag.localeCompare(b.tag);
            });
            const firstTag = sortedTags[0];
            const overflow = Math.max(0, sortedTags.length - 1);
```

Then within the ticker cell `<span>` (the one starting at line 611), add the chips after the cushion-state markers but inside the same flex container:

```jsx
                  {td(
                    <span style={{ display: "flex", alignItems: "center" }}>
                      <button ... >
                        {pos.ticker}
                      </button>
                      {pos.cushion_state === "assignment_risk" && (dte == null || dte <= 21) && (
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: theme.red, display: "inline-block", flexShrink: 0 }} />
                      )}
                      {pos.cushion_state === "approaching" && (dte == null || dte <= 14) && (
                        <span style={{ fontSize: theme.size.sm, color: theme.amber, lineHeight: 1 }}>⚠</span>
                      )}
                      {firstTag && (
                        <PositionTagChip
                          tag={firstTag.tag}
                          compact={true}
                          onClick={() => onShowJournalEntry?.(firstTag.entryId)}
                        />
                      )}
                      {overflow > 0 && canExpand && (
                        <PositionTagOverflow
                          count={overflow}
                          onClick={() => setExpandedRowKey(isExpanded ? null : rowKey)}
                        />
                      )}
                    </span>
                  )}
```

(The "+N" overflow chip toggles the expanded row to show all tags. For LEAPS — `canExpand=false` — the overflow chip becomes non-clickable. The full tag list isn't reachable for LEAPS in v1; user falls back to journal tab. Note in the manual test plan.)

- [ ] **Step 7: Render Strategic context block + `+ Tag` button in the expanded row**

In [src/components/OpenPositionsTab.jsx:654-665](src/components/OpenPositionsTab.jsx:654), the expanded `<tr>` currently renders `CushionPanel` and `PriceTargetPanel`. Add the Strategic context block above them. Replace the existing condition `{isExpanded && (priceTargets || (pos.cushion_state && pos.cushion_state !== "safe")) && (` with one that always renders the row when expanded:

```jsx
                {isExpanded && (
                  <tr>
                    <td colSpan={isMobile ? 5 : 10} style={{ padding: 0, borderBottom: `1px solid ${theme.border.default}` }}>
                      {(sortedTags.length > 0 || onTagPosition) && (
                        <div style={{
                          padding: theme.space[3],
                          background: theme.bg.surface,
                          borderTop: `1px solid ${theme.border.default}`,
                        }}>
                          <div style={{
                            color: theme.text.subtle, fontSize: theme.size.xs,
                            textTransform: "uppercase", letterSpacing: "0.8px",
                            marginBottom: theme.space[2], fontWeight: 700,
                          }}>
                            Strategic context
                          </div>
                          {sortedTags.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: theme.space[1], marginBottom: theme.space[2] }}>
                              {sortedTags.map(t => (
                                <PositionTagChip
                                  key={t.tag}
                                  tag={t.tag}
                                  compact={false}
                                  onClick={() => onShowJournalEntry?.(t.entryId)}
                                />
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: theme.text.subtle, fontSize: theme.size.sm, marginBottom: theme.space[2], fontStyle: "italic" }}>
                              No strategic tags yet.
                            </div>
                          )}
                          {onTagPosition && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onTagPosition(pos); }}
                              style={{
                                background: "transparent", border: "none", padding: 0,
                                color: theme.text.muted, cursor: "pointer",
                                fontSize: theme.size.sm, fontFamily: "inherit",
                                textDecoration: "underline",
                              }}
                            >
                              + Tag
                            </button>
                          )}
                        </div>
                      )}
                      {pos.cushion_state && pos.cushion_state !== "safe" && (
                        <CushionPanel cushion={pos} dte={dte} />
                      )}
                      {priceTargets && (
                        <PriceTargetPanel targets={priceTargets} position={pos} stockPrice={quoteMap.get(pos.ticker)?.mid ?? null} />
                      )}
                    </td>
                  </tr>
                )}
```

- [ ] **Step 8: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Manual end-to-end test**

Run `npm run dev`. Open the browser to Explore → Positions → CSPs (or whichever tab has positions you've previously tagged in journal entries).

**Verification checklist:**
1. Positions with no strategic tags show the ticker only (no chip).
2. Positions with at least one matching journal-entry strategic tag show a small chip after the ticker.
3. Positions with 2+ tags show the first chip + a "+N" indicator.
4. Click a chip → navigates to Review → Journal, scrolls to the source entry, expands it.
5. Click a row's chevron to expand → see the "Strategic context" block with all tags as full-text chips, each clickable.
6. Click `+ Tag` in the expanded row → composer opens with `position_note` selected, the position pre-linked, title auto-filled (e.g. "SOFI Position — ..."), TagInput focused.
7. Type a tag, hit save with no body → entry saves successfully.
8. Return to Open Positions → the new tag appears on the position row.
9. Mobile (window <600px): chip-after-ticker still visible; expand row works.
10. LEAPS rows: chip visible; chevron not present (unchanged).

If any item fails, debug and fix before committing.

- [ ] **Step 10: Commit**

```bash
git add src/App.jsx src/components/ExploreView.jsx src/components/OpenPositionsTab.jsx
git commit -m "feat(positions): show strategic journal tags inline + +Tag shortcut

Open Positions table now surfaces earnings-play / signal / macro tags
from linked journal entries.

Collapsed row: a compact chip after the ticker (suffix-only label,
category-colored border). Multiple tags collapse to first chip + N.

Expanded row: 'Strategic context' block above existing PriceTargetPanel
showing all tags as full clickable chips, plus a '+ Tag' button that
opens the JournalQuickAdd composer pre-filled to this position.

Click any tag chip → navigates to Review → Journal, scrolls the
source entry into view, and auto-expands it.

LEAPS positions get the inline chip only (rows don't expand).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Version bump

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js:29`

Per CLAUDE.md, every feature requires a coordinated bump in both files.

- [ ] **Step 1: Verify the baseline version on origin/main**

Run: `git show origin/main:package.json | grep '"version"'`
Expected: `"version": "1.110.1",`

- [ ] **Step 2: Bump package.json**

In [package.json](package.json), change `"version": "1.110.1"` to `"version": "1.111.0"`.

- [ ] **Step 3: Bump src/lib/constants.js**

In [src/lib/constants.js:29](src/lib/constants.js:29), change `export const VERSION = "1.110.1";` to `export const VERSION = "1.111.0";`.

- [ ] **Step 4: Verify the build still passes**

Run: `npm run build && npm test`
Expected: build succeeds; tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/constants.js
git commit -m "chore: bump version to 1.111.0 — strategic tag display on open positions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Summary of commits

After all tasks: 7 commits on the worktree branch. Push, open PR with the spec link in the description, merge.

```
1. feat(tags): add groupStrategicTagsByPosition helper
2. feat(positions): add PositionTagChip + PositionTagOverflow components
3. refactor: migrate journalIntent from string to {kind} object
4. feat(journal): handle show_entry intent — scroll + auto-expand
5. feat(journal): handle tag_position intent + allow empty body for position_note
6. feat(positions): show strategic journal tags inline + +Tag shortcut
7. chore: bump version to 1.111.0 — strategic tag display on open positions
```
