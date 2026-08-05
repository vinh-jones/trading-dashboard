/**
 * api/orb-day.js — Vercel serverless function (read-only)
 *
 * GET /api/orb-day            -> today's orb_sessions row (or null) plus the
 *                                 previous 30 sessions, newest first.
 * GET /api/orb-day?limit=90   -> longer history tail, clamped to 250.
 *
 * Read-only: the ledger UI renders this response directly, nothing here
 * writes to orb_sessions. Unlike api/orb-open.js, api/orb-scan.js and
 * api/orb-outcome.js:
 *   - no cron calls this endpoint, so it does NOT accept CRON_SECRET —
 *     only the APP_SECRET bearer / app_auth cookie the browser uses.
 *   - it makes no Unusual Whales calls, so it does NOT check hasUwKey().
 *
 * NOTE FOR WHOEVER BUILDS THE UI: despite the `_pct` suffix, range_atr_pct
 * is stored as a RATIO (e.g. 0.3908), not a 0-100 percentage. Rendering it
 * raw shows "0.39%" when the real figure is "39%" — multiply by 100 (or run
 * it through a percent formatter) before display.
 */

import { getSupabase } from "./_lib/orbDb.js";
import { todayET } from "../src/lib/orb/calendar.js";

const SYMBOL = "QQQ";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 250;

function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const app    = process.env.APP_SECRET;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  return !!(app && m && decodeURIComponent(m[1]) === app);
}

// A non-numeric or non-positive `limit` falls back to the default rather
// than producing NaN (which would flow straight into a Supabase .limit()
// call and blow up the query).
function parseLimit(raw) {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!authorized(req))     return res.status(401).json({ ok: false, error: "Unauthorized" });

  const limit = parseLimit(req.query.limit);

  try {
    const supabase = getSupabase();
    // Fetch one extra row: if today already has a row it rides along in this
    // same page, and pulling it out below must still leave `limit` rows of
    // history rather than one short.
    const { data, error } = await supabase
      .from("orb_sessions")
      .select("*")
      .eq("symbol", SYMBOL)
      .order("session_date", { ascending: false })
      .limit(limit + 1);
    if (error) throw new Error(`orb_sessions read failed: ${error.message}`);

    const rows = data ?? [];
    const sessionDate = todayET();
    const today = rows.find((r) => r.session_date === sessionDate) ?? null;
    const history = rows.filter((r) => r.session_date !== sessionDate).slice(0, limit);

    return res.status(200).json({ ok: true, today, history });
  } catch (err) {
    console.error("[api/orb-day]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
