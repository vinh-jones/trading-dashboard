import { useMemo } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS } from "../lib/constants";
import { theme } from "../lib/theme";

export function SummaryTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDuration, setSelectedDuration }) {
  const { trades: TRADES_ALL } = useData();
  const isMobile = useWindowWidth() < 600;
  // Scope the entire Summary tab to YTD (Jan 1 – today)
  const YTD_START = new Date("2026-01-01T00:00:00");
  const YTD_END   = new Date();
  const TRADES = TRADES_ALL.filter(t => t.closeDate && t.closeDate >= YTD_START && t.closeDate <= YTD_END);

  const DURATION_BUCKETS = [
    { label: "0-1d",   min: 0,  max: 1    },
    { label: "2-3d",   min: 2,  max: 3    },
    { label: "4-7d",   min: 4,  max: 7    },
    { label: "8-14d",  min: 8,  max: 14   },
    { label: "15-30d", min: 15, max: 30   },
    { label: "30d+",   min: 31, max: 9999 },
  ];

  const tickerSummary = useMemo(() => {
    const source = TRADES.filter((t) => {
      if (selectedType && t.type !== selectedType) return false;
      if (selectedDuration != null) {
        const b = DURATION_BUCKETS[selectedDuration];
        if (t.days < b.min || t.days > b.max) return false;
      }
      return true;
    });
    const map = {};
    source.forEach((t) => {
      if (!map[t.ticker]) map[t.ticker] = { ticker: t.ticker, trades: 0, premium: 0, byType: {} };
      map[t.ticker].trades++;
      map[t.ticker].premium += t.premium;
      if (!map[t.ticker].byType[t.type]) map[t.ticker].byType[t.type] = { count: 0, premium: 0 };
      map[t.ticker].byType[t.type].count++;
      map[t.ticker].byType[t.type].premium += t.premium;
    });
    return Object.values(map).sort((a, b) => b.premium - a.premium);
  }, [selectedType, selectedDuration]);

  const typeSummary = useMemo(() => {
    const source = TRADES.filter((t) => {
      if (selectedTicker && t.ticker !== selectedTicker) return false;
      if (selectedDuration != null) {
        const b = DURATION_BUCKETS[selectedDuration];
        if (t.days < b.min || t.days > b.max) return false;
      }
      return true;
    });
    const map = {};
    source.forEach((t) => {
      if (!map[t.type]) map[t.type] = { type: t.type, count: 0, premium: 0 };
      map[t.type].count++;
      map[t.type].premium += t.premium;
    });
    return Object.values(map).sort((a, b) => b.premium - a.premium);
  }, [selectedTicker, selectedDuration]);

  const filteredTrades = useMemo(() => {
    return TRADES.filter((t) => {
      if (selectedTicker && t.ticker !== selectedTicker) return false;
      if (selectedType && t.type !== selectedType) return false;
      if (selectedDuration != null) {
        const b = DURATION_BUCKETS[selectedDuration];
        if (t.days < b.min || t.days > b.max) return false;
      }
      return true;
    });
  }, [selectedTicker, selectedType, selectedDuration]);

  const filteredTotal = filteredTrades.reduce((s, t) => s + t.premium, 0);

  return (
    <div>
      <p style={{ fontSize: theme.size.lg, color: theme.text.muted, marginBottom: 20 }}>
        {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)} net realized
      </p>

      {/* Type filter pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setSelectedType(null)}
          style={{
            padding: "6px 14px", borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
            cursor: "pointer", border: !selectedType ? "none" : "none",
            background: !selectedType ? theme.bg.elevated : "transparent",
            color: !selectedType ? theme.text.primary : theme.text.muted,
          }}
        >
          ALL ({TRADES.length})
        </button>
        {typeSummary.map((ts) => (
          <button
            key={ts.type}
            onClick={() => setSelectedType(selectedType === ts.type ? null : ts.type)}
            style={{
              padding: "6px 14px", borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
              cursor: "pointer",
              border: `1px solid ${TYPE_COLORS[ts.type]?.border || theme.border.strong}`,
              background: selectedType === ts.type ? TYPE_COLORS[ts.type]?.bg || theme.border.strong : "transparent",
              color: TYPE_COLORS[ts.type]?.text || theme.text.secondary,
            }}
          >
            {ts.type} ({ts.count}) · {formatDollars(ts.premium)}
          </button>
        ))}
      </div>

      {/* Ticker bar chart */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, marginBottom: 20 }}>
        {tickerSummary.map((ts) => {
          const isSelected = selectedTicker === ts.ticker;
          const isNeg = ts.premium < 0;
          return (
            <button
              key={ts.ticker}
              onClick={() => setSelectedTicker(isSelected ? null : ts.ticker)}
              style={{
                background: isSelected ? theme.bg.elevated : theme.bg.surface,
                border: isSelected ? `1px solid ${theme.blue}` : `1px solid ${theme.border.default}`,
                borderRadius: theme.radius.sm, padding: "14px 12px 12px", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: theme.size.md, fontWeight: 600, color: isSelected ? theme.blue : theme.text.primary, fontFamily: "inherit", marginBottom: 2 }}>
                {ts.ticker}
              </div>
              {(() => {
                const source = selectedType
                  ? TRADES.filter((t) => t.type === selectedType && t.ticker === ts.ticker)
                  : TRADES.filter((t) => t.ticker === ts.ticker);
                // Show YTD monthly bars
                const monthData = MONTHS.map(({ month, label }) => {
                  const mTrades = source.filter(
                    (t) => t.closeDate && t.closeDate.getFullYear() === 2026 && t.closeDate.getMonth() === month
                  );
                  return { label, premium: mTrades.reduce((s, t) => s + t.premium, 0), count: mTrades.length };
                });
                const maxP = Math.max(...monthData.map((d) => Math.abs(d.premium)), 1);
                return (
                  <div style={{ width: "100%", display: "flex", gap: 4, justifyContent: "center", height: 76, alignItems: "flex-end" }}>
                    {monthData.map((md, mi) => {
                      const h = Math.max(3, (Math.abs(md.premium) / maxP) * 44);
                      const neg = md.premium < 0;
                      return (
                        <div key={mi} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                          <div style={{ fontSize: theme.size.xs, color: md.count === 0 ? theme.border.strong : neg ? theme.red : theme.green }}>
                            {md.count > 0 ? formatDollars(md.premium) : ""}
                          </div>
                          <div style={{
                            width: "70%", height: md.count > 0 ? h : 2,
                            background: md.count === 0 ? theme.border.default : neg
                              ? "linear-gradient(180deg, #8b2a2a 0%, #da3633 100%)"
                              : "linear-gradient(180deg, #238636 0%, #1a5a2a 100%)",
                            borderRadius: 2, transition: "height 0.3s",
                          }} />
                          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 1 }}>{md.label}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <div style={{ fontSize: theme.size.md, color: isNeg ? theme.red : theme.green, fontFamily: "inherit", fontWeight: 500 }}>
                {formatDollars(ts.premium)}
              </div>
              <div style={{ fontSize: theme.size.md, color: theme.text.muted, fontFamily: "inherit" }}>
                {ts.trades} trades
              </div>
            </button>
          );
        })}
      </div>

      {/* Hold duration histogram */}
      {(() => {
        const histSource = TRADES.filter((t) => {
          if (selectedTicker && t.ticker !== selectedTicker) return false;
          if (selectedType && t.type !== selectedType) return false;
          return true;
        });
        const bucketData = DURATION_BUCKETS.map((b, i) => {
          const trades = histSource.filter((t) => t.days >= b.min && t.days <= b.max);
          return { ...b, idx: i, count: trades.length, premium: trades.reduce((s, t) => s + t.premium, 0) };
        });
        const maxCount = Math.max(...bucketData.map((b) => b.count), 1);
        return (
          <div style={{ marginBottom: 20, padding: "16px 20px", background: theme.bg.surface, borderRadius: theme.radius.sm, border: `1px solid ${theme.border.default}` }}>
            <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14, fontWeight: 500 }}>
              Hold duration distribution
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 80 }}>
              {bucketData.map((b) => {
                const barH = maxCount > 0 ? Math.max(3, (b.count / maxCount) * 60) : 3;
                const isSelected = selectedDuration === b.idx;
                return (
                  <div
                    key={b.idx}
                    onClick={() => setSelectedDuration(selectedDuration === b.idx ? null : b.idx)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, cursor: "pointer", transition: "opacity 0.15s", opacity: selectedDuration != null && !isSelected ? 0.4 : 1 }}
                  >
                    <div style={{ fontSize: theme.size.md, color: isSelected ? theme.blue : theme.text.muted }}>{b.count}</div>
                    <div style={{
                      width: "60%", height: barH,
                      background: b.count > 0 ? (isSelected ? theme.blue : "#1f6feb") : theme.border.default,
                      borderRadius: 2, transition: "height 0.3s",
                      border: isSelected ? `1px solid ${theme.blue}` : "1px solid transparent",
                    }} />
                    <div style={{ fontSize: theme.size.md, color: isSelected ? theme.blue : theme.text.subtle, fontWeight: isSelected ? 600 : 400 }}>{b.label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {bucketData.map((b) => (
                <div key={b.idx} style={{ flex: 1, textAlign: "center", fontSize: theme.size.md, color: b.premium >= 0 ? theme.green : theme.red, opacity: selectedDuration != null && selectedDuration !== b.idx ? 0.4 : 1 }}>
                  {b.count > 0 ? formatDollars(b.premium) : ""}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Active filter indicator */}
      {(selectedTicker || selectedType || selectedDuration != null) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: theme.size.lg, color: theme.text.muted }}>
          Showing: {selectedTicker || "All tickers"} · {selectedType || "All types"}
          {selectedDuration != null ? ` · ${DURATION_BUCKETS[selectedDuration].label}` : ""} · {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)}
          <button
            onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); }}
            style={{ background: theme.border.default, border: `1px solid ${theme.border.strong}`, color: theme.text.muted, borderRadius: theme.radius.sm, padding: "4px 10px", cursor: "pointer", fontSize: theme.size.md, fontFamily: "inherit" }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Trade table */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredTrades.map((t, i) => {
            const tc = TYPE_COLORS[t.type] || {};
            const isLoss = t.premium < 0;
            return (
              <div key={i} style={{ background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{t.ticker}</span>
                    <span style={{ background: tc.bg, color: tc.text, padding: "2px 6px", borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>{t.type}</span>
                    <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</span>
                  </div>
                  <span style={{ fontWeight: 600, color: isLoss ? theme.red : theme.green, fontSize: theme.size.md }}>{formatDollarsFull(t.premium)}</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: theme.size.sm, color: theme.text.muted, flexWrap: "wrap" }}>
                  {t.strike && <span>${t.strike}</span>}
                  <span>{t.open} → {t.close}</span>
                  {t.days != null && <span>{t.days}d</span>}
                  {t.kept && t.kept !== "—" && <span>{t.kept} kept</span>}
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
                {["Ticker", "Type", "", "Strike", "Ct", "Open", "Close", "Days", "Premium", "Kept", "Fronted"].map((h) => (
                  <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: theme.text.muted, fontWeight: 500, fontSize: theme.size.md, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t, i) => {
                const tc = TYPE_COLORS[t.type] || {};
                const isLoss = t.premium < 0;
                return (
                  <tr
                    key={i}
                    style={{ borderBottom: `1px solid ${theme.bg.surface}` }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg.surface)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "8px", fontWeight: 600, color: theme.text.primary }}>{t.ticker}</td>
                    <td style={{ padding: "8px" }}>
                      <span style={{ background: tc.bg, color: tc.text, padding: "3px 8px", borderRadius: theme.radius.sm, fontSize: theme.size.md, fontWeight: 500 }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: "8px", color: theme.text.muted, fontSize: theme.size.md }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</td>
                    <td style={{ padding: "8px", color: theme.text.secondary }}>{t.strike ? `$${t.strike}` : "—"}</td>
                    <td style={{ padding: "8px", color: theme.text.muted }}>{t.contracts || "—"}</td>
                    <td style={{ padding: "8px", color: theme.text.muted }}>{t.open}</td>
                    <td style={{ padding: "8px", color: theme.text.muted }}>{t.close}</td>
                    <td style={{ padding: "8px", color: theme.text.muted }}>{t.days != null ? `${t.days}d` : "—"}</td>
                    <td style={{ padding: "8px", fontWeight: 600, color: isLoss ? theme.red : theme.green }}>
                      {formatDollarsFull(t.premium)}
                    </td>
                    <td style={{ padding: "8px", color: theme.text.muted }}>{t.kept}</td>
                    <td style={{ padding: "8px", color: theme.text.muted }}>{formatDollarsFull(t.fronted)}</td>
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
