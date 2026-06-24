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
