# Audit — Macro

**Scope files:** `src/components/MacroTab.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

**User decision 2026-04-17:** convert `POSTURE_COLORS` and `ARROW_COLORS` to theme tokens (not allowlisted).

- [x] Convert `POSTURE_COLORS` at `src/components/MacroTab.jsx:8–13` to theme tokens: text → `theme.green`/`theme.red`/`theme.amber`. For bg values that don't have a direct 1:1 token, use the new `theme.alert.successBg`/`theme.alert.dangerBg` or tinted `rgba()` overlays of the matching semantic color — pick closest match per entry.
- [x] Convert `ARROW_COLORS` at `src/components/MacroTab.jsx:23–26` to `theme.green` (up), `theme.red` (down), `theme.text.muted` (flat).

**Outside the declared-intentional maps:**
- [x] Replace hardcoded hex `"1px solid #30363d"` in `SignalGroup` border at `src/components/MacroTab.jsx:287` with `\`1px solid ${theme.border.strong}\`` — `#30363d` = `theme.border.strong`
- [x] Replace hardcoded hex `"#6e7681"` for `SignalGroup` label color at `src/components/MacroTab.jsx:295` with `theme.text.subtle` — `#6e7681` = `theme.text.subtle`
- [x] Replace hardcoded hex `"#161b22"` for `RelationshipLegend` background at `src/components/MacroTab.jsx:319` with `theme.bg.surface` — `#161b22` = `theme.bg.surface`
- [x] Replace hardcoded hex `"1px solid #21262d"` border in `RelationshipLegend` at `src/components/MacroTab.jsx:320` with `\`1px solid ${theme.border.default}\`` — `#21262d` = `theme.border.default`
- [x] Replace hardcoded hex `"#6e7681"` for `RelationshipLegend` label color at `src/components/MacroTab.jsx:328` with `theme.text.subtle`
- [x] Replace hardcoded hex `"#8b949e"` for `RelationshipLegend` relationship text color at `src/components/MacroTab.jsx:338` with `theme.text.muted` — `#8b949e` = `theme.text.muted`
- [x] Replace `"#1c2d1c"` for 55% Rule alert background at `src/components/MacroTab.jsx:545` with `theme.alert.successBg` (new token added 2026-04-17).
- [x] Replace `"1px solid #238636"` border in 55% Rule alert at `src/components/MacroTab.jsx:546` with `` `1px solid ${theme.alert.successBorder}` `` (new token added 2026-04-17).
- [x] Replace hardcoded hex `"#3fb950"` text in 55% Rule alert at `src/components/MacroTab.jsx:548` with `theme.green`

## Q2 — Off-grid spacing

- [x] Replace raw fontSize `28` (posture value) at `src/components/MacroTab.jsx:477` with `theme.size.xxl` (new token added 2026-04-17).
- [x] Replace off-grid spacing `1` (letterSpacing on posture label) at `src/components/MacroTab.jsx:443` — this is `letterSpacing: 1` (CSS value, not spacing token); not strictly a spacing grid issue but inconsistent with token usage pattern
- [x] Replace off-grid spacing `4` (gap inside `childStyle` inline flex container at VIX trend) at `src/components/MacroTab.jsx:229` — value is correct (= `theme.space[1]`) but raw literal; replace with `theme.space[1]`
- [x] Replace off-grid spacing `2` (gap between ScoreDots) at `src/components/MacroTab.jsx:43` with `theme.space[1]`

## Q3 — Font-size outliers

- [x] Replace raw fontSize `28` at `src/components/MacroTab.jsx:477` with `theme.size.xxl` (same item as Q2; listed here for grep completeness).

## Q4 — Surface inconsistency

- [x] `SignalGroup` wrapper at `src/components/MacroTab.jsx:285` uses a hardcoded hex border (see Q1) and no `background` — it acts as a group container with `padding: theme.space[4]`. This is distinct from a panel (no bg fill), which is a valid design choice, but the border uses a raw hex instead of the token.
- [x] `RyanSummaryCard` at `src/components/MacroTab.jsx:141` uses `padding: theme.space[4]` (16px) instead of the canonical `theme.space[5]` (20px) — minor inconsistency with other top-level panels
- [x] Posture header at `src/components/MacroTab.jsx:427` uses `padding: theme.space[4]` (16px) — same as above; canonical panel uses `theme.space[5]` (20px). This may be intentional for the colored-bg posture header.
- [x] `SignalCard` at `src/components/MacroTab.jsx:197` uses `padding: theme.space[4]` (16px) — consistent within the Macro tab but different from the top-level panel standard. Acceptable for card-within-group contexts.

## Q5 — State gaps

- [x] Missing hover state on "Why this matters" toggle button at `src/components/MacroTab.jsx:249` — `cursor: pointer` and `onClick` but no visual hover feedback (no background/color change); consider adding a subtle color shift on hover
- [x] Missing hover state on Refresh button at `src/components/MacroTab.jsx:458` — has `cursor: pointer` and `onClick` but no `onMouseEnter`/`onMouseLeave`
- [x] Missing hover state on Retry button at `src/components/MacroTab.jsx:375` — same issue

## Total items: 20
