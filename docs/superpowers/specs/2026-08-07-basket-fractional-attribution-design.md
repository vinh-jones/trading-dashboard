# Fractional attribution for strategy baskets

**Date:** 2026-08-07
**Status:** Design approved

## Problem

A strategy basket can only own a *whole* trade. `resolveBasket` maps a tagged
journal entry to one row in `trades` and takes its `premium_collected` entire.

But the broker holds blended lots, and a basket routinely owns a slice of one:

| Case | Trade | Basket's share |
|---|---|---|
| GLW covered calls | `CC $160 8/07` 4ct +$1,028 and `CC $157.50 8/07` 4ct +$2,008 | 1 of 4 contracts |
| GLW shares | four 100-share lots called away 8/07, +$850 blended | 100 of 400 shares |
| DRAM covered call | `CC $63 8/28` 12ct +$1,740 | 4 of 12 contracts |
| IREN covered calls | `CC $50 8/21` 8ct +$560 and `CC $50 8/21` 8ct +$512 | 4 of 8 contracts |

Three of these landed in a single week, so this is the normal case, not an
exception. Today the only options are to credit the basket 100% of a trade it
partly owns, or leave the slice out entirely.

The existing declared-shares path (`fromDeclaredShares`) already solves the
matching problem for *open* share lots by asserting the slice in
`metadata: {shares, basis}`. This spec extends the same idea to trades.

## Data model

One journal entry per attributed trade — the durable overlay layer, unchanged
by sync — with one new metadata key:

```
entry_type: 'position_note'
ticker, type, strike, expiry
trade_id:   <trades.id>        -- pinned, so a later same-strike leg can't hijack the tuple
tags:       ['strategy:<slug>']
source:     'Self'
body:       auto-generated note
metadata:   { contracts: 4 }   -- NEW: the count this basket owns
```

`metadata.contracts` is the numerator. The denominator is the resolved trade's
own `contracts` column — never stored, so the two can't drift apart.

Counts, not decimals: `4` of 12 stays exact where `0.3333` would not, the row
can render "4 of 12 ct" without extra fields, and it reads the way the position
is actually held.

The same key covers share lots. A Shares trade row stores its share count in
`contracts` (100 for a one-lot assignment), so `{contracts: 25}` means 25 of
that lot's 100 shares.

**No collision with declared shares.** `fromDeclaredShares` fires only when
`type === 'Shares'` *and* both `metadata.shares` and `metadata.basis` are
present. An attribution entry sets neither, so it falls through to the
trade-resolution path as intended.

## Resolver semantics

`weight = metadata.contracts / trade.contracts`, clamped to `(0, 1]`.

**Scaled:** `realized`, `capitalFronted`, `contracts`.

**Not scaled:** `entryCost` (a per-contract/per-share price), `strike`,
`roi`, `keptPct`, `daysHeld` — these are rates and per-unit values, invariant
under a change of share count.

Because `memberUnrealized` and `spreadUnrealized` both multiply by
`member.contracts`, **open** members scale correctly with no second code path.

The member gains an `attribution: {owned, total}` field so the transactions
table can render "1 of 4 ct" without re-deriving the fraction.

**Fallback:** if the trade's `contracts` is null or `<= 0` — some older Shares
rows have a null count — weight is 1 and the member resolves whole, which is
today's behavior. The attribution form does not offer those trades.

**Downstream, no changes needed:**

- `realizedRecovery` / `capitalDeployed` sum the already-scaled fields.
- `shareCoverageWarnings` scales on both sides, so `ccContracts * 100 > shares`
  stays a valid comparison. Fractional counts round for display only.
- `basketTarget` reads baselines only; weight applies uniformly and is not
  special-cased for baselines.

## UI: attribute a closed trade

A sibling affordance to "+ Add assigned shares" on `StrategyBasketTab`, using
the same `createJournalEntry` path:

```
+ Add assigned shares   + Attribute a closed trade

[GLW v] [CC $157.50 8/07 - 4ct - +$2,008 v]  I own [ 1 ] of 4 ct  -> +$502.00   [Add to basket]
```

