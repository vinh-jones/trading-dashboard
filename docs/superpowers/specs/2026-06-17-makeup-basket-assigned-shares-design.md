# Makeup Basket — Recording Assigned Shares & Covered Calls

**Date:** 2026-06-17
**Status:** Approved design, revised 2026-06-17 to fit the write architecture
(reconciliation deferred — see Open Questions)

## Write-architecture constraint (drives the design)

`trades` and `positions` are **read-only from the app** — they are sourced from the
user's Google Sheet via `/api/sync`, which is the source of truth. There is no endpoint to
close a CSP or write an assigned-shares row from the UI. The **only** client-writable store
is `journal_entries` (`POST/PATCH/DELETE /api/journal-entry`), and that table has **no
`contracts` or `entry_cost` columns** — extra structured fields live in its `metadata`
JSONB.

Consequences:
- The CSP→Assigned close is **not** written by the app. The user marks it Assigned in the
  Sheet and syncs; the basket then auto-reflects it because the CSP's tagged entry stops
  tuple-matching the open position and starts matching the now-closed trade (full premium →
  Realized Recovery, unrealized mark wiped). **No code is needed for the CSP leg.**
- The declared shares lot's share-count and basis are stored in the entry's `metadata`,
  not dedicated columns.
- The only genuinely new client write is **creating the tagged Shares declaration entry**.

## Problem

When a CSP in a strategy basket (e.g. `strategy:sofi-makeup`) is assigned, the basket
must keep an honest ledger of the transition:

1. The CSP premium is fully kept and should move from *unrealized mark* to
   **Realized Recovery**.
2. The resulting shares lot enters the basket at the **full strike cost basis** (not
   the premium-reduced "effective" basis — the premium is already counted as recovery
   income, so netting it into basis too would double-count it).
3. Covered calls written on those shares are additional recovery members.

The hard part is **lot attribution**. The broker holds a single blended share position
per ticker — possibly multiple assignment prices, some shares belonging to this basket
and some not. The basket needs to track a *specific slice* (count + basis) without
reconciling against the blended broker lot.

### The resolver landmine

A basket member is a tagged `journal_entries` row, resolved by
`resolveBasket()` ([src/lib/strategyBasket.js:79](../../../src/lib/strategyBasket.js))
in priority order: `trade_id` link → tuple-match an open position → tuple-match a closed
trade → else skipped. `tupleMatch()` compares `(ticker, type, strike, expiry)`.

**Shares have null `strike` and null `expiry`**, so a tagged Shares entry would
tuple-match *any* shares position for that ticker — i.e. the entire blended lot, with the
wrong basis and count. Lot attribution must therefore be solved *in the resolver*, not
downstream.

## Core principle

**The basket is a logical ledger, not a mirror of the brokerage position.** The basket
slice is *declared*, never derived from the blended broker lot. We never reconcile against
the broker's share count (deferred — see Open Questions); we only need the equity *quote*
(one per ticker, independent of basis) to mark the lot.

## Chosen approach: self-contained declaration entry

The tagged `Shares` journal entry carries its **own** `contracts` (share count) and
`entry_cost` (per-share basis). The resolver builds the member directly from the entry and
**never tuple-matches the positions feed** for Shares. The blended broker position is
irrelevant to basket math.

Approaches considered and rejected:
- **Link to a real lot row via `trade_id`** — requires splitting the blended
  `assigned_shares` position into per-basket rows; re-imports the blending problem.
- **Hybrid (declaration + reference to parent position)** — extra plumbing only to display
  "slice vs. total held"; YAGNI for now.

## Design

### 1. Declaration entry shape

A makeup shares lot is one journal entry, with share-count and basis in `metadata`:

```js
{ entry_type: "position_note", ticker: "GLW", type: "Shares",
  entry_date: "2026-06-17", strike: null, expiry: null,
  tags: ["strategy:sofi-makeup"],
  metadata: { shares: 100, basis: 190 } }
```

- `metadata.shares` = **share count** (resolves to the member's `contracts`, consistent
  with the SOFI baseline, which uses 3300).
- `metadata.basis` = **per-share basis** (the assignment strike, $190 — never the
  premium-reduced effective basis).
- `capitalFronted` derives as `shares × basis` = $19,000.

### 2. Resolver change — [src/lib/strategyBasket.js:79](../../../src/lib/strategyBasket.js)

Add a declaration path at the top of the resolve loop: when a tagged entry has
`type === "Shares"` **and** carries `metadata.shares` + `metadata.basis`, build the member
straight from the entry (status `open`, role `recovery`, `contracts = metadata.shares`,
`entryCost = metadata.basis`, `capitalFronted = shares × basis`) and **skip tuple-matching
entirely**. This closes the null-strike/null-expiry landmine.

