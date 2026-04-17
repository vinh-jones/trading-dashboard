# Audit — Radar

**Scope files:** `src/components/RadarTab.jsx`, `src/components/radar/RadarPresetBar.jsx`, `src/components/radar/RadarAdvancedFilters.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

_(BB_COLORS / SCORE_BG_COLORS in RadarTab.jsx are allowlisted — not flagged)_

_(none outside the allowlist)_

## Q2 — Off-grid spacing

**RadarTab.jsx:**
- [ ] Replace off-grid spacing `2` (gap between ScoreBar segments) at `src/components/RadarTab.jsx:187` with `theme.space[1]` (4px) — raw literal `2` is off-grid
- [ ] Replace off-grid spacing `4` (marginLeft on expand caret span) at `src/components/RadarTab.jsx:333` with `theme.space[1]`
- [ ] Replace off-grid spacing `4` (horizontal padding on filter/sort bar) at `src/components/RadarTab.jsx:837` — `padding: \`${theme.space[3]}px ${theme.space[4]}px\`` is correct token usage; no change needed there, but confirm `marginBottom: theme.space[3]` is consistent
- [ ] Replace off-grid spacing `4` (marginRight on "BB Position:" label) at `src/components/RadarTab.jsx:843` with `theme.space[1]`

**RadarPresetBar.jsx:**
- [ ] Replace off-grid padding `"3px 10px"` on PresetBtn at `src/components/radar/RadarPresetBar.jsx:219` — 3px is off-grid; replace with `"2px ${theme.space[2]}px"` (2px 8px) or `"${theme.space[1]}px ${theme.space[2]}px"` (4px 8px)
- [ ] Replace off-grid padding `"3px 10px"` on ghostBtnStyle at `src/components/radar/RadarPresetBar.jsx:401` — same issue as above
- [ ] Replace off-grid padding `"5px 14px"` on cancelBtnStyle at `src/components/radar/RadarPresetBar.jsx:411` — 5px is off-grid; replace with `"${theme.space[1]}px ${theme.space[3]}px"` (4px 12px)
- [ ] Replace off-grid padding `"5px 14px"` on primaryBtnStyle at `src/components/radar/RadarPresetBar.jsx:420` — same issue
- [ ] Replace off-grid padding `"6px 10px"` on modalInputStyle at `src/components/radar/RadarPresetBar.jsx:433` — 6px off-grid; replace with `"${theme.space[1]}px ${theme.space[2]}px"` (4px 8px)
- [ ] Replace off-grid fontSize `10` on edit icon button at `src/components/radar/RadarPresetBar.jsx:252` — not a theme.size token; replace with `theme.size.xs` (10px is the value but should use the token)
- [ ] Replace off-grid spacing `4` (gap between preset name and edit icon) at `src/components/radar/RadarPresetBar.jsx:213` with `theme.space[1]`

**RadarAdvancedFilters.jsx:**
- [ ] Replace off-grid padding `"3px 6px"` on inputStyle at `src/components/radar/RadarAdvancedFilters.jsx:129` — 3px off-grid; replace with `"${theme.space[1]}px ${theme.space[1]}px"` (4px)
- [ ] Replace off-grid padding `"3px 10px"` on SectorBtn at `src/components/radar/RadarAdvancedFilters.jsx:54` — 3px off-grid; replace with `"2px ${theme.space[2]}px"` or `"${theme.space[1]}px ${theme.space[2]}px"`
- [ ] Replace off-grid spacing `4` (marginBottom in RangeInput label) at `src/components/radar/RadarAdvancedFilters.jsx:103` with `theme.space[1]`
- [ ] Replace off-grid spacing `6` (marginBottom in "Min days to earnings" label) at `src/components/radar/RadarAdvancedFilters.jsx:263` with `theme.space[1]`
- [ ] Replace off-grid spacing `6` (marginBottom in Ownership label) at `src/components/radar/RadarAdvancedFilters.jsx:244` with `theme.space[1]`
- [ ] Replace off-grid spacing `4` (marginBottom in SectorTooltip group name) at `src/components/radar/RadarAdvancedFilters.jsx:23` with `theme.space[1]`
- [ ] Replace off-grid spacing `4` (marginBottom in SectorTooltip sectors row) at `src/components/radar/RadarAdvancedFilters.jsx:26` with `theme.space[1]`
- [ ] Replace off-grid padding `"4px 12px"` on ghostBtnStyle in RadarAdvancedFilters at `src/components/radar/RadarAdvancedFilters.jsx:294` — 4px is on-grid (= `theme.space[1]`) but 12px should use `theme.space[3]`; replace with token references
- [ ] Replace off-grid spacing `5` (gap inside `labelStyle` in `label` for ownership radio) at `src/components/radar/RadarAdvancedFilters.jsx:247` with `theme.space[1]`

## Q3 — Font-size outliers

- [ ] Replace raw fontSize `10` on edit icon button at `src/components/radar/RadarPresetBar.jsx:252` with `theme.size.xs` (same numeric value but should use token for consistency)

## Q4 — Surface inconsistency

- [ ] Filter/sort bar panel at `src/components/RadarTab.jsx:833` uses `marginBottom: theme.space[3]` (12px) instead of the canonical `theme.space[4]` (16px) — minor inconsistency with other panels
- [ ] Advanced filters panel (`RadarAdvancedFilters`) at `src/components/radar/RadarAdvancedFilters.jsx:160` when not `bare` uses `padding: \`${theme.space[3]}px ${theme.space[4]}px\`` (12px 16px top/side) and `marginBottom: theme.space[3]` — consistent with the filter bar above; acceptable as a filter sub-panel
- [ ] Modal inner container at `src/components/radar/RadarPresetBar.jsx:29` uses `padding: \`${theme.space[4]}px\`` (16px all sides) and `background: theme.bg.elevated` + `border: theme.border.strong` — correct for a modal floating above the surface hierarchy
- [ ] ExpandedPanel at `src/components/RadarTab.jsx:401` uses `background: theme.bg.elevated` with no top border (only `borderTop: "none"`) — correct for a sub-panel attached below a row, but `marginBottom: 0` means no bottom gap; verify this is intentional

## Q5 — State gaps

- [ ] Missing hover state on `FilterBtn` at `src/components/RadarTab.jsx:598` — has `transition: "all 0.1s"` and `cursor: pointer` but no `onMouseEnter`/`onMouseLeave` handler; transition fires but background never changes on hover
- [ ] Missing hover state on `SortBtn` (which renders `FilterBtn`) — same as above, inherits via `FilterBtn`
- [ ] Missing focus ring on RangeInput `<input>` fields at `src/components/radar/RadarAdvancedFilters.jsx:109,116` — `outline: "none"` is set with no replacement indicator
- [ ] Missing focus ring on earnings days `<input>` at `src/components/radar/RadarAdvancedFilters.jsx:265` — no focus handler
- [ ] Missing focus ring on preset name `<input>` in SavePresetModal at `src/components/radar/RadarPresetBar.jsx:89` and EditPresetModal at `src/components/radar/RadarPresetBar.jsx:176` — `outline: "none"` set in `modalInputStyle` with no replacement
- [ ] Missing hover state on preset select `<select>` dropdown at `src/components/radar/RadarPresetBar.jsx:324` — no hover effect defined

## Total items: 27
