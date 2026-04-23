/**
 * Position-shape adapter.
 *
 * The `positions` object has a nested shape:
 *
 *   {
 *     open_csps:       [{ ticker, strike, expiry_date, premium_collected, contracts, ... }],
 *     open_leaps:      [{ ticker, ... }],                   // top-level LEAPs
 *     assigned_shares: [{
 *       ticker,
 *       positions: [{ description, fronted, ... }],         // share lots
 *       active_cc: { strike, expiry_date, premium_collected, contracts, ... } | null,
 *       open_leaps: [{ ... }],                              // covered LEAPs under shares
 *     }],
 *     open_spreads:    [{ ... }],                           // (reserved)
 *   }
 *
 * Components should not reach into this shape directly. Use the helpers here
 * so that a schema change touches one file instead of 12.
 *
 * All helpers are tolerant of missing keys/arrays — pass in a freshly-loaded
 * `positions` object or a partially-hydrated one without guards.
 */

import { parseShareCount } from "./trading.js";

// ── Flat accessors ──────────────────────────────────────────────────────────

/** Top-level open CSPs. Returns [] if absent. */
export function getOpenCSPs(positions) {
  return positions?.open_csps ?? [];
}

/**
 * All assigned-share blocks. Returns [] if absent.
 * Each entry has shape `{ ticker, positions, active_cc, open_leaps, cost_basis_total, ... }`.
 */
export function getAssignedShares(positions) {
  return positions?.assigned_shares ?? [];
}

/**
 * Flat list of all active covered calls, with the parent block's ticker
 * injected onto each (the stored `active_cc` does not carry its own ticker).
 */
export function getOpenCCs(positions) {
  const out = [];
  for (const share of getAssignedShares(positions)) {
    if (share.active_cc) {
      out.push({ ...share.active_cc, ticker: share.ticker });
    }
  }
  return out;
}

/**
 * Flat list of all open LEAPs — both top-level and nested under assigned
 * shares (covered LEAPs). Each carries a `ticker` field (nested LEAPs inherit
 * from the parent share block if their own `ticker` is missing).
 */
export function getOpenLEAPs(positions) {
  const top = (positions?.open_leaps ?? []).map(l => ({ ...l }));
  const nested = [];
  for (const share of getAssignedShares(positions)) {
    for (const leap of share.open_leaps ?? []) {
      nested.push({ ...leap, ticker: leap.ticker ?? share.ticker });
    }
  }
  return [...top, ...nested];
}

/**
 * Flat list of all open short options (CSPs + active CCs).
 * Use when you need to aggregate premium/exposure across shorts.
 */
export function getOpenShorts(positions) {
  return [...getOpenCSPs(positions), ...getOpenCCs(positions)];
}

// ── Assigned-share helpers ──────────────────────────────────────────────────

/** The array of share lots inside an assigned-share block. */
export function getShareLots(shareRow) {
  return shareRow?.positions ?? [];
}

/** Total share count for an assigned-share block (summed across lots). */
export function getTotalShareCount(shareRow) {
  return getShareLots(shareRow).reduce(
    (sum, lot) => sum + parseShareCount(lot.description),
    0,
  );
}

/** Total capital fronted for all lots in an assigned-share block. */
export function getTotalFronted(shareRow) {
  return getShareLots(shareRow).reduce((sum, lot) => sum + (lot.fronted || 0), 0);
}

/**
 * Per-share cost basis for an assigned-share block. Null if no shares parsed.
 * Derives `totalFronted / totalShares` from the underlying lot descriptions,
 * which is the canonical way to reconcile cost-basis across split lots.
 */
export function getCostBasisPerShare(shareRow) {
  const totalShares = getTotalShareCount(shareRow);
  if (!totalShares) return null;
  return getTotalFronted(shareRow) / totalShares;
}
