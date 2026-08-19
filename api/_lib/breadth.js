/**
 * api/_lib/breadth.js — S&P 500 breadth (% of members above their 50-day MA).
 *
 * Pure: no I/O, no clock. api/uw-breadth.js does the fetching and the write.
 *
 * This replaces the S5FI reading that OpenClaw used to scrape off Finviz. That
 * pusher died on 2026-07-01 and is not coming back, and Finviz Cloudflare-403s
 * Vercel's datacenter IPs, so the number is now computed from Unusual Whales
 * daily candles instead — one census of the full S&P 500, once per session.
 *
 * A census, not a sample, and deliberately so: Ryan's framework reads this on
 * fixed thresholds (80/65/50/35/20/10). A sampled estimate would carry a
 * confidence interval wide enough to straddle those cutoffs — n=150 gives
 * ±6.6pp against buckets 15pp wide — so the bucket boundaries would stop
 * meaning what they mean today. Measuring all 500 keeps them intact.
 */

export const SMA_PERIOD = 50;

// A partial universe produces a biased percentage, not a noisy one: whichever
// tickers failed to resolve are not missing at random (illiquid names and
// recent listings fail first). Below this share of the requested universe we
// write nothing and let the signal report Unavailable.
export const MIN_COVERAGE = 0.9;

/** Simple mean of the last `period` values. Null if there aren't enough. */
export function sma(values, period = SMA_PERIOD) {
  if (!Array.isArray(values) || values.length < period || period <= 0) return null;
  const window = values.slice(-period);
  if (!window.every((v) => Number.isFinite(v))) return null;
  return window.reduce((a, b) => a + b, 0) / period;
}

/**
 * One ticker's verdict from its normalized daily bars (ascending, from
 * normalizeDailyBars). Returns null when there isn't enough history to judge —
 * a recent listing is unresolved, not "below".
 *
 * @param {Array<{date:string,c:number}>} bars
 * @returns {{sessionDate:string, close:number, sma:number, above:boolean}|null}
 */
export function evaluateTicker(bars, period = SMA_PERIOD) {
  if (!Array.isArray(bars) || bars.length < period) return null;
  const avg = sma(bars.map((b) => b.c), period);
  if (avg == null) return null;
  const last = bars[bars.length - 1];
  if (!last || !Number.isFinite(last.c)) return null;
  return { sessionDate: last.date, close: last.c, sma: avg, above: last.c > avg };
}

/**
 * Fold per-ticker verdicts into one breadth reading.
 *
 * Two guards, both of which produce `ok:false` rather than a number:
 *   - coverage: enough of the requested universe actually resolved
 *   - session alignment: the resolved tickers agree on which session they are
 *     reporting. If the job runs before the daily candle settles, some tickers
 *     return the prior session and some today's; averaging across that mix
 *     silently blends two days. The modal session wins and stragglers are
 *     excluded, but only if the modal share clears MIN_COVERAGE too.
 *
 * @param {Array<object|null>} verdicts  one slot per requested ticker, null = unresolved
 */
export function summarizeBreadth(verdicts, { requested = null, minCoverage = MIN_COVERAGE } = {}) {
  const slots = Array.isArray(verdicts) ? verdicts : [];
  const total = requested ?? slots.length;
  const resolved = slots.filter((v) => v && typeof v === "object");
  const coverage = total > 0 ? resolved.length / total : 0;

  if (total === 0) {
    return { ok: false, reason: "no tickers requested", requested: 0, resolved: 0, coverage: 0 };
  }
  if (coverage < minCoverage) {
    return {
      ok: false,
      reason: `coverage ${(coverage * 100).toFixed(1)}% below ${(minCoverage * 100).toFixed(0)}% floor`,
      requested: total, resolved: resolved.length, coverage,
    };
  }

  // Modal session date across the resolved set.
  const byDate = new Map();
  for (const v of resolved) byDate.set(v.sessionDate, (byDate.get(v.sessionDate) ?? 0) + 1);
  let sessionDate = null;
  let modalCount = 0;
  for (const [d, n] of byDate) {
    // Ties break toward the later date — the settled session, not the stale one.
    if (n > modalCount || (n === modalCount && d > sessionDate)) { sessionDate = d; modalCount = n; }
  }

  const sessionShare = modalCount / total;
  if (sessionShare < minCoverage) {
    return {
      ok: false,
      reason: `only ${(sessionShare * 100).toFixed(1)}% of tickers report session ${sessionDate} — candles look unsettled`,
      requested: total, resolved: resolved.length, coverage, sessionDate, sessionShare,
    };
  }

  const inSession = resolved.filter((v) => v.sessionDate === sessionDate);
  const above = inSession.filter((v) => v.above).length;
  const counted = inSession.length;

  return {
    ok: true,
    sessionDate,
    above,
    total: counted,
    pct: Math.round((above / counted) * 1000) / 10,
    requested: total,
    resolved: resolved.length,
    coverage,
    sessionShare,
  };
}

/**
 * The `as_of` stamp for a reading, derived from the session it measures rather
 * than from wall-clock time. Makes the write idempotent (a re-run for the same
 * session produces the same stamp) and keeps the freshness gate in api/macro.js
 * measuring the age of the *data*, not the age of the job.
 */
export function asOfForSession(sessionDate) {
  return `${sessionDate}T21:00:00.000Z`;
}
