import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS } from "../lib/constants";
import { theme } from "../lib/theme";
import { computePortfolioBaseline, computeFamiliarity } from "../lib/earningsEngine";

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

  // Q5 — hover state for interactive elements
  const [hoveredType, setHoveredType] = useState(null);
  const [hoveredTicker, setHoveredTicker] = useState(null);
  const [hoveredDuration, setHoveredDuration] = useState(null);
  const [hoveredClear, setHoveredClear] = useState(false);

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

  // Ticker history — uses full lifetime trades (not YTD-filtered) for honest baseline
  const portfolioBaseline = useMemo(() => computePortfolioBaseline(TRADES_ALL), [TRADES_ALL]);
  const familiarity = useMemo(
    () => computeFamiliarity(selectedTicker, TRADES_ALL, portfolioBaseline),
    [selectedTicker, TRADES_ALL, portfolioBaseline]
  );

  return (
    <div>
      {/* Q4/Q2: <p> → <div>, marginBottom 20 → theme.space[5] */}
      <div style={{ fontSize: theme.size.lg, color: theme.text.muted, marginBottom: theme.space[5] }}>
        {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)} net realized
      </div>

      {/* Type filter pills — Q2: gap 8→space[2], marginBottom 16→space[4] */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap" }}>
        {/* Q2/Q5: padding "6px 14px" → tokens, add hover */}
        <button
          onClick={() => setSelectedType(null)}
          onMouseEnter={() => setHoveredType("__ALL__")}
          onMouseLeave={() => setHoveredType(null)}
          style={{
            padding: `${theme.space[1]}px ${theme.space[3]}px`,
            borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
            cursor: "pointer", border: "none",
            background: !selectedType
              ? theme.bg.elevated
              : hoveredType === "__ALL__" ? "rgba(58,130,246,0.06)" : "transparent",
            color: !selectedType ? theme.text.primary : theme.text.muted,
            transition: "background 0.15s",
          }}
        >
          ALL ({TRADES.length})
        </button>
        {/* Q2/Q5: padding "6px 14px" → tokens, add hover */}
        {typeSummary.map((ts) => (
          <button
            key={ts.type}
            onClick={() => setSelectedType(selectedType === ts.type ? null : ts.type)}
            onMouseEnter={() => setHoveredType(ts.type)}
            onMouseLeave={() => setHoveredType(null)}
            style={{
              padding: `${theme.space[1]}px ${theme.space[3]}px`,
              borderRadius: theme.radius.pill, fontSize: theme.size.md, fontFamily: "inherit",
              cursor: "pointer",
              border: `1px solid ${TYPE_COLORS[ts.type]?.border || theme.border.strong}`,
              background: selectedType === ts.type
                ? TYPE_COLORS[ts.type]?.bg || theme.border.strong
                : hoveredType === ts.type ? "rgba(58,130,246,0.06)" : "transparent",
              color: TYPE_COLORS[ts.type]?.text || theme.text.secondary,
              transition: "background 0.15s",
            }}
          >
            {ts.type} ({ts.count}) · {formatDollars(ts.premium)}
          </button>
        ))}
      </div>

      {/* Ticker bar chart — Q2: gap 8→space[2], marginBottom 20→space[5] */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: theme.space[2], marginBottom: theme.space[5] }}>
        {tickerSummary.map((ts) => {
          const isSelected = selectedTicker === ts.ticker;
          const isNeg = ts.premium < 0;
          const isHovered = hoveredTicker === ts.ticker;
          return (
            <button
              key={ts.ticker}
              onClick={() => setSelectedTicker(isSelected ? null : ts.ticker)}
              onMouseEnter={() => setHoveredTicker(ts.ticker)}
              onMouseLeave={() => setHoveredTicker(null)}
              style={{
                /* Q4: radius.sm → radius.md; Q5: unselected hover tint */
                background: isSelected ? theme.bg.elevated : isHovered ? "rgba(58,130,246,0.06)" : theme.bg.surface,
                border: isSelected ? `1px solid ${theme.blue}` : `1px solid ${theme.border.default}`,
                borderRadius: theme.radius.md,
                /* Q2: padding "14px 12px 12px" → space[4]/space[3]/space[3] */
                padding: `${theme.space[4]}px ${theme.space[3]}px ${theme.space[3]}px`,
                cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center",
                /* Q2: gap 8 → space[2] */
                gap: theme.space[2],
                transition: "all 0.15s",
              }}
            >
              {/* Q2: marginBottom 2 → space[1] */}
              <div style={{ fontSize: theme.size.md, fontWeight: 600, color: isSelected ? theme.blue : theme.text.primary, fontFamily: "inherit", marginBottom: theme.space[1] }}>
                {ts.ticker}
              </div>
              {(() => {
                const source = selectedType
                  ? TRADES.filter((t) => t.type === selectedType && t.ticker === ts.ticker)
                  : TRADES.filter((t) => t.ticker === ts.ticker);
                const monthData = MONTHS.map(({ month, label }) => {
                  const mTrades = source.filter(
                    (t) => t.closeDate && t.closeDate.getFullYear() === 2026 && t.closeDate.getMonth() === month
                  );
                  return { label, premium: mTrades.reduce((s, t) => s + t.premium, 0), count: mTrades.length };
                });
                const maxP = Math.max(...monthData.map((d) => Math.abs(d.premium)), 1);
                return (
                  /* Q2: gap 4 → space[1] */
                  <div style={{ width: "100%", display: "flex", gap: theme.space[1], justifyContent: "center", height: 76, alignItems: "flex-end" }}>
                    {monthData.map((md, mi) => {
                      const h = Math.max(3, (Math.abs(md.premium) / maxP) * 44);
                      const neg = md.premium < 0;
                      return (
                        /* Q2: gap 3 → space[1] */
                        <div key={mi} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: theme.space[1], justifyContent: "flex-end" }}>
                          <div style={{ fontSize: theme.size.xs, color: md.count === 0 ? theme.border.strong : neg ? theme.red : theme.green }}>
                            {md.count > 0 ? formatDollars(md.premium) : ""}
                          </div>
                          <div style={{
                            width: "70%", height: md.count > 0 ? h : 2,
                            background: md.count === 0 ? theme.border.default : neg
                              ? theme.gradient.loss
                              : theme.gradient.gain,
                            borderRadius: 2, transition: "height 0.3s",
                          }} />
                          {/* Q2: marginTop 1 → removed */}
                          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>{md.label}</div>
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

      {/* Ticker history panel — shown when a ticker card is selected */}
      {selectedTicker && familiarity && familiarity.lifetimeCsps > 0 && (
        <div style={{
          marginBottom: theme.space[5],
          padding: `${theme.space[4]}px ${theme.space[5]}px`,
          background: theme.bg.surface,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md,
        }}>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: theme.space[3] }}>
            {selectedTicker} · Lifetime CSP History
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[3], marginBottom: theme.space[3] }}>
            {[
              { label: "Lifetime CSPs",   value: familiarity.lifetimeCsps },
              { label: "Assignments",     value: familiarity.assignments,
                sub: `${((familiarity.assignments / familiarity.lifetimeCsps) * 100).toFixed(0)}% rate` },
              { label: "Win Rate",        value: familiarity.winRate != null ? `${(familiarity.winRate * 100).toFixed(0)}%` : "—" },
              { label: "Avg ROI / Trade", value: familiarity.avgRoi != null ? `${familiarity.avgRoi.toFixed(2)}%` : "—" },
              { label: "vs Portfolio",
                value: familiarity.relativeRoi != null
                  ? `${familiarity.relativeRoi >= 0 ? "+" : ""}${familiarity.relativeRoi.toFixed(2)} pp`
                  : "—",
                color: familiarity.relativeRoi == null ? theme.text.muted
                  : familiarity.relativeRoi >= 0 ? theme.green : theme.red,
                sub: portfolioBaseline?.count
                  ? `vs ${portfolioBaseline.avgRoi?.toFixed(2)}% avg`
                  : null,
              },
            ].map(({ label, value, sub, color }) => (
              <div key={label}>
                <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: theme.size.md, color: color || theme.text.primary, fontFamily: theme.font.mono }}>{value}</div>
                {sub && <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 2 }}>{sub}</div>}
              </div>
            ))}
          </div>
          {(familiarity.lastTrade || familiarity.best) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: theme.space[3] }}>
              {[
                familiarity.lastTrade && { label: "Last trade", trade: familiarity.lastTrade, color: theme.text.primary },
                familiarity.best      && { label: "Best",       trade: familiarity.best,      color: theme.green },
                familiarity.worst     && { label: "Worst",      trade: familiarity.worst,     color: theme.red },
              ].filter(Boolean).map(({ label, trade, color }) => (
                <div key={label}>
                  <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: theme.size.sm, color, fontFamily: theme.font.mono }}>
                    {trade.close} · {trade.premium < 0 ? "" : "+"}{formatDollarsFull(trade.premium)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          /* Q2: marginBottom 20→space[5], padding "16px 20px"→tokens; Q4: radius.sm→radius.md */
          <div style={{ marginBottom: theme.space[5], padding: `${theme.space[4]}px ${theme.space[5]}px`, background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
            {/* Q2: marginBottom 14 → space[3] */}
            <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[3], fontWeight: 500 }}>
              Hold duration distribution
            </div>
            {/* Q2: gap 8 → space[2] */}
            <div style={{ display: "flex", gap: theme.space[2], alignItems: "flex-end", height: 80 }}>
              {bucketData.map((b) => {
                const barH = maxCount > 0 ? Math.max(3, (b.count / maxCount) * 60) : 3;
                const isSelected = selectedDuration === b.idx;
                const isHovered = hoveredDuration === b.idx;
                return (
                  <div
                    key={b.idx}
                    onClick={() => setSelectedDuration(selectedDuration === b.idx ? null : b.idx)}
                    onMouseEnter={() => setHoveredDuration(b.idx)}
                    onMouseLeave={() => setHoveredDuration(null)}
                    /* Q2: gap 5 → space[1]; Q5: hover opacity/color */
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: theme.space[1], cursor: "pointer", transition: "opacity 0.15s", opacity: selectedDuration != null && !isSelected ? 0.4 : isHovered && !isSelected ? 0.85 : 1 }}
                  >
                    <div style={{ fontSize: theme.size.md, color: isSelected ? theme.blue : theme.text.muted }}>{b.count}</div>
                    <div style={{
                      width: "60%", height: barH,
                      background: b.count > 0 ? (isSelected || isHovered ? theme.blue : theme.blueBold) : theme.border.default,
                      borderRadius: 2, transition: "height 0.3s",
                      border: isSelected ? `1px solid ${theme.blue}` : "1px solid transparent",
                    }} />
                    <div style={{ fontSize: theme.size.md, color: isSelected ? theme.blue : theme.text.subtle, fontWeight: isSelected ? 600 : 400 }}>{b.label}</div>
                  </div>
                );
              })}
            </div>
            {/* Q2: marginTop 6 → space[1], gap 8 → space[2] */}
            <div style={{ display: "flex", gap: theme.space[2], marginTop: theme.space[1] }}>
              {bucketData.map((b) => (
                <div key={b.idx} style={{ flex: 1, textAlign: "center", fontSize: theme.size.md, color: b.premium >= 0 ? theme.green : theme.red, opacity: selectedDuration != null && selectedDuration !== b.idx ? 0.4 : 1 }}>
                  {b.count > 0 ? formatDollars(b.premium) : ""}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Active filter indicator — Q2: gap 8→space[2], marginBottom 12→space[3] */}
      {(selectedTicker || selectedType || selectedDuration != null) && (
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[3], fontSize: theme.size.lg, color: theme.text.muted }}>
          Showing: {selectedTicker || "All tickers"} · {selectedType || "All types"}
          {selectedDuration != null ? ` · ${DURATION_BUCKETS[selectedDuration].label}` : ""} · {filteredTrades.length} trades · {formatDollarsFull(filteredTotal)}
          {/* Q2/Q5: padding "4px 10px" → tokens, add hover */}
          <button
            onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); }}
            onMouseEnter={() => setHoveredClear(true)}
            onMouseLeave={() => setHoveredClear(false)}
            style={{
              background: hoveredClear ? "rgba(58,130,246,0.06)" : theme.border.default,
              border: `1px solid ${theme.border.strong}`,
              color: theme.text.muted, borderRadius: theme.radius.sm,
              padding: `${theme.space[1]}px ${theme.space[2]}px`,
              cursor: "pointer", fontSize: theme.size.md, fontFamily: "inherit",
              transition: "background 0.15s",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Trade table */}
      {isMobile ? (
        /* Q2: gap 8 → space[2] */
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[2] }}>
          {filteredTrades.map((t, i) => {
            const tc = TYPE_COLORS[t.type] || {};
            const isLoss = t.premium < 0;
            return (
              /* Q2: padding "10px 12px" → tokens; Q4: radius.sm → radius.md */
              <div key={i} style={{ background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
                {/* Q2: marginBottom 6 → space[1] */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[1] }}>
                  {/* Q2: gap 8 → space[2] */}
                  <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
                    <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{t.ticker}</span>
                    {/* Q2: padding "2px 6px" → tokens */}
                    <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[1]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>{t.type}</span>
                    <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</span>
                  </div>
                  <span style={{ fontWeight: 600, color: isLoss ? theme.red : theme.green, fontSize: theme.size.md }}>{formatDollarsFull(t.premium)}</span>
                </div>
                {/* Q2: gap 12 → space[3] */}
                <div style={{ display: "flex", gap: theme.space[3], fontSize: theme.size.sm, color: theme.text.muted, flexWrap: "wrap" }}>
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
                {/* Q2: padding "10px 8px" → tokens */}
                {["Ticker", "Type", "", "Strike", "Ct", "Open", "Close", "Days", "Premium", "Kept", "Fronted"].map((h) => (
                  <th key={h} style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, textAlign: "left", color: theme.text.muted, fontWeight: 500, fontSize: theme.size.md, textTransform: "uppercase", letterSpacing: "0.5px" }}>
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
                    {/* Q2: padding "8px" → space[2] token */}
                    <td style={{ padding: theme.space[2], fontWeight: 600, color: theme.text.primary }}>{t.ticker}</td>
                    <td style={{ padding: theme.space[2] }}>
                      {/* Q2: padding "3px 8px" → tokens */}
                      <span style={{ background: tc.bg, color: tc.text, padding: `${theme.space[1]}px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.md, fontWeight: 500 }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted, fontSize: theme.size.md }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</td>
                    <td style={{ padding: theme.space[2], color: theme.text.secondary }}>{t.strike ? `$${t.strike}` : "—"}</td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted }}>{t.contracts || "—"}</td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted }}>{t.open}</td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted }}>{t.close}</td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted }}>{t.days != null ? `${t.days}d` : "—"}</td>
                    <td style={{ padding: theme.space[2], fontWeight: 600, color: isLoss ? theme.red : theme.green }}>
                      {formatDollarsFull(t.premium)}
                    </td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted }}>{t.kept}</td>
                    <td style={{ padding: theme.space[2], color: theme.text.muted }}>{formatDollarsFull(t.fronted)}</td>
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