- Ticker select, from the distinct tickers in the `trades` prop the tab already
  receives.
- Trade select, closed trades for that ticker, most recent first, excluding any
  with a null or non-positive `contracts`.
- Count input, validated to `0 < n <= total`.
- Live dollar preview of the credit before submitting.

Create-only. Editing or removing an attribution stays a manual database change
for now; revisit if it comes up more than once.

## Transactions table

Group rows by type — CC, CSP, Shares, LEAPS, Spread — with a per-group G/L
subtotal, reusing the `GroupLabel` mechanism already in the file.

The Open/Closed split stays the outer grouping. Their G/L columns mean
different things (mark-to-market vs realized) and a subtotal spanning both
would be misleading. Baseline stays pinned above everything. Column sorting
applies within each type group.

Attributed rows show their slice in the Detail column ("1 of 4 ct").

## Testing

Vitest, extending `src/lib/__tests__/strategyBasket.test.js`. No database in the
test path, so the resolver and reducers are covered directly:

- closed trade at 4/12 credits exactly one third of `premium_collected`
- open member at 1/4 scales `contracts`, `capitalFronted`, and `memberUnrealized`
- `entryCost`, `roi`, `keptPct`, `daysHeld` unchanged by weight
- null / zero / missing `trade.contracts` resolves whole (weight 1)
- `metadata.contracts` exceeding the trade's count clamps to whole
- a Shares entry carrying `{shares, basis}` still takes the declared-open path
- `realizedRecovery` and `capitalDeployed` reflect scaled members
- `shareCoverageWarnings` with fractional CCs and fractional shares
- type-group subtotals

## Data to load after ship

Nine entries, all tagged `strategy:sofi-makeup`:

| Ticker | Trade | `trades.id` | Slice | Credit |
|---|---|---|---|---|
| GLW | Shares lot basis $165.00 (-$750) | `ac6b36fd` | 25 of 100 | -$187.50 |
| GLW | Shares lot basis $167.50 (-$1,000) | `b3de308e` | 25 of 100 | -$250.00 |
| GLW | Shares lot basis $148.00 (+$950) | `8f3ddea7` | 25 of 100 | +$237.50 |
| GLW | Shares lot basis $141.00 (+$1,650) | `c67642a7` | 25 of 100 | +$412.50 |
| GLW | `CC $160 8/07` 4ct (+$1,028) | `535ed37d` | 1 of 4 | +$257.00 |
| GLW | `CC $157.50 8/07` 4ct (+$2,008) | `72c802b6` | 1 of 4 | +$502.00 |
| DRAM | `CC $63 8/28` 12ct (+$1,740) | `d9a02ebe` | 4 of 12 | +$580.00 |
| IREN | `CC $50 8/21` 8ct (+$560) | `cca339fd` | 4 of 8 | +$280.00 |
| IREN | `CC $50 8/21` 8ct (+$512) | `e27264a6` | 4 of 8 | +$256.00 |

Trade IDs are pinned above because GLW has a decoy row: `8791840b` is a
100-share, $141-basis row opened *and* closed on 8/03 with zero P/L — a
same-day assignment artifact, superseded by `c67642a7`. It must not be tagged.

GLW share appreciation nets **+$212.50** — a quarter of the +$850 blended
result (400 shares, average basis $155.375, called away at $157.50).

Two decisions recorded here because they are judgment calls, not arithmetic:

1. **GLW shares are attributed pro rata, 25 of each of the four lots.** By
   provenance the basket's lot is the $165 one — its tagged
   `GLW CSP $165 exp 7/31` was assigned on 7/29 — and that lot alone lost $750.
   Pro rata across the blend was chosen instead.
2. **The IREN `CC $50 8/21` +$560 entry already exists at full value** and must
   be amended to `{contracts: 4}`, not duplicated. The +$512 IREN CC is a new
   entry.

## Out of scope

- Editing or deleting an attribution from the UI.
- Attributing a slice of an *open* position from the UI. The resolver supports
  it; only the closed-trade form ships.
- Any change to how `trades` or `positions` are synced. This is an overlay.
