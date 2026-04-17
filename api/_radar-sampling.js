// Pure sampling helpers for Radar capital-required column.
// No I/O — these are driven by caller-provided data.

const DTE_MIN    = 21;
const DTE_MAX    = 45;
const DTE_TARGET = 30;

const DELTA_MIN    = 0.25;
const DELTA_MAX    = 0.35;
const DELTA_TARGET = 0.30;

// Given a list of expiry ISO date strings and today's ISO date, returns the
// expiry closest to 30 DTE within the 21–45 DTE window. Returns null if no
// expiry falls within the window. Ties break to the LOWER DTE.
export function pickSampleExpiry(expiries, todayISO) {
  if (!expiries || expiries.length === 0) return null;

  const today = parseISODate(todayISO);
  if (!today) return null;

  let best     = null;
  let bestDiff = Infinity;
  let bestDTE  = Infinity;

  for (const iso of expiries) {
    const d = parseISODate(iso);
    if (!d) continue;
    const dte = Math.round((d - today) / (24 * 60 * 60 * 1000));
    if (dte < DTE_MIN || dte > DTE_MAX) continue;

    const diff = Math.abs(dte - DTE_TARGET);
    if (diff < bestDiff || (diff === bestDiff && dte < bestDTE)) {
      best     = iso;
      bestDiff = diff;
      bestDTE  = dte;
    }
  }

  return best;
}

// Given a list of { strike, delta } objects (delta as positive magnitude),
// returns the entry with delta closest to 0.30 within the 0.25–0.35 window.
// Returns null if no strike falls in the window. Ties break to the LOWER delta
// (e.g. 0.29 preferred over 0.31).
export function pickSampleStrike(strikes) {
  if (!strikes || strikes.length === 0) return null;

  let best      = null;
  let bestDiff  = Infinity;
  let bestDelta = Infinity;

  for (const s of strikes) {
    if (s == null || s.delta == null) continue;
    const delta = Math.abs(s.delta);
    if (delta < DELTA_MIN || delta > DELTA_MAX) continue;

    const diff = Math.abs(delta - DELTA_TARGET);
    if (diff < bestDiff || (diff === bestDiff && delta < bestDelta)) {
      best      = { strike: s.strike, delta };
      bestDiff  = diff;
      bestDelta = delta;
    }
  }

  return best;
}

export function computeCollateral(strike) {
  if (strike == null) return null;
  const n = Number(strike);
  if (!Number.isFinite(n)) return null;
  return n * 100;
}

function parseISODate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isFinite(d.getTime()) ? d : null;
}
