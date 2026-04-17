# Audit — Mode Nav

**Scope files:** `src/components/ModeNav.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

_(none)_

## Q2 — Off-grid spacing

- [ ] Replace off-grid spacing `6` (gap inside badge span) at `src/components/ModeNav.jsx:24` with `theme.space[1]` (4px) — raw literal `6` is not a grid value
- [ ] Replace off-grid padding `"10px 24px"` on desktop button at `src/components/ModeNav.jsx:10` — 10px is off-grid; replace with `"${theme.space[2]}px ${theme.space[6]}px"` (`8px 24px`) or `"${theme.space[3]}px ${theme.space[6]}px"` (`12px 24px`). Mobile variant `"10px 14px"` also uses 10px off-grid.
- [ ] Replace off-grid padding `"10px 14px"` on mobile button at `src/components/ModeNav.jsx:10` — 10px is off-grid; replace with `"${theme.space[2]}px ${theme.space[3]}px"` (`8px 12px`)
- [ ] Replace off-grid spacing `"0 6px"` padding on alert badge at `src/components/ModeNav.jsx:29` — 6px is off-grid; replace with `"0 ${theme.space[1]}px"` (`0 4px`) or `"0 ${theme.space[2]}px"` (`0 8px`)

## Q3 — Font-size outliers

_(none — all uses reference theme.size tokens)_

## Q4 — Surface inconsistency

_(none — ModeNav is a tab bar, not a panel; no surface check applies)_

## Q5 — State gaps

- [ ] Missing explicit hover state on nav tab buttons at `src/components/ModeNav.jsx:51` — has `transition: "all 0.15s"` but no `onMouseEnter`/`onMouseLeave` handler to change background or color on hover; transition fires but nothing changes visually. Consider adding a subtle hover background (e.g. `rgba(255,255,255,0.04)`) via mouse handlers.

## Total items: 5
