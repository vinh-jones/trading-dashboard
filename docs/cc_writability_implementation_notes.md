# CC Writability Alert — implementation notes

Companion to `docs/spec_cc_writability_alert_v1.md`. The spec is finance Claude's
document and is committed verbatim; this file records where each piece landed,
which acceptance criteria are verified and how, and where the implementation
deliberately differs from or goes beyond the spec.

## Where it lives

| Concern | File |
|---|---|
| Gate, tiers, rung/ladder math, event decomposition, push copy | `src/lib/ccWritability.js` |
| Scope derivation, pricing passes, suppression state, shadow log | `api/_lib/computeCcWritability.js` |
| Per-expiry IV curve (daily cache) | `api/_lib/ivTermStructure.js` + `fetchIvTermStructure` in `api/_lib/uwClient.js` |
| Focus-engine rule → Pushover | `ruleCcWritable` in `src/lib/focusEngine.js` (`NOTIFY_RULES.cc_writable`) |
| Intraday cadence (§5) | `api/alert-check.js` |
| EOD digest floor (§5) | `api/_lib/ccWritabilityDigest.js`, called from `api/snapshot.js` |
| Dashboard state (AMBER lives here) | `api/cc-writability.js` → `src/hooks/useCcWritability.js` → `src/components/CcWritability.jsx` |
| Shadow log table (§8.2) | `supabase/migrations/2026-08-22-cc-writability-log.sql` |

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Scope derived per run | ✅ `positions` filtered on `position_type = 'assigned_shares'` and `has_active_cc = false` each run; writing a CC drops the ticker on the next tick |
| 2 | §7 IREN table reproduces within ~1pp | ✅ against the measured table as a fixture — see caveat below |
| 3 | RED fires once, no re-fire for 5 trading days | ✅ `alert_state` (crossing) + `sent_alerts` (re-arm floor), tested in `ccWritability.test.js` / `ccWritabilityRule.test.js` |
| 4 | IREN suppressed across 8/27, un-suppresses after | ✅ tested both directions, plus the per-ticker override |
| 5 | Payload carries every listed field | ✅ per-rung + `iv`, `iv_rank`, `bb_position`, `open_interest`, `spread_pct`, `illiquid`, `priced_from`, earnings fields, `event_move_implied`, both rung pointers |
| 6 | Annualized RoR at `K_basis` is the sole gate | ✅ tested with a 60 DTE rung carrying higher absolute premium than the 14 DTE rung |
| 7 | No delta threshold in the trigger path | ✅ `delta` is written into the payload and read by nothing that gates |
| 8 | No IV-rank threshold in the trigger path | ✅ `iv_rank` / `iv_rank_pctile_90d` are written to the payload and the shadow log only |
| 9 | Per-expiry IV | ✅ chain path takes IV per contract from greeks; modeled path interpolates the UW term structure in total variance. No code path spreads one IV across the ladder |
| 10 | Ladder is `K_basis` + next 4 listed strikes, `gain_if_assigned == 0` at `K_basis` | ✅ tested |
| 11 | Illiquid contracts never selected, never pushed | ✅ tested (an illiquid 76% rung loses to a liquid 31% one) |
| 12 | Shadow log writes on every evaluation | ✅ one row per in-scope ticker per scheduled run, firing or not |
| 13 | Nothing in the alert path can place an order | ✅ the path touches Supabase, Public.com market data, UW market data, and Pushover — no order endpoint is imported anywhere in it |

### Caveat on #2

The §7 numbers are reproduced from the spec's **measured** bid/ask/OI/IV, fed
through the same functions the live chain path feeds. That verifies the math and
the selection rules to the penny. It does **not** verify the live Public.com
wiring, because the 2026-08-21 chain is no longer retrievable. Two things are
worth a look on the first live run:

- **Open interest field name.** Public.com's option-chain row is not documented
  as carrying OI, and this repo has never read it before. `readOpenInterest()`
  tries `openInterest` / `open_interest` / `oi` / `openInterestValue` and falls
  back to `null`. Unknown OI degrades liquidity marking to spread-only rather
  than flagging every contract illiquid — but until it is confirmed, the OI half
  of the §3.4 rule may be inert. The 9/25 rung in §7 (OI 431, spread 14.9%) is
  caught by spread anyway; a thin-but-tight contract would not be.
