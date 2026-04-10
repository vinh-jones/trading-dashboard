import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { calcPipeline } from "../lib/trading";
import { getCalendarWeeks } from "../lib/calendar";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS, DAY_NAMES } from "../lib/constants";
import { theme } from "../lib/theme";
import { CalendarDetailPanel } from "./CalendarDetailPanel";

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

  // maxAbsPremium normalizes heatmap intensity within the current month
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
  const hasDisplay = displayClosed.length > 0 || displayExpiring.length > 0;

  // Heatmap: intensity-scaled RGB from the base background color (#0d1117 = rgb 13,17,23)
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
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap" }}>
        <button
          onClick={() => setSelectedType(null)}
          style={{
            padding: "6px 14px", borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
            cursor: "pointer", border: "none",
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
              background: selectedType === ts.type ? TYPE_COLORS[ts.type]?.bg || theme.bg.elevated : "transparent",
              color: TYPE_COLORS[ts.type]?.text || theme.text.secondary,
            }}
          >
            {ts.type} ({ts.count}) · {formatDollars(ts.premium)}
          </button>
        ))}
      </div>

      {/* Pipeline planning panel */}
      <div style={{ padding: `${theme.space[3]}px ${theme.space[4]}px`, background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}`, marginBottom: theme.space[4] }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
            Premium Pipeline
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[1], fontSize: theme.size.sm, color: theme.text.muted }}>
            Expected capture:
            <select
              value={captureRate}
              onChange={e => setCaptureRate(parseFloat(e.target.value))}
              style={{ background: theme.bg.base, border: `1px solid ${theme.border.strong}`, color: theme.text.primary, borderRadius: theme.radius.sm, padding: "3px 6px", fontSize: theme.size.sm, fontFamily: "inherit", cursor: "pointer" }}
            >
              <option value={0.50}>50%</option>
              <option value={0.60}>60%</option>
              <option value={0.70}>70%</option>
              <option value={0.80}>80%</option>
            </select>
          </div>
        </div>
        {hasPipelinePositions ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(5, 1fr)", gap: theme.space[4] }}>
            {[
              { label: "Gross open premium",                value: formatDollarsFull(grossOpenPremium), color: theme.text.primary },
              { label: `Expected (${Math.round(captureRate * 100)}%)`, value: `~${formatDollarsFull(expectedPipeline)}`, color: theme.green },
              { label: "MTD collected",                     value: formatDollarsFull(mtdCollected), color: theme.text.primary },
              { label: "Implied month total",               value: `~${formatDollarsFull(impliedTotal)}`, color: theme.text.primary },
              {
                label: "Gap to baseline",
                value: gapToBaseline > 0
                  ? `-${formatDollarsFull(gapToBaseline)} to ${formatDollars(pipelineBaseline)}`
                  : `✓ +${formatDollarsFull(Math.abs(gapToBaseline))} above`,
                color: gapToBaseline > 0 ? theme.red : theme.green,
              },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[1] }}>{label}</div>
                <div style={{ fontSize: theme.size.md, fontWeight: 600, color }}>{value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>No open CSPs or CCs — pipeline is empty.</div>
        )}
        <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: theme.space[2] }}>
          Across all open expirations · assuming {Math.round(captureRate * 100)}% capture on open positions
        </div>
      </div>

      {/* Month selector + monthly total */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[4] }}>
        <div style={{ display: "flex", gap: theme.space[1] }}>
          {MONTHS.map((m, i) => (
            <button
              key={m.label}
              onClick={() => { setCalMonth(i); setSelectedDay(null); setSelectedWeek(null); }}
              style={{
                padding: "6px 16px", fontSize: theme.size.md, fontFamily: "inherit", cursor: "pointer",
                fontWeight: calMonth === i ? 600 : 400,
                background: "transparent",
                color: calMonth === i ? theme.text.primary : theme.text.muted,
                border: "none",
                borderBottom: calMonth === i ? `2px solid ${theme.blue}` : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >
              {m.label} 2026
            </button>
          ))}
        </div>
        <div style={{ fontSize: theme.size.xl, fontWeight: 600 }}>
          <span style={{ color: theme.text.muted, fontWeight: 400, fontSize: theme.size.md, marginRight: theme.space[2] }}>Monthly P&L:</span>
          <span style={{ color: monthTotal.total >= 0 ? theme.green : theme.red }}>
            {formatDollarsFull(monthTotal.total)}
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, overflow: "hidden" }}>
        {/* Header row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr) 120px" }}>
          {DAY_NAMES.map((d) => (
            <div key={d} style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, fontSize: theme.size.xs, color: theme.text.muted, textAlign: "center", borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.surface, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {d}
            </div>
          ))}
          <div style={{ padding: `${theme.space[2]}px ${theme.space[3]}px`, fontSize: theme.size.xs, color: theme.text.muted, textAlign: "center", borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.surface, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Total
          </div>
        </div>

        {/* Week rows */}
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
                    padding: `${theme.space[2]}px ${theme.space[3]}px`, minHeight: 72,
                    borderBottom: wi < weeks.length - 1 ? `1px solid ${theme.border.default}` : "none",
                    borderRight: di < 6 ? `1px solid ${theme.bg.surface}` : "none",
                    background: isSelected ? theme.bg.elevated : hasTrades ? getCellBg(data.premium) : (isWeekend && inMonth ? theme.bg.weekend : theme.bg.base),
                    cursor: isClickable ? "pointer" : "default",
                    opacity: inMonth ? 1 : 0.25,
                    transition: "background 0.15s",
                    border: isSelected ? `1px solid ${theme.blue}` : "1px solid transparent",
                    borderBottomColor: wi < weeks.length - 1 ? theme.border.default : "transparent",
                  }}
                  onMouseEnter={(e) => { if (hasTrades && !isSelected) e.currentTarget.style.outline = `1px solid ${theme.border.strong}`; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.outline = "none"; }}
                >
                  <div style={{ fontSize: theme.size.xs, fontWeight: 500, color: inMonth ? theme.text.subtle : theme.border.strong, marginBottom: theme.space[1] }}>
                    {day.getDate()}
                  </div>
                  {hasTrades && (
                    <>
                      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: data.premium >= 0 ? theme.green : theme.red, lineHeight: 1.3 }}>
                        {formatDollarsFull(data.premium)}
                      </div>
                      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>
                        {data.count} trade{data.count !== 1 ? "s" : ""}
                      </div>
                    </>
                  )}
                  {!hasTrades && inMonth && !isWeekend && !hasExpiry && (
                    <div style={{ fontSize: theme.size.sm, color: theme.border.default }}>$0</div>
                  )}
                  {hasExpiry && (() => {
                    const { tickers, totalPremium } = expiryMap[key];
                    const shown = tickers.slice(0, 3);
                    const extra = tickers.length - shown.length;
                    return (
                      <div style={{ marginTop: hasTrades ? theme.space[1] : 0, fontSize: theme.size.xs, color: theme.blue, background: "rgba(88,166,255,0.08)", borderRadius: theme.radius.sm, padding: "2px 4px", lineHeight: 1.5 }}>
                        ⚑ {shown.join(" · ")}{extra > 0 ? ` +${extra}` : ""}{" "}
                        <span style={{ color: theme.text.subtle }}>${totalPremium.toLocaleString()} gross</span>
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
                    padding: `${theme.space[2]}px ${theme.space[3]}px`, minHeight: 72,
                    borderBottom: wi < weeks.length - 1 ? `1px solid ${theme.border.default}` : "none",
                    border: isWeekSelected ? `1px solid ${theme.blue}` : "1px solid transparent",
                    background: isWeekSelected ? theme.bg.elevated : theme.bg.surface,
                    display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                    cursor: isWeekClickable ? "pointer" : "default",
                    borderRadius: isWeekSelected ? theme.radius.sm : 0,
                  }}
                >
                  <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[1] }}>
                    Week {wi + 1}
                  </div>
                  {weeklyTotals[wi].count > 0 ? (
                    <>
                      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: weeklyTotals[wi].total >= 0 ? theme.green : theme.red }}>
                        {formatDollarsFull(weeklyTotals[wi].total)}
                      </div>
                      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>
                        {weeklyTotals[wi].count} trades
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: theme.size.sm, color: theme.border.strong }}>—</div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>

      <CalendarDetailPanel
        selectedDay={selectedDay}
        selectedWeek={selectedWeek}
        displayClosed={displayClosed}
        displayExpiring={displayExpiring}
        hasDisplay={hasDisplay}
        dailyData={dailyData}
        weeklyTotals={weeklyTotals}
        calMonth={calMonth}
        isMobile={isMobile}
        deleteTrade={deleteTrade}
      />
    </div>
  );
}
