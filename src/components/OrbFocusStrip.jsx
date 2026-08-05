import { useEffect, useState } from "react";
import { theme } from "../lib/theme";
import { nowMinutesET, BOX_COMPLETE_MIN, WINDOW_END_MIN } from "../lib/orb/calendar";

function n(v, d = 2) {
  return v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);
}

/**
 * T1 is the near box edge and can already sit behind the entry (t1Ahead ===
 * false) — showing a bare "0.00R" there reads as a data glitch. Match the
 * wording api/orb-scan.js's buildAlertMessage uses for the Pushover push, so
 * the phone alert and this strip agree.
 */
function t1Label(row) {
  if (row.t1 == null) return "—";
  return row.t1_ahead === false
    ? `${n(row.t1)} (already passed at entry)`
    : `${n(row.t1)} (${n(row.rr_t1)}R)`;
}

/**
 * Time-boxed live view of the day's opening-range setup.
 *
 * Renders null outside 09:45-11:00 ET and on days that failed the liquidity
 * gate, so it costs nothing on the (many) sessions where QQQ does not set up.
 * The Pushover alert is the thing that gets acted on; this exists so the levels
 * are already on screen when it lands.
 *
 * Deliberately does NOT route through src/lib/focusEngine.js — that engine
 * derives items from positions and quotes, and ORB is neither. This fetches
 * /api/orb-day itself so it deletes cleanly if the edge does not prove out.
 *
 * Time gating uses nowMinutesET() (America/New_York), never browser-local —
 * this is market-hours logic and stays on ET regardless of where the user sits.
 */
export function OrbFocusStrip() {
  const [row, setRow]   = useState(null);
  const [mins, setMins] = useState(() => nowMinutesET());

  const inWindow = mins >= BOX_COMPLETE_MIN && mins < WINDOW_END_MIN;

  useEffect(() => {
    const tick = setInterval(() => setMins(nowMinutesET()), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!inWindow) return;
    let live = true;
    const load = () => {
      fetch("/api/orb-day?limit=1", { credentials: "include" })
        .then((r) => r.json())
        .then((j) => { if (live && j.ok) setRow(j.today); })
        .catch(() => {});
    };
    load();
    const poll = setInterval(load, 60_000);
    return () => { live = false; clearInterval(poll); };
  }, [inWindow]);

  if (!inWindow || !row || row.qualified !== true) return null;

  const matched    = row.detection_status === "matched";
  // A match found against a too-small prior bar is logged, not alerted — do
  // not present it with the same green "matched" treatment a real push gets,
  // or the strip reads as an alert that never actually fired.
  const weakMatch   = matched && row.prev_weak === true;
  const remaining   = WINDOW_END_MIN - mins;
  const accent      = weakMatch ? theme.amber : matched ? theme.green : theme.blue;

  return (
    <div style={{
      background:   theme.bg.surface,
      border:       `1px solid ${accent}`,
      borderRadius: theme.radius.md,
      padding:      theme.space[3],
      marginBottom: theme.space[3],
      display:      "flex",
      flexWrap:     "wrap",
      alignItems:   "baseline",
      gap:          theme.space[3],
    }}>
      <span style={{ color: accent, fontSize: theme.size.xs, fontFamily: theme.font.mono, letterSpacing: "0.5px" }}>
        QQQ OPENING RANGE
      </span>

      <span style={{ color: theme.text.secondary, fontSize: theme.size.sm, fontFamily: theme.font.mono }}>
        {n(row.box_low)} – {n(row.box_high)}
      </span>

      <span style={{ color: theme.text.muted, fontSize: theme.size.xs }}>
        {n(Number(row.range_atr_pct) * 100, 0)}% of ATR
        {row.grey_band ? " ⚑ grey band" : ""}
      </span>

      <span style={{ color: theme.text.muted, fontSize: theme.size.xs }}>
        seeking {row.direction} {row.direction === "bearish" ? "above" : "below"}
      </span>

      {matched ? (
        weakMatch ? (
          <span style={{ color: theme.amber, fontSize: theme.size.xs, fontFamily: theme.font.mono }}>
            {row.pattern.replace(/_/g, " ")} detected against a weak prior bar — not alerted
          </span>
        ) : (
          <span style={{ color: theme.green, fontSize: theme.size.xs, fontFamily: theme.font.mono }}>
            {row.pattern.replace(/_/g, " ")} · entry {n(row.entry)} · stop {n(row.stop)} ·
            T1 {t1Label(row)} · T2 {n(row.t2)} ({n(row.rr_t2)}R)
          </span>
        )
      ) : (
        <span style={{ color: theme.text.subtle, fontSize: theme.size.xs, marginLeft: "auto" }}>
          watching · {remaining} min left
        </span>
      )}
    </div>
  );
}
