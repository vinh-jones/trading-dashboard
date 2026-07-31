/**
 * src/lib/lifespanChains.js
 *
 * Share-lifespan chain detection. Groups a ticker's closed trades into
 * "chains" — one share-holding cycle from first acquisition until the running
 * share count returns to zero. Open chains are emitted too.
 *
 * Lives in src/lib/ (not api/_lib/) because both the browser and the
 * serverless functions need it. `api/_lib/lifespan.js` re-exports
 * detectLifespans and DATA_QUALITY_THRESHOLD, so server consumers
 * (position-lifespan, ticker-detail, eod-snapshot) are unaffected.
 *
 * Keep this module dependency-free. It is already in the client bundle by
 * design — the constraint is about what else would ride along: any import
 * here drags its transitive weight into every consumer, and re-coupling this
 * leaf back into the app graph defeats the point of extracting it.
 *
 * Exports: DATA_QUALITY_THRESHOLD, detectLifespans, computeBlendedBasis
 */

export const DATA_QUALITY_THRESHOLD = "2026-01-01";

// ---------------------------------------------------------------------------
// Lifespan detection helpers (private)
// ---------------------------------------------------------------------------

// Sort priority for same-day events: CC bookkeeping first, share-removal last.
// Ensures coordinated_exit CC Close is in cc_history before Shares Sold runs,
// and CC Assigned ends the lifespan before any redundant Shares Sold is seen.
function tradeSortPriority(trade) {
  if (trade.type === "CC" && (trade.subtype === "Close" || trade.subtype === "Roll Loss")) return 1;
  if (trade.type === "CC" && trade.subtype === "Assigned")  return 2;
  if (trade.type === "CSP" && trade.subtype === "Assigned") return 3;
  if (trade.type === "Shares") return 4;
  return 5;
}

