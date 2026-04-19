# Product Brief — Trading Dashboard Redesign

> First-pass fill based on repo inspection. Anything marked **[guess — confirm]**
> is Claude's inference and needs your review. Everything else is grounded in
> code/docs and should be mostly right.

---

## 1. The one-liner

A personal options-trading cockpit for the Wheel strategy (CSPs → assigned
shares → CCs, plus LEAPS) that surfaces the decision inputs Ryan actually uses
(VIX regime, Bollinger-Band position, IV Rank, earnings, macro events) and
tracks positions, journal entries, and monthly premium targets against
baseline/stretch goals.

## 2. Who uses it

- **Primary user:** You — solo discretionary options trader running the Wheel. **[guess — confirm]**
- **How often they use it:** Daily, with pre-market (before 9:30 ET) and post-close check-ins; Radar consulted intraday when opportunities appear. **[guess — confirm]**
- **Device mix:** Desktop-primary (dense, keyboard-driven UI; hotkeys F/E/R; Cmd+K palette). Mobile read-only glance would be nice-to-have. **[guess — confirm]**
- **Skill level:** Experienced discretionary trader following a defined framework (Ryan Hildreth's contrarian VIX-based deployment); not a beginner.

## 3. Jobs-to-be-done

**[all guesses — confirm/edit]**

1. When **I sit down pre-market**, I want to **see today's must-act items (P1 alerts, cash floor breaches, earnings within DTE)**, so I can **decide what to roll, close, or open before the bell**.
2. When **VIX or macro shifts**, I want to **see my current cash % vs. the VIX-band target**, so I can **rebalance deployment without second-guessing the framework**.
3. When **looking for a new CSP entry**, I want to **scan my watchlist by BB position + IV Rank**, so I can **find tickers below band with rich premium and no earnings landmine**.
4. When **closing out a trade**, I want to **log the outcome + mood in one click**, so I can **track discipline and monthly premium progress without breaking flow**.
5. When **reviewing the month**, I want to **see MTD capture vs. baseline ($15k) / stretch ($25k)** with **which tickers drove it**, so I can **adjust strategy for next month**.

## 4. What's working today

**[guess from code — confirm]**

- **VIX-based cash framework** is baked into alerts and contextual coloring — it's the spine of the app.
- **Focus → Explore → Review** (F/E/R) mental model is clean: act now / scan / reflect.
- **Radar scoring** (BB × IV composite) with color-coded strength buckets gives a fast "what's juicy right now" read.
- **Monthly calendar heatmap** with weekly rollups + pipeline panel against baseline/stretch is a strong recurring artifact.
- **Command palette** + hotkeys — dense, keyboard-first feel.
- **Ryan-voice macro summaries** — tone is distinctive, not generic.

## 5. What's broken / frustrating

**[needs your input — these are placeholders]**

- …
- …
- …

## 6. Trading strategy context

- **Core strategy:** The Wheel — sell CSPs on quality tickers, take assignment, sell CCs against shares, repeat. LEAPS as leveraged long-side exposure; vertical spreads occasionally.
- **Decision inputs (what the dashboard surfaces):**
  - **VIX level + 5-day trend** → cash-deployment posture (contrarian: high VIX = deploy more)
  - **Bollinger-Band position** (20-day, 2σ) → entry timing; below band = primary CSP signal
  - **IV Rank composite** (60% IVR + 40% min(IV/1.50, 1.0)) → is premium rich enough
  - **Earnings proximity** (Finnhub) → avoid selling puts into earnings; flag if earnings ≤ expiry
  - **Macro context** — S5FI breadth, CME FedWatch rate cuts, CNN Fear & Greed, SPY vs ATH
  - **Free cash %** vs. VIX-band floor → P1 trigger if below
- **Cadence:** Weekly to monthly option cycles; daily journal; monthly target review. **[guess — confirm]**
- **Risk framework:** VIX-band cash targets (see CLAUDE.md table — 0–50% cash inversely correlated with VIX). Monthly premium targets: baseline $15k, stretch $25k.
- **Reference docs already in repo:** `CLAUDE.md`, `DESIGN.md`, `FOCUS_RULES.md`, `RYAN_STYLE_GUIDE.md`, `FRIEND_SPEC.md`, and the SPIKE_*.md files for data-source rationale.

## 7. Information hierarchy

- **Tier 1 (always visible, persistent header):**
  - Free cash ($ + %)
  - MTD premium closed
  - Pipeline gross + expected-capture (default 60%)
  - Monthly progress bar (baseline / stretch)
  - P1 alert count badge
  - Cmd+K command palette trigger
- **Tier 2 (one click / one hotkey away):**
  - Focus pipeline (P1/P2/P3 alerts with reasons)
  - Open positions feed sorted by urgency
  - Radar scanner (ticker list w/ score, BB bucket, IV, earnings proximity)
  - Macro signal summary
  - Monthly calendar heatmap
- **Tier 3 (drill-down / on demand):**
  - Per-position trade history, rolls, notes
  - Per-ticker earnings detail + management templates
  - Per-day trade detail (from calendar cell)
  - YTD sortable trade table (kept %, days held, ROI, etc.)
  - Journal entries

## 8. Non-goals

**[guess — confirm]**

- Not a broker / order-entry tool — execution happens at the broker, this is decision support
- Not a backtester / strategy-research tool
- Not multi-user / shared / social
- Not a generic stock screener — the watchlist is curated, not the whole market
- Not a news reader — macro signals are numeric, not headline-based

## 9. Design constraints (already fixed — do not redesign these)

- Inline `style={{}}` only, no CSS files or Tailwind
- Theme tokens from `src/lib/theme.js` — never hardcode hex (see CLAUDE.md for the narrow list of intentional exceptions)
- Font-size scale: `xs/sm/md/lg/xl/xxl` (10/12/14/16/18/28px) — no in-betweens
- Spacing: 4-point grid via `theme.space[1..6]` (4/8/12/16/20/24px)
- Radius: `sm/md/pill` (4/8/20px)
- Monospace font stack (`theme.font.mono`) — terminal-dense aesthetic is part of the identity
- Market-hours / DTE / expiry logic in `America/New_York`
- User-facing timestamps in browser-local (no hardcoded TZ)
- React 18 + Vite, Supabase optional backend, no external chart library

## 10. Redesign scope

**[needs your input — check what applies]**

- [ ] Full visual refresh (colors, type, spacing within existing token system)
- [ ] Information architecture (tab structure, nav)
- [ ] Specific screens only: _list them_
- [ ] Add new surfaces / views
- [ ] Mobile layout (read-only glance view?)

## 11. Success criteria

**[needs your input — these are placeholders to spark ideas]**

- Pre-market scan time drops from **X → Y** (pipeline + radar digestible in under 2 min)
- Zero "where is that?" friction — every P1 action reachable in ≤1 click from Focus
- Monthly capture visibility improves — baseline/stretch status readable at a glance without drilling

## 12. Inspirations / anti-inspirations

**[needs your input]**

- **Feels like:** …
- **Does NOT feel like:** …

---

## Attachments to include when handing to Claude

1. This filled-in brief
2. Screenshots of every current tab (Focus, Radar, Macro, Monthly, YTD, Journal) — desktop + mobile if relevant, labeled
3. One "happy path" screen recording (optional, 30–60s)
4. Links to `CLAUDE.md`, `DESIGN.md`, `RYAN_STYLE_GUIDE.md`, `FOCUS_RULES.md`, `FRIEND_SPEC.md`
