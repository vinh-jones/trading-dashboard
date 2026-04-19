# Product Brief — Trading Dashboard

> Updated 2026-04-19 after Layers 1–7 of the redesign shipped. This brief
> reflects the app as it exists today (v1.52.x) plus the user context learned
> while building it.

---

## 1. The one-liner

A personal options-trading cockpit for the Wheel strategy (CSPs → assigned
shares → CCs, plus LEAPS) that surfaces the decision inputs Vinh actually uses
(VIX regime, Bollinger-Band position, IV Rank, earnings, macro events) and
tracks positions, journal entries, and monthly premium targets against
baseline/stretch goals. Terminal-dense aesthetic, keyboard-driven, designed
for daily use and occasional mobile walking-use.

## 2. Who uses it

- **Primary user:** Vinh. Solo discretionary options trader running the Wheel. Pacific-time; markets watched on ET.
- **How often:** Daily. Two natural check-ins — pre-market scan (before 9:30 ET) and end-of-day logging (after 4:00 ET). Intraday visits happen mid-day or whenever VIX or a position alert prompts it.
- **Use-case split (~80/20):** Desktop as the command center for active decisions (~4 out of 5 visits). Mobile as a walking-use glance to pre-empt push-notification alerts (~1 out of 5 visits) — smaller, read-mostly, designed for "do I need to care right now?"
- **Skill level:** Experienced discretionary trader following a defined framework (Ryan Hildreth's contrarian VIX-based deployment). Not a beginner; not an algorithmic / high-frequency trader either.

## 3. Jobs-to-be-done

1. When **I open the app in the morning**, I want to **see today's must-act items (P1 alerts, cash floor breaches, earnings within DTE, positions approaching proximity targets)**, so I can **decide what to roll, close, or open before the bell**.
2. When **VIX or macro shifts**, I want to **see my current cash % vs. the VIX-band target and the macro posture signal**, so I can **rebalance deployment without second-guessing the framework**.
3. When **I've decided to deploy capital**, I want to **scan my approved ticker universe by BB position + IV Rank + concentration status**, so I can **pick a ticker with a favorable technical setup that doesn't breach my 10%/15% position limits**. The "what CSP would look like today" sample (strike / premium / RoR / collateral at ~30DTE / ~30δ) should be visible inline so I don't have to flip to the broker to do the math.
4. When **closing out a trade or logging an EOD state**, I want to **log the outcome + mood with minimal friction** (quick-add bar at top of Journal, `N` hotkey to open it), so I can **track discipline and monthly premium progress without breaking flow**.
5. When **reviewing the month**, I want to **see MTD capture vs. baseline ($15k) / stretch ($25k)** with **which tickers drove it**, so I can **adjust strategy for next month**.
6. When **walking away from the desk during market hours**, I want to **pull up the app on my phone** and **get the "do I need to act" answer in under 5 seconds** without drilling.

## 4. What's working today (post Layers 1–7)

- **Three-mode IA (Focus / Explore / Review)** with `F` / `E` / `R` hotkeys. Focus is the home default and the "act now" surface. Clean mental model: act / scan / reflect.
- **Persistent Tier-1 header** always visible across all three modes — Free Cash gauge, VIX + posture + live trend, P1 alerts, MTD Premium + pipeline progress bar, ⌘K. This is the spine.
- **VIX-based cash framework** (contrarian band targets) drives alert priorities, Free Cash coloring, and narrative copy across Radar and Focus.
- **Positions-first Focus view** — every row is a position with inline alert tags + a live proximity-to-target indicator (G/L% vs. dynamic 50/60/80% target based on % DTE left). Lets the user pre-empt alerts rather than react to them. Non-position alerts (cash floor, macro posture shift) surface as a thin banner above.
- **Radar** — prescriptive narratives (not descriptive) tied to the user's framework: each BB + IV template now ends with a decision rule and next-check criteria, references VIX context, and runs a concentration check against 10% target / 15% hard ceiling. Capital sampling layer shows `$strike · $premium · RoR · $collateral` inline per ticker (30DTE / 30δ), hour-cached server-side.
- **Command palette (⌘K)** with pinned actions (Open Journal, New EOD entry, Open Radar, Open Macro) plus position search. Selecting a CC/LEAP/CSP routes to Open Positions with the type filter pre-applied and the matching row highlighted.
- **Journal redesign** — entries grouped by week with a left rail, day headers within each week, EOD Updates render as floor-status-accented day-anchor bands (green in-band / amber ceiling / red floor). Quick-add collapses from a right panel into a one-line bar at top that blooms on `N` or click. Meta row grouped as `Contract | Execution | Performance | Result`.
- **Monthly calendar heatmap** + weekly rollups + pipeline panel against baseline/stretch is the Review default.
- **Design system codified** — `DESIGN.md` at project root is the source of truth for tokens, patterns, and hardcode exceptions. Every surface passed a token audit (229 polish items applied in Layer 5).
- **Command-center mobile treatment** — persistent header adapts to ~80px compact strip with 3 slots on mobile; bottom tab bar for thumb reach.

## 5. What's broken / frustrating

Caught while building or noted for follow-up. Not blockers for v1.52, but worth surfacing in any further redesign brief:

- **Mobile week rail is heavy at 110px** when it stacks horizontally — it was accepted as a known rough edge in Layer 6. A mobile-specific treatment (inline week header instead of a stacked block) would tighten things up.
- **No journal body search** — the filter row covers type, ticker, and date range but not text. When looking for a past trade reasoning, you have to scroll.
- **No in-app keyboard navigation between entries** (j/k/e). Not in scope for any layer so far; occasionally missed.
- **Radar capital-sampling cold load takes ~5–7 seconds** on first visit after an hour (server-side fan-out to Public.com). Bearable but the user sees `—` in the new column until the fetch resolves.
- **Roll analysis is opt-in behind a button** — good for API cost, but the button can be missed by new sessions. No recent-run indicator other than the freshness line.
- **No "back to EOD band" affordance after expanding** — in the Journal, clicking an EOD band delegates to the rich expanded JournalEntryCard view; collapsing via the chevron returns to the plain collapsed-card state, not back to the band. Minor UX dead-end.
- **No broker link from Radar / Focus** — deliberate non-goal (execution stays in Public.com / Tastytrade), but means the hand-off from "I've decided" to "order placed" is manual.
- **Earnings filter is presence-of-badge only** — no way to include-only or exclude-before-N-days from the Radar controls. Currently requires visual scanning.

## 6. Trading strategy context

- **Core strategy:** The Wheel — sell CSPs on quality tickers, take assignment, sell CCs against shares, repeat. LEAPS as leveraged long-side exposure; vertical spreads occasionally.
- **CSP entry defaults:** ~30 DTE, ~30 delta strike, within a 21–45 DTE / 25–35δ tolerance window (these are the Radar capital-sample defaults).
- **Decision inputs (what the dashboard surfaces):**
  - **VIX level + 5-day trend + posture sentiment** → cash-deployment posture (contrarian: high VIX = deploy more)
  - **Bollinger-Band position** (20-day, 2σ) → entry timing; below band = primary CSP signal, near_lower = starter-size zone, mid-range = neutral, near/above upper = avoid new CSPs
  - **IV Rank composite** (60% IVR + 40% min(IV/1.50, 1.0)) → is premium rich enough. Tiers: Strong ≥0.70, Moderate ≥0.50, Weak <0.30. (Neutral visible on the row but collapsed into Moderate for template selection.)
  - **Earnings proximity** (Finnhub) → avoid selling puts into earnings; flag ticker if earnings ≤ 21 days
  - **Macro context** — S5FI breadth, CME FedWatch rate cuts, CNN Fear & Greed, SPY vs ATH, Treasury curve
  - **Free cash %** vs. VIX-band floor → P1 trigger if below
  - **Concentration %** per ticker vs. 10% target / 15% hard ceiling → prescriptive warning in Radar's expanded view
- **Position-exit framework (60/60 rule family):** dynamic profit target based on % DTE left — 50% profit target if >80% DTE left, 60% if 40–80%, 80% if ≤40%. Drives the proximity bar on Focus rows.
- **Cadence:** Weekly to monthly option cycles. Daily EOD journal entry. Monthly target review; 55% rule on monthly pace (if past 55% of month elapsed but below 55% of baseline, that's a yellow signal).
- **Risk framework:** VIX-band cash targets (CLAUDE.md table — 0–50% cash inversely correlated with VIX). Monthly premium targets: baseline $15k, stretch $25k. Per-ticker concentration 10% target / 15% ceiling.
- **Reference docs in repo:** `CLAUDE.md`, `DESIGN.md`, `FOCUS_RULES.md`, `RYAN_STYLE_GUIDE.md`, `FRIEND_SPEC.md`, `SPIKE_BB_FINDINGS.md`, `SPIKE_BB_COMPLETE.md`, `SPIKE_MACRO_FINDINGS.md`, `SPIKE_VIX_TREND_PUTCALL.md`. Design specs for each layer under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/`.

## 7. Information hierarchy

- **Tier 1 (always visible, persistent header):**
  - Free cash % + $ + VIX-band target + in/above/below-band status
  - VIX level + 5-day trend direction + posture sentiment pill (Extreme Greed … Extreme Fear)
  - P1 alert count (pulsing red pill when > 0)
  - MTD Premium — progress bar toward baseline + pipeline estimate
  - ⌘K command palette trigger (desktop; search icon on mobile)
- **Tier 2 (one click / one hotkey away):**
  - Focus positions feed sorted by P1 → P2 → proximity → DTE
  - Non-position alert banner (cash-floor, macro-posture shifts) above the list
  - Explore sub-views: Open Positions (with type filter), Radar scanner, Macro summary
  - Review sub-views: Journal (default), Monthly Calendar, YTD Summary
- **Tier 3 (drill-down / on demand):**
  - Per-position expanded view with live quote, proximity bar, target math
  - Per-ticker Radar expanded panel: VIX context line, BB section + prescriptive narrative, IV section + prescriptive narrative, concentration check, current positions, scanner score breakdown, valuation, earnings, 30-DTE sample subrow
  - Per-day trade detail (from Monthly calendar cell)
  - YTD sortable trade table (kept %, days held, ROI, etc.)
  - Journal entry expanded (inline edit, full EOD metadata view)
  - Command palette results (position jump, pinned actions)

## 8. Non-goals

- **Not a broker / order-entry tool** — execution happens at Public.com / Tastytrade. This is decision support.
- **Not a backtester / strategy-research tool** — no "how would this rule have performed" simulations.
- **Not multi-user / shared / social** — single-user app.
- **Not a generic stock screener** — the watchlist is a curated ~53-ticker universe, not the whole market.
- **Not a news reader** — macro signals are numeric (S5FI, VIX, rate cuts, fear/greed); headline ingestion is out of scope.
- **Not real-time / tick-level** — 15-min quote cache during market hours; 1-hour Radar sample cache. Good enough for wheel-cycle decisions, not day-trading.
- **No in-app chart rendering library** — allocation bars, progress bars, and calendar heatmap are all hand-rolled with inline styles; no Recharts / Victory / etc.

## 9. Design constraints (already fixed — do not redesign these)

- Inline `style={{}}` only; no CSS files or Tailwind.
- Theme tokens from `src/lib/theme.js`. Never hardcode hex outside the CLAUDE.md allowlist (TYPE_COLORS, MOODS, JOURNAL_ENTRY_TYPES, monthly-target progress bars, BB_BUCKET_COLORS, SCORE_ROW_BG, POSTURE_COLORS — all semantic-data maps).
- Design patterns + token reference live at `DESIGN.md` (project root) — Linear base + Warp terminal-chrome + Coinbase/Kraken restrained signed-value color.
- Font-size scale: `xs/sm/md/lg/xl/xxl` = 10/12/14/16/18/28px. No in-betweens. `xxl` is hero-only (VIX posture value).
- Spacing: 4-point grid via `theme.space[1..6]` = 4/8/12/16/20/24px.
- Radius: `sm/md/pill` = 4/8/20px.
- Monospace font stack (`theme.font.mono`) — terminal-dense aesthetic is part of the identity.
- Market-hours / DTE / expiry logic in `America/New_York`. User-facing timestamps in browser-local (no hardcoded TZ).
- React 18 + Vite, Supabase backend, Vercel serverless API routes, Public.com for quotes + option chains, no external chart library.
- Server-side API routes handle their own market-hours check via `api/_marketHours.js` (two named exports: `isMarketOpen` regular session, `isMarketOpenExtended` for cron warmup).

## 10. Redesign scope

Layers 1–7 shipped as of v1.52.x. What's next depends on the user's read after a few weeks of live use. Candidate threads flagged during the process:

- [ ] **Mobile-specific layout pass** — particularly week rail on Journal (heavy at 110px when stacked), and mobile Radar row density.
- [ ] **Journal body search** — keyword search within entry bodies + tag filtering refinements.
- [ ] **Per-entry keyboard nav** — j/k to cycle entries, `e` to edit, `Del` to delete.
- [ ] **Earnings filter controls on Radar** — toggle include/exclude earnings within N days as a filter, not just a badge.
- [ ] **Second pass on Radar narratives** if Claude Chat iterates on the template wording.
- [ ] **Pinned / starred entries in Journal** — stickies for "lessons learned" or "patterns to watch".
- [ ] **Alert customization** — P1/P2 thresholds exposed in a settings surface.
- [ ] **Historical sampling for Radar** — right now one row per ticker overwritten. Time-series sampling would enable "premium trend" visualizations if ever useful.

## 11. Success criteria

What Layers 1–7 already moved the needle on, and what further redesigns should aim at:

- **Pre-market scan time** — Focus + header already surface P1 alerts and cash-floor state in ≤ 2s of load. Further improvement: zero-scroll answer on mobile.
- **Capital-deployment decision speed** — Radar expanded view now shows "30DTE sample" inline, removing the need to tab to the broker for strike/premium math. Target: decide in < 30s from ticker click.
- **Journal logging friction** — `N` hotkey opens quick-add anywhere in the app. Target: EOD entry in < 45s from first keystroke to save.
- **"Where is that?" friction** — ⌘K palette routes to any position, journal entry, or major view. Target: every Tier-1/Tier-2 artifact reachable in ≤ 2 key presses.
- **Visual consistency** — DESIGN.md + audit pass applied across 8 surfaces. Target for follow-up: every new component introduced from here passes the same 5-question audit before shipping.

## 12. Inspirations / anti-inspirations

- **Feels like:**
  - **Linear** (primary) — typography scale, spacing rhythm, subtle surface elevation, precision.
  - **Warp** (accents) — monospace-forward numeric display, terminal-chrome strip in the header, sharp dividers.
  - **Coinbase / Kraken** (restrained) — signed-value semantic color (green up, red down, amber warning). Applied sparingly, not on every number.
  - **Bloomberg Terminal** — density without clutter; numbers are the content, labels recede.
- **Does NOT feel like:**
  - **Robinhood / Webull / consumer retail-broker UI** — no confetti, no "streak" gamification, no "Top Movers" feed. Zero dopamine-bait.
  - **TradingView** — no chart-first, no indicator-overlay experience. Charts are supporting artifacts here, not the center of gravity.
  - **Generic dashboard BI tool** — no "drag a widget" customization, no chart-picker modals, no configurable columns UI.
  - **Day-trading platforms** — no Level 2, no tick-by-tick, no blinking prices.

---

## Attachments to include when handing to Claude

1. This brief.
2. Screenshots of every current tab (Focus, Explore → Positions / Radar / Macro, Review → Journal / Monthly / YTD) — desktop + mobile, labeled.
3. Optional: a 30–60s screen recording of a happy-path pre-market scan (Focus → Radar → close/roll decision).
4. Links to:
   - `CLAUDE.md` (user-specific collaboration rules + token conventions)
   - `DESIGN.md` (visual brief, token reference, component patterns, allowlist)
   - `RYAN_STYLE_GUIDE.md` (narrative voice for macro + radar summaries)
   - `FOCUS_RULES.md` (P1/P2/P3 alert logic)
   - `FRIEND_SPEC.md` (peer-review voice for Claude Chat hand-offs)
   - Layer specs: `docs/superpowers/specs/2026-04-16-dashboard-redesign-design.md` and the seven layer-specific specs
   - Layer plans: `docs/superpowers/plans/` (one per layer)
5. For any redesign brief targeting a specific surface, include the relevant audit file from `docs/superpowers/audits/2026-04-16-layer-5/`.
