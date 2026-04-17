# Dashboard Redesign — Design Spec

**Date:** 2026-04-16
**Status:** Approved — ready for implementation plan
**Revisions:** 2026-04-16 — added journal palette pins, confirmed Review sub-nav, Supabase schema in scope, resolved Gemini macro placement, confirmed Layer 1 feature safety
**Design base:** Linear (primary) + Warp (monospace/terminal DNA accents)

---

## Summary

Redesign the trading dashboard from an organically-grown 7-tab layout into a three-mode workspace (**Focus / Explore / Review**) with a persistent Tier-1 header that stays visible across every mode. Replace the current tab-scoped AccountBar with a command-center header showing only signals that drive daily action. Promote the alerts-style Focus view into the home experience, re-architected as a **positions-first list with proximity-to-trigger indicators** so the trader can pre-empt alerts, not just react to them.

## Goals

- Eliminate the "7 tabs grew organically" feel. Align the app to the three ways it's actually used: decide-today, drill-down, reflect.
- Make command-center usage (primary) distinct from reporting (secondary) and journaling (tertiary) through different layout densities per mode — not identical single-column treatment for all three.
- Make the mobile walking use case first-class. Opening the phone mid-walk should surface "what changed and what's about to trigger" within 2 seconds, no navigation required.
- Preserve the power-user terminal identity (monospace, dense, dark) while adding institutional-grade authority (Linear-style precision).
- Never bury Free Cash %, P1 alerts, or MTD Premium behind more than one tap/click.

## Non-goals

- No day-trading-grade real-time features (ticker tape quotes, blinking price changes).
- No ambient dollar P&L emphasis (explicitly deprioritized in strategy doc — process > outcome).
- No new data sources or analytics. Every number shown already exists in the current app.
- No backwards-compat mode. This is a solo tool with one user — we replace, we don't fork.

## Use cases (priority-ordered)

1. **"Do I need to do anything today?"** — P1/P2/P3 alerts, positions approaching trigger thresholds
2. **"Am I within my cash targets?"** — Free cash % vs VIX-band floor/ceiling
3. **"What's expiring soon and what do I do about it?"** — Positions sorted by % DTE left
4. **"Is there a roll opportunity on my below-cost positions?"** — Inline roll analysis
5. **"What price does X need to hit for 60% profit by Friday?"** — Per-position target tracking
6. **"What's the macro environment telling me?"** — VIX posture, macro score
7. **"What new CSPs should I be looking at?"** — Radar
8. **"How am I tracking against my income goal?"** — MTD premium vs baseline / stretch

**Mobile walking use case:** ~80% command-center (items 1–3), ~15% reporting (item 8), ~5% journaling. Design should optimize for that ratio.

## Information architecture

### Before → After

| Today (7 tabs)    | After (3 modes) |
|-------------------|-----------------|
| Open Positions    | Focus (home)    |
| Focus             | Focus (home)    |
| Radar             | Explore         |
| Monthly Calendar  | Review          |
| YTD Summary       | Review          |
| Journal           | Review          |
| Macro             | Explore         |

### Mode definitions

- **Focus** (home, default landing) — Answers "do I need to do anything today?" Positions-first list with alert state and proximity indicators inline. Non-position P1s (cash below floor, macro posture shift) surface as a thin banner above the list.
- **Explore** — Drill-down destinations used when something in Focus prompts deeper inspection. Contains: Positions detail view (the current Open Positions columns), Radar scanner, Macro posture detail.
- **Review** — Reporting and reflection. Contains: Monthly Calendar, YTD Summary, Journal.

### Persistent header (always visible across all three modes)

Five slots, left to right:

