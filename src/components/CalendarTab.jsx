import { useState, useMemo, useEffect } from "react";
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
  const [expandedWeek, setExpandedWeek] = useState(null); // mobile: which week row is expanded
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: type filter drawer

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
  const { grossOpenPremium, expectedPipeline: flatExpected, hasPositions: hasPipelinePositions } = calcPipeline(positions, captureRate);

  // Prefer v2 forecast when available; fall back to flat captureRate.
  // expectedPipeline here means "what lands in the current month" — maps to v2's this_month_remaining.
  const fc = account?.forecast ?? null;
  const v2ThisMonth = fc?.this_month_remaining ?? null;
  const v2Forward   = fc?.forward_pipeline_premium ?? null;
  const pipelineIsV2 = v2ThisMonth != null;
  const expectedPipeline = v2ThisMonth ?? flatExpected;
  const mtdCollected      = account?.month_to_date_premium ?? 0;
  const pipelineBaseline  = account?.monthly_targets?.baseline ?? 15000;
  const impliedTotal      = fc?.month_total ?? mtdCollected + expectedPipeline;
  // Legacy convention: gapToBaseline positive when behind target.
  // v2 target_gap is (monthTotal − target), so negate to match.
  const gapToBaseline     = fc?.target_gap != null ? -fc.target_gap : pipelineBaseline - impliedTotal;

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

  // Mobile-only: week-level heatmap (weekly totals are larger than daily, needs its own max)
  const maxAbsWeekPremium = useMemo(() => {
    let max = 0;
    weeklyTotals.forEach(w => { max = Math.max(max, Math.abs(w.total)); });
    return max || 1;
  }, [weeklyTotals]);

  function getWeekBg(premium) {
    // Cap at 40% of full intensity so the month's dominant week doesn't crush the scale
    const intensity = Math.min(Math.abs(premium) / maxAbsWeekPremium, 1) * 0.4;
    if (premium > 0) {
      return `rgb(${Math.round(13 + intensity * 22)}, ${Math.round(17 + intensity * 100)}, ${Math.round(23 + intensity * 30)})`;
    } else {
      return `rgb(${Math.round(13 + intensity * 100)}, ${Math.round(17 + intensity * 5)}, ${Math.round(23 + intensity * 10)})`;
    }
  }

  // Today key (YYYY-MM-DD) for highlighting in mobile week list
  const todayKey = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }, []);

  // Mobile: auto-expand the week containing today when viewing the current month
  useEffect(() => {
    const today = new Date();
    const sameMonth = today.getFullYear() === monthInfo.year && today.getMonth() === monthInfo.month;
    if (sameMonth) {
      const idx = weeks.findIndex(w => w.some(d =>
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      ));
      setExpandedWeek(idx >= 0 ? idx : null);
    } else {
      setExpandedWeek(null);
    }
  }, [calMonth, monthInfo.month, monthInfo.year, weeks]);

  // ── Mobile layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div>
        {/* Compact header: prev/month/next + P&L + filter toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: theme.space[2], marginBottom: theme.space[3] }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <button
              onClick={() => { if (calMonth > 0) { setCalMonth(calMonth - 1); setSelectedDay(null); setSelectedWeek(null); } }}
              disabled={calMonth === 0}
              style={{
                background: "transparent", border: "none",
                color: calMonth === 0 ? theme.text.faint : theme.text.secondary,
                fontSize: theme.size.xl, cursor: calMonth === 0 ? "default" : "pointer",
                padding: `${theme.space[1]}px ${theme.space[1]}px`, fontFamily: "inherit", lineHeight: 1,
              }}
              aria-label="Previous month"
            >‹</button>
            <div style={{ fontSize: theme.size.md, fontWeight: 600, color: theme.text.primary, minWidth: 72, textAlign: "center" }}>
              {monthInfo.label} {monthInfo.year}
            </div>
            <button
              onClick={() => { if (calMonth < MONTHS.length - 1) { setCalMonth(calMonth + 1); setSelectedDay(null); setSelectedWeek(null); } }}
              disabled={calMonth === MONTHS.length - 1}
              style={{
                background: "transparent", border: "none",
                color: calMonth === MONTHS.length - 1 ? theme.text.faint : theme.text.secondary,
                fontSize: theme.size.xl, cursor: calMonth === MONTHS.length - 1 ? "default" : "pointer",
                padding: `${theme.space[1]}px ${theme.space[1]}px`, fontFamily: "inherit", lineHeight: 1,
              }}
              aria-label="Next month"
            >›</button>
          </div>
          <div style={{ fontSize: theme.size.md, fontWeight: 600, color: monthTotal.total >= 0 ? theme.green : theme.red, marginLeft: "auto", marginRight: theme.space[2] }}>
            {formatDollarsFull(monthTotal.total)}
          </div>
          <button
            onClick={() => setFiltersOpen(v => !v)}
            style={{
              padding: `${theme.space[1]}px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm,
              background: (filtersOpen || selectedType) ? theme.bg.elevated : "transparent",
              color: selectedType ? (TYPE_COLORS[selectedType]?.text || theme.text.secondary) : theme.text.muted,
              border: `1px solid ${selectedType ? (TYPE_COLORS[selectedType]?.border || theme.border.strong) : theme.border.strong}`,
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            {selectedType ? selectedType : "Filter"}
          </button>
        </div>

        {/* Expandable filter pill row */}
        {filtersOpen && (
          <div style={{ display: "flex", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[3], padding: theme.space[2], background: theme.bg.surface, borderRadius: theme.radius.sm }}>
            <button
              onClick={() => { setSelectedType(null); setFiltersOpen(false); }}
              onMouseEnter={e => { e.currentTarget.style.background = !selectedType ? theme.bg.elevated : "rgba(58,130,246,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = !selectedType ? theme.bg.elevated : "transparent"; }}
              style={{
                padding: `${theme.space[1]}px ${theme.space[2]}px`, borderRadius: theme.radius.pill, fontSize: theme.size.sm, fontFamily: "inherit",
                cursor: "pointer", border: "none",
                background: !selectedType ? theme.bg.elevated : "transparent",
                color: !selectedType ? theme.text.primary : theme.text.muted,
              }}
            >
              ALL ({TRADES.length})
            </button>
            {typeSummary.map(ts => (
              <button
                key={ts.type}
                onClick={() => { setSelectedType(selectedType === ts.type ? null : ts.type); setFiltersOpen(false); }}
                onMouseEnter={e => { if (selectedType !== ts.type) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                onMouseLeave={e => { if (selectedType !== ts.type) e.currentTarget.style.background = "transparent"; }}
                style={{
                  padding: `${theme.space[1]}px ${theme.space[2]}px`, borderRadius: theme.radius.pill, fontSize: theme.size.sm, fontFamily: "inherit",
                  cursor: "pointer",
                  border: `1px solid ${TYPE_COLORS[ts.type]?.border || theme.border.strong}`,
                  background: selectedType === ts.type ? (TYPE_COLORS[ts.type]?.bg || theme.bg.elevated) : "transparent",
                  color: TYPE_COLORS[ts.type]?.text || theme.text.secondary,
                }}
              >
                {ts.type} ({ts.count})
              </button>
            ))}
          </div>
        )}

        {/* Compact pipeline card — 3 hero numbers only */}
        {hasPipelinePositions && (
          <div style={{
            padding: `${theme.space[3]}px ${theme.space[4]}px`,
            background: theme.bg.surface,
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.border.default}`,
            marginBottom: theme.space[4],
          }}>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500, marginBottom: theme.space[2] }}>
              Premium Pipeline
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: theme.space[2] }}>
              {[
                { label: "Gross open", value: formatDollarsFull(grossOpenPremium) },
                { label: "MTD collected", value: formatDollarsFull(mtdCollected) },
                { label: "Implied total", value: `~${formatDollarsFull(impliedTotal)}` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: theme.size.sm, fontWeight: 600, color: theme.text.primary }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Week list — each row expandable to show its in-month days */}
        <div style={{ border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, overflow: "hidden", marginBottom: theme.space[4] }}>
          {weeks.map((week, wi) => {
            const weekData = weeklyTotals[wi];
            const isExpanded = expandedWeek === wi;
            const hasTint = weekData.count > 0;
            const bg = hasTint ? getWeekBg(weekData.total) : theme.bg.surface;
            // On heatmap-tinted rows, mid-grays wash out — bump label text to secondary for contrast
            const labelColor = hasTint ? theme.text.secondary : theme.text.muted;
            const subLabelColor = hasTint ? theme.text.secondary : theme.text.subtle;
            const inMonthDays = week.filter(d => d.getMonth() === monthInfo.month);
            const rangeLabel = inMonthDays.length > 0
              ? inMonthDays[0].getDate() === inMonthDays[inMonthDays.length - 1].getDate()
                ? `${monthInfo.label} ${inMonthDays[0].getDate()}`
                : `${monthInfo.label} ${inMonthDays[0].getDate()}–${inMonthDays[inMonthDays.length - 1].getDate()}`
              : "—";

            return (
              <div key={wi}>
                {/* Week header row */}
                <div
                  onClick={() => setExpandedWeek(isExpanded ? null : wi)}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; }}
                  style={{
                    display: "flex", alignItems: "center", gap: theme.space[2],
                    padding: `${theme.space[3]}px ${theme.space[3]}px`,
                    background: bg,
                    borderBottom: (wi < weeks.length - 1 || isExpanded) ? `1px solid ${theme.border.default}` : "none",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: theme.size.sm, color: labelColor, fontWeight: 500, minWidth: 52 }}>
                    Week {wi + 1}
                  </div>
                  <div style={{ fontSize: theme.size.sm, color: subLabelColor, flex: 1 }}>
                    {rangeLabel}
                  </div>
                  {hasTint ? (
                    <>
                      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: weekData.total >= 0 ? theme.green : theme.red }}>
                        {formatDollarsFull(weekData.total)}
                      </div>
                      <div style={{ fontSize: theme.size.xs, color: subLabelColor, minWidth: 32, textAlign: "right" }}>
                        {weekData.count} tr
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: theme.size.sm, color: theme.text.faint, minWidth: 40, textAlign: "right" }}>—</div>
                  )}
                  <div style={{ fontSize: theme.size.sm, color: subLabelColor, marginLeft: theme.space[1], width: 12, textAlign: "center" }}>
                    {isExpanded ? "▴" : "▾"}
                  </div>
                </div>

                {/* Expanded day rows (all 7 days Sun→Sat; out-of-month are dimmed) */}
                {isExpanded && (
                  <div style={{ background: theme.bg.base, borderBottom: wi < weeks.length - 1 ? `1px solid ${theme.border.default}` : "none" }}>
                    {week.map((day, di) => {
                      const inMonth = day.getMonth() === monthInfo.month;
                      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
                      const data = dailyData[key];
                      const hasTrades = inMonth && data && data.count > 0;
                      const hasExpiry = inMonth && !!expiryMap[key];
                      const isClickable = hasTrades || hasExpiry;
                      const isSelected = selectedDay === key;
                      const isToday = inMonth && key === todayKey;
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                      const wk = day.toLocaleDateString("en-US", { weekday: "short" });

                      return (
                        <div
                          key={di}
                          onClick={() => { if (isClickable) { setSelectedDay(isSelected ? null : key); setSelectedWeek(null); } }}
                          onMouseEnter={e => { if (isClickable && !isSelected) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                          onMouseLeave={e => { if (isClickable && !isSelected) e.currentTarget.style.background = inMonth && isWeekend ? theme.bg.weekend : "transparent"; }}
                          style={{
                            display: "flex", alignItems: "center", gap: theme.space[2],
                            padding: `${theme.space[2]}px ${theme.space[3]}px`,
                            borderBottom: di < week.length - 1 ? `1px solid ${theme.border.default}` : "none",
                            background: isSelected ? theme.bg.elevated : (inMonth && isWeekend ? theme.bg.weekend : "transparent"),
                            cursor: isClickable ? "pointer" : "default",
                            borderLeft: isToday ? `3px solid ${theme.blue}` : "3px solid transparent",
                            opacity: inMonth ? 1 : 0.35,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[1], minWidth: 64 }}>
                            <span style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              {wk}
                            </span>
                            <span style={{ fontSize: theme.size.sm, color: isToday ? theme.blue : theme.text.secondary, fontWeight: isToday ? 600 : 400 }}>
                              {day.getDate()}
                            </span>
                          </div>
                          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: theme.space[2] }}>
                            {hasTrades ? (
                              <>
                                <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
                                  {data.count} tr
                                </span>
                                <span style={{ fontSize: theme.size.sm, fontWeight: 600, color: data.premium >= 0 ? theme.green : theme.red, minWidth: 68, textAlign: "right" }}>
                                  {formatDollarsFull(data.premium)}
                                </span>
                              </>
                            ) : (
                              <span style={{ fontSize: theme.size.sm, color: theme.text.faint, minWidth: 68, textAlign: "right" }}>
                                {!inMonth ? "" : isWeekend ? "—" : "$0"}
                              </span>
                            )}
                            <span style={{ width: 14, display: "inline-flex", justifyContent: "center", fontSize: theme.size.sm, color: hasExpiry ? theme.blue : "transparent" }}>
                              {hasExpiry ? "⚑" : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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

  // ── Desktop layout (unchanged) ─────────────────────────────────────────────
  return (
    <div>
      {/* Type filter pills */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap" }}>
        <button
          onClick={() => setSelectedType(null)}
          onMouseEnter={e => { if (selectedType) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
          onMouseLeave={e => { if (selectedType) e.currentTarget.style.background = "transparent"; }}
          style={{
            padding: `${theme.space[1]}px ${theme.space[3]}px`, borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
            cursor: "pointer", border: "none",
            background: !selectedType ? theme.bg.elevated : "transparent",
            color: !selectedType ? theme.text.primary : theme.text.muted,
            transition: "background 0.15s",
          }}
        >
          ALL ({TRADES.length})
        </button>
        {typeSummary.map((ts) => (
          <button
            key={ts.type}
            onClick={() => setSelectedType(selectedType === ts.type ? null : ts.type)}
            onMouseEnter={e => { if (selectedType !== ts.type) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
            onMouseLeave={e => { if (selectedType !== ts.type) e.currentTarget.style.background = "transparent"; }}
            style={{
              padding: `${theme.space[1]}px ${theme.space[3]}px`, borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
              cursor: "pointer",
              border: `1px solid ${TYPE_COLORS[ts.type]?.border || theme.border.strong}`,
              background: selectedType === ts.type ? TYPE_COLORS[ts.type]?.bg || theme.bg.elevated : "transparent",
              color: TYPE_COLORS[ts.type]?.text || theme.text.secondary,
              transition: "background 0.15s",
            }}
          >
            {ts.type} ({ts.count}) · {formatDollars(ts.premium)}
          </button>
        ))}
      </div>

      {/* Pipeline planning panel */}
      <div style={{ padding: `${theme.space[5]}px`, background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}`, marginBottom: theme.space[4] }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
            Premium Pipeline
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[1], fontSize: theme.size.sm, color: theme.text.muted }}>
            {pipelineIsV2 ? (
              <span style={{ color: theme.green, fontSize: theme.size.xs, letterSpacing: "0.05em" }} title="v2 per-position auto-calibrated forecast">
                v2 · auto-calibrated
              </span>
            ) : (
              <>
                Expected capture:
                <select
                  value={captureRate}
                  onChange={e => setCaptureRate(parseFloat(e.target.value))}
                  onFocus={e => { e.currentTarget.style.outline = `2px solid ${theme.blue}`; e.currentTarget.style.outlineOffset = "2px"; }}
                  onBlur={e => { e.currentTarget.style.outline = "none"; }}
                  style={{ background: theme.bg.base, border: `1px solid ${theme.border.strong}`, color: theme.text.primary, borderRadius: theme.radius.sm, padding: `${theme.space[1]}px ${theme.space[1]}px`, fontSize: theme.size.sm, fontFamily: "inherit", cursor: "pointer" }}
                >
                  <option value={0.50}>50%</option>
                  <option value={0.60}>60%</option>
                  <option value={0.70}>70%</option>
                  <option value={0.80}>80%</option>
                </select>
              </>
            )}
          </div>
        </div>
        {hasPipelinePositions ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(5, 1fr)", gap: theme.space[4] }}>
            {[
              { label: "Gross open premium",                value: formatDollarsFull(grossOpenPremium), color: theme.text.primary },
              { label: pipelineIsV2 ? "Expected this month (v2)" : `Expected (${Math.round(captureRate * 100)}%)`, value: `~${formatDollarsFull(expectedPipeline)}`, color: theme.green },
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
          {pipelineIsV2
            ? `Across all open expirations · v2 per-position capture · forward pipeline ~${formatDollarsFull(v2Forward ?? 0)}`
            : `Across all open expirations · assuming ${Math.round(captureRate * 100)}% capture on open positions`}
        </div>
      </div>

      {/* Month selector + monthly total */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[4] }}>
        <div style={{ display: "flex", gap: theme.space[1] }}>
          {MONTHS.map((m, i) => (
            <button
              key={m.label}
              onClick={() => { setCalMonth(i); setSelectedDay(null); setSelectedWeek(null); }}
              onMouseEnter={e => { if (calMonth !== i) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
              onMouseLeave={e => { if (calMonth !== i) e.currentTarget.style.background = "transparent"; }}
              style={{
                padding: `${theme.space[1]}px ${theme.space[4]}px`, fontSize: theme.size.md, fontFamily: "inherit", cursor: "pointer",
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
                  onMouseEnter={(e) => { if (isClickable && !isSelected) e.currentTarget.style.background = "rgba(58,130,246,0.06)"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = hasTrades ? getCellBg(data.premium) : (isWeekend && inMonth ? theme.bg.weekend : theme.bg.base); }}
                >
                  <div style={{ fontSize: theme.size.xs, fontWeight: 500, color: inMonth ? theme.text.subtle : theme.border.strong, marginBottom: theme.space[1] }}>
                    {day.getDate()}
                  </div>
                  {hasTrades && (
                    <>
                      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: data.premium >= 0 ? theme.green : theme.red, lineHeight: 1.3 }}>
                        {formatDollarsFull(data.premium)}
                      </div>
                      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: theme.space[1] }}>
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
                      <div style={{ marginTop: hasTrades ? theme.space[1] : 0, fontSize: theme.size.xs, color: theme.blue, background: "rgba(88,166,255,0.08)", borderRadius: theme.radius.sm, padding: `${theme.space[1]}px ${theme.space[1]}px`, lineHeight: 1.5 }}>
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
                      <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: theme.space[1] }}>
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
