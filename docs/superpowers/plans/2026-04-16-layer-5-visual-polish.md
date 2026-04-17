# Layer 5 — Visual Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a consolidated `DESIGN.md` and apply its tokens comprehensively across 8 surfaces via an audit-driven polish pass.

**Architecture:** Three artifacts in order: (1) `DESIGN.md` at project root, (2) 8 audit checklist files under `docs/superpowers/audits/2026-04-16-layer-5/`, (3) 8 polish commits, one per surface. The audit is the contract — implementer does not add items mid-task.

**Tech Stack:** React 18, Vite, inline `style={{}}` objects importing from `src/lib/theme.js`. No CSS files, no Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-16-layer-5-visual-polish-design.md`

---

## Project-specific rules (apply to every task)

- **Never hardcode hex.** All colors must come from `theme` in `src/lib/theme.js`. Exceptions allowlisted in CLAUDE.md:
  - `TYPE_COLORS` in `src/lib/constants.js`
  - `MOODS` + `JOURNAL_ENTRY_TYPES` in `src/components/journal/journalConstants.js`
  - Monthly-target progress bar colors in `src/components/journal/JournalEntryCard.jsx`
  - `BB_COLORS` / `SCORE_BG_COLORS` in `src/components/RadarTab.jsx`
- **Spacing must be `theme.space[1..6]`** (4, 8, 12, 16, 20, 24 px). No 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23 values.
- **Font-size must be `theme.size.xs/sm/md/lg/xl`** (10, 12, 14, 16, 18). No intermediate values.
- **No new behavior.** Polish enhances existing states only. New buttons, new data, new click targets, copy edits → out of scope.
- **Timezones:** user-facing timestamps use browser-local; market-hours logic stays on `America/New_York`. Polish pass does not change any timezone code.
- **Version bumps:** check `git show origin/main:package.json | grep '"version"'` before bumping. Bump both `package.json` and `VERSION` in `src/lib/constants.js`.
- **Commit workflow:** after committing to main, always `git push origin main` immediately. Never report done before push succeeds.

---

## File structure

**Create:**
- `DESIGN.md` (project root)
- `docs/superpowers/audits/2026-04-16-layer-5/header.md`
- `docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md`
- `docs/superpowers/audits/2026-04-16-layer-5/open-positions.md`
- `docs/superpowers/audits/2026-04-16-layer-5/radar.md`
- `docs/superpowers/audits/2026-04-16-layer-5/macro.md`
- `docs/superpowers/audits/2026-04-16-layer-5/journal.md`
- `docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md`
- `docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md`

**Modify (polish tasks only — exact diffs depend on audit findings):**
- `src/components/PersistentHeader.jsx`
- `src/components/ModeNav.jsx`
- `src/components/OpenPositionsTab.jsx`
- `src/components/RadarTab.jsx`, `src/components/radar/RadarPresetBar.jsx`, `src/components/radar/RadarAdvancedFilters.jsx`
- `src/components/MacroTab.jsx`
- `src/components/journal/JournalTab.jsx`, `src/components/journal/JournalEntryCard.jsx`, `src/components/journal/JournalField.jsx`, `src/components/journal/JournalAutoTextarea.jsx`, `src/components/journal/JournalInlineEditForm.jsx`
- `src/components/CalendarTab.jsx`, `src/components/CalendarDetailPanel.jsx`
- `src/components/SummaryTab.jsx`
- `src/lib/constants.js` (version bump)
- `package.json` (version bump)

---

## Task 1: Write DESIGN.md

**Files:**
- Create: `DESIGN.md`

- [ ] **Step 1: Read `src/lib/theme.js` to confirm current tokens**

Run: `cat src/lib/theme.js`

Confirm these values:
- `bg`: base `#0d1117`, surface `#161b22`, elevated `#1c2333`, weekend `#0a0e14`
- `text`: primary `#e6edf3`, secondary `#c9d1d9`, muted `#8b949e`, subtle `#6e7681`, faint `#4e5a65`
- `border`: default `#21262d`, strong `#30363d`
- Semantic: green `#3fb950`, red `#f85149`, blue `#58a6ff`, blueBold `#1f6feb`, amber `#e3b341`
- `space`: 1=4, 2=8, 3=12, 4=16, 5=20, 6=24
- `radius`: sm=4, md=8, pill=20
- `size`: xs=10, sm=12, md=14, lg=16, xl=18

