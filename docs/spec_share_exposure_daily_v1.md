# Spec: Daily Assigned-Share Exposure Snapshot (v1)

**Status:** shipped v1.187.0, 2026-09-22
**Code:** `api/_lib/shareExposure.js` (the one algorithm), `api/snapshot.js` §9d (live), `scripts/backfill-share-exposure.js` (full recompute), `supabase/migrations/2026-09-22-share-exposure-daily.sql`

**Why:** On 9/22 the question "what % of the book was in assigned shares in June vs July vs August?" had to be rebuilt by hand from the ledger. Nothing stored share exposure over time. This makes the series a stored fact.

## 1. Table `share_exposure_daily`, one row per calendar day

| column | meaning |
|---|---|
| `snapshot_date` (PK) | the day described |
| `shares_basis_total` | sum of gross assignment basis across share lots open that day |
| `shares_basis_pct` | `shares_basis_total / book_denominator × 100` |
| `book_denominator` | the denominator used that day, stored explicitly (§4) |
| `n_tickers` | distinct tickers with an open share lot |
| `by_ticker` | `{"DRAM": 73000, ...}` basis dollars |
| `leaps_basis_total` | same computation for LEAPS |
| `csp_collateral_total` | same for CSPs (`type = 'CSP'` only, never CCs) |
| `source` | `'live'` or `'backfill_ledger'` |
| `computed_at` | |

Separate table rather than widening `account_snapshots`, which has weekend and pre-April gaps.

**Basis, not market value.** Capital committed at the assignment price, the same basis the concentration limits use.

## 2–3. One algorithm, two callers

A lot is open on day *d* when `open_date <= d < close_date`.

- **Closed lots:** `trades`. Shares need `subtype = 'Sold'`; `subtype = 'Assigned'` rows are same-day event markers that duplicate a Sold row or an open `positions` lot and are excluded. LEAPS and CSP trades rows are used as-is.
- **Open lots:** `positions`. Shares come from `lots[]` (`open_date`, `fronted`); LEAPS (`open_leaps`) and CSPs (`open_csp` **and** `type = 'CSP'`) are one lot per row.
- `trades` is closed-only, so reading it alone drops every current position.

The live row is this algorithm evaluated at today, so live and backfill agree by construction.

**Calendar-day coverage.** The snapshot cron runs Mon–Fri. Each run writes today as `live` and fills any calendar days missing since the last stored row (weekends, missed runs) from the ledger as `backfill_ledger`. An empty table fills from 2025-11-21, so the first cron run is also the one-time backfill. `scripts/backfill-share-exposure.js` recomputes the full range on demand.

LEAPS and CSPs **are** backfilled: `trades` carries row-level `open_date`/`close_date`/`capital_fronted` for both.

## 4. Denominator

Latest `account_snapshots.account_value` on or before *d*; before the first row (2026-04-04), `875131.25`. Known issues, not fixed in v1: `account_value` has held one value since April, and Jan–Mar used a different book size (~$854k). Storing the denominator per row allows recomputation later.

## 5. Description/basis conflicts: surfaced, not resolved

A share lot whose description implies a basis more than $100 from `capital_fronted` is logged (`[share-exposure]` warning) and returned in the snapshot response under `share_exposure.conflicts`. Nothing is auto-corrected. Known at ship time:

- **CDE 2026-05-01:** "Shares (1000, $20)" vs stored 21,000.
- **GLW 2026-07-30** (closed 8/07): "Shares (100, $165)" vs stored 16,750.

## 6. Acceptance (verified in `api/__tests__/shareExposure.test.js` against the real ledger)

| check | expected |
|---|---|
| 2026-09-22 | $369,480 · 8 tickers · 42.2% |
| 2026-08-06 (YTD peak) | $576,650 · 65.9% |
| 2026-01-01 | $114,500 · 13.1% |
| July avg `shares_basis_pct` | 37.6% |
| August avg | 45.7% |
| 2026-09-22 `by_ticker` | DRAM 73,000 · CLS 69,700 · CDE 62,000 · IREN 47,580 · CRDO 44,000 · LRCX 32,500 · KTOS 29,400 · CCJ 11,300 |

Plus: live == backfill for today; no `Assigned` row contributes; CCs never in `csp_collateral_total`; re-runs are identical.

## 7. Out of scope for v1

In-app chart (v2 can read this table), market-value exposure, fixing the static `account_value`.
