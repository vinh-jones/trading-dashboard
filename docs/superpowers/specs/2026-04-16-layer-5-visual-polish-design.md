# Layer 5 — Visual Polish Pass — Design Spec

**Date:** 2026-04-16
**Status:** Approved — ready for implementation plan
**Parent spec:** `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md` (Layer 5 item)

---

## Summary

Apply `DESIGN.md` tokens comprehensively across the 8 remaining surfaces that weren't rebuilt in Layers 1–4. Produces three artifacts: (1) a consolidated `DESIGN.md` brief at project root, (2) per-view audit checklists enumerating specific polish items, (3) polish commits that execute the checklists mechanically. Anti-sprawl is enforced by a pre-enumerated checklist (the audit IS the contract) and a "no new behavior" rule.

## Goals

- Produce a single `DESIGN.md` at project root that future UI work treats as source of truth.
- Eliminate off-token visual drift across the 8 surfaces: hardcoded hex, off-grid spacing, outlier font sizes, inconsistent surfaces, missing hover/focus states.
- Unify the hand-feel across all 3 modes — Focus (already polished in L2), Explore (3 sub-views), Review (3 sub-views).
- Keep the polish pass bounded: no layout restructures, no new components, no new behaviors, no copy edits.

## Non-goals

- No net-new features, data, or analytics.
- No responsive rework beyond token replacements.
- No behavioral changes (hover on already-clickable row = in; new click target = out).
- No reworking of surfaces already rebuilt in L1/L2 (Focus, CommandPalette).

## Artifacts produced

### 1. `DESIGN.md` (project root)

Consolidated visual brief. Contents:

- **Principles** — terminal-dense, institutional-authoritative, signal-hierarchy (numbers are the content, labels recede).
- **Token reference** — documents what exists in `src/lib/theme.js`. Does not redefine tokens.
  - Typography (`theme.size.xs/sm/md/lg/xl`)
  - Spacing (`theme.space[1..6]` — 4-point grid)
  - Surfaces (`theme.bg.base/surface/elevated/weekend`)
  - Text hierarchy (`theme.text.primary/secondary/muted/subtle/faint`)
  - Borders (`theme.border.default/strong`)
  - Semantic colors (`theme.green/red/blue/amber`)
  - Radius (`theme.radius.sm/md/pill`)
  - Chart-specific (`theme.chart.shares/leaps`)
- **Intentional hex-hardcode exceptions** — mirrors the CLAUDE.md allowlist (TYPE_COLORS, MOODS, JOURNAL_ENTRY_TYPES, monthly-target progress bar colors, BB_COLORS, SCORE_BG_COLORS).
- **Component patterns** — documents patterns already in use:
  - Panel (padding 20, `bg.surface`, `border.default`, `radius.md`, marginBottom 16)
  - Section header (uppercase, 0.5px letterspacing, `text.muted`, weight 500)
  - Chip (padding 6x14, `radius.pill`, active → `blue` + `bg.elevated`)
  - Position row (borderLeft 3px highlight slot)
  - Tab button (padding 3x12, `radius.sm`, active → blue ring)
- **Borrowed patterns** — from Linear (typography / spacing / surface), Warp (monospace-forward numerics, terminal-chrome header), Coinbase/Kraken (restrained signed-value color).
- **States taxonomy** — per component type, which states are required:
  - Clickable rows/cards → default + hover + selected (if applicable)
  - Form inputs → default + focus ring
  - Buttons → default + hover + disabled
  - Chips → default + active
  - Palette items → default + keyboard-selected

### 2. Per-view audit checklists

One markdown file per surface under `docs/superpowers/audits/2026-04-16-layer-5/`:

- `header.md`
- `mode-nav.md`
- `open-positions.md`
- `radar.md`
- `macro.md`
- `journal.md`
- `monthly-calendar.md`
- `ytd-summary.md`

Each audit file is produced by asking five objective questions per surface:

1. **Hardcoded hex** — any `#xxxxxx` outside the CLAUDE.md allowlist?
2. **Off-grid spacing** — any padding/margin not from `theme.space[1..6]`?
3. **Size outliers** — any font-size not in `theme.size.xs/sm/md/lg/xl`?
4. **Surface inconsistency** — are panels/cards using `bg.surface` + `border.default` + `radius.md` consistently?
5. **State gaps** — does the surface have the hover/focus/active states DESIGN.md says it should?

