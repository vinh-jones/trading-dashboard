# Unusual Whales Signal Integration — Design Spec

**Date:** 2026-06-20
**Status:** Brainstorm w/ Vinh — design-only, gated on UW API subscription (not yet purchased)
**Builds on:** Redeploy signal (v1.133.0, `src/lib/redeploySignal.js`), hold-yield signal, cushion/assignment system

## Problem

The redeploy and hold-yield signals are **trend-blind** — they reason from premium captured, time elapsed, and the current mark, but have no view on *where a ticker is heading next*. Jefferson's framing (close early when % gain beats DTE, **unless** big money is piling into the ticker) is the missing forward-looking dimension. More broadly, the wheel's two biggest P&L levers — **entry timing** and **assignment avoidance** — are currently driven by raw IV and price cushion alone.

A single Unusual Whales API subscription (**API Basic, $125/mo standalone** — or the **$165/mo Whale Bundle Basic** if the UW Retail Pro dashboard is also wanted) is only justified if it feeds **multiple** decisions, not just one flow overlay. This spec scopes four consumers riding one shared backbone, sequenced so the cheapest/highest-confidence ships first and the spend de-risks itself.

## Cost justification

YTD premium ≈ **$94k** across positions running **$28k+** collateral each. At **$1,500/yr** (API Basic), UW pays for itself if it improves outcomes by **<2% of premium**, prevents **one bad assignment**, or frees idle collateral a few days sooner across the book. Low bar — but only if wired into decisions, not just displayed.

## Decisions (settled in brainstorm)

