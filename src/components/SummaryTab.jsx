import { useMemo } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS } from "../lib/constants";

export function SummaryTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDuration, setSelectedDuration }) {
  const { trades: TRADES_ALL } = useData();
  const isMobile = useWindowWidth() < 600;
  // Scope the entire Summary tab to Q1 2026 (Jan 1 – Mar 31)
  const Q1_START = new Date("2026-01-01T00:00:00");
  const Q1_END   = new Date("2026-03-31T23:59:59");
  const TRADES = TRADES_ALL.filter(t => t.closeDate && t.closeDate >= Q1_START && t.closeDate <= Q1_END);

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
      <p style={{ fontSize: 15, color: "#8b949e", marginBottom: 20 }}>
        {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)} net realized
      </p>

      {/* Type filter pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setSelectedType(null)}
          style={{
            padding: "6px 14px", borderRadius: 4, fontSize: 14, fontFamily: "inherit",
            cursor: "pointer", border: "1px solid",
            background: !selectedType ? "#30363d" : "transparent",
            color: !selectedType ? "#e6edf3" : "#8b949e",
            borderColor: !selectedType ? "#8b949e" : "#30363d",
          }}
        >
          ALL ({TRADES.length})
        </button>
        {typeSummary.map((ts) => (
          <button
            key={ts.type}
            onClick={() => setSelectedType(selectedType === ts.type ? null : ts.type)}
            style={{
              padding: "6px 14px", borderRadius: 4, fontSize: 14, fontFamily: "inherit",
              cursor: "pointer",
              border: `1px solid ${TYPE_COLORS[ts.type]?.border || "#30363d"}`,
              background: selectedType === ts.type ? TYPE_COLORS[ts.type]?.bg || "#30363d" : "transparent",
              color: TYPE_COLORS[ts.type]?.text || "#c9d1d9",
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
                background: isSelected ? "#1c2333" : "#161b22",
                border: isSelected ? "1px solid #58a6ff" : "1px solid #21262d",
                borderRadius: 6, padding: "14px 12px 12px", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: isSelected ? "#58a6ff" : "#e6edf3", fontFamily: "inherit", marginBottom: 2 }}>
                {ts.ticker}
              </div>
              {(() => {
                const source = selectedType
                  ? TRADES.filter((t) => t.type === selectedType && t.ticker === ts.ticker)
                  : TRADES.filter((t) => t.ticker === ts.ticker);
                // Show Jan/Feb/Mar 2026 bars (matching original Q1 scope)
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
                          <div style={{ fontSize: 10, color: md.count === 0 ? "#30363d" : neg ? "#f85149" : "#3fb950" }}>
                            {md.count > 0 ? formatDollars(md.premium) : ""}
                          </div>
                          <div style={{
                            width: "70%", height: md.count > 0 ? h : 2,
                            background: md.count === 0 ? "#21262d" : neg
                              ? "linear-gradient(180deg, #8b2a2a 0%, #da3633 100%)"
                              : "linear-gradient(180deg, #238636 0%, #1a5a2a 100%)",
                            borderRadius: 2, transition: "height 0.3s",
                          }} />
                          <div style={{ fontSize: 10, color: "#6e7681", marginTop: 1 }}>{md.label}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <div style={{ fontSize: 13, color: isNeg ? "#f85149" : "#3fb950", fontFamily: "inherit", fontWeight: 500 }}>
                {formatDollars(ts.premium)}
              </div>
              <div style={{ fontSize: 14, color: "#8b949e", fontFamily: "inherit" }}>
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
          <div style={{ marginBottom: 20, padding: "16px 20px", background: "#161b22", borderRadius: 6, border: "1px solid #21262d" }}>
            <div style={{ fontSize: 13, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14, fontWeight: 500 }}>
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
                    <div style={{ fontSize: 13, color: isSelected ? "#58a6ff" : "#8b949e" }}>{b.count}</div>
                    <div style={{
                      width: "60%", height: barH,
                      background: b.count > 0 ? (isSelected ? "#58a6ff" : "#1f6feb") : "#21262d",
                      borderRadius: 2, transition: "height 0.3s",
                      border: isSelected ? "1px solid #58a6ff" : "1px solid transparent",
                    }} />
                    <div style={{ fontSize: 13, color: isSelected ? "#58a6ff" : "#6e7681", fontWeight: isSelected ? 600 : 400 }}>{b.label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {bucketData.map((b) => (
                <div key={b.idx} style={{ flex: 1, textAlign: "center", fontSize: 13, color: b.premium >= 0 ? "#3fb950" : "#f85149", opacity: selectedDuration != null && selectedDuration !== b.idx ? 0.4 : 1 }}>
                  {b.count > 0 ? formatDollars(b.premium) : ""}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Active filter indicator */}
      {(selectedTicker || selectedType || selectedDuration != null) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 15, color: "#8b949e" }}>
          Showing: {selectedTicker || "All tickers"} · {selectedType || "All types"}
          {selectedDuration != null ? ` · ${DURATION_BUCKETS[selectedDuration].label}` : ""} · {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)}
          <button
            onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); }}
            style={{ background: "#21262d", border: "1px solid #30363d", color: "#8b949e", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}
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
              <div key={i} style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, color: "#e6edf3", fontSize: 14 }}>{t.ticker}</span>
                    <span style={{ background: tc.bg, color: tc.text, padding: "2px 6px", borderRadius: 3, fontSize: 12, fontWeight: 500 }}>{t.type}</span>
                    <span style={{ color: "#8b949e", fontSize: 12 }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</span>
                  </div>
                  <span style={{ fontWeight: 600, color: isLoss ? "#f85149" : "#3fb950", fontSize: 14 }}>{formatDollarsFull(t.premium)}</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#8b949e", flexWrap: "wrap" }}>
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
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d" }}>
                {["Ticker", "Type", "", "Strike", "Ct", "Open", "Close", "Days", "Premium", "Kept", "Fronted"].map((h) => (
                  <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: "#8b949e", fontWeight: 500, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.5px" }}>
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
                    style={{ borderBottom: "1px solid #161b22" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#161b22")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "8px", fontWeight: 600, color: "#e6edf3" }}>{t.ticker}</td>
                    <td style={{ padding: "8px" }}>
                      <span style={{ background: tc.bg, color: tc.text, padding: "3px 8px", borderRadius: 3, fontSize: 13, fontWeight: 500 }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: "8px", color: "#8b949e", fontSize: 13 }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</td>
                    <td style={{ padding: "8px", color: "#c9d1d9" }}>{t.strike ? `$${t.strike}` : "—"}</td>
                    <td style={{ padding: "8px", color: "#8b949e" }}>{t.contracts || "—"}</td>
                    <td style={{ padding: "8px", color: "#8b949e" }}>{t.open}</td>
                    <td style={{ padding: "8px", color: "#8b949e" }}>{t.close}</td>
                    <td style={{ padding: "8px", color: "#8b949e" }}>{t.days != null ? `${t.days}d` : "—"}</td>
                    <td style={{ padding: "8px", fontWeight: 600, color: isLoss ? "#f85149" : "#3fb950" }}>
                      {formatDollarsFull(t.premium)}
                    </td>
                    <td style={{ padding: "8px", color: "#8b949e" }}>{t.kept}</td>
                    <td style={{ padding: "8px", color: "#8b949e" }}>{formatDollarsFull(t.fronted)}</td>
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
