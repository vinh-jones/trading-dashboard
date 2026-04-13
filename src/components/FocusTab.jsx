import { useState, useEffect, useMemo } from "react";
import marketContextDev from "../data/market-context.json";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { useLiveVix } from "../hooks/useLiveVix";
import { useQuotes } from "../hooks/useQuotes";
import { theme } from "../lib/theme";
import { generateFocusItems, categorizeFocusItems } from "../lib/focusEngine";
import { formatExpiry } from "../lib/format";

// ── Data freshness tooltip ────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function DataFreshnessInfo({ quotesRefreshedAt, contextAsOf, positionsLastUpdated }) {
  const [hovered, setHovered] = useState(false);

  const rows = [
    { label: "Quotes",          value: fmt(quotesRefreshedAt),    note: "30 min cache · market hours only" },
    { label: "Market context",  value: fmt(contextAsOf),          note: "updated by ingest job"            },
    { label: "Positions",       value: positionsLastUpdated || "—", note: "daily snapshot"                 },
  ];

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{
        fontSize:   theme.size.xs,
        color:      theme.text.faint,
        cursor:     "default",
        userSelect: "none",
      }}>
        ⓘ data freshness
      </span>

      {hovered && (
        <div style={{
          position:     "absolute",
          top:          "calc(100% + 6px)",
          left:         0,
          background:   theme.bg.elevated,
          border:       `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.md,
          padding:      `${theme.space[2]}px ${theme.space[3]}px`,
          zIndex:       100,
          minWidth:     300,
          pointerEvents: "none",
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

// ── Priority config ──────────────────────────────────────────────────────────

const PRIORITY = {
  P1: { label: "P1", color: theme.red,   bg: "rgba(248,81,73,0.08)",  borderColor: theme.red   },
  P2: { label: "P2", color: theme.amber, bg: "rgba(227,179,65,0.07)", borderColor: theme.amber },
  P3: { label: "P3", color: theme.text.subtle, bg: theme.bg.elevated, borderColor: theme.border.strong },
};

const RULE_LABELS = {
  cash_below_floor:       "Cash",
  expiring_soon:          "Expiry",
  uncovered_shares:       "Coverage",
  cc_deeply_itm:          "Assignment Risk",
  csp_itm_urgency:        "Assignment Risk",
  earnings_before_expiry: "Earnings",
  macro_overlap:          "Macro",
  near_worthless:         "Efficiency",
  rule_60_60:             "Close Candidate",
  expiry_cluster:         "Cluster",
};

// ── Sub-components ───────────────────────────────────────────────────────────

function FocusItemCard({ item, isMobile }) {
  const [expanded, setExpanded] = useState(true);
  const p = PRIORITY[item.priority];
  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        borderLeft:    `3px solid ${p.borderColor}`,
        background:    p.bg,
        border:        `1px solid ${theme.border.default}`,
        borderLeftColor: p.borderColor,
        borderRadius:  theme.radius.md,
        padding:       `${theme.space[3]}px ${theme.space[4]}px`,
        marginBottom:  theme.space[2],
        cursor:        "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: theme.space[2] }}>
        {/* Priority badge */}
        <span style={{
          fontSize:    theme.size.xs,
          fontWeight:  600,
          color:       p.color,
          background:  "transparent",
          border:      `1px solid ${p.borderColor}`,
          borderRadius: theme.radius.sm,
          padding:     "1px 5px",
          flexShrink:  0,
          marginTop:   1,
        }}>
          {item.priority}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
            <span style={{ fontSize: theme.size.md, fontWeight: 500, color: theme.text.primary }}>
              {item.title}
            </span>
            <span style={{
              fontSize:     theme.size.xs,
              color:        theme.text.subtle,
              background:   theme.bg.elevated,
              border:       `1px solid ${theme.border.strong}`,
              borderRadius: theme.radius.sm,
              padding:      "1px 5px",
            }}>
              {RULE_LABELS[item.rule] ?? item.rule}
            </span>
          </div>

          {/* Detail (expanded) */}
          {expanded && (
            <div style={{
              marginTop:  theme.space[2],
              fontSize:   theme.size.sm,
              color:      theme.text.muted,
              lineHeight: 1.6,
            }}>
              {item.detail}
            </div>
          )}
        </div>

        {/* Expand caret */}
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0, marginTop: 2 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>
    </div>
  );
}

function WatchingRow({ item }) {
  const [expanded, setExpanded] = useState(true);
  const p = PRIORITY[item.priority];
  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        display:       "flex",
        alignItems:    "flex-start",
        gap:           theme.space[3],
        padding:       `${theme.space[2]}px ${theme.space[3]}px`,
        borderLeft:    `2px solid ${p.borderColor}`,
        marginBottom:  6,
        cursor:        "pointer",
      }}
    >
      <span style={{ fontSize: theme.size.xs, color: p.color, fontWeight: 600, flexShrink: 0, marginTop: 2 }}>
        {RULE_LABELS[item.rule] ?? item.rule}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: theme.size.sm, color: theme.text.secondary }}>
          {item.title}
        </span>
        {expanded && (
          <div style={{ marginTop: 4, fontSize: theme.size.sm, color: theme.text.muted, lineHeight: 1.6 }}>
            {item.detail}
          </div>
        )}
      </div>
      <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0 }}>
        {expanded ? "▲" : "▼"}
      </span>
    </div>
  );
}

function MacroCalendar({ macroEvents }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  // Deduplicate — show one row per eventType, soonest upcoming
  const byType = {};
  for (const evt of macroEvents) {
    const d = evt.dateTime.slice(0, 10);
    if (d < todayStr) continue;
    if (!byType[evt.eventType] || d < byType[evt.eventType]._date) {
      byType[evt.eventType] = { ...evt, _date: d };
    }
  }
  const upcoming = Object.values(byType).sort((a, b) => a._date.localeCompare(b._date));
  if (!upcoming.length) return null;

  const colStyle = { fontSize: theme.size.sm, padding: "5px 8px", textAlign: "left" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
        <thead>
          <tr style={{ color: theme.text.subtle, borderBottom: `1px solid ${theme.border.default}` }}>
            <th style={{ ...colStyle, fontWeight: 500 }}>Event</th>
            <th style={{ ...colStyle, fontWeight: 500 }}>Date</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Previous</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Forecast</th>
            <th style={{ ...colStyle, fontWeight: 500, textAlign: "right" }}>Actual</th>
          </tr>
        </thead>
        <tbody>
          {upcoming.map((evt, i) => {
            const label = evt.eventType === "FOMC_RATE_DECISION" ? "FOMC Rate" : evt.eventType;
            const isPast = evt.actual != null;
            return (
              <tr
                key={i}
                style={{
                  borderBottom:    `1px solid ${theme.border.default}`,
                  color: isPast ? theme.text.subtle : theme.text.secondary,
                }}
              >
                <td style={colStyle}>{label}</td>
                <td style={{ ...colStyle, color: theme.text.muted }}>{formatExpiry(evt._date)}</td>
                <td style={{ ...colStyle, textAlign: "right", color: theme.text.muted }}>
                  {evt.previous != null ? evt.previous : "—"}
                </td>
                <td style={{ ...colStyle, textAlign: "right", color: theme.text.muted }}>
                  {evt.forecast != null ? evt.forecast : "—"}
                </td>
                <td style={{ ...colStyle, textAlign: "right", color: isPast ? theme.green : theme.text.subtle }}>
                  {evt.actual != null ? evt.actual : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FocusTab() {
  const { positions, account } = useData();
  const isMobile = useWindowWidth() < 600;
  const { vix: liveVix } = useLiveVix(account?.vix_current);
  const { quoteMap, refreshedAt: quotesRefreshedAt } = useQuotes();

  const [marketContext, setMarketContext] = useState(null);
  const [mcLoading, setMcLoading] = useState(true);
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setMarketContext(marketContextDev);
      setMcLoading(false);
      return;
    }
    fetch("/api/focus-context")
      .then(r => r.json())
      .then(data => { if (data.ok && data.marketContext) setMarketContext(data.marketContext); })
      .catch(err => console.warn("[FocusTab] market context fetch failed:", err.message))
      .finally(() => setMcLoading(false));
  }, []);

  const allItems = useMemo(
    () => generateFocusItems(positions, account, marketContext, liveVix, quoteMap),
    [positions, account, marketContext, liveVix, quoteMap]
  );
  const { focus, watching, info } = useMemo(() => categorizeFocusItems(allItems), [allItems]);

  const panelStyle = {
    background:   theme.bg.surface,
    border:       `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.md,
    padding:      isMobile ? theme.space[3] : theme.space[4],
    marginBottom: theme.space[4],
  };

  const sectionHeader = (label, count) => (
    <div style={{
      display:        "flex",
      alignItems:     "center",
      gap:            theme.space[2],
      marginBottom:   theme.space[3],
      fontSize:       theme.size.sm,
      fontWeight:     500,
      color:          theme.text.muted,
      textTransform:  "uppercase",
      letterSpacing:  "0.5px",
    }}>
      {label}
      {count > 0 && (
        <span style={{
          fontSize:     theme.size.xs,
          color:        theme.text.subtle,
          background:   theme.bg.elevated,
          border:       `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.pill,
          padding:      "0 6px",
          fontWeight:   400,
          textTransform: "none",
          letterSpacing: 0,
        }}>
          {count}
        </span>
      )}
    </div>
  );

  // Macro events for calendar panel
  const macroEvents = marketContext?.macroEvents ?? [];

  const asOfLabel = marketContext?.asOf
    ? (() => {
        const d = new Date(marketContext.asOf);
        return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      })()
    : null;

  const RULES = [
    { priority: "P1", rule: "Cash below floor",    trigger: "Free cash % is below the VIX band floor",                                    source: "Account" },
    { priority: "P1", rule: "Expiring soon",        trigger: "CC or CSP with DTE ≤ 2",                                                     source: "Positions" },
    { priority: "P1", rule: "Uncovered shares",     trigger: "Assigned shares with no active covered call. IV guidance appended when available.", source: "Positions + Quotes" },
    { priority: "P1", rule: "CC deeply ITM",        trigger: "Stock > strike by 2–7% (threshold scales with entry delta). P2 if DTE > 7",  source: "Positions + Quotes" },
    { priority: "P1", rule: "CSP ITM urgency",      trigger: "ITM% × DTE-elapsed% score ≥ 0.05 (min 3% ITM to fire). P2 if score < 0.10", source: "Positions + Quotes" },
    { priority: "P2", rule: "Expiring soon",        trigger: "CC or CSP with DTE 3–5",                                                     source: "Positions" },
    { priority: "P2", rule: "Earnings before expiry", trigger: "Earnings date falls on or before an option expiry",                        source: "Market context" },
    { priority: "P2", rule: "Macro overlap",        trigger: "CPI/FOMC/NFP within 2 days of any option expiry",                            source: "Market context" },
    { priority: "P2", rule: "Near worthless",       trigger: "Option mid < $0.10 and < 5% of original premium collected",                  source: "Positions + Quotes" },
    { priority: "P2", rule: "60/60 rule",           trigger: "≥60% premium captured with ≥60% DTE remaining (suppressed below 5 DTE)",     source: "Positions + Quotes" },
    { priority: "P3", rule: "Expiry cluster",       trigger: "3+ options (CC or CSP) expire on the same date",                             source: "Positions" },
  ];

  const priorityColors = { P1: theme.red, P2: theme.amber, P3: theme.text.subtle };

  return (
    <div>
      {/* ── Rules reference toggle + freshness info ──────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
        <DataFreshnessInfo
          quotesRefreshedAt={quotesRefreshedAt}
          contextAsOf={marketContext?.asOf}
          positionsLastUpdated={account?.last_updated}
        />
        <button
          onClick={() => setRulesOpen(o => !o)}
          style={{
            background:   "transparent",
            border:       `1px solid ${theme.border.strong}`,
            borderRadius: theme.radius.sm,
            color:        rulesOpen ? theme.text.secondary : theme.text.subtle,
            fontSize:     theme.size.sm,
            fontFamily:   "inherit",
            cursor:       "pointer",
            padding:      "3px 10px",
          }}
        >
          {rulesOpen ? "▲ rules" : "? rules"}
        </button>
      </div>

      {/* ── Rules reference panel ──────────────────────────────────────── */}
      {rulesOpen && (
        <div style={{ ...panelStyle, marginBottom: theme.space[4] }}>
          {sectionHeader("Focus Rules", 0)}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.sm }}>
            <thead>
              <tr style={{ color: theme.text.subtle, borderBottom: `1px solid ${theme.border.default}` }}>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Priority</th>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Rule</th>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Trigger</th>
                <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                  <td style={{ padding: "5px 8px" }}>
                    <span style={{ color: priorityColors[r.priority], fontWeight: 600, fontSize: theme.size.xs }}>
                      {r.priority}
                    </span>
                  </td>
                  <td style={{ padding: "5px 8px", color: theme.text.secondary, whiteSpace: "nowrap" }}>{r.rule}</td>
                  <td style={{ padding: "5px 8px", color: theme.text.muted }}>{r.trigger}</td>
                  <td style={{ padding: "5px 8px", color: theme.text.subtle, whiteSpace: "nowrap" }}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Today's Focus (P1) ─────────────────────────────────────────── */}
      <div style={panelStyle}>
        {sectionHeader("Today's Focus", focus.length)}
        {focus.length === 0 ? (
          <div style={{
            padding:      `${theme.space[3]}px ${theme.space[4]}px`,
            background:   "rgba(63,185,80,0.06)",
            border:       `1px solid ${theme.green}`,
            borderRadius: theme.radius.md,
            fontSize:     theme.size.md,
            color:        theme.green,
          }}>
            Nothing urgent today.
          </div>
        ) : (
          focus.map(item => (
            <FocusItemCard key={item.id} item={item} isMobile={isMobile} />
          ))
        )}
      </div>

      {/* ── Watching (P2) ──────────────────────────────────────────────── */}
      {watching.length > 0 && (
        <div style={panelStyle}>
          {sectionHeader("Watching", watching.length)}
          {watching.map(item => (
            <WatchingRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* ── Informational (P3) ─────────────────────────────────────────── */}
      {info.length > 0 && (
        <div style={panelStyle}>
          <div
            onClick={() => setInfoExpanded(e => !e)}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            {sectionHeader("Informational", info.length)}
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[3] }}>
              {infoExpanded ? "▲ hide" : "▼ show"}
            </span>
          </div>
          {infoExpanded && info.map(item => (
            <WatchingRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* ── Macro Calendar ─────────────────────────────────────────────── */}
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
          {sectionHeader("Macro Calendar", 0)}
          {asOfLabel && (
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[3] }}>
              as of {asOfLabel}
            </span>
          )}
        </div>
        {mcLoading ? (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>Loading…</div>
        ) : macroEvents.length > 0 ? (
          <MacroCalendar macroEvents={macroEvents} />
        ) : (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
            Market context unavailable — run OpenClaw ETL to populate.
          </div>
        )}
      </div>
    </div>
  );
}
