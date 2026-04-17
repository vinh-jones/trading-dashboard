# Audit — Macro

**Scope files:** `src/components/MacroTab.jsx`
**Produced:** 2026-04-17

## Q1 — Hardcoded hex

Note: `POSTURE_COLORS` and `ARROW_COLORS` are declared with inline comments calling them "intentional hardcoded hex" like `TYPE_COLORS`. However they are NOT in the CLAUDE.md allowlist. They play the same semantic-data role (key → color) but are defined inside `MacroTab.jsx`, not in the listed allowlist files. Flagging for a decision — either add them to CLAUDE.md allowlist or replace with theme tokens.

- [ ] Decide whether `POSTURE_COLORS` at `src/components/MacroTab.jsx:8–13` should be added to the CLAUDE.md allowlist or replaced with theme tokens (`theme.green`, `theme.red`, `theme.amber` for text; custom bg values have no direct token equivalent)
- [ ] Decide whether `ARROW_COLORS` at `src/components/MacroTab.jsx:23–26` should be added to the CLAUDE.md allowlist or replaced with `theme.green`, `theme.red`, `theme.text.muted`

**Outside the declared-intentional maps:**
- [ ] Replace hardcoded hex `"1px solid #30363d"` in `SignalGroup` border at `src/components/MacroTab.jsx:287` with `\`1px solid ${theme.border.strong}\`` — `#30363d` = `theme.border.strong`
- [ ] Replace hardcoded hex `"#6e7681"` for `SignalGroup` label color at `src/components/MacroTab.jsx:295` with `theme.text.subtle` — `#6e7681` = `theme.text.subtle`
- [ ] Replace hardcoded hex `"#161b22"` for `RelationshipLegend` background at `src/components/MacroTab.jsx:319` with `theme.bg.surface` — `#161b22` = `theme.bg.surface`
- [ ] Replace hardcoded hex `"1px solid #21262d"` border in `RelationshipLegend` at `src/components/MacroTab.jsx:320` with `\`1px solid ${theme.border.default}\`` — `#21262d` = `theme.border.default`
- [ ] Replace hardcoded hex `"#6e7681"` for `RelationshipLegend` label color at `src/components/MacroTab.jsx:328` with `theme.text.subtle`
- [ ] Replace hardcoded hex `"#8b949e"` for `RelationshipLegend` relationship text color at `src/components/MacroTab.jsx:338` with `theme.text.muted` — `#8b949e` = `theme.text.muted`
- [ ] Replace hardcoded hex `"#1c2d1c"` for 55% Rule alert background at `src/components/MacroTab.jsx:545` with `theme.alert.dangerBg` (closest available) or a new `theme.alert.successBg` token — this is a green-tinted alert with no current token
- [ ] Replace hardcoded hex `"1px solid #238636"` border in 55% Rule alert at `src/components/MacroTab.jsx:546` with a theme token (no current green-border alert token exists — flag for token addition)
- [ ] Replace hardcoded hex `"#3fb950"` text in 55% Rule alert at `src/components/MacroTab.jsx:548` with `theme.green`

## Q2 — Off-grid spacing

- [ ] Replace raw fontSize `28` (posture value) at `src/components/MacroTab.jsx:477` — not a theme.size token; this is a hero number intentionally larger than `xl` (18px). Flag for decision: either accept as a one-off hero size or add a `theme.size.hero` / `theme.size.xxl` token.
- [ ] Replace off-grid spacing `1` (letterSpacing on posture label) at `src/components/MacroTab.jsx:443` — this is `letterSpacing: 1` (CSS value, not spacing token); not strictly a spacing grid issue but inconsistent with token usage pattern
- [ ] Replace off-grid spacing `4` (gap inside `childStyle` inline flex container at VIX trend) at `src/components/MacroTab.jsx:229` — value is correct (= `theme.space[1]`) but raw literal; replace with `theme.space[1]`
- [ ] Replace off-grid spacing `2` (gap between ScoreDots) at `src/components/MacroTab.jsx:43` with `theme.space[1]`

## Q3 — Font-size outliers

- [ ] Replace raw fontSize `28` at `src/components/MacroTab.jsx:477` with a named token — see Q2 note above. Closest available is `theme.size.xl` (18px); a new `theme.size.xxl` (28px) or `theme.size.hero` token may be warranted.

## Q4 — Surface inconsistency

- [ ] `SignalGroup` wrapper at `src/components/MacroTab.jsx:285` uses a hardcoded hex border (see Q1) and no `background` — it acts as a group container with `padding: theme.space[4]`. This is distinct from a panel (no bg fill), which is a valid design choice, but the border uses a raw hex instead of the token.
- [ ] `RyanSummaryCard` at `src/components/MacroTab.jsx:141` uses `padding: theme.space[4]` (16px) instead of the canonical `theme.space[5]` (20px) — minor inconsistency with other top-level panels
- [ ] Posture header at `src/components/MacroTab.jsx:427` uses `padding: theme.space[4]` (16px) — same as above; canonical panel uses `theme.space[5]` (20px). This may be intentional for the colored-bg posture header.
- [ ] `SignalCard` at `src/components/MacroTab.jsx:197` uses `padding: theme.space[4]` (16px) — consistent within the Macro tab but different from the top-level panel standard. Acceptable for card-within-group contexts.

## Q5 — State gaps

- [ ] Missing hover state on "Why this matters" toggle button at `src/components/MacroTab.jsx:249` — `cursor: pointer` and `onClick` but no visual hover feedback (no background/color change); consider adding a subtle color shift on hover
- [ ] Missing hover state on Refresh button at `src/components/MacroTab.jsx:458` — has `cursor: pointer` and `onClick` but no `onMouseEnter`/`onMouseLeave`
- [ ] Missing hover state on Retry button at `src/components/MacroTab.jsx:375` — same issue

## Total items: 20
