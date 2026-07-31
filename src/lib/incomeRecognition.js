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

  // Deferral is added in Task 4. For now every trade recognizes on close_date
  // in both bases.
  const deferredIds = new Set();
  const releases = [];
  const openChains = [];

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