- [ ] **Step 2: Read CLAUDE.md to confirm exception allowlist**

Run: `cat CLAUDE.md | sed -n '/Intentional exceptions/,/^$/p'`

The exceptions section must match what goes into DESIGN.md §Intentional hex-hardcode exceptions.

- [ ] **Step 3: Write DESIGN.md**

Create `DESIGN.md` at project root with the following structure and content:

```markdown
# Trading Dashboard — Design Brief

Consolidated visual brief. Source of truth for all UI work.

**Base:** Linear (typography, spacing, surfaces) + Warp (monospace-forward numerics, terminal-chrome header) + Coinbase/Kraken (restrained signed-value color).

---

## Principles

1. **Terminal-dense** — monospace font stack, tight line-heights, information-rich rows. Numbers are the content; labels recede.
2. **Institutional-authoritative** — Linear-style precision (uniform spacing, aligned typography, subtle elevation). No cute flourishes.
3. **Signal hierarchy** — the eye should catch the most important signal first (P1 alerts, VIX posture, free-cash state). Less important chrome (nav, counts, metadata) uses muted tones.
4. **Restrained color** — green/red for signed values, amber for warning states, blue for selected/active. Hardcoded hex forbidden outside the explicit allowlist.

## Token reference

All tokens live in `src/lib/theme.js`. Do not redefine — import and use.

### Typography

| Token             | Size | Use                                                        |
|-------------------|------|------------------------------------------------------------|
| `theme.size.xs`   | 10px | Meta labels, version tags, footnotes                       |
| `theme.size.sm`   | 12px | Secondary body, table headers, chip labels                 |
| `theme.size.md`   | 14px | Default body text                                          |
| `theme.size.lg`   | 16px | Subsection headers                                         |
| `theme.size.xl`   | 18px | Section headers                                            |

Font: `theme.font.mono` — `'SF Mono', 'Fira Code', 'Consolas', monospace`. Used universally.

### Spacing (4-point grid)

`theme.space[1..6]` = 4, 8, 12, 16, 20, 24 px.

- `space[1]` (4px) — inline gap inside a tag, icon-to-text
- `space[2]` (8px) — chip gap, form-field inner padding
- `space[3]` (12px) — row gap in lists, card inner padding
- `space[4]` (16px) — section marginBottom
- `space[5]` (20px) — panel padding
- `space[6]` (24px) — page padding, major section gap

No other pixel values. If you find yourself wanting `10px` or `18px`, you want `space[2]` or `space[4]`.

### Surfaces

| Token              | Hex       | Use                                           |
|--------------------|-----------|-----------------------------------------------|
| `bg.base`          | `#0d1117` | Page background                               |
| `bg.surface`       | `#161b22` | Cards, panels                                 |
| `bg.elevated`      | `#1c2333` | Selected / active state background            |
| `bg.weekend`       | `#0a0e14` | Weekend day cells in calendar                 |

### Text hierarchy

| Token              | Hex       | Use                                           |
|--------------------|-----------|-----------------------------------------------|
| `text.primary`     | `#e6edf3` | Primary data values (ticker, dollar amounts)  |
| `text.secondary`   | `#c9d1d9` | Default body text                             |
| `text.muted`       | `#8b949e` | Section headers (uppercase), metadata labels  |
| `text.subtle`      | `#6e7681` | Timestamps, disabled-ish text, tertiary meta  |
| `text.faint`       | `#4e5a65` | Near-invisible helper text, version tags      |

### Borders

| Token              | Hex       | Use                                           |
|--------------------|-----------|-----------------------------------------------|
| `border.default`   | `#21262d` | Row separators, panel borders                 |
| `border.strong`    | `#30363d` | Emphasized borders, table header underline    |

### Semantic colors

