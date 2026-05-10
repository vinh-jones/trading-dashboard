# Open Positions — Strategic Tag Display

**Date:** 2026-05-10
**Status:** Draft (awaiting user review)

## Goal

Surface strategic journal tags on open positions in the Open Positions table so the trader can see *what they were thinking* about each position at a glance, with a one-click path back to the source journal entry.

This is a stepping-stone toward an eventual per-position working-memory dashboard (conviction, watch conditions, exit triggers). v1 surfaces only existing journal tags; future work layers richer state into the same expanded-row surface without UI replatforming.

## Non-goals

- New journal-entry fields, free-text notes on positions, conviction scoring, exit-condition tracking. Those are filed for a future v2/v3 working-memory dashboard.
- A new dedicated positions view. The existing Open Positions table stays canonical.
- A transient "highlight pulse" on the linked journal entry. Scroll-into-view + auto-expand only.

## Tag selection rules

### Position → journal-entry matching
Match journal entries to a position by `(ticker, type, strike, expiry)`. These four fields already exist as columns on `journal_entries` (per [JournalQuickAdd.jsx](src/components/journal/JournalQuickAdd.jsx) usage at lines 88–113). For Shares (assigned), match by `(ticker, type="Shares")` — strike/expiry don't apply.

### Categories to include
Based on the actual `tag_vocabulary` taxonomy in [migration-016-tag-system.sql](supabase/migration-016-tag-system.sql):

**Show:**
- `earnings-play:*` — strategic context for the trade
- `signal:*` — trade origin (Ryan / independent / framework-rule / Kobeissi)
- `macro:*` — regime context (Fed, tariffs, vix-spike, etc.)

**Skip:**
- `position-action:*` — action history; redundant with the position record itself
- `framework:*` — process descriptors, not strategic state
- `drift:*` — private reflection, inappropriate to surface on a position display

### Aggregation
Take the **union of in-scope tags across all matching journal entries**, deduplicated. The original spec contradicted itself ("most recent entry" vs "all entries"); this resolves to *all*. Rationale: if a position was opened as `earnings-play:path-c-standard` and later annotated `signal:ryan-plus-independent`, both are true and worth seeing.

### Empty case
If a position has no in-scope tags, render **nothing** — no `[—]` placeholder. Most positions will be untagged; placeholders would train the eye to ignore the column.

## Display — collapsed row

A single compact chip appears immediately after the ticker, in the existing ticker cell (no new column). This is the at-a-glance scan that the user looks at most often.

- **0 tags:** ticker only, no chip.
- **1 tag:** chip showing the *suffix* portion (e.g. `earnings-play:path-c-standard` → `path-c-standard`); category is implied by chip color. For bare tags with no `:` suffix (e.g. `earnings-play` itself), show the full tag.
- **2+ tags:** first tag's chip + a small `+N` chip immediately after.

Chip styling:
- Inline with the ticker, smaller than ticker text (`theme.size.xs`), `theme.radius.pill`, low contrast background (`theme.bg.elevated`), category-colored border so the user can learn category at a glance.
- Category color map (new constants):
  - `earnings-play` → `theme.amber`
  - `signal` → `theme.blue`
  - `macro` → `theme.green`
