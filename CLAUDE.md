# Claude Code Instructions

## Version bumping

**Always check main's current version before bumping.** This repo uses worktrees — the local `package.json` may be on an old branch. Before any version bump, run:

```bash
git show origin/main:package.json | grep '"version"'
```

Increment from that number. Never use the local file's version as the baseline.

- Minor bump (`x.Y.0`) for new features
- Patch bump (`x.y.Z`) for fixes
- Bump `package.json` AND `const VERSION` in `src/lib/constants.js` in the same commit

## PR workflow

After creating a PR, merge it immediately (no need to ask).

## Timezones

The user is on **Pacific Time (west coast)**.

- **User-facing timestamps** (tooltips, dashboard displays, notification text, etc.) must be rendered in `America/Los_Angeles` — either implicitly (browser-local, which is PT for the user) or explicitly via `timeZone: "America/Los_Angeles"`. Prefer explicit when the timestamp could be read in a different context (emails, push bodies).
- **Market-hours logic** (any `isMarketOpen()` / `isMarketHours()` check, DTE calc, options expiry math) stays on `America/New_York`. Markets are ET regardless of where the user sits. Don't change these to PT.

## Design tokens

All styles use inline `style={{}}` objects — no CSS files, no Tailwind. **Never hardcode hex color values.** Always import and use `theme` from `src/lib/theme.js`:

```js
import { theme } from "../lib/theme";
// or from a subdirectory:
import { theme } from "../../lib/theme";
```

Key token categories:
- `theme.bg.base/surface/elevated/weekend` — backgrounds
- `theme.text.primary/secondary/muted/subtle/faint` — text hierarchy
- `theme.border.default/strong` — borders
- `theme.green/red/blue/amber` — semantic status colors
- `theme.size.xs/sm/md/lg/xl` (10/12/14/16/18px) — font sizes, no in-betweens
- `theme.space[1..6]` (4/8/12/16/20/24px) — spacing, 4-point grid
- `theme.radius.sm/md/pill` (4/8/20px) — border radius
- `theme.font.mono` — monospace font stack
- `theme.chart.shares/leaps` — chart-specific colors

**Intentional exceptions** (hardcoded hex is correct, do not replace):
- `TYPE_COLORS` in `src/lib/constants.js` — CSP/CC/LEAPS/Spread/Shares badge colors
- `MOODS` in `journalConstants.js` — mood-specific activeBg/activeBorder per mood
- `JOURNAL_ENTRY_TYPES` in `journalConstants.js` — type-specific activeColor/activeBg per entry type
- Monthly target progress bar colors in `JournalEntryCard.jsx` — semantic data values tied to target labels
- `BB_COLORS` / `SCORE_BG_COLORS` in `src/components/RadarTab.jsx` — semantic-data maps for Bollinger-Band buckets and score buckets (same role as TYPE_COLORS)
