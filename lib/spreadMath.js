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

// Canonical spread phrases, scanned in a fixed order. is_credit drives premium
// treatment; right drives which option chain (put vs call) and the breakeven
// formula. Real rows contain exactly one of these phrases.
const SPREAD_TYPES = [
  { phrase: "bull put spread",  subtype: "Bull Put",  is_credit: true,  right: "put"  },
  { phrase: "bear call spread", subtype: "Bear Call", is_credit: true,  right: "call" },
  { phrase: "bull call spread", subtype: "Bull Call", is_credit: false, right: "call" },
  { phrase: "bear put spread",  subtype: "Bear Put",  is_credit: false, right: "put"  },
];

// Classify a spread by finding any canonical phrase as a case-insensitive
// SUBSTRING of the input. The live sheet carries the label in the description
// with trailing text (e.g. "Bull Put Spread (Max gain $1094)") and a bare
// "SPREAD" in the txnType column, so substring matching — not exact match — is
// mandatory. Returns null when no phrase is present.
export function classifySpread(text) {
  if (!text || typeof text !== "string") return null;
  const haystack = text.toLowerCase();
  // First match wins; real rows contain exactly one phrase, so order is moot.
  const hit = SPREAD_TYPES.find(t => haystack.includes(t.phrase));
  return hit ? { subtype: hit.subtype, is_credit: hit.is_credit, right: hit.right } : null;
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

/**
 * Assign the short/long roles from the spread's geometry rather than from the
 * order the strikes were typed into the sheet.
 *
 * The two roles are fully determined by (is_credit, right) plus the two strike
 * values — the typed order carries no extra information:
 *
 *   Bull Put   (credit, put)  → sell the HIGHER put,  buy the lower
 *   Bear Call  (credit, call) → sell the LOWER call,  buy the higher
 *   Bull Call  (debit,  call) → buy  the LOWER call,  sell the higher
 *   Bear Put   (debit,  put)  → buy  the HIGHER put,  sell the lower
 *
 * Correctly-ordered rows pass through untouched; a reversed cell (e.g. a bear
 * put typed "770/750" instead of "750/770") self-corrects, which otherwise
 * lands a breakeven computed off the wrong leg. Passes through unchanged when
 * either strike is missing or the row never classified.
 */
export function normalizeSpreadLegs({ short_strike, long_strike, is_credit, right }) {
  if (short_strike == null || long_strike == null || is_credit == null || !right) {
    return { short_strike, long_strike };
  }
  const shortIsHigher = is_credit ? right === "put" : right === "call";
  const hi = Math.max(short_strike, long_strike);
  const lo = Math.min(short_strike, long_strike);
  return shortIsHigher
    ? { short_strike: hi, long_strike: lo }
    : { short_strike: lo, long_strike: hi };
}

// Round to whole dollars (matches how premium_collected/capital_fronted are
// stored elsewhere in parseSheets).
const money = (n) => Math.round(n);

/**
 * Max gain on a debit spread: the width you can't lose, less what you paid.
 * Unlike a credit spread's max gain (which is the collected premium, stored as
 * premium_collected), this is derivable but not persisted — api/_lib/
 * reshapePositions.js re-derives it on the read path so both surfaces agree.
 */
export function debitMaxGain({ width, debit, contracts }) {
  if (width == null || debit == null || !contracts) return null;
  return money((width - debit) * 100 * contracts);
}

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
    max_gain = debitMaxGain({ width, debit: c, contracts: n }) ?? 0;
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