Each "no" produces one checklist item with `file:line` pointer. The audit does not make subjective judgments ("this looks ugly") — only measurable token deviations.

Expected item count per surface (rough, finalized during audit):

| # | Surface | Files | Items |
|---|---------|-------|-------|
| 1 | Persistent Header | `PersistentHeader.jsx` | 3–5 |
| 2 | Mode Nav | `ModeNav.jsx` | 2–4 |
| 3 | OpenPositionsTab | `OpenPositionsTab.jsx` | 8–12 |
| 4 | Radar | `RadarTab.jsx`, `radar/*.jsx` | 6–10 |
| 5 | Macro | `MacroTab.jsx` | 4–6 |
| 6 | Journal | `JournalTab.jsx`, `journal/*.jsx` | 6–10 |
| 7 | Monthly Calendar | `CalendarTab.jsx` | 5–8 |
| 8 | YTD Summary | `SummaryTab.jsx` | 4–6 |

Total estimate: ~40–60 polish items across 8 surfaces.

### 3. Polish commits

One commit per surface, each executing that surface's audit checklist exactly. No drift from checklist — that's the sprawl guard.

## Sequencing

1. **Write `DESIGN.md`** (one commit — `docs(design): add consolidated design brief`).
2. **Run audit** across all 8 surfaces → produce 8 checklist files (one commit — `docs(polish): layer 5 audit checklists`).
3. **User review gate** — user reviews the checklists. This is the critical gate: scope drift caught here, before code changes.
4. **Implement polish view-by-view**, in order: Header → Mode Nav → OpenPositions → Radar → Macro → Journal → Monthly → YTD. One commit per surface.
5. **Final pass** — bump version to `1.49.0`, commit, push.

## Verification

Polish changes are hard to unit-test. Verification is:

- **Checklist completeness** — every item in the audit file is checked off in the commit (or explicitly deferred with a reason).
- **No-new-behavior rule** — implementer diff must be token replacements and existing-state enhancements only. Reviewer checks for scope violations.
- **Visual spot-check** — user loads the page post-commit. We cannot do this via the dev preview server (no data there) — verification is on user's end, on production deploy or local with data.

## Guardrails (anti-sprawl)

- **Audit is the contract.** Implementer does not add items mid-task.
- **One commit per surface.** If a surface's diff starts sprawling, split it and flag for discussion.
- **Hardcoded-hex deviations** outside the CLAUDE.md allowlist require an explicit justification line in the commit message.
- **"No new behavior" rule.** Polish enhances existing states only:
  - Hover state on an already-clickable row → in scope
  - New button, new data, new feature, copy edit → out of scope

## Out of scope (explicit)

- Layout restructures
- New components or new data
- Behavioral changes (adding new click targets, new interactions on non-interactive elements)
- Copy edits
- Responsive rework beyond token fixes
- Adding tests for polish changes
- Surfaces already rebuilt in L1/L2 (Focus view, CommandPalette) — these are out of scope unless a specific regression is found during the audit

## Open questions (decide during planning)

- **DESIGN.md pattern section depth** — do we document every pattern (panel, chip, row, header, etc.) or only the most-reused? Recommendation: document the 5–8 patterns that appear 3+ times across the codebase. Deeper taxonomy is out of scope.
- **Borrowed-pattern treatment** — do we literally copy Linear / Warp tokens, or reference them as inspiration and stick to existing `theme.js`? Recommendation: reference-only. `theme.js` is already aligned to this DNA; DESIGN.md codifies, not redefines.

## Success criteria

- `DESIGN.md` exists at project root and is internally consistent with `theme.js` + CLAUDE.md.
- Every audit file has been produced before any code changes.
- Every audit checklist item is either implemented or explicitly deferred with a reason.
- No hardcoded hex outside the CLAUDE.md allowlist remains in the 8 surfaces.
- No off-grid spacing or outlier font-sizes remain in the 8 surfaces.
- Version bumped to `1.49.0` and shipped to main.
