/**
 * Position P/L math — single source of truth.
 *
 * Split across two flavors:
 *   - short options (CSP, CC): G/L = premium collected − current buyback cost
 *   - long options (LEAPs):    G/L = current mark − capital fronted
 *
 * Also houses the "how much of DTE remains" helper used to color-code
 * positions by their pace-to-target.
 *
 * Every function is pure — no quoteMap / positions-object / clock deps.
 * Callers pull the needed primitives (mid, premium, contracts, dates) then
 * dispatch here so that "what does G/L mean" is defined once.
 */

// ── Short-option G/L (CSP, CC) ──────────────────────────────────────────────

/** Dollar G/L on a short option. Null if inputs insufficient. */
export function shortOptionGlDollars({ premiumCollected, optionMid, contracts }) {
  if (!premiumCollected || optionMid == null || !contracts) return null;
  return premiumCollected - optionMid * contracts * 100;
}

/**
 * Percent G/L on a short option, returned as a percentage (e.g. 42 for 42%).
 * Null if inputs insufficient.
 */
export function shortOptionGlPct({ premiumCollected, optionMid, contracts }) {
  const dollars = shortOptionGlDollars({ premiumCollected, optionMid, contracts });
  if (dollars == null) return null;
  return (dollars / premiumCollected) * 100;
}

// ── Long-option G/L (LEAPs) ─────────────────────────────────────────────────

/** Dollar G/L on a long option (LEAP). Null if inputs insufficient. */
export function leapGlDollars({ capitalFronted, optionMid, contracts }) {
  if (!capitalFronted || optionMid == null || !contracts) return null;
  return optionMid * contracts * 100 - capitalFronted;
}

/**
 * Percent G/L on a long option, returned as a percentage (e.g. 12 for 12%).
 * Null if inputs insufficient.
 */
export function leapGlPct({ capitalFronted, optionMid, contracts }) {
  const dollars = leapGlDollars({ capitalFronted, optionMid, contracts });
  if (dollars == null) return null;
  return (dollars / capitalFronted) * 100;
}

// ── DTE pace ────────────────────────────────────────────────────────────────

/**
 * Percent of the original lifetime window remaining, given (open → expiry)
 * bracket and current DTE. Returns a number 0–100, or null if inputs missing.
 *
 * Example: 30-day CSP, 10 days left → 33%.
 */
export function dtePctRemaining({ openDateIso, expiryDateIso, dte }) {
  if (!openDateIso || !expiryDateIso || dte == null) return null;
  const openMs   = new Date(openDateIso   + "T00:00:00").getTime();
  const expiryMs = new Date(expiryDateIso + "T00:00:00").getTime();
  const totalDays = Math.max(1, Math.round((expiryMs - openMs) / (1000 * 60 * 60 * 24)));
  return totalDays > 0 ? (dte / totalDays) * 100 : null;
}
