/**
 * api/_lib/uwCandles.js — wire-shape adapters for Unusual Whales REST candles.
 *
 * The internal candle shape used throughout src/lib/orb/bars.js was derived
 * from the UW *MCP tool's* abbreviated response (`o/h/l/c/start/end/vol/market`,
 * `date` for daily). The REST endpoint api/_lib/uwClient.js actually calls —
 * GET /api/stock/{ticker}/ohlc/{candle_size} — is documented to return
 * `open/high/low/close` (as strings), `start_time`/`end_time`,
 * `volume`, and `market_time`. That mismatch is what silently produced empty
 * sessions in production (see api/orb-open.js history). We have NOT seen a
 * live REST response body to confirm this, so these adapters are tolerant of
 * BOTH shapes rather than committing to one guess.
 *
 * These adapters only rename fields at the wire boundary — they do not
 * coerce types. The existing normalizeBars/normalizeDailyBars (bars.js)
 * already coerce strings to numbers and reject blanks; duplicating that here
 * would just be a second place to get it wrong.
 */

import { etDate } from "../../src/lib/orb/bars.js";

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Raw UW REST (or abbreviated) intraday candle array -> internal shape.
 * @returns {Array<{start,end,o,h,l,c,vol,market}>}
 */
export function adaptIntradayCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === "object")
    .map((b) => ({
      start: b.start ?? b.start_time,
      end: b.end ?? b.end_time,
      o: b.o ?? b.open,
      h: b.h ?? b.high,
      l: b.l ?? b.low,
      c: b.c ?? b.close,
      vol: b.vol ?? b.volume,
      market: b.market ?? b.market_time,
    }));
}

/**
 * Raw UW REST (or abbreviated) daily candle array -> internal shape.
 *
 * Date derivation, in order:
 *   1. An explicit `b.date` that is already a bare YYYY-MM-DD is used as-is.
 *   2. An explicit `b.date` that carries a time component (e.g. a UTC
 *      instant) is reduced to YYYY-MM-DD via etDate — normalizeDailyBars
 *      requires a bare date and would otherwise drop the row.
 *   3. No `date` at all: derive it from a start timestamp via etDate, NEVER
 *      by slicing the ISO string — a UTC instant can land on the previous ET
 *      calendar day and a naive slice would silently shift the bar.
 *
 * @returns {Array<{date,o,h,l,c,vol}>}
 */
export function adaptDailyCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === "object")
    .map((b) => {
      let date = b.date;
      if (date == null) {
        const start = b.start ?? b.start_time;
        if (start) date = etDate(start);
      } else if (typeof date === "string" && !BARE_DATE_RE.test(date)) {
        date = etDate(date);
      }
      return {
        date,
        o: b.o ?? b.open,
        h: b.h ?? b.high,
        l: b.l ?? b.low,
        c: b.c ?? b.close,
        vol: b.vol ?? b.volume,
      };
    });
}
