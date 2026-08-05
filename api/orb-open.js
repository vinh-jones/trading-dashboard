/**
 * api/orb-open.js — Vercel serverless function (cron)
 *
 * Runs once per session at 09:45 ET. Builds the opening-range box from the
 * first three 5-minute bars, computes ATR(14) from prior sessions only, and
 * writes gates 0-4 of the day's orb_sessions row. Sends no alerts.
 *
 * A row is written on EVERY trading day, including days that fail the
 * liquidity gate — range_atr_pct is stored continuously so the 25% threshold
 * stays recalibratable from the log. On a fail, gates 5-7 are marked `skipped`,
 * which is a different fact from `expired` (searched, found nothing).
 *
 * Cron fires wide (13:45Z and 14:45Z, covering EDT and EST) and the handler
 * gates on actual ET wall-clock — a cron expression alone would drift by an
 * hour twice a year.
 *
 * Soft no-op until UW_API_KEY is set. Self-authenticates.
 */

import { hasUwKey, fetchDailyOhlc, fetchIntradayOhlc } from "./_lib/uwClient.js";
import { getSupabase, upsertSession } from "./_lib/orbDb.js";
import { ORB_PARAMS } from "../src/lib/orb/params.js";
import { normalizeBars, normalizeDailyBars, sliceSession } from "../src/lib/orb/bars.js";
import { wilderAtr } from "../src/lib/orb/atr.js";
import { buildBox, evaluateLiquidity, seekDirection } from "../src/lib/orb/openingRange.js";
import { isTradingDay, todayET, nowMinutesET, isBoxWindow } from "../src/lib/orb/calendar.js";

const SYMBOL = "QQQ";

function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cron   = process.env.CRON_SECRET;
  const app    = process.env.APP_SECRET;
  if (cron && bearer === cron) return true;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  return !!(app && m && decodeURIComponent(m[1]) === app);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req))     return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey())          return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured" });

  const force       = req.query.force === "1";
  const sessionDate = todayET();

  if (!isTradingDay(sessionDate)) {
    return res.status(200).json({ ok: true, skipped: "not a trading day", sessionDate });
  }
  const mins = nowMinutesET();
  if (!force && !isBoxWindow(mins)) {
    return res.status(200).json({ ok: true, skipped: "outside the 09:45 ET box window", mins });
  }

  try {
    const supabase = getSupabase();

    const [dailyRaw, intraRaw] = await Promise.all([
      fetchDailyOhlc(SYMBOL, ORB_PARAMS.atrWarmupBars + 30),
      fetchIntradayOhlc(SYMBOL, sessionDate),
    ]);

    // Prior sessions only — today's partial bar must never reach the ATR.
    const daily = normalizeDailyBars(dailyRaw)
      .filter((b) => b.date < sessionDate)
      .slice(-ORB_PARAMS.atrWarmupBars);

    const atr     = wilderAtr(daily, ORB_PARAMS.atrPeriod);
    const atrAsOf = daily.length ? daily[daily.length - 1].date : null;

    const session = sliceSession(normalizeBars(intraRaw), sessionDate);
    const box     = buildBox(session);

    if (!box) {
      await upsertSession(supabase, {
        symbol: SYMBOL, session_date: sessionDate,
        detection_status: "skipped",
        atr14: atr, atr_asof: atrAsOf,
        params: ORB_PARAMS,
        error: `opening range unavailable (${session.length} regular-session bars)`,
      });
      return res.status(200).json({ ok: true, sessionDate, box: null, reason: "no opening range" });
    }

    const liq       = evaluateLiquidity(box.range, atr, ORB_PARAMS);
    const direction = liq.qualified ? seekDirection(box.color) : null;

    const row = await upsertSession(supabase, {
      symbol: SYMBOL,
      session_date: sessionDate,
      box_high: box.high, box_low: box.low, box_range: box.range,
      candle_color: box.color, candle_open: box.open, candle_close: box.close,
      atr14: atr, atr_threshold: liq.threshold, atr_asof: atrAsOf,
      range_atr_pct: liq.rangeAtrPct,
      qualified: liq.qualified, grey_band: liq.greyBand,
      direction,
      // Not qualifying means gates 5-7 were never searched — `skipped`, not
      // `expired`. Conflating them corrupts any later hit-rate count.
      detection_status: liq.qualified ? "pending" : "skipped",
      params: ORB_PARAMS,
      error: null,
    });

    return res.status(200).json({ ok: true, sessionDate, box, atr, liq, direction, id: row.id });
  } catch (err) {
    console.error("[api/orb-open]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
