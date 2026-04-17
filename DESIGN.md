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
