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

## Commit workflow

After committing directly to main, always push immediately:

```bash
git push origin main
```

Never consider a change "done" or report it to the user until the push has completed successfully.

## PR workflow

After creating a PR, merge it immediately (no need to ask).

## Timezones

The user is on **Pacific Time (west coast)**.

- **User-facing timestamps** (tooltips, dashboard displays, etc.) should rely on **browser-local time** — don't hardcode `timeZone: "America/Los_Angeles"`. This way the display auto-adjusts if the user ever checks from a different timezone.
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

## VIX-Based Cash Targets (Ryan's verified framework)

Deployment posture is contrarian — high VIX = deploy more, low VIX = hold more cash.

| VIX | Sentiment | Cash Target | Invested |
|-----|-----------|-------------|---------|
| ≤12 | Extreme Greed | 40–50% | 50–60% |
| 12–15 | Greed | 30–40% | 60–70% |
| 15–20 | Slight Fear | 20–25% | 75–80% |
| 20–25 | Fear | 10–15% | 85–90% |
| 25–30 | Very Fearful | 5–10% | 90–95% |
| ≥30 | Extreme Fear | 0–5% + new cash | 95–100% |

15–25 VIX is the sweet spot (score 5). ≥30 VIX is opportunity, not pure risk-off (score 3, not 1).

**Intentional exceptions** (hardcoded hex is correct, do not replace):
- `TYPE_COLORS` in `src/lib/constants.js` — CSP/CC/LEAPS/Spread/Shares badge colors
- `MOODS` in `journalConstants.js` — mood-specific activeBg/activeBorder per mood
- `JOURNAL_ENTRY_TYPES` in `journalConstants.js` — type-specific activeColor/activeBg per entry type
- Monthly target progress bar colors in `JournalEntryCard.jsx` — semantic data values tied to target labels
- `BB_COLORS` / `SCORE_BG_COLORS` in `src/components/RadarTab.jsx` — semantic-data maps for Bollinger-Band buckets and score buckets (same role as TYPE_COLORS)
