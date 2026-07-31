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
      // detectLifespans exposes acquisitions and disposals as separate arrays
      // rather than one ordered stream, so rebuild the stream. On a same-date
      // tie acquisitions go first: you cannot dispose shares you have not
      // acquired, and both events land in the same month either way, so the
      // monthly ledger is unaffected by the choice.
      const events = [];
      for (const a of chain.assignment_events) {
        events.push({ date: a.date, kind: "assign", shares: a.shares_added, id: a.triggering_csp_id });
      }
      for (const d of chain.partial_dispositions) {
        events.push({ date: d.date, kind: "dispose", shares: d.shares });
      }
      if (chain.exit_event) {
        events.push({ date: chain.exit_event.date, kind: "dispose", shares: chain.exit_event.shares_disposed });
      }
      events.sort((a, b) => {
        const d = (a.date ?? "").localeCompare(b.date ?? "");
        if (d !== 0) return d;
        return (a.kind === "assign" ? 0 : 1) - (b.kind === "assign" ? 0 : 1);
      });

      let pool = 0;
      let sharesHeld = 0;
      let firstAssignmentDate = null;

      for (const ev of events) {
        if (ev.kind === "assign") {
          if (!firstAssignmentDate) firstAssignmentDate = ev.date;
          const src = ev.id != null ? tradeById.get(ev.id) : null;
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
          // The disposal that empties the chain takes the whole remaining pool,
          // so releases always sum exactly to the deferred total and no penny
          // drift leaks into the invariant.
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
