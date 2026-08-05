/**
 * api/orb-scan.js — Vercel serverless function (cron)
 *
 * Runs every 5 minutes from 09:50 to 11:00 ET. Reads the day's orb_sessions
 * row (written by api/orb-open.js at 09:45), walks every unscanned bar in the
 * session looking for a reversal candlestick pattern outside the opening-
 * range box, and on the FIRST qualifying match sends one Pushover alert with
 * entry/stop/targets. It never places orders.
 *
 * Cursor-driven, not latest-bar-driven: `last_scanned_bar` is persisted and
 * every unscanned bar after the box is evaluated in order, so a late UW
 * response or a missed invocation delays a signal instead of losing it.
 *
 * Only the first non-prevWeak match, on a row that is still `pending` with no
 * `alerted_at`, becomes the alerted "primary". Every other match this scan
 * finds — later ones, and every prevWeak one — is recorded in
 * `shadow_matches` for the log but never pushes.
 *
 * Cron fires wide (UTC), the handler gates on real ET wall-clock via
 * isScanWindow(nowMinutesET()) — never in the cron expression.
 *
 * Soft no-op until UW_API_KEY is set. Self-authenticates.
 */

import { hasUwKey, fetchIntradayOhlc } from "./_lib/uwClient.js";
import { getSupabase, getSession, upsertSession } from "./_lib/orbDb.js";
import { sendPushover } from "./_lib/notify.js";
import { ORB_PARAMS } from "../src/lib/orb/params.js";
import { normalizeBars, sliceSession, etMinutes } from "../src/lib/orb/bars.js";
import { detectPattern, isOutsideBox, matchesDirection } from "../src/lib/orb/patterns.js";
import { buildSignal } from "../src/lib/orb/signal.js";
import {
  isTradingDay, todayET, nowMinutesET, isScanWindow,
  MARKET_OPEN_MIN, BOX_COMPLETE_MIN, WINDOW_END_MIN,
} from "../src/lib/orb/calendar.js";

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

function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "?";
}

function patternLabel(pattern) {
  return pattern.replace(/_/g, " ");
}