| Token              | Hex       | Use                                           |
|--------------------|-----------|-----------------------------------------------|
| `green`            | `#3fb950` | Gains, positive deltas, viable roll           |
| `red`              | `#f85149` | Losses, P1 alerts, non-viable roll            |
| `blue`             | `#58a6ff` | Active chips, selected state, accent links    |
| `blueBold`         | `#1f6feb` | Progress bar fills, bar chart fills           |
| `amber`            | `#e3b341` | P2 alerts, warning states                     |

### Radius

`theme.radius.sm` = 4px (buttons, small chips) · `md` = 8px (panels, cards) · `pill` = 20px (chip-nav).

### Chart

`theme.chart.shares` = `#2eb88a`, `theme.chart.leaps` = `#f0c040`. Used in the allocation bar and nowhere else.

## Intentional hex-hardcode exceptions (allowlist)

These files may contain hardcoded hex values because each maps a semantic data value to a specific color. Do not replace with tokens:

- `TYPE_COLORS` in `src/lib/constants.js` — CSP/CC/LEAPS/Spread/Shares badge colors
- `MOODS` in `src/components/journal/journalConstants.js` — mood-specific activeBg/activeBorder per mood
- `JOURNAL_ENTRY_TYPES` in `src/components/journal/journalConstants.js` — type-specific activeColor/activeBg per entry type
- Monthly target progress bar colors in `src/components/journal/JournalEntryCard.jsx`
- `BB_COLORS` / `SCORE_BG_COLORS` in `src/components/RadarTab.jsx` — Bollinger-Band buckets and score buckets

Any other hardcoded hex in the codebase is a bug.

## Component patterns

### Panel

```js
{
  padding:      theme.space[5],               // 20
  background:   theme.bg.surface,
  borderRadius: theme.radius.md,              // 8
  border:       `1px solid ${theme.border.default}`,
  marginBottom: theme.space[4],               // 16
}
```

### Section header (inside a panel)

```js
{
  fontSize:      theme.size.md,               // 14
  color:         theme.text.muted,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontWeight:    500,
  marginBottom:  theme.space[3],              // 12
}
```

### Chip (pill-shaped nav)

```js
// Default
{
  padding:      "6px 14px",
  fontSize:     theme.size.sm,                // 12
  fontFamily:   "inherit",
  background:   theme.bg.surface,
  color:        theme.text.muted,
  border:       `1px solid ${theme.border.default}`,
  borderRadius: theme.radius.pill,            // 20
  fontWeight:   400,
  letterSpacing: "0.3px",
  whiteSpace:   "nowrap",
  transition:   "all 0.15s",
}
// Active (override)
{
  background:   theme.bg.elevated,
  color:        theme.blue,
  border:       `1px solid ${theme.blue}`,
  fontWeight:   600,
}
```

### Tab button (tab-style nav)

```js
{
  padding:      "3px 12px",
  fontSize:     theme.size.sm,                // 12
  fontFamily:   "inherit",
  borderRadius: theme.radius.sm,              // 4
  border:       `1px solid ${theme.border.strong}`,
  background:   theme.bg.elevated,
  color:        theme.text.secondary,
  fontWeight:   400,
}
// Active
{
  border:     `1px solid ${theme.blue}`,
  background: "rgba(58,130,246,0.15)",
  color:      theme.blue,
  fontWeight: 600,
}
```

### Clickable row (table row or list item)

```js
{
  borderBottom: `1px solid ${theme.border.default}`,
  borderLeft:   "3px solid transparent",     // reserved for highlight indicator
  cursor:       "pointer",
  background:   "transparent",
  transition:   "background 0.15s",
}
// Hover
{ background: `${TYPE_COLORS.CSP.bg}22` }  // or a neutral tint like rgba(58,130,246,0.06)
// Selected
{ background: "rgba(58,130,246,0.10)" }
```

## States taxonomy

| Component            | Required states                                   |
|----------------------|---------------------------------------------------|
| Clickable row / card | default, hover, (selected if applicable)          |
| Form input           | default, focus ring                               |
| Button               | default, hover, disabled                          |
| Chip                 | default, active                                   |
| Palette item         | default, keyboard-selected                        |

Focus rings use `theme.blue` with 1px outline. Hover backgrounds are low-opacity tints of `theme.blue` or the relevant type color.

## Borrowed-pattern references

