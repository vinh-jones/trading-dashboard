/**
 * api/assigned-share-income.js — Vercel serverless function
 *
 * GET /api/assigned-share-income
 *
 * Runs the assigned-share income & health calc on demand against current
 * positions. Used for v1 spot-checking before wiring into the EOD snapshot
 * cron and the UI. Once those land, this endpoint stays available as a
 * "refresh now" hook the UI can call between EOD runs.
 *
 * Auth: requires Bearer ${CRON_SECRET} (same auth as /api/snapshot).
 *
 * Response:
 *   {
 *     ok: true,
 *     fetched_at,
 *     aggregate: { total_monthly_income, healthy, recovering, grinding, unclassified },
 *     per_position: [{ ticker, shares, ... }],
 *     errors: []
 *   }
 */

import { createClient } from "@supabase/supabase-js";
import { computeAssignedShareIncome } from "./_lib/computeAssignedShareIncome.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const supabase = getSupabase();
    const todayISO = new Date().toISOString().slice(0, 10);

    const { data: positions, error } = await supabase.from("positions").select("*");
    if (error) throw new Error(`positions load failed: ${error.message}`);

    const result = await computeAssignedShareIncome({ supabase, positions: positions ?? [], todayISO });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/assigned-share-income]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