// Pushover title + body. entry/stop/targets/risk/box range/minutes elapsed,
// per spec. t1Ahead === false means T1 already sits behind the entry — a bare
// "0.00R" there reads as a data glitch, so we call it out in words instead
// and let T2 carry the only meaningful R:R in the message.
function buildAlertMessage(row, m) {
  const dirWord = m.side === "long" ? "Bullish" : "Bearish";
  const lines = [
    `Entry ${fmt(m.entry)}  Stop ${fmt(m.stop)}  Risk ${fmt(m.risk)}`,
    m.t1Ahead === false
      ? `T1 ${fmt(m.t1)} (already passed at entry)`
      : `T1 ${fmt(m.t1)} (${m.rrT1.toFixed(2)}R)`,
    `T2 ${fmt(m.t2)} (${m.rrT2.toFixed(2)}R)`,
    `Box ${fmt(row.box_low)}–${fmt(row.box_high)}`,
    `${m.minutes_elapsed} min into session`,
  ];
  if (row.grey_band) lines.push("Grey band — liquidity marginal");
  return { title: `QQQ ORB — ${dirWord} ${patternLabel(m.pattern)}`, message: lines.join("\n") };
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
  if (!force && !isScanWindow(mins)) {
    return res.status(200).json({ ok: true, skipped: "outside the scan window", mins });
  }

  try {
    const supabase = getSupabase();
    const row = await getSession(supabase, SYMBOL, sessionDate);

    if (!row) {
      return res.status(200).json({ ok: true, sessionDate, skipped: "no session row" });
    }
    if (row.detection_status === "skipped") {
      return res.status(200).json({ ok: true, sessionDate, skipped: "session did not qualify" });
    }
    if (row.box_high == null) {
      return res.status(200).json({ ok: true, sessionDate, skipped: "box not available" });
    }

    const box = { high: row.box_high, low: row.box_low, range: row.box_range };
    const atr = row.atr14;

    const raw  = await fetchIntradayOhlc(SYMBOL, sessionDate);
    const bars = sliceSession(normalizeBars(raw), sessionDate);

    const cursorMs = row.last_scanned_bar ? new Date(row.last_scanned_bar).getTime() : null;
    let lastScannedBar = row.last_scanned_bar ?? null;
    const shadowMatches = Array.isArray(row.shadow_matches) ? [...row.shadow_matches] : [];

    // Only a row that is still pending with no alerted_at yet can produce a
    // primary this pass. This is fixed for the whole scan, not re-evaluated
    // per bar, so once alerted_at is set nothing this invocation finds can
    // ever become primary — everything lands in shadow_matches.
    const canAlert = row.detection_status === "pending" && !row.alerted_at;
    let primary = null;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const barMin = etMinutes(bar.start);

      if (barMin < BOX_COMPLETE_MIN) continue;      // still inside the box
      if (barMin >= WINDOW_END_MIN) break;           // hard time gate
      const barMs = new Date(bar.start).getTime();
      if (cursorMs != null && barMs <= cursorMs) continue; // already scanned

      lastScannedBar = bar.start;

      const prevBar = bars[i - 1] ?? null;

      let hit;
      try {
        hit = detectPattern(bar, prevBar, atr, ORB_PARAMS);
      } catch (err) {
        // buildSignal (below) documents that an unrecognized pattern throws
        // deliberately as a caller bug — detectPattern shares that contract
        // for an unrecognized shape. One bad bar must not lose the rest of
        // the session's scan.
        console.error("[api/orb-scan] detectPattern threw", err);
        continue;
      }
      if (!hit) continue;
      if (!matchesDirection(hit.side, row.direction)) continue;

      const rule = isOutsideBox(bar, box, row.direction, ORB_PARAMS);
      if (!rule) continue;

      let sig;
      try {
        sig = buildSignal(hit, bar, prevBar, box);
      } catch (err) {
        console.error("[api/orb-scan] buildSignal threw", err);
        continue;
      }
      if (!sig) continue; // structurally incoherent setup — logged nowhere, not a match

      const record = {
        pattern: hit.pattern,
        side: hit.side,
        prev_weak: hit.prevWeak,
        bar_start: bar.start,
        ohlc: { o: bar.o, h: bar.h, l: bar.l, c: bar.c },
        outside_rule: rule,
        minutes_elapsed: barMin - MARKET_OPEN_MIN,
        ...sig,
      };

      if (!primary && canAlert && !hit.prevWeak) {
        primary = record;
      } else {
        shadowMatches.push(record);
      }
    }

    const baseUpdate = {
      symbol: SYMBOL,
      session_date: sessionDate,
      last_scanned_bar: lastScannedBar,
      shadow_matches: shadowMatches,
      params: ORB_PARAMS,
    };

    if (!primary) {
      // Preserve a stored `matched`/`expired` value — only a still-pending
      // row past the deadline gets flipped to expired. Every other case
      // omits the key entirely so upsertSession leaves it untouched.
      if (mins >= WINDOW_END_MIN && row.detection_status === "pending") {
        baseUpdate.detection_status = "expired";
      }
      const written = await upsertSession(supabase, baseUpdate);
      return res.status(200).json({ ok: true, sessionDate, matched: false, id: written.id });
    }

    const { title, message } = buildAlertMessage(row, primary);
    const push = await sendPushover({ title, message, priority: 0 });

    const finalRow = {
      ...baseUpdate,
      pattern: primary.pattern,
      pattern_bar_start: primary.bar_start,
      pattern_ohlc: primary.ohlc,
      outside_rule: primary.outside_rule,
      prev_weak: primary.prev_weak,
      minutes_elapsed: primary.minutes_elapsed,
      entry: primary.entry,
      stop: primary.stop,
      t1: primary.t1,
      t2: primary.t2,
      risk: primary.risk,
      rr_t1: primary.rrT1,
      rr_t2: primary.rrT2,
      t1_ahead: primary.t1Ahead,
      detection_status: "matched",
    };
    // Only record alerted_at when the push actually went out — a skipped
    // push (Pushover unconfigured) still records the match so the log is
    // truthful, but must not dedup a real alert that never fired.
    if (!push.skipped) finalRow.alerted_at = new Date().toISOString();

    const written = await upsertSession(supabase, finalRow);
    return res.status(200).json({
      ok: true, sessionDate, matched: true, pushSkipped: !!push.skipped, id: written.id,
    });
  } catch (err) {
    console.error("[api/orb-scan]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