| Question | Decision |
|---|---|
| Provider | Unusual Whales (buys the classification; UW's tape already trusted) over Polygon raw-tape build |
| Refresh cadence | Intraday (piggyback `intraday-snapshot`); heavier smoothing to tame intraday flow noise |
| Signal purity | UW data **never** mutates the redeploy ratio. It overlays as a separate veto/confirm layer |
| Build order | IV-rank/structural entries → Assignment defense → GEX → Whale CSP flow → Flow-conviction veto (ROI ÷ effort; noisiest last) |
| Scope of tickers | Open-position + watchlist names only (not full market) — keeps API volume + cost down |
| Already-owned data | `earnings_date` and raw IV already live in `quotes`; do **not** re-source from UW |

## Architecture — the shared backbone (build once)

All four consumers read from one pipeline that mirrors the existing quotes flow (`snapshot job → Supabase → frontend hook`).

- **`api/_lib/uwClient.js`** — UW REST adapter: auth, rate-limit/backoff, per-ticker fetch. Pure fetch+shape, no business logic.
- **Ingestion** — extend `api/intraday-snapshot.js` (and `eod-snapshot.js` for slower fields like short interest) to call the adapter for each tracked ticker and upsert.
- **Tables (Supabase):**
  - `uw_signals` — one row per ticker per refresh: `ticker, iv_rank, net_premium, net_premium_norm, dark_pool_notional, short_interest_pct, flow_sentiment, refreshed_at`
  - `uw_gex` — strike-level: `ticker, expiry, strike, gamma_notional, is_call, refreshed_at` (+ derived `max_pain`)
- **`useUwSignals` hook** — frontend reader keyed by ticker, same shape/ergonomics as `useQuotes`.
- **Pure signal libs** in `src/lib/` per consumer (testable, no I/O), exactly like `redeploySignal`/`holdYield`.

> Stub-first: tables + hook land empty so the app compiles and renders gracefully (null = "no signal") **before** the key exists. Wiring the adapter is then a localized change.

## Consumer 1 — Entry timing: IV rank (1a) + Ryan's structural gate (1b)  *(ship first)*

**Why first:** smallest surface area, proves the pipeline end-to-end, pays off immediately. Entry richness is judged by **two co-equal lenses** — the strongest entry is when they agree:

- **1a — IV rank** (`iv_rank`, IV percentile vs the ticker's own trailing year): the statistical "is premium actually rich" measure. Band helper (<30 cheap / 30–60 fair / >60 rich). Vinh weights this heavily even though Ryan doesn't use it — it is **not** subordinate to 1b.
- **1b — Ryan's structural gate:** lower-Bollinger-Band proximity + the 2%-on-30Δ/30d rule + contrarian "sell into fear" (VIX / UW fear gauge).
- **Surfaces:** Radar scoring + CSP selection calculator show **both** IV rank and the structural read per candidate; cash-target framework (CLAUDE.md VIX table) uses per-ticker IV rank to contextualize the contrarian posture beyond the single market VIX number.
- **Decision impact:** "should I sell premium on *this name* right now" — highest conviction when statistical richness (1a) and structure (1b) line up.

## Consumer 2 — Assignment defense

**Why second:** mostly flags on existing rows; high value, low build. UW's unique contribution is narrow (earnings dates already owned).

- **Data:** `short_interest_pct`, bearish-flow flag (from `net_premium`/`flow_sentiment`), catalyst calendar. Earnings-before-expiry uses existing `quotes.earnings_date`.
- **Lib:** `assignmentRisk.js` — combine cushion state (existing) + earnings-before-expiry + unusual put buying + short interest into an escalation level.
- **Surfaces:** Open Positions row flags / cushion panel — an *early-warning* layer that fires before a price-based cushion breach.
- **Decision impact:** close/roll a CSP before a foreseeable gap.

## Consumer 3 — GEX / strike walls

**Why third:** strike-level data + richer UI; the entry-quality multiplier.

- **Data:** `uw_gex` (per-strike dealer gamma), derived put-gamma walls + max pain.
- **Lib:** `gexLevels.js` — reduce strike-level gamma to nearest support wall + max-pain price per ticker/expiry.
- **Surfaces:** Radar / CSP strike picker — annotate strikes sitting below a put-gamma wall; show expiry-week max-pain vs your strike.
- **Decision impact:** strike placement + expiry pin-risk awareness.

## Consumer 4 — Flow conviction veto  *(ship last)*

**Why last:** most data sources, noisiest, needs the others validated first. By now the backbone is mature.

- **Data:** `net_premium_norm` (normalized, smoothed), `dark_pool_notional`, insider/congress buys, analyst changes.
- **Lib:** `trendOverlay.js` — combine sources into `bullish / neutral / bearish` conviction; pure function `trendOverlay(redeployRatio, conviction) → recommendation`.
- **Overlay logic (CSP-aware):**
  - bullish inflow + redeploy-signal → **downgrade to "let it ride"** (don't churn into strength)
  - bearish outflow + hold-signal → **escalate to "close / shed"** (flow leads price)
  - neutral → ratio stands as-is
- **Surfaces:** modulates the existing redeploy chip + hold-yield veto. The pure `redeploySignal` ratio is untouched.
- **Decision impact:** the original hold-vs-redeploy directional veto, triangulated rather than single-source.

## Consumer 5 — Whale CSP flow (entry ideas + confirmation)

**What:** Ryan's actual daily driver — a live, watchlist-scoped list of institutions **selling puts**, used both to surface CSP entry ideas and to confirm a strike you're eyeing. It's the aggregated *list* view of the same put-selling flow Consumer 4 ingests, so it's largely free once that feed exists — and it's *simpler* than the veto (a filtered, ranked list; no conviction-scoring or overlay logic), so it **ships ahead of the Consumer 4 veto**.

- **Data:** institutional put-sell prints — **bid-side, puts only, stocks only, ≥$50k premium, DTE 7–65, sweeps+crosses+normal (hide floor)** — the exact filter from Ryan's "CSP whale flow" screen. Same flow feed as Consumer 4.
- **Lib:** `whaleCspFlow.js` — group raw prints into per-ticker whale put-sell rows; rank by premium, recency, and **repeat count** (repeat > one-off). Annotate each against data we already have: strike vs current price / lower Bollinger Band, and whether it aligns with an open position or a watchlist name.
- **Surfaces:** a dedicated list (Radar-tab section or its own panel) — ticker · strike · DTE · premium · sweep type · strike-vs-BB · "aligns with your CSP?" Sortable, watchlist-scoped.
- **Decision impact:** "where are whales selling puts right now → candidate entries, and is the strike I'm considering being validated by institutional size at/near it?" Idea **generation**, not just per-position veto.

## Ryan's playbook — extracted parameters (from UW course transcripts)

Source: Ryan's 5 UW lectures (his workflow, not ours). UW is **confirmation only** — the OTU checklist supersedes it (upward-trending chart 1.5yr, positive P/E, **30Δ/30-day put paying ≥2%**, consecutive earnings beats). These pin our signal definitions and default thresholds to his actual numbers:

- **Consumer 1 (entries):** Ryan's richness gate is **lower-Bollinger-Band + the 2%-on-30Δ/30d rule + contrarian "sell into fear" (VIX/UW fear gauge)** — *not* IV rank. Per Vinh, run these as **co-equal lenses**: IV rank = "1a" (statistical richness), Ryan's structural gate = "1b". Surface both; a strong entry is when they agree.
- **Consumer 2 (assignment defense):** add an **earnings expected-move overlay** — market-maker expected move vs actual move over the last 4 quarters + directional skew; flag CSPs whose strike sits **inside** the expected move before an earnings-before-expiry event. Add **insider transactions with the 10b5-1 scheduled-vs-unscheduled flag** (an unscheduled insider *sell* is a real risk signal; scheduled is noise).
- **Consumer 3 (GEX):** classify each ticker's environment from the **net OI gamma sign** — positive = MM-stabilized (CSP-friendly), negative = choppy/fast (caution). Surface nearest **positive-gamma bar above = resistance** and **negative-gamma bar below = support/acceleration** for strike placement. Default posture: sell CSPs in positive-gamma names.
- **Consumer 4 (flow):** the primary CSP confirmation is **institutional put-selling flow**, not generic net premium — filter: **bid-side, puts only, stocks only, ≥$50k premium, DTE 7–65, sweeps+crosses+normal (hide floor)**. Bullish when whales are selling puts at/near your strike. Reinforce with per-ticker **put/call ratio (<1 bullish)**. Require **repeat activity, not one-offs** → this IS the smoothing window. Market-wide posture (ties to the VIX cash-target framework): **market tide** net call vs put premium + fear gauge; index sentiment filter is **SPY/QQQ, bid+ask, calls+puts, ETFs only, ≥$250k premium, DTE 1–30**.
- **Whale CSP flow → promoted to Consumer 5:** Ryan's actual daily driver (a watchlist list of whales selling puts) is now a first-class surface — see Consumer 5. Its filter params are the Consumer 4 flow params above.
- **Conviction layer (Consumer 2/4):** 13F institutional-ownership trend (are the big banks *adding* near the lows?) — quarterly/lagged, long-horizon conviction only.

**API coverage — verified in API Basic** (UW official MCP catalog + REST docs): options flow with **side (bid/ask) + premium + sweep/cross classification**, **market tide** (`GET /api/market/market-tide`, also `market_tide_v3`), **earnings — schedules + historical earnings w/ IV & expected moves**, **greek exposure**, **IV rank**, **short interest**, **insider transactions**, **13F institutional ownership**. The *only* endpoint flagged premium-gated is the **Politicians/portfolios** dataset (not load-bearing for any consumer). **No tier upgrade required.**

## Build sequence

| Phase | Deliverable | Gates on |
|---|---|---|
| 0 | Backbone: adapter, tables, `useUwSignals`, stubs | UW key |
| 1 | Consumer 1 — IV-rank + structural entries | Phase 0 |
| 2 | Consumer 2 — Assignment defense | Phase 0 (+ existing earnings) |
| 3 | Consumer 3 — GEX strike walls | Phase 0 |
| 4 | Consumer 5 — Whale CSP flow list (+ shared put-selling-flow ingestion) | Phase 0 |
| 5 | Consumer 4 — Flow-conviction veto | Phase 4 ingestion + Phases 1–3 validated |

Whale CSP flow (Consumer 5) deliberately ships **before** the Consumer 4 veto: it reuses the same put-selling-flow ingestion but is a simple ranked list — high value, low complexity — whereas the veto adds the noisy triangulation/overlay logic that benefits from validating the other signals first. Each phase is independently shippable and independently abandonable — if IV-rank/structural entries (Phase 1) don't earn their keep once live, we've learned that cheaply before the heavy phases.

## Endpoint coverage — verified 2026-06-20

Confirmed against UW's **official MCP server README** (their own enumeration of the API surface). All four consumers' data exists in the REST API:

- **IV rank** ✅ (Consumer 1)
- **Short interest / FTDs / borrow rates** ✅ (Consumer 2)
- **Earnings — schedules + historical earnings w/ IV & expected moves** ✅ (Consumer 2)
- **Greek exposure — GEX/DEX/vanna by strike** ✅ (Consumer 3)
- **Market tide** (`GET /api/market/market-tide`) **+ options flow w/ side classification** ✅ (Consumer 4)
- **13F institutional ownership / insider transactions** ✅ (Consumers 2/4)

**Tier mapping (confirmed from UW pricing page):** API Basic **$125/mo** includes options order flow, stocks, **congressional & insider trades**, market data, and proprietary tools — i.e. **everything all four consumers need**. Basic excludes only the "Premium endpoints" (Forex, Commodities, Economic indicators, Digital currencies, Top movers, IPO calendar, Statistics, Extended fundamentals) — none of which we use. Advanced ($315/mo) adds only **websockets** (our REST polling doesn't need them) and 365- vs 180-day history. So **API Basic covers all four phases**, congress/insider enrichment included. Rate limits: **40,000 req/day, 120/min** — our polling (~3–9k/day across tracked names) is well under.

## Remaining questions / dependencies

- **Bundle vs standalone (purchasing only):** standalone API Basic ($125, 180-day history) for a pure pipe, or Whale Bundle Basic ($165, +Retail Pro dashboard + Predictions + $200 data-shop credits, 90-day history) if the UW web dashboard is also wanted. No impact on the integration itself.
- **Normalization basis:** net premium normalized by what — avg daily option premium volume? market cap? (per-ticker, so cross-name comparable).
- **Smoothing window:** sessions of look-back for the flow state to avoid intraday flicker.
- **ToS:** personal-dashboard use of derived UW data (no redistribution) — fine, but note it.
- **Build option:** UW ships an official MCP server; a backend REST adapter is still cleaner for a Supabase-writing snapshot job, but the MCP is a viable fallback.

## Risks

- **Flow attribution noise** — the reason flow ships last and never touches the ratio. Treat as qualitative veto only.
- **Cost creep** — if Basic lacks an endpoint, the jump is to a pricier tier; validate endpoint coverage before subscribing.
- **Over-display** — surfacing signals without wiring them into a decision adds clutter, not edge. Every phase must change a decision or it's cut.
