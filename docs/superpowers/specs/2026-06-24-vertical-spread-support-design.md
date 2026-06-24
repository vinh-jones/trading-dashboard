# Vertical-Spread Support — Design

**Date:** 2026-06-24
**Status:** Approved (design); ready for implementation plan
**Trigger:** Logged a bull put spread (XSP, 6/24/2026) on the LEAPS/Shares tab. Spreads have never been supported in the app since the rebuild — they are silently dropped by the parser. This spec adds first-class vertical-spread support across the sheet contract, parser, position model, Open Positions UI, journal, History/realized path, allocation, and the v2 forecast pipeline.

## Goal / definition of done

A vertical spread logged on the LEAPS/Shares tab:
1. Parses correctly (both legs, correct direction) instead of being dropped.
2. Appears as a first-class open position in a **Spreads** tab with risk/reward, breakeven, cushion-to-breakeven, live two-leg G/L, % of max profit captured, and underlying-aware signals.
3. Can carry journal notes / strategic tags like any other position.
4. On close, lands in History with the correct label and realized P&L, joins the allocation chart, and (for credit spreads) contributes to MTD premium **and** the forward forecast pipeline.

Concrete first proof: the existing open XSP row (`708/703`, 16x, exp 7/31, $0.66 credit) shows up in the Spreads tab with max gain ~$1,056, max loss $6,944, breakeven 707.34.

## Scope decisions (resolved during brainstorm)

