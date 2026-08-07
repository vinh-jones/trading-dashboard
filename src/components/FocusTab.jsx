import { useState } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { theme } from "../lib/theme";
import { buildAttentionList } from "../lib/positionAttention";
import { formatExpiry } from "../lib/format";
import { AlertsBanner } from "./focus/AlertsBanner";
import { OrbFocusStrip } from "./OrbFocusStrip";
import { PositionsFeed } from "./focus/PositionsFeed";

// Reference list of all Focus Engine rules — surfaced via the "? rules" toggle
// so the user can always see what can fire and why.
const RULES = [
  { priority: "P1", rule: "Cash below floor",       trigger: "Free cash % is below the VIX band floor",                                                          source: "Account" },
  { priority: "P1", rule: "Expiring soon",          trigger: "CC or CSP with DTE ≤ 2",                                                                            source: "Positions" },
  { priority: "P1", rule: "Uncovered shares",       trigger: "Assigned shares with no active covered call. IV guidance appended when available.",                 source: "Positions + Quotes" },
  { priority: "P1", rule: "CC deeply ITM",          trigger: "Stock > strike by 2–7% (threshold scales with entry delta). P2 if DTE > 7",                         source: "Positions + Quotes" },
  { priority: "P1", rule: "CSP ITM urgency",        trigger: "ITM% × DTE-elapsed% score ≥ 0.05 (min 3% ITM to fire). P2 if score < 0.10",                         source: "Positions + Quotes" },
  { priority: "P1", rule: "Assigned CC breach imminent", trigger: "Active CC whose strike sits below the share basis with sigmas-to-breach < 0.5 (within ½σ of being called). P2 if 0.5–1.0σ. CCs at or above basis and modeled (non-active) capacity are excluded.", source: "Assigned-share income" },
  { priority: "P2", rule: "Expiring soon",          trigger: "CC or CSP with DTE 3–5",                                                                            source: "Positions" },
  { priority: "P2", rule: "Earnings before expiry", trigger: "Earnings date falls on or before an option expiry",                                                 source: "Market context" },
  { priority: "P2", rule: "Macro overlap",          trigger: "CPI/FOMC/NFP within 2 days of any option expiry",                                                   source: "Market context" },
  { priority: "P2", rule: "Near worthless",         trigger: "Option mid < $0.10 and < 5% of original premium collected",                                         source: "Positions + Quotes" },
  { priority: "P2", rule: "60/60 rule",             trigger: "≥60% premium captured with ≥60% DTE remaining (suppressed below 5 DTE)",                            source: "Positions + Quotes" },
  { priority: "P2", rule: "Manage LEAPS",           trigger: "LEAP with < 90 DTE — time decay accelerates, consider rolling or closing",                          source: "Positions" },
  { priority: "P2", rule: "Take Profit",            trigger: "LEAP return ≥ 10% of capital invested",                                                             source: "Positions + Quotes" },
  { priority: "P2", rule: "Roll opportunity",       trigger: "Net-neutral or better roll to assignment price available for a below-cost CC. Only fires after Check Rolls is run.", source: "Roll analysis" },
  { priority: "P3", rule: "Expiry cluster",         trigger: "3+ options (CC or CSP) expire on the same date",                                                    source: "Positions" },
];

const PRIORITY_COLORS = { P1: "#f85149", P2: "#e3b341", P3: "#8b949e" };