Baseline Shares (the SOFI loss) continue to resolve from their closed trade row via
`trade_id` (they carry no `metadata.shares`) — unchanged. Only *open recovery* Shares lots
use the new declaration path.

### 3. Marking math — [src/lib/strategyBasket.js:149](../../../src/lib/strategyBasket.js)

Add a `SHARES_TYPES` branch to `memberUnrealized` / `unrealizedCushion`:
- Mark off the **equity quote by ticker** (not an OCC option symbol via `markFor`).
- P/L = `(quote − entryCost) × contracts × 1` — note the **×1** multiplier (shares),
  not `×100` (options).

`capitalDeployed()` and `realizedRecovery()` are already type-agnostic and need no change —
they will pick up the declared lot's `capitalFronted` (open) and any closed Shares trade's
`realized`.

### 4. "Add assigned shares to basket" affordance

A UI action in `StrategyBasketTab` that creates **only** the §1 declaration entry via
`POST /api/journal-entry` (the one new client write). When invoked from an open CSP basket
row it pre-fills `shares = csp.contracts × 100`, `basis = csp.strike`, and the active
`strategy:*` tag; the user can also enter the lot manually (ticker, shares, basis).

The **CSP-close leg is not written by the app** — the user marks the CSP Assigned in the
Sheet and syncs, and the basket auto-reflects it (see the Write-architecture constraint).
The affordance copy should remind the user of that second step.

After the POST succeeds, the basket must refresh. `ExploreView` currently loads
`strategyEntries` once when the Baskets subview activates
([src/components/ExploreView.jsx:80](../../../src/components/ExploreView.jsx)) with no
refresh path. The plan extracts that load into a reusable callback and passes it to
`StrategyBasketTab` as `onEntriesChanged`, which the affordance calls after writing.

### 5. Over-allocation soft warning

In the basket view, compute `taggedCCContracts × 100` vs. summed declared Shares for that
ticker. If CC coverage exceeds declared shares, render a **non-blocking** warning (e.g.
"2 CCs tagged but 100 shares declared — over-allocated"). Numbers still compute.

This also covers the **CC-written-before-assignment** case: the warning shows while shares
= 0 and clears once the assignment is recorded.

### 6. Exit / partial sell (no dedicated affordance in v1)

The app can't write trades, so there is no "close lot" button in this iteration. The
manual flow: when the shares are sold (recorded in the Sheet), the user edits the
declaration entry's `metadata.shares` down via `PATCH /api/journal-entry` (partial) or
deletes it via `DELETE` (full) to stop marking the sold portion. The realized sale P/L
books through the normal closed-trade → basket-tagging flow (a tagged entry resolving the
closed `Shares` trade by `trade_id`, mirroring the baseline).

A dedicated exit/reduce affordance is deferred (see Open Questions).

Rolling a tagged CC needs no special handling — close one (realizes its premium), open the
next, same tag.

### 7. Testing — [src/lib/__tests__/strategyBasket.test.js](../../../src/lib/__tests__/strategyBasket.test.js)

The resolver, marking, and over-allocation logic are pure functions — fully unit-tested:

- A declared Shares member resolves from `metadata.shares`/`metadata.basis` and **never**
  from a blended positions row (assert it ignores a conflicting GLW position in the feed).
- The baseline Shares entry (no `metadata.shares`) still resolves via `trade_id`.
- Equity-marking math uses the ×1 multiplier and the ticker quote (`mid ?? last`); unmarked
  when no ticker quote.
- Over-allocation detection fires when tagged CC contracts × 100 > declared shares.

The affordance is UI + a journal POST; **local dev does not serve `/api`**, so it is
verified via `npm run build` + the unit-tested helpers, not a local browser run.

## Out of scope (YAGNI)

- **Tax-lot / FIFO selection on exit.** Which broker lot is actually delivered is a tax
  concern; the basket uses the declared slice.

## Open Questions (deferred)

- **Reconciling a declared slice against the actual broker share count.** The user expects
  this may be needed later but the requirements aren't yet clear. Out of scope for this
  iteration; revisit once the need is concrete. The declaration-driven design does not
  block adding a reconciliation/display layer on top later (this is essentially deferred
  Approach C).
- **Dedicated exit / reduce-lot affordance.** v1 handles exit by manually editing/deleting
  the declaration entry (§6). A one-click reduce/close action is deferred — it pairs
  naturally with reconciliation.

## Worked example (GLW, as of 2026-06-17)

- GLW CSP: 1 contract, $190 strike, ~$1,030 premium collected, showing ~−$897 unrealized.
- GLW trading at ~$176.92.

On recording assignment:
- Realized Recovery **+~$1,030** (full premium kept; −$897 mark wiped).
- New declared lot: 100 GLW @ $190 basis, marked `(176.92 − 190) × 100 = −$1,308`
  unrealized.
- GLW's net contribution moves from −$897 → ~−$278, honestly reflecting that the basket is
  now long GLW below basis.
