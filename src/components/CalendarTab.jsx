import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull, formatExpiry } from "../lib/format";
import { calcDTE, calcPipeline } from "../lib/trading";
import { getCalendarWeeks } from "../lib/calendar";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS, DAY_NAMES } from "../lib/constants";

export function CalendarTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDay, setSelectedDay, captureRate, setCaptureRate }) {
  const { trades: TRADES, positions, account, deleteTrade } = useData();
  const isMobile = useWindowWidth() < 600;
  const [calMonth, setCalMonth] = useState(3); // default to April
  const [selectedWeek, setSelectedWeek] = useState(null); // null or week index (0-4)

  const monthInfo = MONTHS[calMonth];

  const dailyData = useMemo(() => {
    const filtered = TRADES.filter((t) => {
      if (selectedTicker && t.ticker !== selectedTicker) return false;
      if (selectedType && t.type !== selectedType) return false;
      return true;
    });
    const map = {};
    filtered.forEach((t) => {
      const d = t.closeDate; // Date object from adapter
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map[key]) map[key] = { premium: 0, count: 0, trades: [] };
      map[key].premium += t.premium;
      map[key].count++;
      map[key].trades.push(t);
    });
    return map;
  }, [TRADES, selectedTicker, selectedType]);

  const weeks = useMemo(() => getCalendarWeeks(monthInfo.year, monthInfo.month), [calMonth]);

  const monthTotal = useMemo(() => {
    let total = 0, count = 0;
    Object.entries(dailyData).forEach(([key, val]) => {
      const [ky, km] = key.split("-").map(Number);
      if (ky === monthInfo.year && km - 1 === monthInfo.month) {
        total += val.premium;
        count += val.count;
      }
    });
    return { total, count };
  }, [dailyData, calMonth]);

  const weeklyTotals = useMemo(() => {
    return weeks.map((week) => {
      let total = 0, count = 0;
      week.forEach((day) => {
        if (day.getMonth() !== monthInfo.month) return;
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        if (dailyData[key]) {
          total += dailyData[key].premium;
          count += dailyData[key].count;
        }
      });
      return { total, count };
    });
  }, [dailyData, weeks, calMonth]);

  const maxAbsPremium = useMemo(() => {
    let max = 0;
    Object.entries(dailyData).forEach(([key, val]) => {
      const [ky, km] = key.split("-").map(Number);
      if (ky === monthInfo.year && km - 1 === monthInfo.month) {
        max = Math.max(max, Math.abs(val.premium));
      }
    });
    return max || 1;
  }, [dailyData, calMonth]);

  const typeSummary = useMemo(() => {
    const source = TRADES.filter((t) => {
      if (selectedTicker && t.ticker !== selectedTicker) return false;
      return true;
    });
    const map = {};
    source.forEach((t) => {
      if (!map[t.type]) map[t.type] = { type: t.type, count: 0, premium: 0 };
      map[t.type].count++;
      map[t.type].premium += t.premium;
    });
    return Object.values(map).sort((a, b) => b.premium - a.premium);
  }, [TRADES, selectedTicker]);

  const expiryMap = useMemo(() => {
    const map = {};
    const openPositions = [
      ...positions.open_csps,
      ...positions.assigned_shares
        .filter(s => s.active_cc)
        .map(s => s.active_cc),
    ].filter(p => {
      if (selectedTicker && p.ticker !== selectedTicker) return false;
      if (selectedType && p.type !== selectedType) return false;
      return true;
    });
    openPositions.forEach(p => {
      if (!p.expiry_date) return;
      const key = p.expiry_date;
      if (!map[key]) map[key] = { tickers: [], totalPremium: 0, positions: [] };
      map[key].tickers.push(p.ticker);
      map[key].totalPremium += (p.premium_collected || 0);
      map[key].positions.push(p);
    });
    return map;
  }, [positions, selectedTicker, selectedType]);

  const monthClosedTrades = useMemo(() => {
    const result = [];
    Object.entries(dailyData).forEach(([key, val]) => {
      const [ky, km] = key.split("-").map(Number);
      if (ky === monthInfo.year && km - 1 === monthInfo.month) {
        result.push(...val.trades);
      }
    });
    return result.sort((a, b) => (a.closeDate || 0) - (b.closeDate || 0));
  }, [dailyData, calMonth]);

  const monthExpiringPositions = useMemo(() => {
    const result = [];
    Object.entries(expiryMap).forEach(([key, val]) => {
      const [ky, km] = key.split("-").map(Number);
      if (ky === monthInfo.year && km - 1 === monthInfo.month) {
        val.positions.forEach(p => result.push(p));
      }
    });
    return result.sort((a, b) => (a.expiry_date || "").localeCompare(b.expiry_date || ""));
  }, [expiryMap, calMonth]);

  // Pipeline values for the planning panel
  const { grossOpenPremium, expectedPipeline, hasPositions: hasPipelinePositions } = calcPipeline(positions, captureRate);
  const mtdCollected      = account?.month_to_date_premium ?? 0;
  const pipelineBaseline  = account?.monthly_targets?.baseline ?? 15000;
  const impliedTotal      = mtdCollected + expectedPipeline;
  const gapToBaseline     = pipelineBaseline - impliedTotal;

  // Unified display: selected day, selected week, or whole month when nothing selected
  const displayClosed = selectedDay
    ? (dailyData[selectedDay]?.trades || [])
    : selectedWeek != null
      ? weeks[selectedWeek]
          .filter(d => d.getMonth() === monthInfo.month)
          .flatMap(d => {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            return dailyData[key]?.trades || [];
          })
      : monthClosedTrades;
  const displayExpiring = selectedDay
    ? (expiryMap[selectedDay]?.positions || [])
    : selectedWeek != null
      ? weeks[selectedWeek]
          .filter(d => d.getMonth() === monthInfo.month)
          .flatMap(d => {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            return expiryMap[key]?.positions || [];
          })
      : monthExpiringPositions;
  const hasDisplay      = displayClosed.length > 0 || displayExpiring.length > 0;

  function getCellBg(premium) {
    const intensity = Math.min(Math.abs(premium) / maxAbsPremium, 1);
    if (premium > 0) {
      return `rgb(${Math.round(13 + intensity * 22)}, ${Math.round(17 + intensity * 100)}, ${Math.round(23 + intensity * 30)})`;
    } else {
      return `rgb(${Math.round(13 + intensity * 100)}, ${Math.round(17 + intensity * 5)}, ${Math.round(23 + intensity * 10)})`;
    }
  }

  return (
    <div>
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

      {/* Pipeline planning panel */}
      <div style={{ padding: isMobile ? "12px 14px" : "16px 20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
            Premium Pipeline
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8b949e" }}>
            Expected capture:
            <select
              value={captureRate}
              onChange={e => setCaptureRate(parseFloat(e.target.value))}
              style={{ background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3", borderRadius: 4, padding: "3px 6px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}
            >
              <option value={0.50}>50%</option>
              <option value={0.60}>60%</option>
              <option value={0.70}>70%</option>
              <option value={0.80}>80%</option>
            </select>
          </div>
        </div>
        {hasPipelinePositions ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(5, 1fr)", gap: 12 }}>
            {[
              { label: "Gross open premium",                value: formatDollarsFull(grossOpenPremium), color: "#e6edf3" },
              { label: `Expected (${Math.round(captureRate * 100)}%)`, value: `~${formatDollarsFull(expectedPipeline)}`, color: "#3fb950" },
              { label: "MTD collected",                     value: formatDollarsFull(mtdCollected), color: "#e6edf3" },
              { label: "Implied month total",               value: `~${formatDollarsFull(impliedTotal)}`, color: "#e6edf3" },
              {
                label: "Gap to baseline",
                value: gapToBaseline > 0
                  ? `-${formatDollarsFull(gapToBaseline)} to ${formatDollars(pipelineBaseline)}`
                  : `✓ +${formatDollarsFull(Math.abs(gapToBaseline))} above`,
                color: gapToBaseline > 0 ? "#f85149" : "#3fb950",
              },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: isMobile ? 10 : 11, color: "#6e7681", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 600, color }}>{value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#6e7681" }}>No open CSPs or CCs — pipeline is empty.</div>
        )}
        <div style={{ fontSize: 11, color: "#4e5a65", marginTop: 10 }}>
          Across all open expirations · assuming {Math.round(captureRate * 100)}% capture on open positions
        </div>
      </div>

      {/* Month selector + monthly total */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {MONTHS.map((m, i) => (
            <button
              key={m.label}
              onClick={() => { setCalMonth(i); setSelectedDay(null); setSelectedWeek(null); }}
              style={{
                padding: "7px 18px", borderRadius: 4, fontSize: 15, fontFamily: "inherit", cursor: "pointer",
                fontWeight: calMonth === i ? 600 : 400,
                background: calMonth === i ? "#21262d" : "transparent",
                color: calMonth === i ? "#e6edf3" : "#8b949e",
                border: calMonth === i ? "1px solid #30363d" : "1px solid transparent",
                transition: "all 0.15s",
              }}
            >
              {m.label} 2026
            </button>
          ))}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          <span style={{ color: "#8b949e", fontWeight: 400, fontSize: 14, marginRight: 8 }}>Monthly P&L:</span>
          <span style={{ color: monthTotal.total >= 0 ? "#3fb950" : "#f85149" }}>
            {formatDollarsFull(monthTotal.total)}
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ border: "1px solid #21262d", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr) 120px" }}>
          {DAY_NAMES.map((d) => (
            <div key={d} style={{ padding: "10px 12px", fontSize: 13, color: "#8b949e", textAlign: "center", borderBottom: "1px solid #21262d", background: "#161b22", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {d}
            </div>
          ))}
          <div style={{ padding: "10px 12px", fontSize: 13, color: "#8b949e", textAlign: "center", borderBottom: "1px solid #21262d", background: "#161b22", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Total
          </div>
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr) 120px" }}>
            {week.map((day, di) => {
              const inMonth = day.getMonth() === monthInfo.month;
              const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
              const data = dailyData[key];
              const hasTrades = inMonth && data && data.count > 0;
              const hasExpiry = inMonth && !!expiryMap[key];
              const isClickable = hasTrades || hasExpiry;
              const isSelected = selectedDay === key;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={di}
                  onClick={() => { if (isClickable) { setSelectedDay(isSelected ? null : key); setSelectedWeek(null); } }}
                  style={{
                    padding: "10px 12px", minHeight: 80,
                    borderBottom: wi < weeks.length - 1 ? "1px solid #21262d" : "none",
                    borderRight: di < 6 ? "1px solid #161b22" : "none",
                    background: isSelected ? "#1c2333" : hasTrades ? getCellBg(data.premium) : (isWeekend && inMonth ? "#0a0e14" : "#0d1117"),
                    cursor: isClickable ? "pointer" : "default",
                    opacity: inMonth ? 1 : 0.25,
                    transition: "background 0.15s",
                    border: isSelected ? "1px solid #58a6ff" : "1px solid transparent",
                    borderBottomColor: wi < weeks.length - 1 ? "#21262d" : "transparent",
                  }}
                  onMouseEnter={(e) => { if (hasTrades && !isSelected) e.currentTarget.style.outline = "1px solid #30363d"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.outline = "none"; }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500, color: inMonth ? "#8b949e" : "#30363d", marginBottom: 6 }}>
                    {day.getDate()}
                  </div>
                  {hasTrades && (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 600, color: data.premium >= 0 ? "#3fb950" : "#f85149", lineHeight: 1.3 }}>
                        {formatDollarsFull(data.premium)}
                      </div>
                      <div style={{ fontSize: 12, color: "#6e7681", marginTop: 3 }}>
                        {data.count} trade{data.count !== 1 ? "s" : ""}
                      </div>
                    </>
                  )}
                  {!hasTrades && inMonth && !isWeekend && !hasExpiry && (
                    <div style={{ fontSize: 13, color: "#21262d" }}>$0</div>
                  )}
                  {hasExpiry && (() => {
                    const { tickers, totalPremium } = expiryMap[key];
                    const shown = tickers.slice(0, 3);
                    const extra = tickers.length - shown.length;
                    return (
                      <div style={{ marginTop: hasTrades ? 4 : 0, fontSize: 10, color: "#58a6ff", background: "rgba(88,166,255,0.08)", borderRadius: 2, padding: "2px 4px", lineHeight: 1.5 }}>
                        ⚑ {shown.join(" · ")}{extra > 0 ? ` +${extra}` : ""}{" "}
                        <span style={{ color: "#6e7681" }}>${totalPremium.toLocaleString()} gross</span>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            {/* Weekly total column */}
            {(() => {
              const isWeekSelected = selectedWeek === wi;
              const isWeekClickable = weeklyTotals[wi].count > 0;
              return (
                <div
                  onClick={() => { if (isWeekClickable) { setSelectedWeek(isWeekSelected ? null : wi); setSelectedDay(null); } }}
                  style={{
                    padding: "10px 12px", minHeight: 80,
                    borderBottom: wi < weeks.length - 1 ? "1px solid #21262d" : "none",
                    border: isWeekSelected ? "1px solid #58a6ff" : "1px solid transparent",
                    background: isWeekSelected ? "#1c2333" : "#161b22",
                    display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                    cursor: isWeekClickable ? "pointer" : "default",
                    borderRadius: isWeekSelected ? 4 : 0,
                  }}
                >
                  <div style={{ fontSize: 12, color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    Week {wi + 1}
                  </div>
                  {weeklyTotals[wi].count > 0 ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 600, color: weeklyTotals[wi].total >= 0 ? "#3fb950" : "#f85149" }}>
                        {formatDollarsFull(weeklyTotals[wi].total)}
                      </div>
                      <div style={{ fontSize: 12, color: "#6e7681", marginTop: 2 }}>
                        {weeklyTotals[wi].count} trades
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: "#30363d" }}>—</div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>

      {/* Unified detail panel — selected day or whole month default */}
      {hasDisplay && (
        <div style={{ marginTop: 20, padding: "16px 20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>
              {selectedDay
                ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                : selectedWeek != null
                  ? `Week ${selectedWeek + 1} — ${MONTHS[calMonth].label} 2026`
                  : `${MONTHS[calMonth].label} 2026 — All Transactions`}
            </div>
            {selectedDay && displayClosed.length > 0 && dailyData[selectedDay] && (
              <div style={{ fontSize: 15, fontWeight: 600, color: dailyData[selectedDay].premium >= 0 ? "#3fb950" : "#f85149" }}>
                {formatDollarsFull(dailyData[selectedDay].premium)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
              </div>
            )}
            {selectedWeek != null && displayClosed.length > 0 && (() => {
              const weekTotal = weeklyTotals[selectedWeek].total;
              return (
                <div style={{ fontSize: 15, fontWeight: 600, color: weekTotal >= 0 ? "#3fb950" : "#f85149" }}>
                  {formatDollarsFull(weekTotal)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
                </div>
              );
            })()}
          </div>
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {displayClosed.map((t, i) => {
                const tc = TYPE_COLORS[t.type] || {};
                const isLoss = t.premium < 0;
                return (
                  <div key={`closed-${i}`} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: "#e6edf3", fontSize: 14 }}>{t.ticker}</span>
                        <span style={{ background: tc.bg, color: tc.text, padding: "2px 6px", borderRadius: 3, fontSize: 12, fontWeight: 500 }}>{t.type}</span>
                        <span style={{ color: "#8b949e", fontSize: 12 }}>{SUBTYPE_LABELS[t.subtype] || t.subtype || "Closed"}</span>
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
              {displayClosed.length > 0 && displayExpiring.length > 0 && (
                <div style={{ textAlign: "center", fontSize: 12, color: "#6e7681", padding: "6px 0" }}>── Open positions expiring ──</div>
              )}
              {displayExpiring.map((p, i) => {
                const tc = TYPE_COLORS[p.type] || {};
                return (
                  <div key={`expiry-${i}`} style={{ background: "#1c2333", border: "1px solid #21262d", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: "#e6edf3", fontSize: 14 }}>{p.ticker}</span>
                        <span style={{ background: tc.bg, color: tc.text, padding: "2px 6px", borderRadius: 3, fontSize: 12, fontWeight: 500 }}>{p.type}</span>
                        <span style={{ color: "#58a6ff", fontSize: 12 }}>Expires {formatExpiry(p.expiry_date)}</span>
                      </div>
                      <span style={{ fontWeight: 600, color: "#3fb950", fontSize: 14 }}>{formatDollarsFull(p.premium_collected)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#8b949e", flexWrap: "wrap" }}>
                      {p.strike && <span>${p.strike}</span>}
                      {p.open_date && <span>opened {p.open_date.slice(5).replace("-", "/")}</span>}
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
                    {["Ticker", "Type", "Status", "Strike", "Ct", "Open", "Close", "Expiry", "Days", "Premium", "Kept", ""].map((h) => (
                      <th key={h} style={{ padding: "8px", textAlign: "left", color: "#8b949e", fontWeight: 500, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
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
                      <tr key={`closed-${i}`} style={{ borderBottom: "1px solid #161b22" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 600, color: "#e6edf3" }}>{t.ticker}</td>
                        <td style={{ padding: "7px 8px" }}>
                          <span style={{ background: tc.bg, color: tc.text, padding: "2px 7px", borderRadius: 3, fontSize: 12, fontWeight: 500 }}>
                            {t.type}
                          </span>
                        </td>
                        <td style={{ padding: "7px 8px", color: "#8b949e", fontSize: 12 }}>{SUBTYPE_LABELS[t.subtype] || t.subtype || "Closed"}</td>
                        <td style={{ padding: "7px 8px", color: "#c9d1d9" }}>{t.strike ? `$${t.strike}` : "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.contracts || "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.open}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.close}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.expiry !== "—" ? t.expiry : "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.days != null ? `${t.days}d` : "—"}</td>
                        <td style={{ padding: "7px 8px", fontWeight: 600, color: isLoss ? "#f85149" : "#3fb950" }}>
                          {formatDollarsFull(t.premium)}
                        </td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.kept}</td>
                        <td style={{ padding: "7px 4px" }}>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete ${t.ticker} ${t.type} closed ${t.close}?`)) deleteTrade(t);
                            }}
                            title="Delete trade"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#6e7681", fontSize: 14, padding: "2px 4px", lineHeight: 1, borderRadius: 3 }}
                            onMouseEnter={e => e.currentTarget.style.color = "#f85149"}
                            onMouseLeave={e => e.currentTarget.style.color = "#6e7681"}
                          >×</button>
                        </td>
                      </tr>
                    );
                  })}
                  {displayClosed.length > 0 && displayExpiring.length > 0 && (
                    <tr>
                      <td colSpan={12} style={{ padding: "8px", textAlign: "center", fontSize: 12, color: "#6e7681", borderTop: "1px solid #21262d", borderBottom: "1px solid #21262d" }}>
                        ── Open positions expiring ──
                      </td>
                    </tr>
                  )}
                  {displayExpiring.map((p, i) => {
                    const tc = TYPE_COLORS[p.type] || {};
                    return (
                      <tr key={`expiry-${i}`} style={{ borderBottom: "1px solid #161b22", background: "#1c2333" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 600, color: "#e6edf3" }}>{p.ticker}</td>
                        <td style={{ padding: "7px 8px" }}>
                          <span style={{ background: tc.bg, color: tc.text, padding: "2px 7px", borderRadius: 3, fontSize: 12, fontWeight: 500 }}>
                            {p.type}
                          </span>
                        </td>
                        <td style={{ padding: "7px 8px", fontSize: 12, color: "#58a6ff" }}>Expires {formatExpiry(p.expiry_date)}</td>
                        <td style={{ padding: "7px 8px", color: "#c9d1d9" }}>{p.strike ? `$${p.strike}` : "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{p.contracts || "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>{p.open_date ? p.open_date.slice(5).replace("-", "/") : "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>—</td>
                        <td style={{ padding: "7px 8px", color: "#58a6ff" }}>{p.expiry_date ? p.expiry_date.slice(5).replace("-", "/") : "—"}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>—</td>
                        <td style={{ padding: "7px 8px", fontWeight: 600, color: "#3fb950" }}>{formatDollarsFull(p.premium_collected)}</td>
                        <td style={{ padding: "7px 8px", color: "#8b949e" }}>—</td>
                        <td style={{ padding: "7px 8px" }}></td>
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