// Share count from a lot description when the structured `contracts` column is
// blank. Near-identical to parseShareCount in src/lib/trading.js — duplicated
// rather than imported so this module stays a dependency-free graph leaf;
// importing from trading.js would transitively pull in theme.js, vixBand.js,
// and positionSchema.js. Handles both formats:
//   "Shares ($121, 300)"  → 300      "Shares (400, $80.21)" → 400
// A count-less adjustment row like "Shares ($38)" yields 0 (a P&L-only row that
// must NOT move share count — see the NULL-contracts rule below).
function parseShareCountFromDesc(description) {
  if (!description) return 0;
  const withoutPrices = description.replace(/\$[\d,]+\.?\d*/g, "");
  const m = withoutPrices.match(/\b(\d[\d,]*)\b/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
}

// Resolve the shares a Shares Sold/Exit row disposes. Prefer the structured
// `contracts` column; when it is NULL fall back to the count embedded in the
// description. A row with neither (e.g. "Shares ($38)") resolves to 0 and is
// treated as a pure P&L adjustment that leaves share count untouched.
function resolveSoldShares(trade) {
  if (trade.contracts != null) return parseInt(trade.contracts) || 0;
  return parseShareCountFromDesc(trade.description);
}

// A CC Assigned is "premium-only" when the user also logged the disposal as a
// same-day Shares Sold/Exit lot. In that bookkeeping convention the Shares Sold
// row is authoritative for share removal + realized P&L (it captures price
// appreciation vs. basis), while the CC Assigned row exists to record the CC
// assignment premium. Such a CC keeps its premium in cc_history but must NOT
// also decrement shares, or the disposal double-counts.
function computePremiumOnlyCcIds(allTickerTrades) {
  const soldDates = new Set();
  for (const t of allTickerTrades) {
    if (
      t.type === "Shares" &&
      (t.subtype === "Sold" || t.subtype === "Exit") &&
      resolveSoldShares(t) > 0
    ) {
      soldDates.add(t.close_date);
    }
  }
  const ids = new Set();
  for (const t of allTickerTrades) {
    if (t.type === "CC" && t.subtype === "Assigned" && soldDates.has(t.close_date)) {
      ids.add(t.id);
    }
  }
  return ids;
}

// Net shares for a ticker across trade history. NULL contracts contribute 0
// (ad-hoc P&L-adjustment rows that don't move shares). CC Assigned removes
// shares only when NOT premium-only (see computePremiumOnlyCcIds). Pass
// `beforeDate` to count only trades that closed strictly before that date —
// used to detect a position held across the data-quality cutoff.
function computeNetShares(allTickerTrades, premiumOnlyCcIds, beforeDate = null) {
  let shares = 0;
  for (const t of allTickerTrades) {
    if (beforeDate && !(t.close_date && t.close_date < beforeDate)) continue;
    if (t.type === "CSP" && t.subtype === "Assigned") {
      shares += (parseInt(t.contracts) || 0) * 100;
    } else if (t.type === "Shares" && t.subtype === "Assigned") {
      shares += parseInt(t.contracts) || 0;
    } else if (t.type === "CC" && t.subtype === "Assigned") {
      if (!premiumOnlyCcIds.has(t.id)) shares -= (parseInt(t.contracts) || 0) * 100;
    } else if (t.type === "Shares" && (t.subtype === "Sold" || t.subtype === "Exit")) {
      shares -= resolveSoldShares(t);
    }
  }
  return shares;
}

// ---------------------------------------------------------------------------
// Lifespan detection — running share count
// ---------------------------------------------------------------------------

export function detectLifespans(ticker, allTickerTrades) {
  // Pre-2026 bookkeeping was unreliable; treat anything before
  // DATA_QUALITY_THRESHOLD as if it didn't happen for share-cycle math.
  // Trades themselves remain visible in the Trade Timeline / All-Time Stats —
  // this filter only governs lifespan detection.
  //
  // Carry-over for positions that span the data-quality cutoff. Pre-cutoff
  // bookkeeping is presumed suspect, EXCEPT when the shares are part of a
  // lifespan that reaches into the trusted window:
  //   - currentlyHeld > 0: shares still open today → model full history.
  //   - heldAtCutoff  > 0: shares were held across 2026-01-01 and later
  //     disposed in-window → the pre-cutoff acquisition must come along or the
  //     in-window disposal orphans and the lifespan can never balance to zero.
  // A ticker held entirely before the cutoff (both > 0 false) keeps the cutoff
  // in place — we don't resurface known-suspect data for fully-closed positions.
  const premiumOnlyCcIds = computePremiumOnlyCcIds(allTickerTrades);
  const currentlyHeld    = computeNetShares(allTickerTrades, premiumOnlyCcIds);
  const heldAtCutoff     = computeNetShares(allTickerTrades, premiumOnlyCcIds, DATA_QUALITY_THRESHOLD);
  const carryPreCutoff   = currentlyHeld > 0 || heldAtCutoff > 0;
  const relevant = allTickerTrades.filter(
    (t) =>
      t.close_date &&
      (t.close_date >= DATA_QUALITY_THRESHOLD || carryPreCutoff) &&
      ((t.type === "CSP" && t.subtype === "Assigned") ||
        (t.type === "Shares" && t.subtype === "Assigned") ||
        (t.type === "CC" &&
          (t.subtype === "Close" ||
            t.subtype === "Roll Loss" ||
            t.subtype === "Assigned")) ||
        (t.type === "Shares" &&
          (t.subtype === "Sold" || t.subtype === "Exit")))
  );

  const sorted = [...relevant].sort((a, b) => {
    const d = (a.close_date ?? "").localeCompare(b.close_date ?? "");
    if (d !== 0) return d;
    const pd = tradeSortPriority(a) - tradeSortPriority(b);
    if (pd !== 0) return pd;
    return (a.open_date ?? "").localeCompare(b.open_date ?? "");
  });

  let runningShares = 0;
  let current = null;
  const lifespans = [];
  const orphanWarnings = [];

  for (const trade of sorted) {
    if (trade.type === "CSP" && trade.subtype === "Assigned") {
      const sharesAdded = (trade.contracts ?? 1) * 100;
      if (runningShares === 0) {
        current = {
          ticker,
          assignment_events: [],
          _cspTrades: [],
          cc_history: [],
          partial_dispositions: [],
          exit_event: null,
          _disposalTrade: null,
          _orphanWarnings: [],
        };
      }
      current._cspTrades.push(trade);
      current.assignment_events.push({
        date: trade.close_date,
        triggering_csp_id: trade.id,
        strike: parseFloat(trade.strike) || 0,
        csp_premium_collected: round2(parseFloat(trade.premium_collected) || 0),
        shares_added: sharesAdded,
        capital_added: round2(sharesAdded * (parseFloat(trade.strike) || 0)),
        spot_at_assignment:
          trade.spot_at_assignment != null
            ? parseFloat(trade.spot_at_assignment)
            : null,
      });
      runningShares += sharesAdded;

    } else if (trade.type === "Shares" && trade.subtype === "Assigned") {
      // Direct share purchase — user bought shares outright (not via CSP assignment).
      // contracts field is a direct share count (consistent with Shares/Sold).
      const sharesAdded = trade.contracts ?? 0;
      if (runningShares === 0) {
        current = {
          ticker,
          assignment_events: [],
          _cspTrades: [],
          cc_history: [],
          partial_dispositions: [],
          exit_event: null,
          _disposalTrade: null,
          _orphanWarnings: [],
        };
      }
      current._cspTrades.push(trade);
      current.assignment_events.push({
        date: trade.close_date,
        triggering_csp_id: trade.id,
        strike: parseFloat(trade.strike) || 0,
        csp_premium_collected: 0,
        shares_added: sharesAdded,
        capital_added: round2(sharesAdded * (parseFloat(trade.strike) || 0)),
        spot_at_assignment: null,
        is_direct_purchase: true,
      });
      runningShares += sharesAdded;

    } else if (
      trade.type === "CC" &&
      (trade.subtype === "Close" || trade.subtype === "Roll Loss")
    ) {
      if (current !== null) {
        current.cc_history.push(trade);
      } else {
        orphanWarnings.push(
          `CC ${trade.subtype} for ${ticker} on ${trade.close_date} (id: ${trade.id}) with no active lifespan`
        );
      }

    } else if (trade.type === "CC" && trade.subtype === "Assigned") {
      if (current !== null && premiumOnlyCcIds.has(trade.id)) {
        // Paired with a same-day Shares Sold that is authoritative for the
        // disposal. Keep the CC premium in history; do NOT remove shares here.
        current.cc_history.push(trade);
      } else if (current !== null) {
        const sharesRemoved = (trade.contracts ?? 1) * 100;
        current.cc_history.push(trade);
        const basis = computeBlendedBasis(current.assignment_events);
        const disposalPnl = round2(
          (parseFloat(trade.strike) - basis) * sharesRemoved
        );
        runningShares -= sharesRemoved;
        if (runningShares === 0) {
          current.exit_event = {
            date: trade.close_date,
            exit_type: "called_away",
            exit_price: parseFloat(trade.strike) || null,
            shares_disposed: sharesRemoved,
            share_disposal_pnl: disposalPnl,
            triggering_decision_id: null,
          };
          current._disposalTrade = trade;
          lifespans.push(current);
          current = null;
        } else {
          current.partial_dispositions.push({
            date: trade.close_date,
            type: "called_away",
            shares: sharesRemoved,
            disposal_pnl: disposalPnl,
          });
        }
      }

    } else if (
      trade.type === "Shares" &&
      (trade.subtype === "Sold" || trade.subtype === "Exit")
    ) {
      const sharesRemoved = resolveSoldShares(trade);
      const disposalPnl = round2(parseFloat(trade.premium_collected) || 0);
      if (current !== null) {
        // A same-day premium-only CC Assigned means these shares were called
        // away (the Shares Sold row books the disposal); prefer that framing
        // and the CC strike as the exit price. Otherwise a same-day CC
        // Close/Roll Loss marks a coordinated exit; else a plain manual sale.
        const sameDayCcAssigned = current.cc_history.find(
          (cc) => cc.close_date === trade.close_date && cc.subtype === "Assigned"
        );
        const sameDayCc = current.cc_history.find(
          (cc) =>
            cc.close_date === trade.close_date &&
            (cc.subtype === "Close" || cc.subtype === "Roll Loss")
        );
        const exitType = sameDayCcAssigned
          ? "called_away"
          : sameDayCc
            ? "coordinated_exit"
            : "manual_sale";
        const basis = computeBlendedBasis(current.assignment_events);
        const exitPrice = sameDayCcAssigned
          ? (parseFloat(sameDayCcAssigned.strike) || null)
          : sharesRemoved > 0
            ? round2(basis + disposalPnl / sharesRemoved)
            : null;
        runningShares -= sharesRemoved;
        if (runningShares === 0) {
          current.exit_event = {
            date: trade.close_date,
            exit_type: exitType,
            exit_price: exitPrice,
            shares_disposed: sharesRemoved,
            share_disposal_pnl: disposalPnl,
            triggering_decision_id: null,
          };
          current._disposalTrade = trade;
          lifespans.push(current);
          current = null;
        } else {
          current.partial_dispositions.push({
            date: trade.close_date,
            type: exitType,
            shares: sharesRemoved,
            disposal_pnl: disposalPnl,
          });
        }
      } else {
        orphanWarnings.push(
          `Shares ${trade.subtype} for ${ticker} on ${trade.close_date} (id: ${trade.id}) with no active lifespan`
        );
      }
    }
  }

  if (current !== null) lifespans.push(current);

  if (orphanWarnings.length > 0 && lifespans.length > 0) {
    lifespans[0]._orphanWarnings.push(...orphanWarnings);
  }

  return lifespans;
}

export function computeBlendedBasis(assignmentEvents) {
  const totalCapital = assignmentEvents.reduce((s, e) => s + e.capital_added, 0);
  const totalShares  = assignmentEvents.reduce((s, e) => s + e.shares_added, 0);
  return totalShares > 0 ? totalCapital / totalShares : 0;
}

function round2(n) { return +n.toFixed(2); }
