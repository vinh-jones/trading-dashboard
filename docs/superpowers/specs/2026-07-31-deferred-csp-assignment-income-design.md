# Deferred recognition of CSP-assignment premium

**Date:** 2026-07-31
**Status:** Approved, ready for implementation plan
**Area:** new `src/lib/incomeRecognition.js`, new `src/lib/lifespanChains.js`
(extracted from `api/_lib/lifespan.js`), `src/components/HistoryTab.jsx`

## Problem

Every realized-income number in the app is the same sum: `trades.premium_collected`
bucketed by `close_date`. That is true for the History view, `mtd_premium_collected`
in the EOD snapshot (`api/_lib/computeForecastV2.js:102`), the MTD-vs-target bar in
the journal, `api/monthly-review.js`, ticker stats, cohorts, and strategy baskets.
Nothing anywhere distinguishes *how* a trade closed.

So a CSP that gets assigned writes one closed-trade row — `type: CSP`,
`subtype: Assigned`, full premium, `close_date` = assignment date
(`lib/parseSheets.js:123`) — and that premium lands in that month's realized income
exactly like an expired-worthless CSP.

Fidelity does not do this, and neither does any other brokerage. A short put that is
assigned does not realize its premium; the premium adjusts the cost basis of the
acquired shares, and gain or loss is recognized when those shares are sold.

The user has been using the app's realized-income figure to size monthly withdrawals
from Fidelity. In a light-assignment month the discrepancy self-corrects — income is
pulled slightly early, then the shares get called away and the books true up. In a
heavy-assignment month (such as July 2026) the app can report materially more
distributable income than the brokerage will actually support, and repeated
over-withdrawal compounds into a liquidity problem.

This also blocks planned work: later in the year the user intends to retain monthly
profit in the account and raise the cash-flow denominator to match. Feeding that
denominator with premium the brokerage has not realized would compound the same
error into the deployment math.

## Success criteria

- A month-by-month view shows **booked** vs **distributable** realized income
  side by side, across all history.
- A headline figure shows the **outstanding deferred balance** — premium recognized
  as income that the brokerage has not yet realized.
- The identity `cumulative booked − cumulative distributable ≡ outstanding deferred
  balance` holds exactly on real data, and is asserted in tests.
- The restatement is fully retroactive and requires no new manual data entry.
- No existing number changes. Booked income remains the default everywhere.

## Non-goals (YAGNI)

- **No withdrawal tracking.** The user reconciles against Fidelity themselves.
  An earlier option to record actual monthly withdrawals and compute true
  over/under-draw was explicitly scoped out.
- **No change to the cost-basis convention.** Assigned shares stay declared at full
  strike. Fidelity's adjusted basis and the app's full-strike basis plus a separate
  deferred bucket produce identical total P&L — they only split it differently.
  The full-strike convention is load-bearing for lot matching; it is not touched.
- **No change to `trades`, the sync, or `lib/parseSheets.js`.** No new column, no new
  sheet input, no new subtype.
- **No change to booked income.** `mtd_premium_collected`, the v2 forecast and its
  calibration, cohorts, strategy baskets, and ticker stats all keep summing
  `premium_collected` exactly as they do today.
- **No CC-assignment deferral.** See "CC premium" below — it is a real accounting
  parallel but produces no timing gap in practice.
- **No new API endpoint, cron, or cache.** The computation is client-side over data
  `/api/data` already ships.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Replace booked income, or run alongside? | **Alongside** — parallel track, booked stays default |
| Withdrawal tracking? | **No** — restatement only |
| Release rule on partial disposal | **Pro-rata by shares**, via a running-average pool |
| Trigger condition | `subtype === "Assigned"` alone — **not** a buyback-is-zero test |
| Where computed | **Client-side**, pure module |
| Chain detection | **Reuse `detectLifespans`**, extracted to `src/lib/` |
| Placement | **Third view in HistoryTab**, alongside Cards / Breakdown |

### Why not a buyback-is-zero test