function RulesPanel() {
  const colStyle = { fontSize: theme.size.sm, padding: "6px 10px", textAlign: "left" };
  return (
    <div style={{
      background:   theme.bg.surface,
      border:       `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      padding:      theme.space[3],
      marginBottom: theme.space[4],
      overflowX:    "auto",
    }}>
      <div style={{
        fontSize:      theme.size.xs,
        color:         theme.text.muted,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        marginBottom:  theme.space[2],
      }}>
        Focus Engine rules
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
        <thead>
          <tr style={{ color: theme.text.subtle, borderBottom: `1px solid ${theme.border.default}` }}>
            <th style={{ ...colStyle, fontWeight: 500, width: 60 }}>Priority</th>
            <th style={{ ...colStyle, fontWeight: 500 }}>Rule</th>
            <th style={{ ...colStyle, fontWeight: 500 }}>Trigger</th>
            <th style={{ ...colStyle, fontWeight: 500 }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {RULES.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
              <td style={{ ...colStyle, color: PRIORITY_COLORS[r.priority], fontWeight: 600 }}>{r.priority}</td>
              <td style={{ ...colStyle, color: theme.text.secondary }}>{r.rule}</td>
              <td style={{ ...colStyle, color: theme.text.muted }}>{r.trigger}</td>
              <td style={{ ...colStyle, color: theme.text.subtle }}>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MACRO_LABELS = {
  CPI:          "CPI",
  PPI:          "PPI",
  NFP:          "Jobs report",
  FOMC:         "FOMC",
  PCE:          "PCE",
  RETAIL_SALES: "Retail sales",
};

// Upcoming macro releases from the macro_events table (UW economic calendar,
// ~8-day horizon). Rows arrive pre-deduped — one per (date, type) — and already
// filtered to today-or-later by the API, so there is nothing to collapse here.
//
// Deliberately NO fall-back-to-most-recent-past-release: the old market_context
// version did that, and when its feed died it rendered four-month-old CPI/PPI as
// if current. An empty upcoming set renders nothing.
function MacroCalendar({ macroEvents }) {
  const events = [...(macroEvents ?? [])].sort((a, b) =>
    a.event_date.localeCompare(b.event_date),
  );
  if (!events.length) return null;

  const colStyle = { fontSize: theme.size.sm, padding: "5px 10px", textAlign: "left" };

  return (
    <div style={{
      background:   theme.bg.surface,
      border:       `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      padding:      theme.space[3],
      marginBottom: theme.space[4],
      overflowX:    "auto",
    }}>
      <div style={{
        fontSize:      theme.size.xs,
        color:         theme.text.muted,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        marginBottom:  theme.space[2],
      }}>
        Macro calendar
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
        <thead>
          <tr style={{ color: theme.text.subtle, borderBottom: `1px solid ${theme.border.default}` }}>
            <th style={{ ...colStyle, fontWeight: 500 }}>Event</th>
            <th style={{ ...colStyle, fontWeight: 500 }}>Date</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Previous</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Forecast</th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt) => (
            <tr
              key={`${evt.event_date}-${evt.event_type}`}
              style={{
                borderBottom: `1px solid ${theme.border.default}`,
                color:        theme.text.secondary,
              }}
            >
              <td style={colStyle}>{MACRO_LABELS[evt.event_type] ?? evt.event_type}</td>
              <td style={{ ...colStyle, color: theme.text.muted }}>{formatExpiry(evt.event_date)}</td>
              <td style={{ ...colStyle, textAlign: "right", color: theme.text.muted }}>{evt.previous ?? "—"}</td>
              <td style={{ ...colStyle, textAlign: "right", color: theme.text.muted }}>{evt.forecast ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Data-freshness chip preserved from the previous shell
function DataFreshnessInfo({ quotesRefreshedAt, macroRefreshedAt, positionsLastUpdated }) {
  const [hovered, setHovered] = useState(false);
  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };
  const rows = [
    { label: "Quotes",         value: fmt(quotesRefreshedAt),      note: "30 min cache · market hours only" },
    { label: "Macro calendar", value: fmt(macroRefreshedAt),       note: "daily · uw-macro-events cron" },
    { label: "Positions",      value: positionsLastUpdated || "—", note: "daily snapshot" },
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
  macroEvents,
  macroRefreshedAt,
}) {
  const { positions, account } = useData();
  useWindowWidth(); // subscribe to resize so the feed re-measures
  const [rulesOpen, setRulesOpen] = useState(false);

  const rows = buildAttentionList(positions, quoteMap, focusItems);

  const tickersWithPositions = new Set(rows.map(r => r.ticker));
  const bannerAlerts = (focusItems || [])
    .filter(it => it.priority === "P1" || it.priority === "P2")
    .filter(it => isNonPositionAlert(it, tickersWithPositions));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3], gap: theme.space[3] }}>
        <DataFreshnessInfo
          quotesRefreshedAt={quotesRefreshedAt}
          macroRefreshedAt={macroRefreshedAt}
          positionsLastUpdated={account?.last_updated}
        />
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[3] }}>
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
            {categorized?.focus?.length ?? 0} P1 · {categorized?.watching?.length ?? 0} P2 · {categorized?.info?.length ?? 0} P3
          </span>
          <button
            onClick={() => setRulesOpen(o => !o)}
            style={{
              background:   "transparent",
              border:       `1px solid ${theme.border.strong}`,
              borderRadius: theme.radius.sm,
              color:        rulesOpen ? theme.text.secondary : theme.text.subtle,
              fontSize:     theme.size.xs,
              fontFamily:   "inherit",
              cursor:       "pointer",
              padding:      "3px 8px",
            }}
          >
            {rulesOpen ? "▲ rules" : "? rules"}
          </button>
        </div>
      </div>

      {rulesOpen && <RulesPanel />}

      <OrbFocusStrip />
      <AlertsBanner alerts={bannerAlerts} />
      <PositionsFeed rows={rows} />
      <MacroCalendar macroEvents={macroEvents} />
    </div>
  );
}
