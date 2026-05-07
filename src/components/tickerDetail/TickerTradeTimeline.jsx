import { useMemo, useState } from "react";
import { theme } from "../../lib/theme";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../../lib/constants";
import { useWindowWidth } from "../../hooks/useWindowWidth";
import { formatDollars, formatExpiry } from "../../lib/format";
import { computeTickerStats } from "../../lib/tickerStats";

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || { bg: theme.bg.elevated, border: theme.border.strong, text: theme.text.primary };
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px",
      fontSize: theme.size.xs, fontWeight: 600,
      background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: theme.radius.sm,
      letterSpacing: "0.05em",
    }}>{type}</span>
  );
}

function CycleRef({ index }) {
  if (index == null) return <span style={{ color: theme.text.faint }}>—</span>;
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 6px",
      background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
      borderRadius: theme.radius.sm, color: theme.text.muted, fontWeight: 600,
      letterSpacing: "0.05em",
    }}>#{index}</span>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px", fontSize: theme.size.xs, fontFamily: "inherit",
        cursor: "pointer", color: active ? theme.blue : theme.text.muted,
        background: active ? theme.bg.elevated : "transparent",
        border: `1px solid ${active ? theme.blue : theme.border.strong}`,
        borderRadius: theme.radius.pill, fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
      }}
    >{children}</button>
  );
}

function Marker({ kind }) {
  const c = kind === "BEST" ? theme.green : theme.red;
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 4px",
      border: `1px solid ${c}`, color: c,
      borderRadius: theme.radius.sm, fontWeight: 700,
      letterSpacing: "0.05em",
    }}>{kind}</span>
  );
}

export function TickerTradeTimeline({ data }) {
  const isMobile = useWindowWidth() < 600;
  const trades = data.trades ?? [];
  const lifespans = data.lifespans ?? [];

  const sortedLifespans = useMemo(
    () => [...lifespans].sort((a, b) =>
      (b.assignment_events?.[0]?.date ?? "").localeCompare(a.assignment_events?.[0]?.date ?? "")),
    [lifespans]
  );
  const tradeIdToCycle = useMemo(() => {
    const map = new Map();
    sortedLifespans.forEach((l, i) => {
      const cycleIndex = sortedLifespans.length - i;
      for (const ae of l.assignment_events ?? []) {
        if (ae.triggering_csp_id) map.set(ae.triggering_csp_id, cycleIndex);
      }
      for (const cc of l.cc_history ?? []) {
        if (cc.trade_id) map.set(cc.trade_id, cycleIndex);
      }
    });
    return map;
  }, [sortedLifespans]);

  const stats = useMemo(
    () => computeTickerStats({ trades, lifespans }),
    [trades, lifespans]
  );

  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    let rows = [...trades].filter((t) => t.close_date);
    if (filter !== "all") rows = rows.filter((t) => t.type === filter);
    rows.sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""));
    return rows;
  }, [trades, filter]);

  const closedCount = trades.filter((t) => t.close_date).length;

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
        }}>Trade Timeline</div>
        <div style={{ display: "flex", gap: theme.space[1], flexWrap: "wrap" }}>
          {[
            { key: "all",    label: `all (${closedCount})` },
            { key: "CSP",    label: "CSP" },
            { key: "CC",     label: "CC" },
            { key: "Shares", label: "Shares" },
            { key: "LEAPS",  label: "LEAPS" },
          ].map(({ key, label }) => (
            <FilterButton key={key} active={filter === key} onClick={() => setFilter(key)}>{label}</FilterButton>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>No trades match this filter.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
              {[
                { label: "DATE",    align: "left"  },
                { label: "TYPE",    align: "left"  },
                ...(isMobile ? [] : [{ label: "ACTION",  align: "left"  }]),
                ...(isMobile ? [] : [{ label: "STRIKE",  align: "right" }]),
                { label: "DETAIL",  align: "left"  },
                ...(isMobile ? [] : [{ label: "DAYS",  align: "right" }]),
                ...(isMobile ? [] : [{ label: "CYCLE", align: "left"  }]),
                { label: "P&L",     align: "right" },
              ].map((h) => (
                <th key={h.label} style={{
                  padding: `${theme.space[2]}px ${theme.space[2]}px`,
                  textAlign: h.align, color: theme.text.muted, fontWeight: 500,
                  fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.5px",
                }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const action = SUBTYPE_LABELS[t.subtype] || t.subtype;
              const cycle  = tradeIdToCycle.get(t.id) ?? null;
              const pnl    = Number(t.premium_collected) || 0;
              const pnlColor = pnl > 0 ? theme.green : pnl < 0 ? theme.red : theme.text.muted;
              const isBest  = stats.bestTrade?.id  === t.id;
              const isWorst = stats.worstTrade?.id === t.id;
              return (
                <tr key={t.id} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted, fontSize: theme.size.sm }}>{formatExpiry(t.close_date)}</td>
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}><TypeBadge type={t.type} /></td>
                  {!isMobile && (
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.secondary, fontSize: theme.size.sm }}>{action}</td>
                  )}
                  {!isMobile && (
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "right", color: theme.text.primary, fontSize: theme.size.sm }}>
                      {t.strike != null ? `$${t.strike}` : "—"}
                    </td>
                  )}
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted, fontSize: theme.size.sm }}>
                    {isMobile && t.strike != null && `$${t.strike} · `}
                    {t.contracts != null ? `${t.contracts} ct` : ""}
                    {t.kept_pct != null && ` · ${Math.round(t.kept_pct * 100)}% kept`}
                    {isBest  && <span style={{ marginLeft: theme.space[1] }}><Marker kind="BEST"  /></span>}
                    {isWorst && <span style={{ marginLeft: theme.space[1] }}><Marker kind="WORST" /></span>}
                  </td>
                  {!isMobile && (
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "right", color: theme.text.muted, fontSize: theme.size.sm }}>
                      {t.days_held != null ? `${t.days_held}d` : "—"}
                    </td>
                  )}
                  {!isMobile && (
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}><CycleRef index={cycle} /></td>
                  )}
                  <td style={{
                    padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "right",
                    color: pnlColor, fontWeight: 600, fontSize: theme.size.sm,
                  }}>
                    {pnl === 0 ? "—" : `${pnl > 0 ? "+" : ""}${formatDollars(pnl)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
