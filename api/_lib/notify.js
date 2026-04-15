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
