/**
 * src/lib/incomeRecognition.js
 *
 * Two recognition bases over the same closed-trade rows:
 *
 *   booked        — today's behavior everywhere in the app: every closed
 *                   trade's premium_collected recognized on its close_date.
 *   distributable — brokerage behavior: CSP-assignment premium is deferred at
 *                   assignment and released as the acquired shares are
 *                   disposed, because an assigned put's premium adjusts the
 *                   share cost basis rather than realizing as income.
 *
 * Only `type === "CSP" && subtype === "Assigned"` rows move between the two.
 *
 * Invariant, asserted in tests and displayed in the UI as a self-check:
 *
 *   cumulative booked − cumulative distributable ≡ outstanding deferred
 *
 * POOLING MODEL — blended average, not lot-level, not FIFO. Deferred premium
 * is pooled across the whole share-holding chain and released in proportion to
 * the shares disposed, so a disposal releases a slice of every assignment's
 * premium rather than the specific lot's. A brokerage tracks basis per tax lot,
 * so month-to-month releases here will not match any specific lot's disposal —
 * only the total is guaranteed, and it always drains fully by chain close. This
 * is a deliberate modeling choice: the lifespan model computes disposal P&L
 * against a blended basis (computeBlendedBasis) and carries no lot identity at
 * all, so matching a brokerage's FIFO exactly would mean teaching the lifespan
 * model per-lot identity first. Since this module's whole purpose is brokerage
 * fidelity, the one place it deliberately diverges is called out here.
 *
 * PRE-CUTOFF RESTATEMENT — historical months can move when you open an
 * unrelated new position, and that is expected. Whether a pre-2026 CSP
 * assignment is deferred at all depends on `carryPreCutoff` in
 * lifespanChains.js, which flips on once a ticker becomes currently-held. A
 * 2025 cycle on AAA that is fully closed reports 2025-08 distributable = 400 on
 * its own; open a new 2026 AAA position and those same historical rows restate
 * to 2025-08 distributable = 0 with 2025-11 distributable = 700, because the
 * pre-cutoff acquisition is now carried into the chain and its premium defers
 * to the disposal. Cumulative totals and the invariant are unaffected — only
 * the month-by-month split moves. Surprising, but not a bug.
 *
 * See docs/superpowers/specs/2026-07-31-deferred-csp-assignment-income-design.md
 */

import { detectLifespans } from "./lifespanChains.js";

const round2 = (n) => +n.toFixed(2);

/** "2026-07-15" → "2026-07". Null-safe. */
function monthOf(iso) {
  return iso ? iso.slice(0, 7) : null;
}

/** Empty month row. All figures are dollars. */
function emptyMonth(month) {
  return {
    month,
    booked: 0,
    distributable: 0,
    delta: 0,
    deferredAdded: 0,
    deferredReleased: 0,
    outstandingAtMonthEnd: 0,
  };
}

/**
 * Walk every ticker's lifespan chains, carrying a running premium pool and
 * share count. Returns the set of CSP-assignment trade ids that entered a
 * chain (and are therefore deferred), the dated release amounts, and the
 * still-open chains holding the outstanding balance.
 *
 * Only chain-participating assignments are deferred. detectLifespans drops
 * pre-DATA_QUALITY_THRESHOLD trades for tickers fully closed before the
 * cutoff; such a CSP has no disposal to release against, so deferring it
 * would strand its premium in neither basis and break the invariant.
 */
