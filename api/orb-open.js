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
 * The daily (ATR) and intraday (box) fetches run via Promise.allSettled, not
 * Promise.all — a single UW hiccup must not erase the day's record entirely.
 * If either fetch rejects, a degraded row is still written: whichever of
 * box/ATR the surviving fetch produced, `detection_status: "skipped"`, and an
 * `error` naming which fetch failed and why. A field from the failed fetch is
 * omitted (never null'd) — omission means "don't know", an explicit null on
 * this column would mean "know it's empty" and would corrupt a later re-run
 * that fills it in. `error: null` on the clean-success path is the one
 * deliberate exception, clearing a stale error from a prior degraded run.
 *
 * Soft no-op until UW_API_KEY is set. Self-authenticates.
 */

import { hasUwKey, fetchDailyOhlc, fetchIntradayOhlc, fetchDailyOhlcRaw, fetchIntradayOhlcRaw } from "./_lib/uwClient.js";
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

function reasonText(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req))     return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (!hasUwKey())          return res.status(200).json({ ok: true, skipped: "UW_API_KEY not configured" });

  const force       = req.query.force === "1";
  const debug       = req.query.debug === "1";
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

    const [dailySettled, intraSettled] = await Promise.allSettled([
      fetchDailyOhlc(SYMBOL, ORB_PARAMS.atrWarmupBars + 30),
      fetchIntradayOhlc(SYMBOL, sessionDate),
    ]);
    const dailyOk = dailySettled.status === "fulfilled";
    const intraOk = intraSettled.status === "fulfilled";

    // Prior sessions only — today's partial bar must never reach the ATR.
    // When the daily fetch itself failed there is nothing to filter — `daily`
    // stays empty and atr/atrAsOf stay null, which is a "don't know", not the
    // same fact as "computed and it was null" (insufficient warm-up).
    const daily = dailyOk
      ? normalizeDailyBars(dailySettled.value)
          .filter((b) => b.date < sessionDate)
          .slice(-ORB_PARAMS.atrWarmupBars)
      : [];
    const atr     = dailyOk ? wilderAtr(daily, ORB_PARAMS.atrPeriod) : null;
    const atrAsOf = dailyOk && daily.length ? daily[daily.length - 1].date : null;

    const session = intraOk ? sliceSession(normalizeBars(intraSettled.value), sessionDate) : [];
    const box     = buildBox(session);

    // Debug affordance (?debug=1, still behind the normal auth check above):
    // surface the first raw candle from each fetch BEFORE adaptation, plus
    // post-normalization counts, so the real UW wire format can be confirmed
    // instead of guessed at again. Extra requests, so only made when asked.
    let debugInfo;
    if (debug) {
      const [dailyRawSettled, intraRawSettled] = await Promise.allSettled([
        fetchDailyOhlcRaw(SYMBOL, ORB_PARAMS.atrWarmupBars + 30),
        fetchIntradayOhlcRaw(SYMBOL, sessionDate),
      ]);
      const firstOf = (settled) =>
        settled.status === "fulfilled" && Array.isArray(settled.value) && settled.value.length
          ? settled.value[0]
          : null;
      debugInfo = {
        dailyFirstRawCandle: firstOf(dailyRawSettled),
        intradayFirstRawCandle: firstOf(intraRawSettled),
        dailyNormalizedCount: daily.length,
        intradayNormalizedCount: session.length,
      };
    }

    // A fetch failure is recorded, not thrown past — the day still gets a
    // row, just a degraded one built from whichever fetch survived. Fields
    // from the failed fetch are omitted entirely (never sent as null): per
    // upsertSession's semantics an explicit null CLEARS a stored value, and
    // "we never fetched this" is not the same fact as "we fetched it and it's
    // empty". `qualified`/`direction`/etc. are skipped too — evaluateLiquidity
    // needs both box and ATR, and we deliberately don't call it on a half set.
    if (!dailyOk || !intraOk) {
      const errors = [];
      if (!dailyOk) errors.push(`daily OHLC fetch failed: ${reasonText(dailySettled.reason)}`);
      if (!intraOk) errors.push(`intraday OHLC fetch failed: ${reasonText(intraSettled.reason)}`);

      const row = {
        symbol: SYMBOL, session_date: sessionDate,
        detection_status: "skipped",
        params: ORB_PARAMS,
        error: errors.join("; "),
      };
      if (dailyOk) { row.atr14 = atr; row.atr_asof = atrAsOf; }
      if (box) {
        row.box_high = box.high; row.box_low = box.low; row.box_range = box.range;
        row.candle_color = box.color; row.candle_open = box.open; row.candle_close = box.close;
      }

      const written = await upsertSession(supabase, row);
      return res.status(200).json({
        ok: true, sessionDate, degraded: true, errors, id: written.id,
        ...(debug ? { debug: debugInfo } : {}),
      });
    }

    if (!box) {
      await upsertSession(supabase, {
        symbol: SYMBOL, session_date: sessionDate,
        detection_status: "skipped",
        atr14: atr, atr_asof: atrAsOf,
        params: ORB_PARAMS,
        error: `opening range unavailable (${session.length} regular-session bars)`,
      });
      return res.status(200).json({
        ok: true, sessionDate, box: null, reason: "no opening range",
        ...(debug ? { debug: debugInfo } : {}),
      });
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

    return res.status(200).json({
      ok: true, sessionDate, box, atr, liq, direction, id: row.id,
      ...(debug ? { debug: debugInfo } : {}),
    });
  } catch (err) {
    console.error("[api/orb-open]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