- **Linear** — typography scale, spacing rhythm, subtle surface elevation. `theme.js` tokens already target this DNA.
- **Warp** — monospace-forward numeric display, terminal-chrome header (subtle inner gradients, sharp dividers).
- **Coinbase / Kraken** — signed-value semantic color (green up, red down, amber warning). Applied restrained.

These are inspiration, not copied tokens. `theme.js` is the source of truth.
```

- [ ] **Step 4: Verify DESIGN.md is internally consistent with theme.js and CLAUDE.md**

Run:
```bash
grep -E '#[0-9a-fA-F]{6}' DESIGN.md | wc -l
```
Expected: Some count — DESIGN.md documents hex values in the token reference table. That's correct.

Run:
```bash
grep -F '#0d1117' DESIGN.md && grep -F '#0d1117' src/lib/theme.js
```
Expected: Both match. If DESIGN.md cites a hex that isn't in `theme.js`, fix DESIGN.md to match `theme.js`.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md
git commit -m "$(cat <<'EOF'
docs(design): add consolidated visual brief

Source of truth for all UI work. Documents token reference,
component patterns, and intentional hex-hardcode exceptions.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 2: Produce 8 audit checklists

**Files:**
- Create: `docs/superpowers/audits/2026-04-16-layer-5/header.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/open-positions.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/radar.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/macro.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/journal.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md`
- Create: `docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md`

### Audit procedure (run this once per surface)

For each surface in the file-list below, read the listed files and answer these five objective questions:

**Q1: Hardcoded hex?**

Run on each file:
```bash
grep -nE '#[0-9a-fA-F]{3,6}\b' <file>
```
For every match, check:
- Is this file in the CLAUDE.md allowlist? If yes, it's permitted.
- Is the match inside a string literal that represents a token name (e.g., `"#0d1117" in a comment`)? Those are fine.
- Otherwise, record a checklist item: `- [ ] Replace hardcoded hex \`<hex>\` at file:line with appropriate theme token`.

**Q2: Off-grid spacing?**

Run:
```bash
grep -nE '(padding|margin|gap):\s*"?[0-9]+[^0-9]' <file>
grep -nE '(paddingTop|paddingBottom|paddingLeft|paddingRight|marginTop|marginBottom|marginLeft|marginRight):\s*[0-9]+' <file>
```
For every numeric value, check if it's in `{4, 8, 12, 16, 20, 24}`. Off-grid values like `5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23` need replacement. Exception: half-spacings inside a padding string like `"3px 12px"` for tab buttons are allowed if the component pattern in DESIGN.md uses that value.

Record: `- [ ] Replace off-grid spacing <value> at file:line with theme.space[N]`.

**Q3: Font-size outliers?**

Run:
```bash
grep -nE 'fontSize:\s*' <file>
```
Check every value against `{10, 12, 14, 16, 18}`. Anything else — including raw string like `"11px"` — is an outlier. Record:
`- [ ] Replace fontSize <value> at file:line with theme.size.{xs|sm|md|lg|xl}`.

**Q4: Surface inconsistency?**

Visually scan the file for panel/card structures. A panel must use:
- `padding: theme.space[5]` (or `"20px"` literal is acceptable, but prefer the token)
- `background: theme.bg.surface`
- `borderRadius: theme.radius.md`
- `border: \`1px solid ${theme.border.default}\``
- `marginBottom: theme.space[4]`

If a panel deviates — e.g. uses `bg.elevated` as its default surface, `borderRadius: 10`, or custom padding — record:
`- [ ] Panel at file:line deviates from pattern — <describe deviation>`.

**Q5: State gaps?**

For every `onClick` or interactive element in the file:
- Is there a corresponding `onMouseEnter` / `onMouseLeave` hover treatment? If not, record.
- Is there a `:focus` style via `onFocus`/`onBlur` for keyboard users on form inputs? If not, record.

Record: `- [ ] Missing <hover|focus> state for <element description> at file:line`.

### Audit file template

Each audit file uses this exact structure:

```markdown
# Audit — <Surface Name>

**Scope files:** `src/components/...`
**Produced:** 2026-04-16

## Q1 — Hardcoded hex
- [ ] ...

## Q2 — Off-grid spacing
- [ ] ...

## Q3 — Font-size outliers
- [ ] ...

## Q4 — Surface inconsistency
- [ ] ...

## Q5 — State gaps
- [ ] ...

## Total items: <count>
```