1. **Free Cash deployment gauge** — % with VIX-band target overlay, dollar amount to reach floor, amber when below floor, green when within band.
2. **VIX** — level + 5-day trend direction + posture pill (Extreme Greed / Greed / Slight Fear / Fear / Very Fearful / Extreme Fear — per VIX-band framework).
3. **P1 alert count** — pulsing red pill when > 0. Tap/click jumps to Focus mode. Secondary text shows P2 count.
4. **MTD Premium** — progress bar toward $15k baseline; text shows baseline progress + pipeline estimate.
5. **⌘K** — command palette trigger (desktop only; mobile shows a search icon in the header's top-row).

**Not in the header (deliberate):**
- No ticker quotes (SPY / QQQ / VIX level as a real-time tape). This is not a day-trading app.
- No absolute dollar P&L ("+$412 today"). Strategy doc explicitly deprioritizes this.

## Focus view (the primary design change)

Focus is a single scrollable list where every row is a position. Alerts are expressed as colored left strips and inline tags on the position they relate to — not as a separate section above the list.

### Row anatomy

- **Left:** ticker + alert tags (ITM, ROLL→$X, 60/60, ER, etc.) + metadata line (strike · DTE · % DTE left)
- **Right:** G/L% (since position open) + today's delta (▲/▼ pp since market open) + proximity-to-target indicator

### Proximity-to-target

Every row shows current G/L% vs the **live target** for that position (target is dynamic based on % DTE left per the 60/60 framework):

- `> 80% DTE left` → target 50%
- `41–79% DTE left` → target 60%
- `≤ 40% DTE left` → target 80%

Visual: `54/80` numeric + small progress bar. This is the preemptive signal — trader can see "FTNT is 74% of the way to 60% target" and anticipate when alerts will fire.

### Sort order

1. P1 positions (red left-strip)
2. P2 positions (amber left-strip)
3. Positions approaching target (≥70% of the way there)
4. Remaining positions, sorted by % DTE left (closest to expiry first)

### Non-position alerts

Alerts not tied to a specific position (Free cash below floor, macro posture change, P1 cash floor violation) surface as a **thin banner above the position list**. Dismissible or linkable to the relevant detail view. Does not dominate the screen.

### Macro insights in Focus

The persistent header's VIX posture pill (Greed / Slight Fear / Fear / etc.) is the condensed, always-visible macro signal. The full Gemini-generated macro summary stays in Explore → Macro.

When the Gemini pipeline detects a **posture shift** (e.g. Neutral → Defensive) or surfaces an **action-oriented insight**, a P3 card appears in Focus below the P1/P2 banners and above the position list:

> **Macro posture shifted: Constructive → Neutral** — review new-position sizing. Tap to read full summary in Explore.

Focus does not render full Gemini narrative paragraphs. If the user wants that, they go to Explore → Macro.

### Filter chips

The existing Open Positions type filters (CSPs · CCs · LEAPs) carry forward as chips at the top of the Focus list. Preserves muscle memory.

### Push notification interplay

Push notifications handle acute P1 alerts (user is already interrupted when they fire). Therefore, on the Focus screen, the P1 count pill in the header is a *confirmation*, not a *discovery mechanism*. The visual weight in the position list goes to **proximity bars** (what's heading toward a trigger) rather than alert tags (what already fired).

## Explore view

Chip-card launcher at the top (Positions / Radar / Macro) with current counts or status. Tapping a chip opens the corresponding detail view within Explore. Maintains current functionality of Open Positions, Radar, and Macro tabs — this mode is mostly regrouping, not rebuilding.

On desktop, Explore can render as a three-panel split (left: chip nav, center: detail, right: contextual metadata). On mobile, chips are horizontal scroll; tap to replace the body with the selected detail view.

## Review view

Single-column layout, wider prose width than Focus/Explore. Calmer density. No persistent sidebar — the content itself is the focus of this mode.

**Sub-navigation:** three chips/tabs within Review — **Monthly · YTD · Journal**. Single long-scroll is rejected; each sub-view has its own scroll context. Default sub-view on entering Review = Monthly.

## Desktop vs mobile

### Desktop

- Persistent header (full 5-slot strip)
- Mode switcher as underlined tabs directly below header
- Focus renders with a two-column body: position list (left, wider) + contextual right panel (selected position detail, or the "non-position alerts" summary)
- ⌘K command palette
- Press `F` on any panel to enter focus mode (full-screen that panel until Esc)

### Mobile

- Compact header (~80px): 3 slots — Free Cash gauge, VIX + posture pill, P1 count. Trend arrow, MTD bar, ⌘K dropped from header (MTD appears at footer of Focus list; search icon in header top-row replaces ⌘K).
- Bottom tab bar for thumb reach: Focus · Explore · Review. P1 badge on Focus mirrors the header.
- Focus renders as a single-column scrollable list. Row layout compressed but retains ticker, alert tags, G/L%, delta, and proximity bar.
- Explore is a launcher: horizontally-scrollable chip cards at top, tapped chip loads that detail view below.

## Visual direction

Base **Linear** DESIGN.md as the source of truth for:
- Typography scale and hierarchy
- Spacing system
- Surface/elevation tokens
- Subtle dark palette

Borrow from **Warp** for:
- Monospace-forward numeric display (already the app's aesthetic — keep it)
- Terminal-chrome feel in the header strip (subtle inner gradients, sharp dividers)

Borrow from **Coinbase/Kraken** for:
- Signed-value semantic color (green up, red down, amber warning) — but applied restrained, not everywhere
- Price/percentage weighting (numbers are the content; labels recede)

**Preserve from current app:**
- Inline `style={{}}` pattern with `theme.js` tokens
- Monospace font stack
- VIX-band color semantics (per CLAUDE.md)
- Existing intentional hardcoded-color exceptions (`TYPE_COLORS`, `MOODS`, `BB_COLORS`, etc.)

Write a `DESIGN.md` at project root as the consolidated brief (Linear base + these project-specific overlays). This becomes the source of truth for future UI work.

## Implementation sequencing

Ship in additive layers so each PR is independently valuable. If work stops after any layer, the app is still better than before.

1. **Layer 1 — Mode consolidation + persistent header** (the B-layout layer): collapse 7 tabs into 3 modes; build the persistent Tier-1 header; keep Focus/Explore/Review sub-content functionally identical to current tabs on first pass.
2. **Layer 2 — Positions-first Focus view**: replace the current Focus tab content with the positions-first list, proximity-to-target indicators, alert tags inline.
3. **Layer 3 — Command palette (⌘K)**: jump to any ticker, position, journal entry, macro widget. **Pinned at the top of the palette (not buried in search results):**
   - `New EOD journal entry`
   - `Open journal`
   - Other high-frequency actions to be decided during planning (e.g. "Run Radar scan", "Open Macro summary")

   Pinned items render above the search divider and are keyboard-accessible without typing.
4. **Layer 4 — Focus mode (`F` keybind)**: full-screen any panel.
5. **Layer 5 — Visual polish pass**: apply DESIGN.md tokens comprehensively (typography, spacing, surfaces), update remaining views to match.

Each layer is its own PR. Each ships to main. Version bumps per project conventions.

## In scope (explicitly)

- **Supabase schema changes** are permitted if a new feature (palette pins, saved Focus state, dismissed-banner tracking) benefits from persistence. Don't let the schema be a blocker — migrate as needed.

## Out of scope for this spec

- Real-time WebSocket price streaming
- Any net-new analytics or computed fields beyond simple derivations of existing data (e.g. proximity-to-target = G/L% / dynamic-target-from-%-DTE-left — OK; new Greeks model — not OK)
- Changes to the Google Sheets sync / integration
- Mobile PWA install / native app wrapping
- Additional keyboard shortcuts beyond `⌘K` and `F`

## Open questions (decide during planning, with guidance)

- **Command palette scope for Layer 3** — minimum for first ship: pinned actions (New EOD entry, Open journal) + position search + ticker search. Defer journal-entry body search and macro-widget jumps to a follow-up if complexity warrants.
- **Focus view right panel default on desktop** — user wants to see it in-flesh before deciding. Ship Layer 2 with panel empty until a position is clicked; revisit after live use.

## Layer 1 feature-safety confirmation

Confirmed via code inspection (2026-04-16): Layer 1 touches only the app shell (`App.jsx` tab container → mode container) and replaces `AccountBar.jsx` with a `PersistentHeader` component consuming the same data hooks. The following remain untouched and continue to function:

- `src/lib/focusEngine.js` — P1/P2/P3 alert logic
- `src/hooks/useRollAnalysis.js` — roll analysis computation
- `src/components/radar/RadarPresetBar.jsx` + Supabase preset persistence
- Gemini macro pipeline
- All tab component internals — they get rehomed into modes, not rebuilt
- `src/lib/constants.js`, `theme.js`, `blackScholes.js`

Layer 1 is a pure shell-reorganization. No feature can break.
