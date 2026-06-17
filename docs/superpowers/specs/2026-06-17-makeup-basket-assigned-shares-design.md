# Makeup Basket — Recording Assigned Shares & Covered Calls

**Date:** 2026-06-17
**Status:** Approved design (reconciliation deferred — see Open Questions)

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

A makeup shares lot is one journal entry:

```js
{ type: "Shares", ticker: "GLW", contracts: 100, entry_cost: 190,
  tags: ["strategy:sofi-makeup"] }
```

- `contracts` = **share count** (consistent with the SOFI baseline, which uses 3300).
- `entry_cost` = **per-share basis** (the assignment strike, $190 — never the
  premium-reduced effective basis).
- `capitalFronted` derives as `contracts × entry_cost` = $19,000.

### 2. Resolver change — [src/lib/strategyBasket.js:79](../../../src/lib/strategyBasket.js)

Add a `fromEntry` path: when a tagged entry's `type === "Shares"` **and** it carries
`contracts` + `entry_cost`, build the member straight from the entry (status `open`, role
`recovery`) and **skip tuple-matching entirely**. This closes the null-strike/null-expiry
landmine.

Baseline Shares (the SOFI loss) continue to resolve from their closed trade row via
`trade_id` / tuple match — unchanged. Only *open recovery* Shares lots use the new
declaration path.

### 3. Marking math — [src/lib/strategyBasket.js:149](../../../src/lib/strategyBasket.js)

Add a `SHARES_TYPES` branch to `memberUnrealized` / `unrealizedCushion`:
- Mark off the **equity quote by ticker** (not an OCC option symbol via `markFor`).
- P/L = `(quote − entryCost) × contracts × 1` — note the **×1** multiplier (shares),
  not `×100` (options).

`capitalDeployed()` and `realizedRecovery()` are already type-agnostic and need no change —
they will pick up the declared lot's `capitalFronted` (open) and any closed Shares trade's
`realized`.

### 4. "Record assignment" affordance

An action on an open CSP basket row that performs **both legs atomically**:

- **(a) Close the CSP** as `subtype: "Assigned"` with `premium_collected` = the full
  credit collected. Effect: the unrealized mark is wiped, the full premium lands in
  Realized Recovery.
- **(b) Create the declaration entry** (§1) with `contracts = csp.contracts × 100`,
  `entry_cost = csp.strike`, and the same `strategy:*` tag pre-filled.

### 5. Over-allocation soft warning

In the basket view, compute `taggedCCContracts × 100` vs. summed declared Shares for that
ticker. If CC coverage exceeds declared shares, render a **non-blocking** warning (e.g.
"2 CCs tagged but 100 shares declared — over-allocated"). Numbers still compute.

This also covers the **CC-written-before-assignment** case: the warning shows while shares
= 0 and clears once the assignment is recorded.

### 6. Exit / partial sell

Selling the lot (or it being called away) is the mirror of §4: a "Close/reduce lot" action
books a closed `Shares` trade with `realized = (exit − entryCost) × shares`, moving that
P/L into Realized Recovery and reducing or closing the declaration entry.

Rolling a tagged CC needs no special handling — close one (realizes its premium), open the
next, same tag.

### 7. Testing — [src/lib/__tests__/strategyBasket.test.js](../../../src/lib/__tests__/strategyBasket.test.js)

- A declared Shares member resolves from its own fields and **never** from a blended
  positions row (assert it ignores a conflicting GLW position in the feed).
- Equity-marking math uses the ×1 multiplier and the ticker quote.
- Over-allocation detection fires when CC contracts × 100 > declared shares.
- The assignment transition: full premium realized + lot created at strike basis + mark
  wiped.

## Out of scope (YAGNI)

- **Tax-lot / FIFO selection on exit.** Which broker lot is actually delivered is a tax
  concern; the basket uses the declared slice.

## Open Questions (deferred)

- **Reconciling a declared slice against the actual broker share count.** The user expects
  this may be needed later but the requirements aren't yet clear. Out of scope for this
  iteration; revisit once the need is concrete. The declaration-driven design does not
  block adding a reconciliation/display layer on top later (this is essentially deferred
  Approach C).

## Worked example (GLW, as of 2026-06-17)

- GLW CSP: 1 contract, $190 strike, ~$1,030 premium collected, showing ~−$897 unrealized.
- GLW trading at ~$176.92.

On recording assignment:
- Realized Recovery **+~$1,030** (full premium kept; −$897 mark wiped).
- New declared lot: 100 GLW @ $190 basis, marked `(176.92 − 190) × 100 = −$1,308`
  unrealized.
- GLW's net contribution moves from −$897 → ~−$278, honestly reflecting that the basket is
  now long GLW below basis.