If a question has zero findings, write `_(none)_` under the heading.

### Surface-to-files mapping

Run the audit procedure against these surfaces:

- [ ] **Step 1: Audit Persistent Header** → `docs/superpowers/audits/2026-04-16-layer-5/header.md`

Scope files: `src/components/PersistentHeader.jsx`.

- [ ] **Step 2: Audit Mode Nav** → `docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md`

Scope files: `src/components/ModeNav.jsx`.

- [ ] **Step 3: Audit OpenPositions** → `docs/superpowers/audits/2026-04-16-layer-5/open-positions.md`

Scope files: `src/components/OpenPositionsTab.jsx`, `src/components/SixtyCheck.jsx`.

- [ ] **Step 4: Audit Radar** → `docs/superpowers/audits/2026-04-16-layer-5/radar.md`

Scope files: `src/components/RadarTab.jsx`, `src/components/radar/RadarPresetBar.jsx`, `src/components/radar/RadarAdvancedFilters.jsx`.

- [ ] **Step 5: Audit Macro** → `docs/superpowers/audits/2026-04-16-layer-5/macro.md`

Scope files: `src/components/MacroTab.jsx`.

- [ ] **Step 6: Audit Journal** → `docs/superpowers/audits/2026-04-16-layer-5/journal.md`

Scope files: `src/components/journal/JournalTab.jsx`, `src/components/journal/JournalEntryCard.jsx`, `src/components/journal/JournalField.jsx`, `src/components/journal/JournalAutoTextarea.jsx`, `src/components/journal/JournalInlineEditForm.jsx`.

- [ ] **Step 7: Audit Monthly Calendar** → `docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md`

Scope files: `src/components/CalendarTab.jsx`, `src/components/CalendarDetailPanel.jsx`.

- [ ] **Step 8: Audit YTD Summary** → `docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md`

Scope files: `src/components/SummaryTab.jsx`.

- [ ] **Step 9: Commit all 8 audit files**

```bash
git add docs/superpowers/audits/2026-04-16-layer-5/
git commit -m "$(cat <<'EOF'
docs(polish): layer 5 audit checklists

Enumerates token deviations across 8 surfaces — this is the
contract for the polish tasks. Implementer does not add items
mid-task; scope changes require updating the checklist first.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 3: User review gate

**This is not a code task.** Pause and wait for user review of the audit files before any implementation starts.

- [ ] **Step 1: Prompt user**

Send a message: "Audit checklists committed at `docs/superpowers/audits/2026-04-16-layer-5/`. Please review — this is the scope contract. Anything missing or over-reaching? Once you approve, I'll execute the polish tasks one commit per surface."

- [ ] **Step 2: Wait for user approval**

If the user requests changes, update the relevant audit file(s), commit (`docs(polish): revise layer 5 audit — <surface>`), push, and re-prompt.

Only proceed to Task 4 after explicit user approval.

---

## Task 4: Polish Persistent Header

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/header.md`
- Modify: `src/components/PersistentHeader.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/header.md`

- [ ] **Step 2: Apply every checklist item**

For each `- [ ]` entry in the audit, make the exact change it describes. Check off each item in the audit file as you complete it (change `- [ ]` to `- [x]`).

- [ ] **Step 3: Verify diff contains only token replacements and state additions**

Run: `git diff src/components/PersistentHeader.jsx`

Scan for:
- New JSX elements that weren't there before → violation of "no new behavior". Remove.
- New `onClick`, new imported modules, new state variables → violation. Remove.
- Acceptable changes: token swaps (hex → theme), spacing fixes, new hover/focus handlers on already-interactive elements.

- [ ] **Step 4: Verify no hardcoded hex remains outside allowlist**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/PersistentHeader.jsx`

Expected: no matches. (This file is not in the allowlist.)

If matches remain, either replace them or add a justification comment like `// hex allowed: <reason>` and note in commit message.

- [ ] **Step 5: Commit**

