import { useEffect, useState } from "react";
import { theme } from "../lib/theme";

const STATUS_STYLE = {
  pass:    { label: "PASS",    color: theme.green },
  fail:    { label: "FAIL",    color: theme.red },
  skipped: { label: "SKIPPED", color: theme.text.faint },
  expired: { label: "EXPIRED", color: theme.amber },
  pending: { label: "PENDING", color: theme.text.muted },
  // A match was found but deliberately not pushed — the engulfed prior bar
  // was too small to be meaningful (prev_weak). This is neither a pass nor a
  // fail: the setup is real and logged, it just never reached the phone.
  weak:    { label: "LOGGED",  color: theme.amber },
};

function n(v, d = 2) {
  return v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);
}

function pct(v) {
  // range_atr_pct is stored as a RATIO (0.3908), not a 0-100 percentage —
  // multiply by 100 before display.
  return v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`;
}

/**
 * T1 is the near box edge and can already sit behind the entry (t1Ahead ===
 * false) — the setup's high/low can poke back past the near edge even though
 * the CLOSE that triggered the signal was outside the box. Showing a bare
 * "0.00R" there reads as a data glitch, so match the wording buildAlertMessage
 * already uses for the Pushover push, so the phone alert and the dashboard
 * agree.
 */
function t1Label(row) {
  if (row.t1 == null) return "—";
  return row.t1_ahead === false
    ? `${n(row.t1)} (already passed at entry)`
    : `${n(row.t1)} (${n(row.rr_t1)}R)`;
}

/** Maps a row onto the eight ordered gates from the spec. */
function buildGates(row) {
  if (!row) return [];
  const qualified = row.qualified;
  const det       = row.detection_status;
  // A skipped day never qualified, so gates 4-7 were never searched — render
  // that as "skipped" all the way down rather than as a silent "pending"
  // that looks identical to a day still in progress. `expired` is a
  // different fact (searched the whole window, found nothing) and must not
  // collapse into the same label.
  const downstream = det === "skipped" ? "skipped" : null;
  const weakMatch   = det === "matched" && row.prev_weak === true;

  return [
    {
      n: 0, name: "Session is a trading day", status: "pass",
      meta: `${row.session_date} · 09:30 ET open`,
    },
    {
      n: 1, name: "Opening range built",
      status: row.box_high == null ? "fail" : "pass",
      meta: row.box_high == null ? "no bars" :
        `${n(row.box_low)} – ${n(row.box_high)} · width ${n(row.box_range)} · ${row.candle_color} candle`,
    },
    {
      n: 2, name: "ATR available",
      status: row.atr14 == null ? "fail" : "pass",
      meta: `ATR(14) ${n(row.atr14)} · 25% = ${n(row.atr_threshold)}${row.atr_asof ? ` · as of ${row.atr_asof}` : ""}`,
    },
    {
      n: 3, name: "Liquidity gate",
      status: qualified == null ? "pending" : qualified ? "pass" : "fail",
      meta: `range ÷ ATR = ${pct(row.range_atr_pct)}${row.grey_band ? "  ⚑ grey band 22–25%" : ""}`,
    },
    {
      n: 4, name: "Direction set",
      status: downstream ?? (row.direction ? "pass" : "pending"),
      meta: row.direction
        ? `seeking ${row.direction} reversal ${row.direction === "bearish" ? "above" : "below"} the box`
        : "—",
    },
    {
      n: 5, name: "Reversal detected",
      status: downstream ?? (det === "matched" ? (weakMatch ? "weak" : "pass") : det === "expired" ? "expired" : "pending"),
      meta: det === "matched"
        ? `${row.pattern.replace(/_/g, " ")} · ${new Date(row.pattern_bar_start)
            .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${row.outside_rule}` +
          (weakMatch ? " · prior bar too small to engulf — not alerted" : "")
        : det === "expired" ? "window closed with no qualifying pattern" : "—",
    },
    {
      n: 6, name: "Time gate (90 min)",
      status: downstream ?? (det === "matched" ? (weakMatch ? "weak" : "pass") : det === "expired" ? "expired" : "pending"),
      meta: row.minutes_elapsed != null ? `${row.minutes_elapsed} min after open` : "—",
    },
    {
      n: 7, name: "Signal emitted",
      status: downstream ?? (row.entry != null ? (weakMatch ? "weak" : "pass") : det === "expired" ? "expired" : "pending"),
      meta: row.entry == null ? "—" :
        `${weakMatch ? "not alerted — " : ""}entry ${n(row.entry)} · stop ${n(row.stop)} · T1 ${t1Label(row)} · T2 ${n(row.t2)} (${n(row.rr_t2)}R)`,
    },
  ];
}

function GateRow({ gate }) {
  const s = STATUS_STYLE[gate.status] ?? STATUS_STYLE.pending;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "28px 1fr auto",
      gap: theme.space[3],
      alignItems: "baseline",
      padding: `${theme.space[2]}px 0`,
      borderBottom: `1px solid ${theme.border.default}`,
    }}>
      <span style={{ color: theme.text.faint, fontSize: theme.size.xs, fontFamily: theme.font.mono }}>
        {gate.n}
      </span>
      <div>
        <div style={{ color: theme.text.primary, fontSize: theme.size.sm }}>{gate.name}</div>
        <div style={{ color: theme.text.muted, fontSize: theme.size.xs, fontFamily: theme.font.mono, marginTop: 2 }}>
          {gate.meta}
        </div>
      </div>
      <span style={{
        color: s.color, fontSize: theme.size.xs, fontFamily: theme.font.mono,
        letterSpacing: "0.5px", whiteSpace: "nowrap",
      }}>
        {s.label}
      </span>
    </div>
  );
}

export function OrbTab() {
  const [state, setState] = useState({ loading: true, error: null, today: null, history: [] });

  useEffect(() => {
    let live = true;
    fetch("/api/orb-day", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (!j.ok) throw new Error(j.error || "request failed");
        setState({ loading: false, error: null, today: j.today, history: j.history ?? [] });
      })
      .catch((e) => live && setState({ loading: false, error: e.message, today: null, history: [] }));
    return () => { live = false; };
  }, []);

  if (state.loading) {
    return <div style={{ padding: theme.space[5], color: theme.text.muted, fontSize: theme.size.sm }}>Loading…</div>;
  }
  if (state.error) {
    return <div style={{ padding: theme.space[5], color: theme.red, fontSize: theme.size.sm }}>{state.error}</div>;
  }

  const qualifiedCount = state.history.filter((r) => r.qualified).length;

  return (
    <div style={{ padding: theme.space[4] }}>
      <div style={{ marginBottom: theme.space[4] }}>
        <div style={{ color: theme.text.primary, fontSize: theme.size.lg, marginBottom: theme.space[1] }}>
          QQQ Opening Range — alert only
        </div>
        <div style={{ color: theme.text.muted, fontSize: theme.size.xs }}>
          Detection and logging. This system never places an order.
        </div>
      </div>

      {state.today ? (
        <div style={{
          background: theme.bg.surface,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md,
          padding: theme.space[4],
          marginBottom: theme.space[5],
        }}>
          {buildGates(state.today).map((g) => <GateRow key={g.n} gate={g} />)}
        </div>
      ) : (
        <div style={{
          color: theme.text.muted, fontSize: theme.size.sm,
          padding: theme.space[4], marginBottom: theme.space[5],
          background: theme.bg.surface, borderRadius: theme.radius.md,
        }}>
          No row for today yet — the 09:45 ET job has not run.
        </div>
      )}

      <div style={{ color: theme.text.secondary, fontSize: theme.size.sm, marginBottom: theme.space[2] }}>
        Prior sessions{" "}
        <span style={{ color: theme.text.muted, fontSize: theme.size.xs }}>
          — {qualifiedCount} of {state.history.length} qualified
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.xs, fontFamily: theme.font.mono }}>
          <thead>
            <tr style={{ color: theme.text.muted, textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: theme.space[1] }}>Date</th>
              <th style={{ padding: theme.space[1] }}>Range</th>
              <th style={{ padding: theme.space[1] }}>ATR</th>
              <th style={{ padding: theme.space[1] }}>R÷ATR</th>
              <th style={{ padding: theme.space[1] }}>Dir</th>
              <th style={{ padding: theme.space[1] }}>Status</th>
              <th style={{ padding: theme.space[1] }}>R:R T2</th>
              <th style={{ padding: theme.space[1] }}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {state.history.map((r) => {
              const weakMatch = r.detection_status === "matched" && r.prev_weak === true;
              const statusStyle = weakMatch ? STATUS_STYLE.weak : (STATUS_STYLE[r.detection_status] ?? STATUS_STYLE.pending);
              return (
                <tr key={r.session_date} style={{ borderTop: `1px solid ${theme.border.default}`, textAlign: "right" }}>
                  <td style={{ textAlign: "left", padding: theme.space[1], color: theme.text.secondary }}>{r.session_date}</td>
                  <td style={{ padding: theme.space[1], color: theme.text.muted }}>{n(r.box_range)}</td>
                  <td style={{ padding: theme.space[1], color: theme.text.muted }}>{n(r.atr14)}</td>
                  <td style={{ padding: theme.space[1], color: r.qualified ? theme.green : theme.text.faint }}>
                    {pct(r.range_atr_pct)}{r.grey_band ? " ⚑" : ""}
                  </td>
                  <td style={{ padding: theme.space[1], color: theme.text.muted }}>{r.direction ?? "—"}</td>
                  <td style={{ padding: theme.space[1], color: statusStyle.color }}>
                    {r.detection_status}{weakMatch ? " (not alerted)" : ""}
                  </td>
                  <td style={{ padding: theme.space[1], color: theme.text.muted }}>{r.rr_t2 == null ? "—" : `${n(r.rr_t2)}R`}</td>
                  <td style={{ padding: theme.space[1], color: theme.text.muted }}>
                    {r.outcome ?? "—"}{r.outcome_ambiguous ? " ?" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
