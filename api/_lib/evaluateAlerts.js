/**
 * api/_lib/evaluateAlerts.js
 *
 * Shared helper used by both the EOD snapshot cron (`api/snapshot.js`) and
 * the intraday alert-check cron (`api/alert-check.js`).
 *
 * Responsibilities:
 *   1. Load quotes / market_context / roll_analysis (fail-soft).
 *   2. Reshape flat positions and call generateFocusItems().
 *   3. Keep only items whose `rule` is push-worthy in NOTIFY_RULES.
 *   4. Apply transition-based dedup via the `alert_state` table:
 *        - firing now, not in state    → push + insert row  (new)
 *        - firing now, in state        → update last_seen_at (still firing)
 *        - not firing now, in state    → delete row           (resolved, re-eligible)
 *      This means each distinct alert_id pushes exactly once per firing
 *      episode — no day-turnover re-push, no cooldown barrages.
 *   5. Send the push (single `sendPushover` call per new item).
 *
 * Fails soft from the caller's perspective: any thrown error is the caller's
 * to handle (snapshot wraps in try/catch; alert-check surfaces as non-500
 * in the JSON body). But internal best-effort: a push failure logs + skips
 * the state insert for that one alert so it can retry next run.
 */

import { generateFocusItems, NOTIFY_RULES } from "../../src/lib/focusEngine.js";
import { reshapePositions } from "./reshapePositions.js";
import { sendPushover } from "./notify.js";
import { loadQuoteMap, loadMarketContext, loadRollAnalysisMap, loadAssignedShareIncome } from "./loadFocusData.js";

export async function evaluateAlerts({ supabase, accountSnap, positionRows, liveVix }) {
  const reshapedPositions = reshapePositions(positionRows);

  const [quoteMap, marketContext, rollAnalysisMap, assignedShareIncome] = await Promise.all([
    loadQuoteMap(supabase),
    loadMarketContext(supabase),
    loadRollAnalysisMap(supabase),
    loadAssignedShareIncome(supabase),
  ]);

  const items = generateFocusItems(
    reshapedPositions,
    accountSnap,
    marketContext,
    liveVix,
    quoteMap,
    rollAnalysisMap,
    assignedShareIncome,
  );

  const pushItems   = items.filter(i => NOTIFY_RULES[i.rule] === true);
  const firingIds   = new Set(pushItems.map(i => i.id));
  const firingItems = new Map(pushItems.map(i => [i.id, i]));

  // Load currently-outstanding alert state
  const { data: outstandingRows, error: fetchError } = await supabase
    .from("alert_state")
    .select("alert_id");

  if (fetchError) throw new Error(`alert_state read failed: ${fetchError.message}`);

  const outstandingIds = new Set((outstandingRows ?? []).map(r => r.alert_id));

  // Partition: new pushes, still-firing (touch last_seen_at), resolved (delete)
  const newIds        = [...firingIds].filter(id => !outstandingIds.has(id));
  const stillFiringIds = [...firingIds].filter(id =>  outstandingIds.has(id));
  const resolvedIds   = [...outstandingIds].filter(id => !firingIds.has(id));

  const dashboardUrl = process.env.DASHBOARD_URL;
  const now          = new Date().toISOString();

  const sent     = [];
  const skipped  = stillFiringIds.slice();   // reported for observability
  const resolved = resolvedIds.slice();
  const errors   = [];

  // 1. Resolved — delete outstanding rows so the next firing pushes again
  if (resolvedIds.length) {
    const { error: deleteError } = await supabase
      .from("alert_state")
      .delete()
      .in("alert_id", resolvedIds);

    if (deleteError) {
      console.error("[evaluateAlerts] alert_state delete failed:", deleteError);
      errors.push(`delete: ${deleteError.message}`);
    }
  }

  // 2. Still firing — bump last_seen_at so we can age stale rows later if needed
  if (stillFiringIds.length) {
    const { error: touchError } = await supabase
      .from("alert_state")
      .update({ last_seen_at: now })
      .in("alert_id", stillFiringIds);

    if (touchError) {
      console.error("[evaluateAlerts] alert_state touch failed:", touchError);
      errors.push(`touch: ${touchError.message}`);
    }
  }

  // 3. New pushes — send the Pushover push first, then record the state row.
  //    Ordering is deliberate: if insert fails we'd rather re-push on the next
  //    run than leave a row claiming we notified when we didn't.
  for (const id of newIds) {
    const item = firingItems.get(id);
    try {
      await sendPushover({
        title:   item.title,
        message: item.detail,
        url:     dashboardUrl,
      });
    } catch (pushError) {
      console.error(`[evaluateAlerts] sendPushover failed for ${id}:`, pushError);
      errors.push(`push ${id}: ${pushError.message}`);
      continue;   // don't record state — let it retry next run
    }

    const { error: insertError } = await supabase
      .from("alert_state")
      .insert({ alert_id: id, title: item.title, first_fired_at: now, last_seen_at: now });

    if (insertError) {
      console.error(`[evaluateAlerts] alert_state insert failed for ${id}:`, insertError);
      errors.push(`insert ${id}: ${insertError.message}`);
    }
    sent.push(id);
  }

  return { sent, skipped, resolved, errors };
}
