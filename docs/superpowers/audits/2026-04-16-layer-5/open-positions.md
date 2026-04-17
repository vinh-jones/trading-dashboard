# Audit — Open Positions

**Scope files:** `src/components/OpenPositionsTab.jsx`, `src/components/SixtyCheck.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

_(none — `rgba(...)` tints on hover/selected row backgrounds are permitted; `rgba(63,185,80,0.10)` used for roll-opportunity badge bg is also an rgba tint and permitted)_

## Q2 — Off-grid spacing

**OpenPositionsTab.jsx:**
- [ ] Replace off-grid spacing `3` (marginBottom in RollRow at `src/components/OpenPositionsTab.jsx:88`) with `theme.space[1]` — raw `3` is not on the 4-point grid
- [ ] Replace off-grid spacing `3` (marginBottom in RollRow mid case at `src/components/OpenPositionsTab.jsx:98`) with `theme.space[1]`
- [ ] Replace off-grid spacing `3` (marginBottom in RollRow with data at `src/components/OpenPositionsTab.jsx:113`) with `theme.space[1]`
- [ ] Replace off-grid padding `"8px 10px"` on table column headers at `src/components/OpenPositionsTab.jsx:348` — 10px is off-grid; replace with `"${theme.space[2]}px ${theme.space[2]}px"` (8px) or `"${theme.space[2]}px ${theme.space[3]}px"` (8px 12px)
- [ ] Replace off-grid padding `"9px 10px"` on table data cells (`td`) at `src/components/OpenPositionsTab.jsx:457` — 9px and 10px are off-grid; replace with `"${theme.space[2]}px ${theme.space[2]}px"` (8px)
- [ ] Replace off-grid spacing `10` (gap in allocation chart row) at `src/components/OpenPositionsTab.jsx:661` with `theme.space[2]` (8px)
- [ ] Replace off-grid spacing `5` (marginBottom in allocation chart row) at `src/components/OpenPositionsTab.jsx:661` with `theme.space[1]` (4px)
- [ ] Replace off-grid spacing `14` (marginBottom in `sectionHeader`) at `src/components/OpenPositionsTab.jsx:624` with `theme.space[3]` (12px) or `theme.space[4]` (16px)
- [ ] Replace off-grid spacing `14` (marginBottom on `sectionHeader` inside Open Positions header) at `src/components/OpenPositionsTab.jsx:692` with `theme.space[3]`
- [ ] Replace off-grid spacing `14` (marginBottom on `sectionHeader` in Assigned Shares header) at `src/components/OpenPositionsTab.jsx:715` with `theme.space[3]`
- [ ] Replace off-grid spacing `6` (gap in tab button row) at `src/components/OpenPositionsTab.jsx:694` with `theme.space[1]` or `theme.space[2]`
- [ ] Replace off-grid spacing `6` (gap between proximity controls) at `src/components/OpenPositionsTab.jsx:720` with `theme.space[1]`
- [ ] Replace off-grid spacing `12` (gap in assigned-shares grid) at `src/components/OpenPositionsTab.jsx:771` with `theme.space[3]`
- [ ] Replace off-grid padding `"16px"` on assigned-share card at `src/components/OpenPositionsTab.jsx:781` with `theme.space[4]` (16px) — use the token instead of raw string
- [ ] Replace off-grid spacing `10` (marginBottom in share card header) at `src/components/OpenPositionsTab.jsx:782` with `theme.space[2]`
- [ ] Replace off-grid spacing `10` (marginBottom in positions list) at `src/components/OpenPositionsTab.jsx:789` with `theme.space[2]`
- [ ] Replace off-grid spacing `16` (gap in active CC detail row) at `src/components/OpenPositionsTab.jsx:805` with `theme.space[4]`
- [ ] Replace off-grid padding `"10px 12px"` on active-CC inner box at `src/components/OpenPositionsTab.jsx:798` — 10px off-grid; use `"${theme.space[2]}px ${theme.space[3]}px"` (8px 12px)
- [ ] Replace off-grid padding `"8px 12px"` on "NO ACTIVE CC" alert at `src/components/OpenPositionsTab.jsx:821` — use `"${theme.space[2]}px ${theme.space[3]}px"` (already on-grid, just use tokens)
- [ ] Replace off-grid spacing `16` (marginBottom in allocation chart legend) at `src/components/OpenPositionsTab.jsx:678` with `theme.space[4]`
- [ ] Replace off-grid spacing `14` (marginTop on allocation legend row) at `src/components/OpenPositionsTab.jsx:678` with `theme.space[3]`
- [ ] Replace off-grid padding `"1px 6px"` on roll-opportunity badge at `src/components/OpenPositionsTab.jsx:140` — 1px is sub-grid; acceptable as a badge micro-padding but flag for consistency: replace with `"2px ${theme.space[1]}px"` (2px 4px) or leave as is
- [ ] Replace `panel()` helper string `"20px"` padding at `src/components/OpenPositionsTab.jsx:618` with `theme.space[5]` token reference
- [ ] Replace `panel()` helper `marginBottom: 16` at `src/components/OpenPositionsTab.jsx:618` with `theme.space[4]`

**SixtyCheck.jsx:**
- [ ] Replace off-grid spacing `12` (gap in 60/60 grid) at `src/components/SixtyCheck.jsx:44` with `theme.space[3]`
- [ ] Replace off-grid spacing `16` (marginBottom on grid) at `src/components/SixtyCheck.jsx:44` with `theme.space[4]`
- [ ] Replace off-grid spacing `6` (marginBottom on label) at `src/components/SixtyCheck.jsx:37` with `theme.space[1]`
- [ ] Replace off-grid spacing `24` (gap in result metrics row) at `src/components/SixtyCheck.jsx:66` with `theme.space[6]`
- [ ] Replace off-grid spacing `20` (marginLeft auto + gap) at `src/components/SixtyCheck.jsx:66` with `theme.space[5]`
- [ ] Replace off-grid spacing `16` (marginBottom on 60/60 section header) at `src/components/SixtyCheck.jsx:41` with `theme.space[4]`

## Q3 — Font-size outliers

- [ ] Replace raw fontSize `22` at `src/components/SixtyCheck.jsx:65` with `theme.size.xl` (18px) or accept as a hero number intentionally larger than the token scale — flag for decision

## Q4 — Surface inconsistency

- [ ] Assigned-share cards at `src/components/OpenPositionsTab.jsx:781` use `background: theme.bg.base` and `borderRadius: theme.radius.sm` (4px) — the canonical card uses `bg.surface` and `radius.md` (8px). Decide if these are intentionally nested (base is appropriate for nested cards within a surface panel) — if so document; otherwise align to `bg.surface` + `radius.md`.
- [ ] `PriceTargetPanel` at `src/components/OpenPositionsTab.jsx:201` uses `background: theme.bg.elevated` without a border — the expanded sub-panel inside a table row; no border is intentional but worth noting for visual consistency review.
- [ ] `panel()` helper at `src/components/OpenPositionsTab.jsx:618` uses raw padding string `"20px"` instead of `theme.space[5]` token.

## Q5 — State gaps

- [ ] Missing hover state on tab buttons (CSPs / CCs / LEAPs) at `src/components/OpenPositionsTab.jsx:696` — have `cursor: pointer` and `onClick` but no `onMouseEnter`/`onMouseLeave` handler
- [ ] Missing hover state on "Check Rolls" button at `src/components/OpenPositionsTab.jsx:745` — `cursor: pointer` but no hover handler
- [ ] Missing focus ring on threshold `<input>` at `src/components/OpenPositionsTab.jsx:724` — `outline: none` is not set but no `onFocus` handler either; browser default may apply but should be explicit
- [ ] Missing focus rings on all four SixtyCheck `<input>` fields at `src/components/SixtyCheck.jsx:47–59` — `outline: "none"` is set with no replacement focus indicator

## Total items: 34