```bash
git add src/components/PersistentHeader.jsx docs/superpowers/audits/2026-04-16-layer-5/header.md
git commit -m "$(cat <<'EOF'
style(header): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/header.md.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 5: Polish Mode Nav

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md`
- Modify: `src/components/ModeNav.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md`

- [ ] **Step 2: Apply every checklist item**

For each `- [ ]` entry in the audit, make the exact change. Check off each item as completed.

- [ ] **Step 3: Verify diff contains only token replacements and state additions**

Run: `git diff src/components/ModeNav.jsx`

Scan for violations (see Task 4 Step 3). Remove any new behavior.

- [ ] **Step 4: Verify no hardcoded hex remains**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/ModeNav.jsx`

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModeNav.jsx docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md
git commit -m "$(cat <<'EOF'
style(mode-nav): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/mode-nav.md.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 6: Polish OpenPositions

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/open-positions.md`
- Modify: `src/components/OpenPositionsTab.jsx`, `src/components/SixtyCheck.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/open-positions.md`

- [ ] **Step 2: Apply every checklist item**

Check off each item as completed.

- [ ] **Step 3: Verify diff**

Run: `git diff src/components/OpenPositionsTab.jsx src/components/SixtyCheck.jsx`

Scan for violations (new JSX elements, new state, new onClick, new features). Remove.

- [ ] **Step 4: Verify no hardcoded hex outside allowlist**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/OpenPositionsTab.jsx src/components/SixtyCheck.jsx`

Expected: no matches. Neither file is in the allowlist.

- [ ] **Step 5: Commit**

```bash
git add src/components/OpenPositionsTab.jsx src/components/SixtyCheck.jsx docs/superpowers/audits/2026-04-16-layer-5/open-positions.md
git commit -m "$(cat <<'EOF'
style(open-positions): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/open-positions.md.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 7: Polish Radar

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/radar.md`
- Modify: `src/components/RadarTab.jsx`, `src/components/radar/RadarPresetBar.jsx`, `src/components/radar/RadarAdvancedFilters.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/radar.md`

- [ ] **Step 2: Apply every checklist item**

Check off each item as completed.

**Important:** `RadarTab.jsx` contains `BB_COLORS` and `SCORE_BG_COLORS` in the CLAUDE.md allowlist. Do NOT replace these hex values — they map semantic data (Bollinger bucket, score bucket) to specific colors, same role as `TYPE_COLORS`.

- [ ] **Step 3: Verify diff**

Run: `git diff src/components/RadarTab.jsx src/components/radar/`

Scan for violations. Remove.

- [ ] **Step 4: Verify no unexpected hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/RadarTab.jsx src/components/radar/RadarPresetBar.jsx src/components/radar/RadarAdvancedFilters.jsx`

Expected: only matches inside `BB_COLORS` or `SCORE_BG_COLORS` definitions in `RadarTab.jsx`. Anything else is a violation.

- [ ] **Step 5: Commit**

```bash
git add src/components/RadarTab.jsx src/components/radar/ docs/superpowers/audits/2026-04-16-layer-5/radar.md
git commit -m "$(cat <<'EOF'
style(radar): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/radar.md.
BB_COLORS and SCORE_BG_COLORS retained per CLAUDE.md allowlist.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 8: Polish Macro

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/macro.md`
- Modify: `src/components/MacroTab.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/macro.md`

- [ ] **Step 2: Apply every checklist item**

Check off each item as completed.

- [ ] **Step 3: Verify diff**

Run: `git diff src/components/MacroTab.jsx`

Scan for violations. Remove.

- [ ] **Step 4: Verify no hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/MacroTab.jsx`

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/MacroTab.jsx docs/superpowers/audits/2026-04-16-layer-5/macro.md
git commit -m "$(cat <<'EOF'
style(macro): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/macro.md.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 9: Polish Journal

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/journal.md`
- Modify: `src/components/journal/JournalTab.jsx`, `src/components/journal/JournalEntryCard.jsx`, `src/components/journal/JournalField.jsx`, `src/components/journal/JournalAutoTextarea.jsx`, `src/components/journal/JournalInlineEditForm.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/journal.md`

- [ ] **Step 2: Apply every checklist item**

Check off each item as completed.