The original framing was "if the buyback is $0 and the classification is Assigned."
The buyback test is redundant: the sheet's Action column (col 23) is the only thing
that produces `subtype = "Assigned"` (`lib/parseSheets.js:123`), and it does so
independently of the exit-cost column. One condition, not two.

### Why pro-rata and not FIFO

Fidelity releases per tax lot, FIFO by default. The app's lifespan model already
computes disposal P&L against a **blended** basis across assignment events
(`computeBlendedBasis`, `api/_lib/lifespan.js:766`) and does not carry lot identity
through to the disposal. Pro-rata is the only rule consistent with that model.

On a fully disposed lifespan both methods total identically; they differ only in how
a *partial* exit splits across months. Matching Fidelity's FIFO exactly would require
teaching the model per-lot identity — deferred as out of scope.

### CC premium

Fidelity treats an assigned covered call the same way: the premium folds into the
share sale proceeds rather than being realized on its own. In this book that produces
no timing gap — the `CC/Assigned` row and the `Shares/Sold` row carry the same
`close_date`, so both bases already agree. Scope is CSP assignment only.

## Architecture

### Existing machinery this builds on

`detectLifespans(ticker, allTickerTrades)` in `api/_lib/lifespan.js:137` already
constructs exactly the chain this feature needs. It walks a ticker's trades in date
order, tracks a running share count, and emits per chain:

- `assignment_events[]` — each with `date`, `csp_premium_collected`, `shares_added`
- `partial_dispositions[]` — each with `date`, `shares`
- `exit_event` — with `date`, `shares_disposed`

It emits still-open chains as well as closed ones (`api/_lib/lifespan.js:348`), so an
un-disposed assignment is directly observable as outstanding deferred premium.

Every field it needs is already in the browser: `/api/data` selects `*` from `trades`
and ships `id, ticker, type, subtype, strike, contracts, open_date, close_date,
premium_collected, description` (`api/data.js:83`).

### Structural change: extract `src/lib/lifespanChains.js`

`detectLifespans` and its private helpers (`tradeSortPriority`,
`parseShareCountFromDesc`, `resolveSoldShares`, `computePremiumOnlyCcIds`,
`computeNetShares`, `computeBlendedBasis`, and the rounding/date helpers they need)
move to `src/lib/lifespanChains.js`. `api/_lib/lifespan.js` re-exports
`detectLifespans` so its three consumers — `api/position-lifespan.js`,
`api/ticker-detail.js`, `api/eod-snapshot.js` — are unchanged.

Rationale: importing `api/_lib/` into the client bundle works today, because
`lifespan.js` imports only `src/lib/normal.js`. But it is a latent footgun — the first
server-only import added to that file (a Supabase client, a Node builtin) breaks the
client build with a non-obvious error. The extraction removes the hazard and puts the
shared pure code on the side both consumers can legitimately import from.

This is a mechanical move with no behavior change, covered by
`api/_lib/__tests__/lifespan-baseline.test.js`.

### Supporting change: `normalizeTrade`

`src/lib/trading.js:42` drops the ISO `close_date`, keeping only `closeDate` (a Date
object) and `close` (an `MM/DD` display string). `detectLifespans` sorts and compares
on the ISO string. Add `close_date: t.close_date ?? null` to the returned object —
purely additive, no consumer affected.

### New module: `src/lib/incomeRecognition.js`

Pure, no React, no fetching. Signature:

```js
buildRecognitionLedger(trades, { today }) → {
  months: [{
    month,                  // "2026-07"
    booked,                 // realized under today's rules
    distributable,          // realized under brokerage rules
    delta,                  // booked − distributable for this month
    deferredAdded,          // CSP-assignment premium deferred this month
    deferredReleased,       // deferred premium recognized this month
    outstandingAtMonthEnd,  // cumulative unreleased pool
  }],
  outstandingDeferred,      // current pool across all open lifespans
  cumulativeBooked,
  cumulativeDistributable,
  openChains: [{
    ticker,
    firstAssignmentDate,    // date of the chain's earliest assignment event
    sharesHeld,             // shares still undisposed
    deferredRemaining,      // this chain's unreleased pool
  }],
}
```

