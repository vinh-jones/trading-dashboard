# AI Thesis page — design & build record

**Date:** 2026-06-05
**Status:** Implemented (v1.122.0)
**Source spec:** SPEC_AI_THESIS_PAGE_V2.md (external)

## What it is

A new read-only **"AI Thesis"** tab in Explore mode. Groups the 55-name approved wheel
universe into AI-infrastructure "chokepoint" baskets (aibottlenecks.app taxonomy) and
answers: *which AI-infra baskets am I in, how much, how are they moving, where am I not
exposed?*

- **Summary strip:** on-thesis exposure, off-thesis exposure, cash, NAV, baskets active.
- **10 on-thesis cards:** each lists its tickers with Day %, IV rank, BB position; rows
  carry a Day%-scaled green/red heat tint (the "hybrid" visual direction).
- **5 off-thesis baskets:** feed exposure math only, no card.

## Data sources (no new endpoints / tables / cron)

- `useRadar()` → per-ticker `last`, `prev_close`, `iv_rank`, `bb_position`. Day % is
  `(last − prev_close) / prev_close`, computed client-side. `prev_close` was already in
  the hook — no pipeline change needed.
- `positions` / `account` props (from `useData()`, same as RadarTab) → exposure, held
  detection, NAV (`account_value`), cash (`account_value × free_cash_pct_est`).

## Reuse (no reimplementation)

- **BB bucketing/colors** extracted to `src/lib/bbBucket.js` (`bbBucket`,
  `BB_BUCKET_LABELS`, `BB_BUCKET_COLORS`) — shared by RadarTab and AIThesisTab so both
  classify/color BB identically. RadarTab now imports them.
- **Per-ticker exposure** extracted to `src/lib/exposure.js` (`tickerExposure`) — shared;
  RadarTab's `concentrationCheck` routes through it. Definition: assigned-shares
  `cost_basis_total` + Σ CSP `capital_fronted` + Σ LEAP `entry_cost` (CCs = 0).
- Position access via `positionSchema` helpers. All styling via `theme` tokens
  (Day% tints derive from `theme.green`/`theme.red` via `hexToRgba`; only the shared
  `BB_BUCKET_COLORS` map is hardcoded hex — an existing intentional exception).

## Deviation from V2 spec

V2 asked for a per-position **P&L "pos avg"** chip and P&L-signed left borders. The
`positions` object from `useData()` does **not** carry per-position `profit_pct` — the
Positions tab computes P&L live from option marks (`computeHoldYield`/`useQuotes`).
Reproducing that here would mean importing the whole option-mark P&L engine. Instead the
card's momentum signal and left-border color use **basket average Day %** (real
`prev_close` data), which matches the "how are they moving" framing. Held vs. not-held
still drives boldness and the neutral-border state. True position-P&L pos-avg can be a
follow-up if wanted.

## Maintenance guard

`src/config/__tests__/aiBaskets.test.js` asserts the union of basket tickers equals the
approved universe (`APPROVED_UNIVERSE` contract, migration-024) with no duplicates — so a
future universe change can't silently drop a name from the exposure math. When Ryan
changes the approved list, update the migration, `APPROVED_UNIVERSE`, and `aiBaskets.js`
together.

## Verification

`npm test` (451 pass, incl. drift guard + nav registration) and `npm run build` (clean,
AIThesisTab bundled, RadarTab compiles post-extraction). Not browser-verified: local dev
doesn't serve `api/*`, so positions/exposure can't render locally — the documented
constraint for API-driven panels.