- **Strike-grid freshness.** The listed strike grid is cached daily off one
  probe chain. A same-day strike addition would not be seen until the next day.

## Deliberate deviations

1. **A push requires chain-priced rungs.** The spec says modeled numbers are
   "accurate enough to trigger". They are not enough to *push*: liquidity cannot
   be known from a model, and §3.4 forbids pushing on an untradeable contract.
   Modeled numbers still set the dashboard tier and still escalate to a chain
   pull. When a payload is modeled-only, `push_blocked_reason` says so rather
   than the alert going quietly missing.
2. **Rungs whose window contains earnings are never modeled** (spec §2.5 requires
   this) — they come back `priced_from: 'unpriced'` and force the chain pass.
   Same for the strike ladder, which is chain-only.
3. **`tradingDaysBetween` does not model market holidays.** Across a holiday week
   the 5-day re-arm can expire up to a day or two early. The alternative — a
   holiday calendar — is more machinery than the floor is worth, and the error
   direction costs at most one early alert.
4. **The anon dashboard read does not write a shadow-log row.** Only scheduled
   evaluations do. Acceptance 12 counts rows against in-scope tickers × runs, and
   letting a browser refresh inflate that count would corrupt the baseline the
   §8 backtest depends on.

## §8.3 — answered: what lookback does `iv_rank` use?

**The app never computes it.** `quotes.iv_rank` is a vendor passthrough:

`api/uw-iv.js` → `fetchStockScreener()` (UW `GET /api/screener/stocks`) →
`adaptScreenerRow()` in `src/lib/uwNormalize.js` → `quotes.iv_rank`, copied into
`iv_snapshots` on the same cycle. No window is applied anywhere in this
repository. UW's OpenAPI spec documents `iv_rank` as a screener field and a
`min_iv_rank` / `max_iv_rank` filter but **does not state the lookback**.

Two consequences for §8:

- The 2.3-rank-points-per-1%-IV sensitivity cannot be attributed from the app
  source. It is consistent with a short window rolling off its own high, but the
  repo has no way to confirm that — it would have to come from UW.
- **The historical series is not single-provenance.** `api/ingest-iv.js` wrote
  the same `quotes.iv_rank` / `iv_snapshots` columns from an OpenClaw/Tastytrade
  push before the UW cutover; `api/uw-iv.js` notes it "writes the same quotes
  columns /api/ingest-iv did". So a rank series spanning the switch may mix two
  vendors' definitions. Anyone backtesting the §8.3 hypothesis should check
  where that boundary falls before treating the series as continuous.

This is exactly why `iv_rank_pctile_90d` is computed **locally** from
`iv_snapshots` rather than from the vendor's own rank: a percentile of the
ticker's own trailing history is well-defined regardless of what window the
vendor used, as long as the underlying `iv` is consistent. Note that
`iv_snapshots` begins 2026-07-23, so the 90-day percentile is computed over a
shorter window than its name suggests until roughly late October 2026.

## Operational notes

- **The migration must be applied by hand** in the Supabase SQL editor, per this
  repo's convention. Until then the shadow log fails soft (a warning per run) and
  everything else works.
- **Per-ticker earnings override**: set `app_cache` key `cc_writability_overrides`
  to `{"IREN": {"ignore_earnings": true}}` to un-suppress a name through its
  print. Absent the key, all earnings-crossing rungs are suppressed.
- **Tunables** live at the top of `src/lib/ccWritability.js`: `ROR_ANN_MIN` (30),
  `DTE_LADDER`, `AMBER_BAND_PCT` (5%), `SPREAD_ILLIQUID_PCT` (10%),
  `OI_ILLIQUID_MIN` (500), `LADDER_STRIKES_ABOVE` (4).
- **Cost per intraday run**: one cached IV-curve read per ticker (one UW call per
  ticker per day), and chain pulls only for tickers at AMBER/RED or unpriceable —
  at most ~2 Public.com calls per ladder rung for those, bounded by a 45s budget
  that degrades remaining rungs to `unpriced` rather than overrunning the cron.
