# CSP Selection Calculator — Design Spec

**Date:** 2026-06-11
**Status:** Approved (brainstorm w/ Vinh, visual companion session)
**Scope:** v1 calculator only. Cohort persistence is the explicit next step and informs the data shapes here, but ships separately.

## Problem

On the Open Positions → CSPs tab, Vinh mentally sums collateral, premium, and gains across subsets of positions to answer questions like "how much capital is sunk on the Jun 26 expiry?" or "what would freeing up these three positions give me to redeploy?" The dashboard should do that math: click rows to build a selection, see live aggregates.

## Decisions (settled in brainstorm)

| Question | Decision |
|---|---|
| Position types | CSPs only |
| Selection gesture | Row click toggles select; expand moves to direct chevron click |
| Quick-select | Clicking an expiry date cell toggles all rows of that expiry |
| Aggregate display | Sticky bar fixed to bottom of viewport |
| Mobile bar | Two-line layout: count + clear, then 2×2 stat grid |
| Avg G/L | Capital-weighted (total captured ÷ total premium), not simple average |
| Cohorts | Not in v1; selection keyed by `positionKey` so cohorts are additive later |

## Interaction (CSPs tab only)

- **Row click** toggles selection. Selected rows get a blue tint + outline (theme.blue-derived, no hardcoded hex).
- **Expand** requires a direct click on the ▾ chevron cell. The chevron gets a larger padded hit target since it is now the only expand affordance. This is a deliberate change to existing behavior (row click used to expand).
- **Expiry cell click** toggles selection of all rows sharing that expiry date: if all are selected, deselect all; otherwise select all. Desktop-only by nature — the Expiry column is hidden on mobile.
- Existing inner click targets (tag chips, "journal" links, etc.) keep working via `stopPropagation`, the established pattern in `OpenPositionsTab.jsx`.
- **Selection identity:** a `Set` of `positionKey(pos)` strings (existing helper in `src/lib/tags.js`: `ticker|type|strike|expiry`). Survives re-sorts and quote refreshes; row index is never used.
- **Clearing:** switching position tabs (CSPs → CCs/LEAPs) clears the selection. The ✕ in the bar clears it. No persistence across page loads in v1.
- CCs and LEAPs tabs: row click keeps its current expand behavior — no selection there.

## Aggregate bar

Appears (fixed, bottom of viewport, above safe-area inset) whenever ≥1 row is selected.

**Desktop:** single line —
`N selected · COLLATERAL $86,300 (37.1% of acct) · MAX PREMIUM $5,830 · CAPTURED −$4,162 · AVG G/L −89.5% · ✕`

**Mobile:** two lines —
- Line 1: `N selected` + `✕ clear` (right-aligned)
- Line 2: 2×2 grid of the four stats (Collateral w/ % · Max premium · Captured · Avg G/L)

Styling: `theme.bg.elevated`-style surface, blue-tinted border, shadow; small uppercase labels (`theme.size.xs`) over mono values. Layout reserves room on the right for a future "Save as cohort" button.

If any selected row lacks a live option mark, the bar shows a small `*n no mark` annotation next to Captured/Avg G/L.

## Math — `src/lib/cspAggregates.js` (new pure module)

Input: array of enriched selected rows (`{pos, glDollars}` shape already computed in the table) + `accountValue`.

- **Collateral $** = Σ `strike × 100 × contracts`
- **Collateral % of account** = collateral ÷ `account.account_value` — omitted when account value is null/0
- **Max premium** = Σ `premium_collected`
- **Captured $** = Σ `glDollars` over rows where it is non-null; `missingMarkCount` reported for rows skipped
- **Avg G/L %** = captured ÷ Σ `premium_collected` *of rows with non-null `glDollars`* (capital-weighted; denominator excludes skipped rows so the ratio is internally consistent)
- Empty selection → all-null result (bar never renders in this state anyway)

## Components & data flow

- Selection state (`selectedKeys: Set<string>`) lives in `OpenPositionsTab` alongside `expandedRowKey`, scoped to the CSP table instance.
- The CSP table's `enriched` rows (existing computation) are filtered by `selectedKeys` and fed to `computeCspAggregates(rows, accountValue)`.
- New `SelectionBar` component (same file or sibling) renders the fixed bar; receives the aggregate object, `isMobile`, and `onClear`.
- `account.account_value` is already available in `OpenPositionsTab` via props.

## Edge cases

- Missing option quote → row excluded from Captured/Avg G/L, counted in `missingMarkCount`, annotated in bar.
- `account_value` missing → collateral $ shown without the % suffix.
- Sorting, quote-refresh re-renders → selection unaffected (keyed by `positionKey`).
- Selected position disappears on data refresh (closed/rolled) → its key simply no longer matches any row; aggregates compute from matching rows only. (Stale keys are harmless and cleared with the selection.)
- Mobile: expiry quick-select unavailable (column hidden); row-click select + chevron expand work the same.

## Testing & verification

- Vitest: `src/lib/__tests__/cspAggregates.test.js` — multi-contract sums, missing mids (skip + count), missing account value, weighted-avg denominator exclusion, empty input.
- `npm run build` must pass.
- Browser verification is limited locally (positions come from `/api/data`, which Vite doesn't serve) — hence all math in the tested pure module; interaction verified post-deploy.

## Out of scope (v1)

- Cohort save/load/tracking (next project — bar layout and `positionKey` selection are the only forward commitments)
- Selection on CCs/LEAPs tabs
- Cross-tab or persisted selections

## Ship checklist

- Minor version bump (`package.json` + `const VERSION` in `src/lib/constants.js`), baseline from `origin/main`.
