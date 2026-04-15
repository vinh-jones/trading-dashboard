/**
 * api/_lib/notify.js
 *
 * Thin wrapper around Pushover's messages API.
 * Used by /api/snapshot at EOD to push P1 Focus Engine alerts to iPhone.
 *
 * Env vars (both must be set for a push to go out):
 *   PUSHOVER_APP_TOKEN  — from Pushover "Create an Application"
 *   PUSHOVER_USER_KEY   — user's Pushover account key
 *
 * If either is missing, sendPushover returns { skipped: true } and logs a
 * warning. This keeps preview/local deploys safe without extra config.
 *
 * https://pushover.net/api
 */

const PUSHOVER_URL = "https://api.pushover.net/1/messages.json";

export async function sendPushover({ title, message, priority = 0, url }) {
  const token = process.env.PUSHOVER_APP_TOKEN;
  const user  = process.env.PUSHOVER_USER_KEY;

  if (!token || !user) {
    console.warn("[notify] Pushover env vars missing — skipping push");
    return { skipped: true, reason: "env_missing" };
  }

  const params = { token, user, title, message, priority: String(priority) };
  if (url) {
    params.url = url;
    params.url_title = "Open dashboard";
  }

  const res = await fetch(PUSHOVER_URL, {
    method:  "POST",
    body:    new URLSearchParams(params),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pushover ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Operational alert — fires a Pushover push with once-per-day dedup.
 *
 * Intended for infra/API health issues (throttling, auth failures, ingest
 * breakage) that you want to know about immediately but don't want spamming
 * you every 15 minutes if the issue persists. Reuses the `sent_alerts` table
 * so the first occurrence of the day pushes and subsequent ones don't.
 *
 * Fails soft — returns on error rather than throwing. An ops-alert outage
 * must never cascade into breaking the caller.
 */
export async function sendOpsAlert({ supabase, alertId, title, message, today, priority = 1 }) {
  const dedupId = `ops-${alertId}`;

  try {
    const { data: existing } = await supabase
      .from("sent_alerts")
      .select("alert_id")
      .eq("alert_id", dedupId)
      .eq("sent_date", today)
      .maybeSingle();

    if (existing) {
      console.log(`[notify] ops-alert ${dedupId} already sent today — skipping`);
      return { skipped: true, reason: "already_sent" };
    }

    const result = await sendPushover({ title, message, priority });

    const { error: insertError } = await supabase
      .from("sent_alerts")
      .insert({ alert_id: dedupId, sent_date: today, title });
    if (insertError) console.warn(`[notify] sent_alerts insert failed for ${dedupId}:`, insertError.message);

    return result;
  } catch (err) {
    console.error(`[notify] sendOpsAlert(${dedupId}) failed:`, err.message);
    return { skipped: true, reason: "error", error: err.message };
  }
}
