import { formatDollarsFull, formatExpiry } from "../lib/format";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS } from "../lib/constants";
import { theme } from "../lib/theme";

export function CalendarDetailPanel({
  selectedDay,
  selectedWeek,
  displayClosed,
  displayExpiring,
  hasDisplay,
  dailyData,
  weeklyTotals,
  calMonth,
  isMobile,
  deleteTrade,
}) {
  if (!hasDisplay) return null;

  return (
    <div style={{ marginTop: theme.space[4], padding: `${theme.space[5]}px`, background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
        <div style={{ fontSize: theme.size.md, fontWeight: 600, color: theme.text.primary }}>
          {selectedDay
            ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
            : selectedWeek != null
              ? `Week ${selectedWeek + 1} — ${MONTHS[calMonth].label} 2026`
              : `${MONTHS[calMonth].label} 2026 — All Transactions`}
        </div>
        {selectedDay && displayClosed.length > 0 && dailyData[selectedDay] && (
          <div style={{ fontSize: theme.size.md, fontWeight: 600, color: dailyData[selectedDay].premium >= 0 ? theme.green : theme.red }}>
            {formatDollarsFull(dailyData[selectedDay].premium)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
          </div>
        )}
        {selectedWeek != null && displayClosed.length > 0 && (() => {
          const weekTotal = weeklyTotals[selectedWeek].total;
          return (
            <div style={{ fontSize: theme.size.md, fontWeight: 600, color: weekTotal >= 0 ? theme.green : theme.red }}>
              {formatDollarsFull(weekTotal)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
            </div>
          );
        })()}
      </div>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[2] }}>
          {displayClosed.map((t, i) => {
            const tc = TYPE_COLORS[t.type] || {};
            const isLoss = t.premium < 0;
            return (
              <div key={`closed-${i}`} style={{ background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[1] }}>
                  <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
                    <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{t.ticker}</span>
                    <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>{t.type}</span>
                    <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{SUBTYPE_LABELS[t.subtype] || t.subtype || "Closed"}</span>
                  </div>
                  <span style={{ fontWeight: 600, color: isLoss ? theme.red : theme.green, fontSize: theme.size.md }}>{formatDollarsFull(t.premium)}</span>
                </div>
                <div style={{ display: "flex", gap: theme.space[3], fontSize: theme.size.sm, color: theme.text.muted, flexWrap: "wrap" }}>
                  {t.strike && <span>${t.strike}</span>}
                  <span>{t.open} → {t.close}</span>
                  {t.days != null && <span>{t.days}d</span>}
                  {t.kept && t.kept !== "—" && <span>{t.kept} kept</span>}
                </div>
              </div>
            );
          })}
          {displayClosed.length > 0 && displayExpiring.length > 0 && (
            <div style={{ textAlign: "center", fontSize: theme.size.sm, color: theme.text.subtle, padding: `${theme.space[1]}px 0` }}>── Open positions expiring ──</div>
          )}
          {displayExpiring.map((p, i) => {
            const tc = TYPE_COLORS[p.type] || {};
            return (
              <div key={`expiry-${i}`} style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[1] }}>
                  <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
                    <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{p.ticker}</span>
                    <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>{p.type}</span>
                    <span style={{ color: theme.blue, fontSize: theme.size.sm }}>Expires {formatExpiry(p.expiry_date)}</span>
                  </div>
                  <span style={{ fontWeight: 600, color: theme.green, fontSize: theme.size.md }}>{formatDollarsFull(p.premium_collected)}</span>
                </div>
                <div style={{ display: "flex", gap: theme.space[3], fontSize: theme.size.sm, color: theme.text.muted, flexWrap: "wrap" }}>
                  {p.strike && <span>${p.strike}</span>}
                  {p.open_date && <span>opened {p.open_date.slice(5).replace("-", "/")}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                {["Ticker", "Type", "Status", "Strike", "Ct", "Open", "Close", "Expiry", "Days", "Premium", "Kept", ""].map((h) => (
                  <th key={h} style={{ padding: theme.space[2], textAlign: "left", color: theme.text.muted, fontWeight: 500, fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayClosed.map((t, i) => {
                const tc = TYPE_COLORS[t.type] || {};
                const isLoss = t.premium < 0;
                return (
                  <tr key={`closed-${i}`} style={{ borderBottom: `1px solid ${theme.bg.surface}` }}>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: theme.text.primary }}>{t.ticker}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}>
                      <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted, fontSize: theme.size.sm }}>{SUBTYPE_LABELS[t.subtype] || t.subtype || "Closed"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.secondary }}>{t.strike ? `$${t.strike}` : "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.contracts || "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.open}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.close}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.expiry !== "—" ? t.expiry : "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.days != null ? `${t.days}d` : "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: isLoss ? theme.red : theme.green }}>
                      {formatDollarsFull(t.premium)}
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.kept}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[1]}px` }}>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete ${t.ticker} ${t.type} closed ${t.close}?`)) deleteTrade(t);
                        }}
                        title="Delete trade"
                        style={{ background: "none", border: "none", cursor: "pointer", color: theme.text.subtle, fontSize: theme.size.md, padding: `${theme.space[1]}px ${theme.space[1]}px`, lineHeight: 1, borderRadius: theme.radius.sm }}
                        onMouseEnter={e => e.currentTarget.style.color = theme.red}
                        onMouseLeave={e => e.currentTarget.style.color = theme.text.subtle}
                      >×</button>
                    </td>
                  </tr>
                );
              })}
              {displayClosed.length > 0 && displayExpiring.length > 0 && (
                <tr>
                  <td colSpan={12} style={{ padding: theme.space[2], textAlign: "center", fontSize: theme.size.sm, color: theme.text.subtle, borderTop: `1px solid ${theme.border.default}`, borderBottom: `1px solid ${theme.border.default}` }}>
                    ── Open positions expiring ──
                  </td>
                </tr>
              )}
              {displayExpiring.map((p, i) => {
                const tc = TYPE_COLORS[p.type] || {};
                return (
                  <tr key={`expiry-${i}`} style={{ borderBottom: `1px solid ${theme.bg.surface}`, background: theme.bg.elevated }}>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: theme.text.primary }}>{p.ticker}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}>
                      <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>
                        {p.type}
                      </span>
                    </td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, color: theme.blue }}>Expires {formatExpiry(p.expiry_date)}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.secondary }}>{p.strike ? `$${p.strike}` : "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{p.contracts || "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{p.open_date ? p.open_date.slice(5).replace("-", "/") : "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>—</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.blue }}>{p.expiry_date ? p.expiry_date.slice(5).replace("-", "/") : "—"}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>—</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: theme.green }}>{formatDollarsFull(p.premium_collected)}</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>—</td>
                    <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
