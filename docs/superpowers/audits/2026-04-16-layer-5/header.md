# Audit — Header

**Scope files:** `src/components/PersistentHeader.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

_(none)_

## Q2 — Off-grid spacing

- [ ] Replace off-grid spacing `2` (marginBottom on SlotLabel) at `src/components/PersistentHeader.jsx:32` with `theme.space[1]` (4px is close enough; the value 2 has no token equivalent — consider removing or using 1px as a visual separator instead)
- [ ] Replace off-grid spacing `1` (marginTop on VIX status line) at `src/components/PersistentHeader.jsx:95` with `theme.space[1]` (raw `1` is not a grid value)
- [ ] Replace off-grid spacing `1` (marginTop on VIX status badge row) at `src/components/PersistentHeader.jsx:100` with `theme.space[1]`
- [ ] Replace off-grid spacing `2` (marginTop on VIX dot + source) at `src/components/PersistentHeader.jsx:117` with `theme.space[1]`
- [ ] Replace off-grid spacing `4` (marginTop on MTD progress bar) at `src/components/PersistentHeader.jsx:168` with `theme.space[1]`
- [ ] Replace off-grid spacing `2` (marginTop on pipeline text) at `src/components/PersistentHeader.jsx:172` with `theme.space[1]`
- [ ] Replace off-grid padding string `"6px 10px"` on search icon button at `src/components/PersistentHeader.jsx:190` — off-grid 6px; replace with `"${theme.space[1]}px ${theme.space[2]}px"` (`4px 8px`) or use a tab-button style

## Q3 — Font-size outliers

_(none — all uses reference theme.size tokens)_

## Q4 — Surface inconsistency

- [ ] Panel at `src/components/PersistentHeader.jsx:73` uses `marginBottom: theme.space[5]` (20px) — canonical panel uses `theme.space[4]` (16px) for marginBottom. Not a blocking issue but inconsistent with every other panel in the app. Consider aligning to `theme.space[4]`.

## Q5 — State gaps

- [ ] Missing hover state on search icon button (palette trigger) at `src/components/PersistentHeader.jsx:184` — has `cursor: pointer` and `onClick` but no `onMouseEnter`/`onMouseLeave` or transition for background

## Total items: 8
