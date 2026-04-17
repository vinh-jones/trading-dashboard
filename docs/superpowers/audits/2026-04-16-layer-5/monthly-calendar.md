# Audit — Monthly Calendar

**Scope files:** `src/components/CalendarTab.jsx`, `src/components/CalendarDetailPanel.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

**CalendarTab.jsx:**
- [ ] The `getCellBg()` function at `src/components/CalendarTab.jsx:172` uses hardcoded RGB base values derived from `bg.base` (`#0d1117` = `rgb(13,17,23)`) to build heatmap interpolations. This is an intentional computed gradient based on theme colors, but the base values are not token references — if `bg.base` ever changes, this will drift. Consider documenting this as a known coupling or extract the base RGB from the theme.
- [ ] The `getWeekBg()` function at `src/components/CalendarTab.jsx:187` has the same issue as above — hardcoded RGB base values for heatmap interpolation.

_(These two are flagged as DONE_WITH_CONCERNS items — the hardcoded values are tightly tied to the heatmap math and may be acceptable as-is, but they are not using theme tokens)_

## Q2 — Off-grid spacing

**CalendarTab.jsx:**
- [ ] Replace off-grid padding `"2px 6px"` on prev/next month buttons at `src/components/CalendarTab.jsx:231,244` — 2px and 6px are off-grid; replace with `"${theme.space[1]}px ${theme.space[1]}px"` or adjust to on-grid values
- [ ] Replace off-grid padding `"4px 10px"` on mobile Filter button at `src/components/CalendarTab.jsx:257` — 10px off-grid; use `"${theme.space[1]}px ${theme.space[2]}px"` (4px 8px)
- [ ] Replace off-grid spacing `6` (marginBottom in stinger line in CalendarDetailPanel) — see CalendarDetailPanel below; here in CalendarTab the filter pill row marginBottom `theme.space[3]` is correct
- [ ] Replace off-grid padding `"4px 10px"` on ALL/type filter pill buttons (mobile, lines 276, 286) — same as filter button above, 10px off-grid
- [ ] Replace off-grid padding `"6px 14px"` on desktop ALL filter pill at `src/components/CalendarTab.jsx:471` — 14px is off-grid; replace with `"${theme.space[1]}px ${theme.space[3]}px"` (4px 12px) or `"${theme.space[1]}px ${theme.space[4]}px"` (4px 16px)
- [ ] Replace off-grid padding `"6px 14px"` on desktop type filter pills at `src/components/CalendarTab.jsx:481` — same issue
- [ ] Replace off-grid padding `"6px 16px"` on month tab buttons at `src/components/CalendarTab.jsx:552` — 6px off-grid; replace with `"${theme.space[1]}px ${theme.space[4]}px"` (4px 16px)
- [ ] Replace off-grid spacing `2` (marginTop on expiry count text in cell) at `src/components/CalendarTab.jsx:626` with `theme.space[1]`
- [ ] Replace off-grid padding `"2px 4px"` on expiry badge within cell at `src/components/CalendarTab.jsx:639` — 2px and 4px are sub-grid; consider `"${theme.space[1]}px ${theme.space[1]}px"` (4px)
- [ ] Replace off-grid spacing `2` (marginTop on trade count text) at `src/components/CalendarTab.jsx:629` with `theme.space[1]`

**CalendarDetailPanel.jsx:**
- [ ] Replace off-grid padding `"2px 6px"` on type badge in mobile closed trade card at `src/components/CalendarDetailPanel.jsx:54` — 6px off-grid; replace with `"2px ${theme.space[1]}px"` (2px 4px) or `"2px ${theme.space[2]}px"` (2px 8px)
- [ ] Replace off-grid padding `"2px 7px"` on type badge in desktop table at `src/components/CalendarDetailPanel.jsx:111` — 7px off-grid; same as above
- [ ] Replace off-grid padding `"7px 8px"` on desktop table cells at `src/components/CalendarDetailPanel.jsx:109–130` — 7px off-grid; replace with `"${theme.space[2]}px ${theme.space[2]}px"` (8px)
- [ ] Replace off-grid padding `"2px 4px"` on delete button at `src/components/CalendarDetailPanel.jsx:132` — sub-grid; replace with `"${theme.space[1]}px ${theme.space[1]}px"` or just `theme.space[1]`
- [ ] Replace off-grid spacing `6` (padding in detail panel separator row) at `src/components/CalendarDetailPanel.jsx:69,142` with `theme.space[1]`

## Q3 — Font-size outliers

_(none — all uses reference theme.size tokens)_

## Q4 — Surface inconsistency

- [ ] `CalendarDetailPanel` at `src/components/CalendarDetailPanel.jsx:20` uses `padding: \`${theme.space[4]}px ${theme.space[5]}px\`` (16px top/bottom, 20px left/right) — asymmetric padding; canonical panel uses uniform `theme.space[5]`. Not a violation per se but inconsistent.
- [ ] Desktop calendar grid at `src/components/CalendarTab.jsx:575` wraps cells with `border: \`1px solid ${theme.border.default}\`` and `overflow: "hidden"` but individual cells use `border: isSelected ? \`1px solid ${theme.blue}\` : "1px solid transparent"` overriding the container border — this causes double-border artifacts on selected cells. Flag for visual review.
- [ ] Mobile pipeline panel at `src/components/CalendarTab.jsx:303` uses `padding: \`${theme.space[3]}px ${theme.space[4]}px\`` (12px 16px) — slightly leaner than canonical `theme.space[5]` (20px); consistent with the filter bar pattern, acceptable as a compact info card.
- [ ] Desktop pipeline panel at `src/components/CalendarTab.jsx:497` uses `padding: \`${theme.space[3]}px ${theme.space[4]}px\`` — same as mobile; for a full-width top panel, consider upgrading to `theme.space[5]` to match other panels.

## Q5 — State gaps

- [ ] Missing hover state on desktop type filter pills at `src/components/CalendarTab.jsx:479` — `cursor: pointer` but no `onMouseEnter`/`onMouseLeave` handler; transition not defined
- [ ] Missing hover state on desktop month tab buttons at `src/components/CalendarTab.jsx:549` — `transition: "all 0.15s"` is set but no hover handler to change background
- [ ] Missing hover state on mobile week header rows at `src/components/CalendarTab.jsx:348` — `cursor: pointer` but no hover feedback
- [ ] Missing hover state on mobile day rows at `src/components/CalendarTab.jsx:397` — `cursor: isClickable ? "pointer" : "default"` but no hover handler when `isClickable`
- [ ] Missing hover state on mobile filter pills at `src/components/CalendarTab.jsx:276,286` — `cursor: pointer` but no hover effect
- [ ] Missing hover state on mobile all/type filter buttons — same as above
- [ ] Calendar day cells have `onMouseEnter` / `onMouseLeave` at `src/components/CalendarTab.jsx:615` using `outline` — this is a state handler, but it uses `outline` rather than `background`; outline can be clipped by `overflow: hidden` on the grid container. Consider switching to `background` change for reliability.
- [ ] Missing focus state on capture-rate `<select>` at `src/components/CalendarTab.jsx:503` — no focus indicator beyond browser default
- [ ] Delete button in `CalendarDetailPanel` at `src/components/CalendarDetailPanel.jsx:127` has `onMouseEnter`/`onMouseLeave` — this one is compliant.

## Total items: 23