function walkChains(rows) {
  const deferredIds = new Set();
  const releases = [];
  const openChains = [];

  const tradeById = new Map();
  for (const t of rows) if (t.id != null) tradeById.set(t.id, t);

  const byTicker = new Map();
  for (const t of rows) {
    if (!t.ticker) continue;
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
    byTicker.get(t.ticker).push(t);
  }

  for (const [ticker, tickerTrades] of byTicker) {
    for (const chain of detectLifespans(ticker, tickerTrades)) {
      // detectLifespans emits ordered_events in its own processing order,
      // including tradeSortPriority's same-day sequencing. Consume it directly
      // — reconstructing an order from the separate assignment/disposition
      // arrays loses same-day sequencing, and an acquisition and a disposal
      // sharing a date change the denominator and therefore the dollars
      // released that month.
      const events = chain.ordered_events ?? [];

      let pool = 0;
      let sharesHeld = 0;
      let firstAssignmentDate = null;

      for (const ev of events) {
        if (ev.kind === "acquire") {
          if (!firstAssignmentDate) firstAssignmentDate = ev.date;
          const src = ev.trade_id != null ? tradeById.get(ev.trade_id) : null;
          // Only a CSP assignment contributes premium. A direct Shares/Assigned
          // purchase adds shares only — its premium_collected is share P&L, not
          // option premium, and must never enter the pool.
          if (src && src.type === "CSP" && src.subtype === "Assigned") {
            pool = round2(pool + (Number(src.premium_collected) || 0));
            deferredIds.add(src.id);
          }
          sharesHeld += ev.shares || 0;
        } else {
          if (sharesHeld <= 0) continue;
          const disposed = Math.min(ev.shares || 0, sharesHeld);
          if (disposed <= 0) continue;
          // Pro-rata against the shares held RIGHT NOW, not against the shares
          // ever acquired. Acquire 100 shares for $400, then sell 50: release
          // $200 (50/100 of the pool as it stands). A later assignment re-blends
          // the pool, so the denominator has to be read at disposal time. A
          // fixed denominator (disposed ÷ total ever acquired) would under-
          // release that early exit, because assignments that had not happened
          // yet would retroactively inflate its divisor.
          //
          // The `disposed >= sharesHeld` arm signals intent — the disposal that
          // empties the chain hands over the whole remaining pool — but it is
          // not what makes releases sum exactly. That comes from `pool` being
          // round2-normalized on every write: each release is round2'd and
          // subtracted from an already-round2'd pool, so the balance stays a
          // clean 2-decimal figure and the final ratio-1.0 release drains it to
          // zero with no penny drift. (`disposed` is clamped to `sharesHeld`,
          // so this arm fires only at ratio exactly 1.0, where round2(pool * 1)
          // === pool anyway. It is explicitness, not arithmetic.)
          const amount = disposed >= sharesHeld ? pool : round2(pool * (disposed / sharesHeld));
          if (amount !== 0) releases.push({ date: ev.date, amount });
          pool = round2(pool - amount);
          sharesHeld -= disposed;
        }
      }

      if (pool !== 0 || sharesHeld > 0) {
        openChains.push({ ticker, firstAssignmentDate, sharesHeld, deferredRemaining: pool });
      }
    }
  }

  return { deferredIds, releases, openChains };
}

/**
 * @param {Array<object>} trades closed-trade rows. Accepts raw DB rows or
 *        normalizeTrade output — both carry close_date and premium_collected.
 * @returns {{
 *   months: Array<object>,
 *   outstandingDeferred: number,
 *   cumulativeBooked: number,
 *   cumulativeDistributable: number,
 *   openChains: Array<object>,
 * }}
 */
export function buildRecognitionLedger(trades) {
  const rows = Array.isArray(trades) ? trades : [];

  const { deferredIds, releases, openChains } = walkChains(rows);

  const byMonth = new Map();
  const monthRow = (m) => {
    if (!byMonth.has(m)) byMonth.set(m, emptyMonth(m));
    return byMonth.get(m);
  };

  for (const t of rows) {
    const m = monthOf(t.close_date);
    if (!m) continue;
    const amount = Number(t.premium_collected) || 0;
    const row = monthRow(m);
    row.booked = round2(row.booked + amount);

    const isDeferred =
      t.type === "CSP" && t.subtype === "Assigned" && deferredIds.has(t.id);
    if (isDeferred) {
      row.deferredAdded = round2(row.deferredAdded + amount);
    } else {
      row.distributable = round2(row.distributable + amount);
    }
  }

  for (const r of releases) {
    const m = monthOf(r.date);
    if (!m) continue;
    const row = monthRow(m);
    row.distributable = round2(row.distributable + r.amount);
    row.deferredReleased = round2(row.deferredReleased + r.amount);
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  let cumulativeBooked = 0;
  let cumulativeDistributable = 0;
  let outstanding = 0;
  for (const row of months) {
    row.delta = round2(row.booked - row.distributable);
    outstanding = round2(outstanding + row.deferredAdded - row.deferredReleased);
    row.outstandingAtMonthEnd = outstanding;
    cumulativeBooked = round2(cumulativeBooked + row.booked);
    cumulativeDistributable = round2(cumulativeDistributable + row.distributable);
  }

  return {
    months,
    outstandingDeferred: outstanding,
    cumulativeBooked,
    cumulativeDistributable,
    openChains,
  };
}
