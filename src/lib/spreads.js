// src/lib/spreads.js
//
// Frontend, pure, live (quote-driven) vertical-spread math. Static derivations
// (width/max gain/loss/breakeven) are computed once in lib/spreadMath.js at
// parse time and read off the position; this module covers what needs live
// quotes: cushion-to-breakeven, spread mark, and unrealized G/L.

// A bull-put / bull-call profits when the underlying rises (safe ABOVE
// breakeven); a bear-call / bear-put profits when it falls (safe BELOW).
function isBullish(subtype) {
  return subtype === "Bull Put" || subtype === "Bull Call";
}

const WARN_BAND = 0.01; // within 1% of breakeven

export function cushionToBreakeven({ spot, breakeven, subtype }) {
  if (spot == null || breakeven == null) return null;
  // distance_pct > 0 means "on the safe side of breakeven".
  const raw = isBullish(subtype)
    ? (spot - breakeven) / breakeven
    : (breakeven - spot) / breakeven;
  let state;
  if (raw < 0) state = "breached";
  else if (raw <= WARN_BAND) state = "warn";
  else state = "safe";
  return { distance_pct: raw, state };
}

export function spreadMark({ shortMid, longMid }) {
  if (shortMid == null || longMid == null) return null;
  return shortMid - longMid;
}

export function spreadUnrealized({ credit, shortMid, longMid, contracts, is_credit, max_gain }) {
  const mark = spreadMark({ shortMid, longMid });
  if (mark == null || credit == null || !contracts) {
    return { mark: null, gl_dollars: null, pct_captured: null, close_50: false };
  }
  // Credit spread: you collected `credit`, it costs `mark` to close now.
  const gl_dollars = is_credit
    ? (credit - mark) * 100 * contracts
    : (mark - credit) * 100 * contracts; // debit: bought at `credit` (the debit), now worth `mark`
  const pct_captured = (is_credit && max_gain) ? gl_dollars / max_gain : null;
  return {
    mark,
    gl_dollars: Math.round(gl_dollars),
    pct_captured,
    close_50: pct_captured != null && pct_captured >= 0.5,
  };
}
