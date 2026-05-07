import { useMemo, useState } from "react";
import { theme } from "../../lib/theme";
import { computeLifespanVerdict } from "../../lib/tickerVerdict";
import { formatDollars, formatExpiry } from "../../lib/format";
import { VerdictBadge } from "./VerdictBadge";

function StatusPill({ status }) {
  const isActive = status === "active";
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 6px",
      border: `1px solid ${isActive ? theme.green : theme.border.strong}`,
      color: isActive ? theme.green : theme.text.muted,
      borderRadius: theme.radius.sm, letterSpacing: "0.05em",
      textTransform: "uppercase", fontWeight: 600,
    }}>{isActive ? "Active" : "Closed"}</span>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px", fontSize: theme.size.xs, fontFamily: "inherit",
        cursor: "pointer", color: active ? theme.green : theme.text.muted,
        background: active ? `${theme.green}1a` : "transparent",
        border: `1px solid ${active ? theme.green : theme.border.strong}`,
        borderRadius: theme.radius.pill, fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
      }}
    >{children}</button>
  );
}

function CycleEvents({ lifespan }) {
  const events = [];

  for (const a of lifespan.assignment_events ?? []) {
    events.push({
      date: a.date,
      label: `CSP $${a.strike} assigned · ${a.shares_added / 100} ct`,
      color: theme.blue,
    });
  }
  for (const cc of lifespan.cc_history ?? []) {
    const action = cc.is_winning ? "closed" : "rolled";
    events.push({
      date: cc.close_date,
      label: `CC $${cc.strike} ${action} · ${cc.contracts ?? 1} ct · ${formatDollars(cc.premium_collected)}${cc.kept_pct != null ? ` (${cc.kept_pct}% kept)` : ""}`,
      color: cc.premium_collected >= 0 ? theme.green : theme.red,
    });
  }
  if (lifespan.exit_event) {
    events.push({
      date: lifespan.exit_event.date,
      label: `Shares ${lifespan.exit_event.exit_type === "called_away" ? "called away" : "sold"} @ $${lifespan.exit_event.exit_price ?? "—"} · ${formatDollars(lifespan.exit_event.share_disposal_pnl)}`,
      color: lifespan.exit_event.share_disposal_pnl >= 0 ? theme.green : theme.red,
    });
  }
  events.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return (
    <div style={{ marginTop: theme.space[3] }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
      }}>Cycle events</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: `${theme.space[1]}px ${theme.space[3]}px`, fontSize: theme.size.sm }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div style={{ color: theme.text.muted, fontFamily: theme.font.mono }}>{e.date && formatExpiry(e.date)}</div>
            <div style={{ color: e.color }}>{e.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerdictLine({ lifespan }) {
  const spaxx = lifespan.benchmarks?.spaxx_baseline?.vs_actual_pnl;
  const cut   = lifespan.benchmarks?.cut_and_redeploy_baseline?.vs_actual_pnl;
  if (lifespan.lifespan_status === "active") {
    return <span style={{ color: theme.text.muted }}>Lifespan still active — verdict pending close.</span>;
  }
  const parts = [];
  if (spaxx != null) parts.push(`${spaxx >= 0 ? "+" : ""}${formatDollars(spaxx)} vs SPAXX`);
  if (cut   != null) parts.push(`${cut   >= 0 ? "+" : ""}${formatDollars(cut)} vs cut-and-redeploy`);
  if (parts.length === 0) return <span style={{ color: theme.text.muted }}>Insufficient benchmark data.</span>;
  return <span>{parts.join(" · ")}</span>;
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: theme.size.md, color: color || theme.text.primary, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function LifespanRow({ lifespan, n, expanded, onToggle, accentColor }) {
  const verdict = computeLifespanVerdict(lifespan);
  const pnl     = lifespan.lifespan_metrics?.total_lifespan_pnl;
  const pnlPct  = lifespan.lifespan_metrics?.return_pct_on_capital;
  const pnlColor = pnl == null ? theme.text.muted : pnl >= 0 ? theme.green : theme.red;
  const status   = lifespan.lifespan_status;

  return (
    <div style={{
      borderLeft: `3px solid ${accentColor}`,
      background: expanded ? theme.bg.elevated : theme.bg.surface,
      marginBottom: theme.space[2], borderRadius: theme.radius.sm,
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: theme.space[3],
          display: "flex", alignItems: "center", gap: theme.space[3],
          cursor: "pointer", flexWrap: "wrap",
        }}
      >
        <span style={{
          fontSize: theme.size.xs, padding: "1px 6px",
          background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.sm, color: theme.text.muted, fontWeight: 600,
          letterSpacing: "0.05em",
        }}>#{n}</span>
        <StatusPill status={status} />
        <div style={{ fontSize: theme.size.sm, color: theme.text.muted, flex: "1 1 auto" }}>
          {lifespan.assignment_events?.[0]?.date && formatExpiry(lifespan.assignment_events[0].date)}
          {" → "}
          {lifespan.exit_event?.date ? formatExpiry(lifespan.exit_event.date) : "now"}
          {" · "}
          {lifespan.lifespan_metrics?.days_active}d
          {" · peak "}{lifespan.total_shares_at_peak} sh
          {" · "}{formatDollars(lifespan.total_capital_committed)} cap
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          <VerdictBadge verdict={verdict} />
          <div style={{ textAlign: "right", minWidth: 100 }}>
            <div style={{ color: pnlColor, fontWeight: 600 }}>
              {pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${formatDollars(pnl)}`}
              {status === "active" && <span style={{ fontSize: theme.size.xs, color: theme.text.muted, marginLeft: 4 }}>running</span>}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>
              {pnlPct == null ? "" : `${(pnlPct * 100).toFixed(2)}%`}
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: `0 ${theme.space[3]}px ${theme.space[3]}px`,
          borderTop: `1px solid ${theme.border.default}`,
        }}>
          <div style={{ marginTop: theme.space[3], fontSize: theme.size.sm, color: theme.text.secondary }}>
            <VerdictLine lifespan={lifespan} />
          </div>
          <div style={{ marginTop: theme.space[3], display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[3], fontSize: theme.size.sm }}>
            <Stat label="Peak shares" value={lifespan.total_shares_at_peak} />
            <Stat label="Capital" value={formatDollars(lifespan.total_capital_committed)} />
            <Stat label="Days held" value={`${lifespan.lifespan_metrics?.days_active}d`} />
            <Stat label="Return" value={pnlPct != null ? `${(pnlPct * 100).toFixed(2)}%` : "—"} color={pnlColor} />
          </div>
          <CycleEvents lifespan={lifespan} />
        </div>
      )}
    </div>
  );
}

export function TickerLifespanHistory({ data }) {
  const lifespans = data.lifespans ?? [];
  const sorted = useMemo(() =>
    [...lifespans].sort((a, b) => (b.assignment_events?.[0]?.date ?? "").localeCompare(a.assignment_events?.[0]?.date ?? "")),
    [lifespans]
  );

  const [filter, setFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState(() => {
    const active = sorted.find((l) => l.lifespan_status === "active");
    return new Set(active ? [active.assignment_id] : []);
  });

  function toggle(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = sorted.filter((l) => filter === "all" ? true : l.lifespan_status === filter);

  if (sorted.length === 0) {
    return (
      <div style={{
        padding: theme.space[5], background: theme.bg.surface,
        border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
        marginBottom: theme.space[4],
      }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
          marginBottom: theme.space[3],
        }}>Lifespan History · 0 cycles</div>
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
          No assignment cycles. This ticker is CSP-only — see trade timeline below.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
        }}>Lifespan History · {sorted.length} {sorted.length === 1 ? "cycle" : "cycles"}</div>
        <div style={{ display: "flex", gap: theme.space[1] }}>
          <FilterButton active={filter === "active"} onClick={() => setFilter(filter === "active" ? "all" : "active")}>active</FilterButton>
          <FilterButton active={filter === "closed"} onClick={() => setFilter(filter === "closed" ? "all" : "closed")}>closed</FilterButton>
        </div>
      </div>

      {filtered.map((l) => {
        const n = sorted.length - sorted.indexOf(l);
        const id = l.assignment_id;
        const verdict = computeLifespanVerdict(l);
        const accent = verdict === "ahead"   ? theme.green
                    : verdict === "behind"  ? theme.red
                    : verdict === "suspect" ? theme.amber
                    : l.lifespan_status === "active" ? theme.green
                    : theme.border.strong;
        return (
          <LifespanRow
            key={id ?? `${l.assignment_events?.[0]?.date}-${n}`}
            lifespan={l}
            n={n}
            expanded={expandedIds.has(id)}
            onToggle={() => toggle(id)}
            accentColor={accent}
          />
        );
      })}
    </div>
  );
}