**Important:** `journal/journalConstants.js` contains `MOODS` and `JOURNAL_ENTRY_TYPES` (allowlisted). `JournalEntryCard.jsx` contains monthly-target progress bar colors (allowlisted). Do NOT replace these hex values.

- [ ] **Step 3: Verify diff**

Run: `git diff src/components/journal/`

Scan for violations. Remove.

- [ ] **Step 4: Verify no unexpected hardcoded hex**

Run:
```bash
grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/journal/JournalTab.jsx src/components/journal/JournalEntryCard.jsx src/components/journal/JournalField.jsx src/components/journal/JournalAutoTextarea.jsx src/components/journal/JournalInlineEditForm.jsx
```

Expected: only matches inside the monthly-target progress bar color logic in `JournalEntryCard.jsx`. Anything else is a violation.

- [ ] **Step 5: Commit**

```bash
git add src/components/journal/ docs/superpowers/audits/2026-04-16-layer-5/journal.md
git commit -m "$(cat <<'EOF'
style(journal): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/journal.md.
MOODS, JOURNAL_ENTRY_TYPES, and monthly-target progress bar colors
retained per CLAUDE.md allowlist.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 10: Polish Monthly Calendar

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md`
- Modify: `src/components/CalendarTab.jsx`, `src/components/CalendarDetailPanel.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md`

- [ ] **Step 2: Apply every checklist item**

Check off each item as completed.

- [ ] **Step 3: Verify diff**

Run: `git diff src/components/CalendarTab.jsx src/components/CalendarDetailPanel.jsx`

Scan for violations. Remove.

- [ ] **Step 4: Verify no hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/CalendarTab.jsx src/components/CalendarDetailPanel.jsx`

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/CalendarTab.jsx src/components/CalendarDetailPanel.jsx docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md
git commit -m "$(cat <<'EOF'
style(monthly): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/monthly-calendar.md.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 11: Polish YTD Summary

**Files:**
- Read: `docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md`
- Modify: `src/components/SummaryTab.jsx`

- [ ] **Step 1: Read the audit file**

Run: `cat docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md`

- [ ] **Step 2: Apply every checklist item**

Check off each item as completed.

- [ ] **Step 3: Verify diff**

Run: `git diff src/components/SummaryTab.jsx`

Scan for violations. Remove.

- [ ] **Step 4: Verify no hardcoded hex**

Run: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/components/SummaryTab.jsx`

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/SummaryTab.jsx docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md
git commit -m "$(cat <<'EOF'
style(ytd): apply layer 5 polish pass

Applies DESIGN.md tokens per docs/superpowers/audits/2026-04-16-layer-5/ytd-summary.md.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Task 12: Version bump and ship

**Files:**
- Modify: `package.json`
- Modify: `src/lib/constants.js`

- [ ] **Step 1: Confirm main's current version**

Run: `git show origin/main:package.json | grep '"version"'`

Expected output: `"version": "1.48.0",`

If the number is different, use that as the baseline.

- [ ] **Step 2: Bump `package.json`**

Edit `package.json`:

```json
"version": "1.49.0",
```

- [ ] **Step 3: Bump `src/lib/constants.js`**

Edit `src/lib/constants.js`:

```js
export const VERSION = "1.49.0";
```

- [ ] **Step 4: Confirm final audit state**

Run:
```bash
for f in docs/superpowers/audits/2026-04-16-layer-5/*.md; do
  unchecked=$(grep -c '^- \[ \]' "$f" || true)
  echo "$f: $unchecked unchecked"
done
```

Expected: every audit file shows `0 unchecked`. If any are non-zero, either complete them or add an explicit deferral note inside the audit file (`- [x] ~~<item>~~ deferred: <reason>`) before bumping the version.

- [ ] **Step 5: Commit and push**

```bash
git add package.json src/lib/constants.js
git commit -m "$(cat <<'EOF'
chore(release): v1.49.0 — layer 5 visual polish pass

Applies DESIGN.md tokens across 8 surfaces: header, mode-nav,
open-positions, radar, macro, journal, monthly calendar, ytd summary.
No behavioral changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 6: Confirm push succeeded**

Run: `git log origin/main -1 --oneline`

Expected output starts with the commit hash you just pushed.