- Tags with no prefix (rare; shouldn't occur in current vocabulary) get `theme.border.default`.

Tag-priority ordering for "first tag shown" when 2+ exist: `earnings-play` > `signal` > `macro`. Within a category, alphabetical. Predictable, deterministic.

## Display — expanded row (desktop + mobile, non-LEAPS)

Rows are already click-to-expand for CSP and CC ([OpenPositionsTab.jsx:585](src/components/OpenPositionsTab.jsx:585)); LEAPS rows don't expand (`canExpand = !isLeap`).

The expanded row currently renders `PriceTargetPanel` and a cushion-state alert ([OpenPositionsTab.jsx:660](src/components/OpenPositionsTab.jsx:660)). v1 adds a **Strategic context** block at the top of the expanded panel:

```
┌─ Strategic context ─────────────────────────────┐
│ [earnings-play:path-c-standard]  [signal:ryan]  │
│ [macro:earnings-season]                          │
└──────────────────────────────────────────────────┘
[ ... existing PriceTargetPanel ... ]
```

- All in-scope tags rendered as full-text chips, grouped by category (earnings-play first, then signal, then macro).
- Each chip is clickable → navigates to the source journal entry (see "Click behavior").
- If a tag appears in multiple journal entries, clicking jumps to the **most recent** matching entry.
- If no in-scope tags exist for the position, the block is omitted entirely (don't render an empty header).

## Click behavior — link out to source journal entry

Click a chip → land on Review → Journal subview, with the source entry scrolled into view and `defaultExpanded`.

### Mechanism
Extend the existing `journalIntent` cross-tab signaling pattern ([App.jsx:89](src/App.jsx:89)). Today `journalIntent` is a string (`"new_entry" | "eod_update"`). After this change it becomes a discriminated shape:

```js
// Before
journalIntent: "new_entry" | "eod_update" | null

// After
journalIntent:
  | { kind: "new_entry" }
  | { kind: "eod_update" }
  | { kind: "show_entry", entryId: string }
  | null
```

Existing call sites in [App.jsx:105](src/App.jsx:105) and [App.jsx:136](src/App.jsx:136) update to set `{ kind: "new_entry" }` / `{ kind: "eod_update" }`. The consumer in [JournalQuickAdd.jsx:174](src/components/journal/JournalQuickAdd.jsx:174) updates to read `.kind`.

### New consumer in JournalTab
[JournalTab.jsx:30](src/components/journal/JournalTab.jsx:30) gains an effect: when `journalIntent.kind === "show_entry"`, find the matching entry in its rendered list, scroll it into view (`scrollIntoView({ behavior: "smooth", block: "center" })`), and pass `defaultExpanded` to the matching `JournalEntryCard`. Then call `onJournalIntentConsumed()`.

To make this work, `JournalEntryCard` is invoked at [JournalTab.jsx:287](src/components/journal/JournalTab.jsx:287) with `defaultExpanded={false}` today; the change passes `defaultExpanded={entry.id === targetEntryId}` and assigns a `ref` (or `id={\`journal-entry-${entry.id}\`}`) for scroll targeting. Scroll-into-view by DOM id is simpler than a `ref` per card.

### Subview switch
Clicking a chip must also switch the Review subview to `journal`. The chip's onClick:
1. Calls `setJournalIntent({ kind: "show_entry", entryId })` (lifts to App via prop).
2. Calls the existing subview-change mechanism to navigate to Review → Journal.

These both already pipe through `App.jsx`; the chip handler will be a small prop on `OpenPositionsTab` (e.g. `onShowJournalEntry: (entryId) => void`) wired in `App.jsx` to do both.

## Scope

**In scope (v1):**
- CSP positions
- CC positions on assigned shares
- LEAPS positions (collapsed-row chip only — LEAPS rows don't have an expand row)

**Mobile:** the chip-after-ticker works identically. Expanded row works on mobile (just fewer top-row columns). No mobile-specific divergence needed.

## Data fetching

Open Positions data flow today: positions arrive via the `/api/positions` (or equivalent) endpoint and render top-down. Tags are not currently joined.

Two options:

**Option A — client-side join.** Fetch all journal entries with non-empty `tags` for the user's open-position tickers, then group by `(ticker, type, strike, expiry)` in the client. One extra query on tab load.

**Option B — server-side join.** Extend the positions endpoint to include a `tags: string[]` array per position, computed server-side via a Postgres join.

**Recommendation: Option A.** Simpler, no API change, and the client-side grouping is trivial. Journal entries have a `tags` GIN index already ([migration-016-tag-system.sql:29](supabase/migration-016-tag-system.sql:29)) and the query is bounded by the user's open-position ticker set (typically <30 tickers). If profiling shows it's slow, we move to Option B as a follow-up.

Query shape:
```sql
SELECT id, ticker, type, strike, expiry, tags, created_at
FROM journal_entries
WHERE tags && ARRAY['earnings-play', 'signal', 'macro']  -- or use prefix match
  AND ticker = ANY($1)  -- list of open-position tickers
ORDER BY created_at DESC
```

Actually `&&` (overlap) doesn't do prefix matching. Simplest correct approach: fetch all journal entries for the open-position ticker set with `tags IS NOT NULL`, filter prefixes in JS. The `tags` GIN index helps; the ticker filter narrows it further.

Group by `(ticker, type, strike, expiry)` (Shares: just `ticker`) into a map; per-position lookup is O(1).

## Component changes

| File | Change |
|---|---|
| [src/lib/tags.js](src/lib/tags.js) | Add `STRATEGIC_TAG_PREFIXES = ["earnings-play", "signal", "macro"]` and `getStrategicTagsForPositions(tickers) → Promise<Map<positionKey, {tag, entryId, createdAt}[]>>` helper. |
| [src/components/OpenPositionsTab.jsx](src/components/OpenPositionsTab.jsx) | Hook to fetch strategic tags. Pass tag map down to `PositionsTable`. Render chips inline after ticker; render Strategic context block in expanded row. New `onShowJournalEntry` prop wired to App. |
| [src/components/journal/journalConstants.js](src/components/journal/journalConstants.js) | Add `TAG_CATEGORY_COLORS` map. |
| [src/App.jsx](src/App.jsx) | Update `journalIntent` shape (string → object). Add wiring for `onShowJournalEntry` → set intent + switch to Review/Journal. |
| [src/components/journal/JournalQuickAdd.jsx](src/components/journal/JournalQuickAdd.jsx) | Update intent reads (`=== "new_entry"` → `?.kind === "new_entry"`). |
| [src/components/journal/JournalTab.jsx](src/components/journal/JournalTab.jsx) | New effect for `kind: "show_entry"` — scroll-to-id + defaultExpanded for matching entry. Add `id={\`journal-entry-${entry.id}\`}` to each card wrapper. |
| New: `src/components/PositionTagChip.jsx` | Small presentational chip — props: `tag`, `entryId`, `onClick`, `compact?`. |

## Testing

- Unit test: `getStrategicTagsForPositions` correctly excludes `position-action` / `framework` / `drift` and unions across multiple matching entries.
- Unit test: position-key matching for Shares (no strike/expiry) vs CSP/CC (full key).
- Unit test: `journalIntent` shape — existing `"new_entry"` / `"eod_update"` flows still work after string → object migration.
- Manual: click a tag chip, confirm Review → Journal opens with the right entry expanded and scrolled into view.
- Manual: position with 0/1/2/3+ tags renders correctly on collapsed row (mobile + desktop).
- Manual: LEAPS chip renders inline; LEAPS row doesn't expand (unchanged).

## Open questions

None — all addressed in brainstorming.

## Out of scope (filed for later)

- Per-position free-text scratchpad / working-memory dashboard
- Conviction scoring (1–10 or low/med/high)
- Exit conditions / watch list per position
- Transient highlight pulse on the linked journal entry after scroll
- Including position-tag context in EOD/intraday snapshot output