- **Full signal treatment**, not lightweight — because non-index spreads (QQQ, single names) are American-style and physically settled, so assignment risk is real. Signals are **underlying-aware** (see §5).
- **Generic to all four verticals** (Bull Put, Bear Call = credit; Bull Call, Bear Put = debit), though only credit spreads are traded today. Derivations validated against credit spreads.
- **Credit-spread kept credit counts as premium** — flows into MTD premium tally **and** the v2 forecast pipeline (the user's explicit call). Debit spreads do **not** count as premium (directional P&L only).
- All five build steps to be implemented (see §8).

## Rejected alternatives

- **Reuse CSP machinery, short leg as a CSP** — conflates defined-risk with cash-secured semantics (capital, assignment, hold-yield all differ). Fragile.
- **Two linked single-leg rows** — clunky; doesn't match how the sheet or the trader model the position (one credit, one risk number).

First-class is also what the reserved `open_spreads` slot in `positionSchema.js` anticipates.

## 1. Input contract (LEAPS/Shares sheet)

The spread's directional label drives type + direction + right (put/call) + credit/debit. **Amendment (2026-06-24, during impl):** the live sheet — and all historical closed spread rows — carry a bare `SPREAD` in `txnType` (col 7) and the directional label in the **description** (col 3, e.g. `Bull Put Spread (Max gain $1094)`). So classification reads `classifySpread(txnType) ?? classifySpread(description)`, substring-matching the four canonical phrases. `txnType` wins if ever canonicalized; otherwise the description (where the label actually lives) is used. No sheet change required.

| col idx | field | rule |
|---|---|---|
| 7 (txnType) | `Bull Put Spread` \| `Bear Call Spread` \| `Bull Call Spread` \| `Bear Put Spread` | canonical type label; parser keys off this |
| 10 (strike) | `708/703` | **short strike / long strike** (short first) |
| 11 (entry_cost) | `0.66` | net per-share price of the spread (credit for credit spreads, debit for debit spreads) |
| 9 (contracts) | `16` | |
| 8 (expiry) | `7/31/2026` | |
| 6 (capital) | `6944` | max loss / collateral — kept for sheet formulas; app re-derives and reconciles |
| 3 (description) | `Bull Put Spread` | free text, optional (drop hand-computed "Max gain $…") |
| 12 (exit_cost) | blank → fill on close | net per-share cost to close (0 if expired worthless) |
| 2 (close_date) | blank → fill on close | |

**Strike convention: short-first, not low/high.** The first number is the leg that drives the position (breakeven, the watched strike, the expiry pin); the long leg is the max-loss floor. Self-describing — does not require knowing put/call to identify the short leg. For a bull put this is high/low (`708/703`); for a bear call it is low/high (e.g. `700/705`). Bonus: legacy `parseFloat` on `"708/703"` yields 708 (the short strike), so a fallback single-strike parse still grabs the right leg.

Everything else is **derived** (parser/app, not hand-entered):
- `width = |short_strike − long_strike|`
- credit spread: `max_gain = credit × 100 × contracts`, `max_loss = (width − credit) × 100 × contracts`
- credit put spread breakeven `= short_strike − credit`; credit call spread breakeven `= short_strike + credit`
- (debit spreads mirror: max_loss = debit paid, max_gain = (width − debit) × …; breakeven on the long leg)

## 2. Data model

`positions.open_spreads: []` (top-level array). Each entry:

```js
{
  ticker, type: "Spread",
  subtype: "Bull Put" | "Bear Call" | "Bull Call" | "Bear Put",
  is_credit: true, right: "put",            // derived from subtype
  short_strike: 708, long_strike: 703, width: 5,
  contracts: 16, credit: 0.66,              // entry_cost; net per-share price
  open_date, expiry_date,
  max_gain: 1056, max_loss: 6944, breakeven: 707.34,
  capital_fronted: 6944,                    // = max_loss (capital at risk)
  premium_collected: 1056,                  // credit spreads only = capturable credit (max_gain); null for debit
  settlement: "cash" | "physical",
  assignable: false,                        // derived: !CASH_SETTLED_INDICES.has(ticker)
  source: "Ryan", notes: ""
}
```

- **`premium_collected`** is set to the capturable credit (`max_gain`) for **credit** spreads so the position flows through the existing premium reducers and the v2 forecaster **without special-casing** them. Debit spreads leave it null (excluded from premium/pipeline).
- **Settlement / assignability** derived from a `CASH_SETTLED_INDICES` set (`SPX, XSP, NDX, RUT, VIX, DJX, OEX, XEO, SPXW, NDXP, RUTW`, plus aliases as needed). Everything else → `physical` / `assignable: true` (QQQ, SPY, IWM, single names). Lives in `src/lib/constants.js` or `trading.js`.
- **`positionKey`** (in `src/lib/tags.js`) = `ticker|Spread|short_strike|expiry` — reuses the existing key shape, so journal/tag wiring works unchanged. (Collision only if two spreads share ticker+expiry+short_strike with different long legs — acceptable; revisit if it ever happens.)
- **`positionSchema.js`** gains `getOpenSpreads(positions)` returning `positions?.open_spreads ?? []`.

## 3. Parser (`lib/parseSheets.js`)

Three correctness fixes in `processLeapsShares` + downstream:

1. **Stop dropping open spreads.** The current open branch handles only `Shares` and `LEAPS`; a `Spread` falls through and is lost. Add a Spread case that builds an `open_spreads` entry (§2). Thread `openSpreads` out of `processLeapsShares`, into `buildPositions`, and onto the returned `positions` object.
2. **Parse both strikes.** Split `"708/703"` on `/` into `short_strike`/`long_strike` (short first). Do not `parseFloat` the whole cell.
3. **Fix the subtype taxonomy.** Today any spread maps to `"Bear Call"`/`"Bear Debit"`. Map `txnType` → the correct one of the four verticals; derive `is_credit` and `right`. Closed spreads already route to `trades.json`; they get the same taxonomy fix + realized P&L (§6).

`buildPositions` returns `open_spreads`; `fetchSheetData` includes it in the `positions` object alongside `assigned_shares`, `open_csps`, `open_leaps`.

## 4. Open Positions UI (`OpenPositionsTab.jsx`)

New **Spreads** tab (4th, beside CSPs / CCs / LEAPs / Cohorts), mirroring the existing `PositionsTable` pattern. Row collapsed + expanded shows:

- **Definition:** `708/703p · 16x · exp 7/31 · 22 DTE` (right-symbol from `right`)
- **Risk/reward:** max gain $1,056 · max loss $6,944 · breakeven 707.34
- **Cushion to breakeven:** live underlying vs breakeven → e.g. `XSP $712 · +0.7% above BE`, green/amber/red. Uses the **underlying** quote (already fetched) — works even if option-leg quotes are unavailable.
- **Live G/L (two-leg quote):** spread mark = `short_mid − long_mid`; unrealized `$`/`%`; **% of max profit captured** → a *close-at-50%* management nudge (standard credit-spread rule).
- **Signals, underlying-aware:**
  - flow / gamma / GEX where UW data exists (indices have flow too),
  - **assignment-risk layer only when `assignable`** (QQQ / stocks), anchored on the short leg; **suppressed + relabeled** "cash-settled · no early assignment" for index spreads (XSP/SPX/…).

Sorting/columns follow the existing table conventions. The Spreads tab is not `selectable` (CSP-selection calculator stays CSP-only).

## 5. Quotes (`api/quotes.js`)

Extend option-symbol collection to add **both** legs of each open spread: for a put spread, two puts (`short_strike`, `long_strike`); for a call spread, two calls. Reuses `buildOccSymbol` + `quoteMap`. Spread mark computed client-side from the two leg mids.

**Risks to verify during build:**
- Whether the quote feed returns clean quotes for **index** option legs (XSP/SPX). Cushion-to-breakeven (§4) does not depend on this, so the tab is useful regardless.
- `buildOccSymbol` may need a format tweak for index option symbols (e.g. XSP/SPXW roots). Verify against the provider before relying on leg quotes.

## 6. Journal

Free, given §2. The spread row gets the same **"add note" / tag** affordances as other positions. `groupStrategicTagsByPosition` (in `tags.js`) is extended to also walk `open_spreads` when building `validKeys`. Journal entries attached to the spread render their strategic tags back on the row. **No new journal schema.**

## 7. Closed / realized path

On close (close_date + exit_cost filled), the row flows to `trades.json` and renders in History:
- **Label:** new `SUBTYPE_LABELS` entries — `"Bull Put"`, `"Bear Call"`, `"Bull Call"`, `"Bear Put"` → display strings (e.g. "Bull Put Spread"). Existing `"Spread"` `TYPE_COLORS` badge applies.
- **Realized P&L** = `(credit − exit_cost) × 100 × contracts` (full credit if expired worthless → exit_cost 0). Stored in `premium_collected` so it flows through History's net-realized total and MTD.
  - Credit spreads: realized credit-kept is **premium income** → counts in MTD premium + forecast realization.
  - Debit spreads: realized number is directional P&L → included in net realized but **flagged/excluded** from the premium tally.
- **Allocation chart:** open spreads join the per-ticker allocation chart with `capital_fronted` (= max loss / capital at risk) as a new **Spread** segment.

## 8. Forecast pipeline integration (`pipelineForecast.js`, `api/eod-snapshot.js`)

- Open **credit** spreads are added to `pipelinePositions` (currently `open_csps` + CCs) in `eod-snapshot.js` so their `premium_collected` (capturable credit) feeds `open_premium_gross` and the v2 forecaster's forward projection.
- The v2 forecaster's `expectedFinalCapturePct` is keyed on position state via a calibration map. **First approximation: reuse the CSP calibration bucket** for spreads — there is not enough spread history to calibrate a dedicated curve, and spreads are infrequent. Flagged as an approximation to refine once history accrues (a dedicated spread calibration bucket is a future follow-up).
- Verify during step 1/5 that the forecaster's state derivation (DTE, capture %, RoR from `capital_fronted`) behaves sensibly for a spread's risk/reward (max loss as capital, not naked-put collateral).

## Build order

1. **Input contract + parser fixes + `open_spreads` + taxonomy/labels** — correctness; un-drops the XSP trade. Includes `getOpenSpreads`, `CASH_SETTLED_INDICES`, `positionKey` coverage, `SUBTYPE_LABELS` entries.
2. **Spreads tab: static + cushion-to-breakeven** (no leg quotes). Tab, table, risk/reward, breakeven, underlying-anchored cushion.
3. **Live two-leg G/L + % captured + close-at-50%** — extend `quotes.js`; verify index-leg quoting.
4. **Underlying-aware signals** — flow / gamma; assignment-risk gated on `assignable`, relabeled for cash-settled.
5. **Closed/realized + History + allocation + forecast pipeline** — realized P&L, labels, allocation segment, credit-spread premium into MTD + v2 forecaster.

Journal (§6) is wired incidentally in step 1 (positionKey/tags coverage) and needs no dedicated step.

## Open risks (carried forward)

- Index option-leg quoting (XSP/SPX) — verify in step 3.
- `buildOccSymbol` format for index roots — verify in step 3.
- Reusing the CSP calibration curve for spread forecasting is an approximation (step 5).
