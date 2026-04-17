import { useState } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { theme } from "../lib/theme";
import { buildAttentionList } from "../lib/positionAttention";
import { formatExpiry } from "../lib/format";
import { AlertsBanner } from "./focus/AlertsBanner";
import { PositionsFeed } from "./focus/PositionsFeed";

// Data-freshness chip preserved from the previous shell
function DataFreshnessInfo({ quotesRefreshedAt, contextAsOf, positionsLastUpdated }) {
  const [hovered, setHovered] = useState(false);
  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };
  const rows = [
    { label: "Quotes",         value: fmt(quotesRefreshedAt),          note: "30 min cache · market hours only" },
    { label: "Market context", value: fmt(contextAsOf),                note: "updated by ingest job" },
    { label: "Positions",      value: positionsLastUpdated || "—",     note: "daily snapshot" },
  ];
  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: theme.size.xs, color: theme.text.faint, cursor: "default", userSelect: "none" }}>
        ⓘ data freshness
      </span>
      {hovered && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px`,
          zIndex: 100, minWidth: 300, pointerEvents: "none",
        }}>
          {rows.map(({ label, value, note }) => (
            <div key={label} style={{ display: "flex", gap: theme.space[3], alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, minWidth: 100, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: theme.size.xs, color: theme.text.primary, fontFamily: theme.font.mono }}>{value}</span>
              <span style={{ fontSize: theme.size.xs, color: theme.text.faint }}>{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Separates non-position alerts (cash, macro, cluster) from per-position ones.
// Position-backed alerts render as tags on rows; these render as the banner.
function isNonPositionAlert(item, tickersWithPositions) {
  if (!item.ticker) return true;
  return !tickersWithPositions.has(item.ticker);
}

export function FocusTab({
  focusItems,
  categorized,
  quoteMap,
  quotesRefreshedAt,
  marketContext,
}) {
  const { positions, account } = useData();
  const isMobile = useWindowWidth() < 600;

  const rows = buildAttentionList(positions, quoteMap, focusItems);

  const tickersWithPositions = new Set(rows.map(r => r.ticker));
  const bannerAlerts = (focusItems || [])
    .filter(it => it.priority === "P1" || it.priority === "P2")
    .filter(it => isNonPositionAlert(it, tickersWithPositions));

  const macroEvents = marketContext?.macroEvents ?? [];

  const panelStyle = {
    background:   theme.bg.surface,
    border:       `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.md,
    padding:      isMobile ? theme.space[3] : theme.space[4],
    marginBottom: theme.space[4],
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
        <DataFreshnessInfo
          quotesRefreshedAt={quotesRefreshedAt}
          contextAsOf={marketContext?.asOf}
          positionsLastUpdated={account?.last_updated}
        />
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          {categorized?.focus?.length ?? 0} P1 · {categorized?.watching?.length ?? 0} P2 · {categorized?.info?.length ?? 0} P3
        </div>
      </div>

      <AlertsBanner alerts={bannerAlerts} />
      <PositionsFeed rows={rows} />

      {macroEvents.length > 0 && (
        <div style={panelStyle}>
          <div style={{
            fontSize:      theme.size.xs,
            color:         theme.text.muted,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom:  theme.space[2],
          }}>
            Macro calendar
          </div>
          <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, display: "grid", gap: 4 }}>
            {macroEvents.slice(0, 8).map((evt, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: theme.space[3] }}>
                <span>{formatExpiry(evt._date ?? evt.date)} — {evt.label ?? evt.title ?? evt.type}</span>
                {evt.forecast != null && <span style={{ color: theme.text.subtle }}>fc: {evt.forecast}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
