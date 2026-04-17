# Audit — YTD Summary

**Scope files:** `src/components/SummaryTab.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

_(none — `theme.gradient.loss` and `theme.gradient.gain` are used for bar fills; these are listed as permitted in the task brief as they are linear-gradient strings defined in theme)_

## Q2 — Off-grid spacing

- [x] Replace off-grid spacing `20` (marginBottom on summary lede paragraph) at `src/components/SummaryTab.jsx:80` with `theme.space[5]`
- [x] Replace off-grid spacing `8` (gap in type filter pill row) at `src/components/SummaryTab.jsx:85` with `theme.space[2]`
- [x] Replace off-grid spacing `16` (marginBottom on type filter pill row) at `src/components/SummaryTab.jsx:85` with `theme.space[4]`
- [x] Replace off-grid padding `"6px 14px"` on ALL filter pill at `src/components/SummaryTab.jsx:89` — 14px off-grid; replace with `"${theme.space[1]}px ${theme.space[3]}px"` (4px 12px) or `"${theme.space[1]}px ${theme.space[4]}px"` (4px 16px)
- [x] Replace off-grid padding `"6px 14px"` on type filter pills at `src/components/SummaryTab.jsx:98` — same issue
- [x] Replace off-grid spacing `8` (gap in ticker grid) at `src/components/SummaryTab.jsx:115` with `theme.space[2]`
- [x] Replace off-grid spacing `20` (marginBottom on ticker grid) at `src/components/SummaryTab.jsx:115` with `theme.space[5]`
- [x] Replace off-grid padding `"14px 12px 12px"` on ticker card at `src/components/SummaryTab.jsx:127` — 14px and 12px are off-grid for top; replace with `"${theme.space[3]}px ${theme.space[3]}px ${theme.space[3]}px"` or `"${theme.space[4]}px ${theme.space[3]}px ${theme.space[3]}px"`
- [x] Replace off-grid spacing `8` (gap inside ticker card) at `src/components/SummaryTab.jsx:128` with `theme.space[2]`
- [x] Replace off-grid spacing `2` (marginBottom on ticker name in card) at `src/components/SummaryTab.jsx:131` with `theme.space[1]`
- [x] Replace off-grid spacing `4` (gap between month bars) at `src/components/SummaryTab.jsx:147` with `theme.space[1]`
- [x] Replace off-grid spacing `3` (gap inside each month bar column) at `src/components/SummaryTab.jsx:152` with `theme.space[1]`
- [x] Replace off-grid spacing `1` (marginTop on month label) at `src/components/SummaryTab.jsx:163` — raw `1` is not a grid value; this is sub-1px territory; remove or use 0
- [x] Replace off-grid spacing `20` (marginBottom on hold duration histogram) at `src/components/SummaryTab.jsx:194` with `theme.space[5]`
- [x] Replace off-grid padding `"16px 20px"` on hold duration panel at `src/components/SummaryTab.jsx:194` — 16px and 20px are on-grid but should use token references: `"${theme.space[4]}px ${theme.space[5]}px"`
- [x] Replace off-grid spacing `14` (marginBottom on histogram label) at `src/components/SummaryTab.jsx:195` with `theme.space[3]`
- [x] Replace off-grid spacing `8` (gap in histogram bar row) at `src/components/SummaryTab.jsx:198` with `theme.space[2]`
- [x] Replace off-grid spacing `5` (gap inside each histogram bucket column) at `src/components/SummaryTab.jsx:200` with `theme.space[1]`
- [x] Replace off-grid spacing `6` (marginTop on histogram P&L row) at `src/components/SummaryTab.jsx:220` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (gap in histogram P&L row) at `src/components/SummaryTab.jsx:221` with `theme.space[2]`
- [x] Replace off-grid spacing `8` (gap in active filter indicator row) at `src/components/SummaryTab.jsx:233` with `theme.space[2]`
- [x] Replace off-grid spacing `12` (marginBottom on active filter row) at `src/components/SummaryTab.jsx:233` with `theme.space[3]`
- [x] Replace off-grid padding `"4px 10px"` on Clear button at `src/components/SummaryTab.jsx:238` — 10px off-grid; replace with `"${theme.space[1]}px ${theme.space[2]}px"` (4px 8px)
- [x] Replace off-grid spacing `8` (gap in mobile trade card list) at `src/components/SummaryTab.jsx:247` with `theme.space[2]`
- [x] Replace off-grid padding `"10px 12px"` on mobile trade card at `src/components/SummaryTab.jsx:252` — 10px off-grid; replace with `"${theme.space[2]}px ${theme.space[3]}px"` (8px 12px)
- [x] Replace off-grid spacing `6` (marginBottom on mobile card header) at `src/components/SummaryTab.jsx:253` with `theme.space[1]`
- [x] Replace off-grid spacing `8` (gap in mobile card header) at `src/components/SummaryTab.jsx:254` with `theme.space[2]`
- [x] Replace off-grid padding `"2px 6px"` on type badge in mobile card at `src/components/SummaryTab.jsx:256` — 6px off-grid; replace with `"2px ${theme.space[1]}px"` (2px 4px)
- [x] Replace off-grid spacing `12` (gap in mobile trade detail row) at `src/components/SummaryTab.jsx:261` with `theme.space[3]`
- [x] Replace off-grid padding `"10px 8px"` on desktop table header cells at `src/components/SummaryTab.jsx:277` — 10px off-grid; replace with `"${theme.space[2]}px ${theme.space[2]}px"` (8px)
- [x] Replace off-grid padding `"8px"` on desktop table data cells (lines 294–310) — 8px is `theme.space[2]`; use the token
- [x] Replace off-grid padding `"3px 8px"` on type badge in desktop table at `src/components/SummaryTab.jsx:296` — 3px off-grid; replace with `"${theme.space[1]}px ${theme.space[2]}px"` (4px 8px)

## Q3 — Font-size outliers

_(none — all uses reference theme.size tokens)_

## Q4 — Surface inconsistency

- [x] Hold duration histogram panel at `src/components/SummaryTab.jsx:194` uses `borderRadius: theme.radius.sm` (4px) instead of `theme.radius.md` (8px) — the canonical panel uses `radius.md`. Change to `theme.radius.md` for consistency.
- [x] Ticker cards at `src/components/SummaryTab.jsx:122` use `borderRadius: theme.radius.sm` (4px) instead of `theme.radius.md` — these are interactive card buttons; consider upgrading to `radius.md`
- [x] Mobile trade cards at `src/components/SummaryTab.jsx:252` use `borderRadius: theme.radius.sm` (4px) — same issue as above
- [x] The summary lede `<p>` at `src/components/SummaryTab.jsx:80` has `marginBottom: 20` as a raw value inside a `<p>` tag — use `theme.space[5]` and convert to a `<div>` to avoid browser default `<p>` margins interfering

## Q5 — State gaps

- [x] Missing hover state on type filter pills at `src/components/SummaryTab.jsx:88,97` — `cursor: pointer` and `onClick` but no `onMouseEnter`/`onMouseLeave` and no transition defined
- [x] Ticker card buttons at `src/components/SummaryTab.jsx:121` have `transition: "all 0.15s"` — this fires on the `border` and `background` changes when selected/deselected, which is compliant. However there is no `onMouseEnter`/`onMouseLeave` for a hover state between unselected and selected. Flag as missing unselected-hover feedback.
- [x] Hold duration histogram bars (div with `onClick`) at `src/components/SummaryTab.jsx:204` have `transition: opacity 0.15s` for the selection dim effect — compliant for selection. However no hover state on individual bars (e.g. slight opacity bump or color highlight on hover). Flag as missing.
- [x] Desktop table rows at `src/components/SummaryTab.jsx:289` have `onMouseEnter`/`onMouseLeave` for background highlight — compliant. No action needed.
- [x] Missing hover state on Clear filter button at `src/components/SummaryTab.jsx:237` — `cursor: pointer` but no hover handler

## Total items: 38
