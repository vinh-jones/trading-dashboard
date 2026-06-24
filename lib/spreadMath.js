// lib/spreadMath.js
//
// Pure, dependency-free vertical-spread math. Backend-side (imported by
// lib/parseSheets.js) so it does NOT import from src/. All static derivations
// happen once at parse time and are stored on the open_spreads entry; the
// frontend reads the stored fields. Live quote-driven math lives separately in
// src/lib/spreads.js.

// Cash-settled, European-style index options — no early assignment.
export const CASH_SETTLED_INDICES = new Set([
  "SPX", "SPXW", "XSP", "NDX", "NDXP", "RUT", "RUTW", "VIX", "DJX", "OEX", "XEO",
]);

// txnType label → spread classification. is_credit drives premium treatment;
// right drives which option chain (put vs call) and the breakeven formula.
const SPREAD_TYPES = {
  "bull put spread":  { subtype: "Bull Put",  is_credit: true,  right: "put"  },
  "bear call spread": { subtype: "Bear Call", is_credit: true,  right: "call" },
  "bull call spread": { subtype: "Bull Call", is_credit: false, right: "call" },
  "bear put spread":  { subtype: "Bear Put",  is_credit: false, right: "put"  },
};

export function classifySpread(txnType) {
  if (!txnType) return null;
  const hit = SPREAD_TYPES[txnType.trim().toLowerCase()];
  return hit ? { ...hit } : null;
}

export function parseSpreadStrikes(cell) {
  if (!cell || typeof cell !== "string") return null;
  const parts = cell.split("/");
  if (parts.length !== 2) return null;
  const num = (s) => {
    const n = parseFloat(String(s).replace(/[$,\s]/g, ""));
    return isNaN(n) ? null : n;
  };
  const short_strike = num(parts[0]);
  const long_strike = num(parts[1]);
  if (short_strike == null || long_strike == null) return null;
  return { short_strike, long_strike };
}
