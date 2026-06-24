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

// Round to whole dollars (matches how premium_collected/capital_fronted are
// stored elsewhere in parseSheets).
const money = (n) => Math.round(n);

export function deriveSpread({ ticker, short_strike, long_strike, credit, contracts, is_credit, right }) {
  const width = Math.abs(short_strike - long_strike);
  const c = credit ?? 0;
  const n = contracts ?? 0;

  let max_gain, max_loss, breakeven, premium_collected;
  if (is_credit) {
    max_gain = money(c * 100 * n);
    max_loss = money((width - c) * 100 * n);
    breakeven = right === "put" ? short_strike - c : short_strike + c;
    premium_collected = max_gain;              // capturable credit feeds premium + forecast
  } else {
    max_loss = money(c * 100 * n);             // `credit` holds the debit paid
    max_gain = money((width - c) * 100 * n);
    breakeven = right === "call" ? long_strike + c : long_strike - c;
    premium_collected = null;                  // debit spreads are directional, not premium
  }

  const settlement = CASH_SETTLED_INDICES.has(ticker) ? "cash" : "physical";
  return {
    width,
    max_gain, max_loss,
    breakeven: Math.round(breakeven * 100) / 100,
    capital_fronted: max_loss,
    premium_collected,
    settlement,
    assignable: settlement === "physical",
  };
}
