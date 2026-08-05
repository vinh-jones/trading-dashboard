/**
 * api/orb-outcome.js — Vercel serverless function (cron)
 *
 * Runs once after the close. Replays the day's 5-minute bars from the signal
 * bar onward and records whether price hit the stop, T1, or T2 — see
 * src/lib/orb/outcome.js for the replay logic and why an ambiguous flag
 * exists at all.
 *
 * Retail intraday history is short and expensive: an outcome not captured on
 * the day is effectively unrecoverable, so this is the one write that turns
 * an alert into a fact a later backtest can count.
 *
 * Idempotent: a row whose `outcome_resolved_at` is already set is left alone
 * on a re-run (a stuck cron re-firing must not overwrite a resolved outcome).
 * Only a `matched` row has anything to resolve — `pending`/`expired`/`skipped`
 * rows never got a signal and are skipped with a reason.
 *
 * `?date=` accepts a backfill date; isTradingDay's round-trip validation
 * rejects a malformed one rather than trusting the caller.
 *
 * Soft no-op until UW_API_KEY is set. Self-authenticates.
 */

import { hasUwKey, fetchIntradayOhlc } from "./_lib/uwClient.js";
import { getSupabase, getSession, upsertSession } from "./_lib/orbDb.js";
import { normalizeBars, sliceSession } from "../src/lib/orb/bars.js";
import { resolveOutcome } from "../src/lib/orb/outcome.js";
import { isTradingDay, todayET, nowMinutesET, isAfterClose } from "../src/lib/orb/calendar.js";

const SYMBOL = "QQQ";

// inverted_hammer and bearish_engulfing are shorts; hammer and
// bullish_engulfing are longs. Derived from the PATTERN, not by comparing
// t1/entry — a box edge coinciding with the entry would make a price
// comparison ambiguous or wrong.
const SHORT_PATTERNS = new Set(["inverted_hammer", "bearish_engulfing"]);

function sideForPattern(pattern) {
  return SHORT_PATTERNS.has(pattern) ? "short" : "long";
}

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
  const sessionDate = req.query.date || todayET();

  if (!isTradingDay(sessionDate)) {
    return res.status(200).json({ ok: true, skipped: "not a trading day", sessionDate });
  }
  const mins = nowMinutesET();
  if (!force && !isAfterClose(mins)) {
    return res.status(200).json({ ok: true, skipped: "before the close", sessionDate, mins });
  }

  try {
    const supabase = getSupabase();
    const row = await getSession(supabase, SYMBOL, sessionDate);

    if (!row) {
      return res.status(200).json({ ok: true, sessionDate, skipped: "no session row" });
    }
    if (row.detection_status !== "matched") {
      return res.status(200).json({
        ok: true, sessionDate, skipped: "no signal to resolve", detectionStatus: row.detection_status,
      });
    }
    if (row.outcome_resolved_at) {
      return res.status(200).json({ ok: true, sessionDate, skipped: "already resolved", outcome: row.outcome });
    }

    const raw  = await fetchIntradayOhlc(SYMBOL, sessionDate);
    const bars = sliceSession(normalizeBars(raw), sessionDate);

    const signalMs = new Date(row.pattern_bar_start).getTime();
    const postSignalBars = bars.filter((b) => new Date(b.start).getTime() >= signalMs);

    const sig = {
      side:  sideForPattern(row.pattern),
      entry: row.entry,
      stop:  row.stop,
      t1:    row.t1,
      t2:    row.t2,
    };
    const result = resolveOutcome(sig, postSignalBars);

    const written = await upsertSession(supabase, {
      symbol: SYMBOL,
      session_date: sessionDate,
      outcome: result.outcome,
      outcome_ambiguous: result.ambiguous,
      outcome_resolved_at: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true, sessionDate,
      outcome: result.outcome, ambiguous: result.ambiguous, barsToFill: result.barsToFill,
      barsExamined: postSignalBars.length,
      id: written.id,
    });
  } catch (err) {
    console.error("[api/orb-outcome]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
