/**
 * api/_lib/ccWritabilityDigest.js
 *
 * End-of-day digest for the covered-call writability alert (spec §5).
 *
 * The intraday cron pushes on a RED crossing. This is the FLOOR under it: one
 * message each evening listing everything currently AMBER or RED, whether or
 * not it pushed. Moves that matter here round-trip inside a session — CDE
 * printed $21.88 on 8/21 and closed at $20.975 — so an intraday push that was
 * missed, re-arm-suppressed, or earnings-suppressed is still recoverable that
 * night.
 *
 * Deliberately reports suppressed positions too, with the reason. §4.4's
 * tension is the case in point: IREN's 7d rung pays 76% BECAUSE of the print it
 * is being held through. Suppressing the push is a decision not to sell the
 * event; hiding the number would make that decision invisible instead of
 * deliberate.
 *
 * Once per day via `sent_alerts` — the same per-day dedup the ops alerts use,
 * so a cron retry does not double-send.
 */

import { sendPushover } from "./notify.js";

const DIGEST_ALERT_ID = "cc-writability-digest";

function describe(p) {
  const rung = (p.rungs ?? []).find(r => r.target_dte === (p.best_rate_rung ?? p.push_rung));
  const head = `${p.ticker} ${p.tier}`;

  if (!rung) {
    // AMBER with no qualifying rung: say how far spot has to travel.
    const nearest = (p.rungs ?? [])
      .filter(r => r.spot_required != null)
      .sort((a, b) => a.spot_required - b.spot_required)[0];
    if (!nearest || p.spot == null) return head;
    const gap = ((nearest.spot_required - p.spot) / p.spot) * 100;
    return `${head} — needs ${gap > 0 ? "+" : ""}${gap.toFixed(1)}% to $${nearest.spot_required} (${nearest.dte}d)`;
  }

  const premium = Math.round(rung.premium ?? 0).toLocaleString();
  const line = `${head} — ${rung.dte}d $${rung.strike}, $${premium}, ${(rung.ror_annualized ?? 0).toFixed(1)}% ann`;
  return p.pushable ? line : `${line} (held: ${p.push_blocked_reason ?? "suppressed"})`;
}

export async function sendCcWritabilityDigest({ supabase, payload, todayISO }) {
  const active = (payload?.per_position ?? []).filter(p => p.tier === "RED" || p.tier === "AMBER");
  if (!active.length) return { skipped: true, reason: "nothing_active" };

  try {
    const { data: existing } = await supabase
      .from("sent_alerts")
      .select("alert_id")
      .eq("alert_id", DIGEST_ALERT_ID)
      .eq("sent_date", todayISO)
      .maybeSingle();
    if (existing) return { skipped: true, reason: "already_sent" };
  } catch (err) {
    console.warn("[ccWritabilityDigest] dedup read failed:", err.message);
  }

  const red   = active.filter(p => p.tier === "RED").length;
  const amber = active.length - red;
  const title = `CC writability — ${red} red, ${amber} amber`;
  const message = active
    .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "RED" ? -1 : 1))
    .map(describe)
    .join("\n");

  try {
    await sendPushover({ title, message, priority: 0, url: process.env.DASHBOARD_URL });
  } catch (err) {
    console.error("[ccWritabilityDigest] push failed:", err.message);
    return { skipped: true, reason: "push_failed", error: err.message };
  }

  try {
    await supabase.from("sent_alerts").insert({
      alert_id: DIGEST_ALERT_ID, sent_date: todayISO, title,
    });
  } catch (err) {
    console.warn("[ccWritabilityDigest] sent_alerts insert failed:", err.message);
  }

  return { sent: true, red, amber };
}