**The recognition algorithm.** Group trades by ticker, call `detectLifespans` per
ticker, then walk each chain's events in chronological order carrying two running
values — `pool` (unreleased premium, dollars) and `sharesHeld`:

- **Assignment event** → `pool += csp_premium_collected`; `sharesHeld += shares_added`
- **Disposal event** (partial disposition or exit) → release
  `pool × (sharesDisposed / sharesHeld)` recognized on the disposal date; then
  decrement `pool` by the released amount and `sharesHeld` by the disposed shares

This is a running-average release. Properties that make it the right choice:

- It can never over-release; `pool` reaches exactly zero when `sharesHeld` does.
- It handles assignment *after* a partial disposal correctly. A fixed pro-rata
  denominator (`shares disposed / total ever acquired`) under-releases early
  disposals, because later assignments inflate the denominator retroactively.
- Direct share purchases (`Shares/Assigned`) carry `csp_premium_collected: 0`
  (`api/_lib/lifespan.js:234`), so they dilute the pool correctly with no
  special-casing.
- It matches the blended-basis framing the lifespan model already uses.

**Rounding.** Release amounts round to cents. The final disposal that closes a chain
takes the residual, so a chain's releases always sum exactly to its deferred total and
no penny drift accumulates into the invariant.

**Booked** is the trivial basis: every closed trade's `premium_collected` on its
`close_date`. **Distributable** is identical except that `CSP/Assigned` rows
contribute nothing on their own `close_date` and instead contribute their released
portions on disposal dates.

### The invariant

```
cumulative booked − cumulative distributable ≡ outstanding deferred balance
```

This is arithmetic, not coincidence: the two bases differ only in *when* CSP-assignment
premium is recognized, so the running difference is exactly the premium deferred but
not yet released. It is always ≥ 0, and it collapses toward zero as assigned shares
are called away.

It is also the number the user actually wants — the dollar amount of income recognized
ahead of the brokerage, and therefore the ceiling on how far ahead of the book a
withdrawal could have gone. It doubles as a self-check: computed independently from
the two cumulative sums and from the open-chain pools, the two must agree.

### UI: third view in HistoryTab

`src/components/HistoryTab.jsx` already owns the monthly income framing, the
`DateRangePicker`, and a Cards ↔ Breakdown toggle. Recognition becomes a third
option in that toggle.

Headline: current outstanding deferred balance, with the count of open chains
contributing to it.

Table, one row per month across all history (not date-range filtered — the point is
the cumulative drift):

| Month | Booked | Distributable | Δ | Deferred added | Deferred released | Outstanding |

All styling via `theme` tokens per the project's inline-style convention. No new
charting dependency.

## Testing

`src/lib/__tests__/incomeRecognition.test.js`, vitest, against the pure module:

- CSP assigned, shares still held → premium appears in no month's distributable;
  outstanding equals the premium
- CSP assigned and shares disposed in the same month → distributable equals booked
  for that month (net zero change)
- CSP assigned in month 1, disposed in month 3 → premium leaves month 1's
  distributable and appears in month 3's
- Multiple assignments at different premiums, single partial disposal → released
  amount is pro-rata on the blended pool
- Assignment interleaved *after* a partial disposal → running-average denominator is
  correct (the case a fixed denominator gets wrong)
- Rounding residual → a chain's releases sum exactly to its deferred total
- Direct `Shares/Assigned` purchase mixed into a chain → dilutes without releasing
- The invariant asserted over the full real trade history

Plus the existing `lifespan-baseline.test.js` re-run unchanged to confirm the
extraction is behavior-neutral.

Local dev does not serve `api/*`, so this panel cannot be browser-verified locally.
Verification is vitest plus `npm run build`, with visual confirmation on the Vercel
preview deployment.

## Rollout

Additive and default-off in the sense that nothing existing changes: booked income
remains what every current surface reports. The user runs both bases side by side,
reconciles against Fidelity, and decides later whether to promote distributable to
the primary basis for withdrawals, monthly targets, and the cash-flow denominator.
That promotion is deliberately a separate decision, not part of this change.
