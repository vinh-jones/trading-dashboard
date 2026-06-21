import { useState, useEffect } from "react";
import { theme } from "../lib/theme";
import { computeScoreboard } from "../lib/signalScoreboard";

// Decision-attribution read (finance review cross-cutting #3) — the lightweight
// view over the signal_log the Open Positions tab writes. It surfaces the
// decision-relevant moments (the override states + escalated assignment risk)
// so you can eyeball, day to day, what the signals were recommending. The
// richer outcome attribution (did following it help) is the monthly scoreboard,
// which needs closed-position history to accrue first.

const STATE_LABEL = {
  rule_close:  { label: "rule: close",  color: theme.amber },
  let_it_ride: { label: "let it ride",  color: theme.green },
  shed:        { label: "shed",         color: theme.amber },
};

function notableTags(row) {
  const tags = [];
  if (STATE_LABEL[row.overlay_state]) tags.push(STATE_LABEL[row.overlay_state]);
  if (row.assignment_level === "high")     tags.push({ label: "assignment: high",     color: theme.red });
  else if (row.assignment_level === "elevated") tags.push({ label: "assignment: elevated", color: theme.amber });
  return tags;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SignalLogPanel() {
  const [rows, setRows]       = useState(null);
  const [open, setOpen]       = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/signal-log?days=21")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => { if (!cancelled) setRows(d.rows ?? []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  if (rows == null || rows.length === 0) return null; // loading or nothing logged yet — stay quiet

  const flagged = rows.filter((r) => notableTags(r).length > 0);
  const display = showAll ? rows : flagged;
  const board = computeScoreboard(rows);

  const chip = (t, i) => (
    <span key={i} style={{
      fontSize: theme.size.xs, fontWeight: 600, color: t.color,
      background: `${t.color}22`, border: `1px solid ${t.color}66`,
      borderRadius: theme.radius.pill, padding: "1px 7px", whiteSpace: "nowrap",
    }}>{t.label}</span>
  );

  return (
    <div style={{
      background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md, marginBottom: theme.space[4], overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "transparent", border: "none", cursor: "pointer",
          padding: `${theme.space[3]}px ${theme.space[4]}px`, fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          <span style={{ fontSize: theme.size.md, color: theme.text.primary, fontWeight: 600 }}>🧭 Signal log</span>
          <span style={{
            fontSize: theme.size.xs, color: theme.amber, background: `${theme.amber}22`,
            border: `1px solid ${theme.amber}66`, borderRadius: theme.radius.pill, padding: "1px 7px", fontWeight: 600,
          }}>{flagged.length} flagged · 21d</span>
        </span>
        <span style={{ color: theme.text.subtle, fontSize: theme.size.sm }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${theme.border.default}` }}>
          {/* Scoreboard scaffold — computable from the log today; flips on as
              data accrues. Lead drift metric: days held past a rule:close. */}
          <div style={{ padding: `${theme.space[2]}px ${theme.space[4]}px`, borderBottom: `1px solid ${theme.border.default}`, display: "flex", flexWrap: "wrap", gap: theme.space[4], fontSize: theme.size.sm }}>
            {[
              { label: "Position-days", value: board.position_days, color: theme.text.primary },
              { label: "rule:close fired", value: `${board.counts.rule_close} pos`, color: theme.amber },
              { label: "Held past rule", value: `${board.held_past_rule_days}d`, color: board.held_past_rule_days > 0 ? theme.red : theme.green, title: "Days a position kept being logged after a take-profit/cushion rule said close — the lead drift metric. 0 = you acted on the rule." },
              { label: "let-it-ride (obs)", value: `${board.counts.let_it_ride} pos`, color: theme.text.muted },
              { label: "shed", value: `${board.counts.shed} pos`, color: theme.text.muted },
              { label: "risk elev/high", value: `${board.counts.risk_elevated}/${board.counts.risk_high}`, color: theme.text.muted },
            ].map((m) => (
              <div key={m.label} title={m.title}>
                <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>{m.label}</div>
                <div style={{ color: m.color, fontWeight: 600, fontFamily: theme.font.mono }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: `${theme.space[2]}px ${theme.space[4]}px`, fontSize: theme.size.xs, color: theme.text.subtle, lineHeight: 1.5 }}>
            What the signals recommended on each open CSP, captured when you viewed this tab. Thin early on — the figures above are noisy by design until weeks accrue. Outcome attribution (did following a signal help; divergence vs. your baseline; entry paper-track) is the data-accruing follow-on.
            <button
              onClick={() => setShowAll((s) => !s)}
              style={{ marginLeft: theme.space[2], fontSize: theme.size.xs, fontFamily: "inherit", cursor: "pointer", background: "transparent", border: "none", color: theme.text.muted, textDecoration: "underline" }}
            >{showAll ? "flagged only" : "show all entries"}</button>
          </div>

          {display.length === 0 ? (
            <div style={{ padding: `${theme.space[2]}px ${theme.space[4]}px ${theme.space[3]}px`, fontSize: theme.size.sm, color: theme.text.subtle }}>
              No flagged events in the last 21 days — no override or escalated-risk signals fired.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
                <tbody>
                  {display.map((r, i) => {
                    const tags = notableTags(r);
                    return (
                      <tr key={`${r.logged_date}-${r.position_key}`} style={{ borderTop: i ? `1px solid ${theme.border.default}` : "none" }}>
                        <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, color: theme.text.muted, whiteSpace: "nowrap" }}>{fmtDate(r.logged_date)}</td>
                        <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, fontWeight: 700, color: theme.text.primary }}>{r.ticker}</td>
                        <td style={{ padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: theme.space[1] }}>
                            {tags.length ? tags.map(chip) : (
                              <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
                                {r.overlay_state ?? r.redeploy_state ?? "—"}{r.assignment_level && r.assignment_level !== "none" ? ` · risk ${r.assignment_level}` : ""}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
