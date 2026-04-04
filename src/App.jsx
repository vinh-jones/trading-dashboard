import { useState, useMemo, useEffect, createContext, useContext } from "react";
import tradesData from "./data/trades.json";
import positionsData from "./data/positions.json";
import accountData from "./data/account.json";

// ─── ADAPTER ───────────────────────────────────────────────────────────────
// Converts trades.json field names to the shape the components expect.

function normalizeTrade(t) {
  const fmtDate = (iso) => (iso ? iso.slice(5).replace("-", "/") : "—");
  const closeDate = t.close_date ? new Date(t.close_date + "T12:00:00") : null;
  const keptStr =
    t.kept_pct != null ? `${Math.round(t.kept_pct * 100)}%` : "—";
  return {
    ticker: t.ticker,
    type: t.type,
    subtype: t.subtype,
    strike: t.strike ?? null,
    contracts: t.contracts ?? null,
    open: fmtDate(t.open_date),
    close: fmtDate(t.close_date),
    closeDate,               // Date object — used by calendar
    days: t.days_held ?? null,
    premium: t.premium_collected ?? 0,
    kept: keptStr,
    fronted: t.capital_fronted ?? null,
    description: t.description ?? null,
    source: t.source ?? "",
    notes: t.notes ?? "",
  };
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  CSP:    { bg: "#1a3a5c", text: "#6db3f2", border: "#2a5a8c" },
  CC:     { bg: "#1a4a3a", text: "#6dd9a0", border: "#2a6a5a" },
  LEAPS:  { bg: "#4a2a5c", text: "#c49df2", border: "#6a3a7c" },
  Spread: { bg: "#5c4a1a", text: "#f2d96d", border: "#7c6a2a" },
  Shares: { bg: "#5c1a1a", text: "#f26d6d", border: "#7c2a2a" },
};

const SUBTYPE_LABELS = {
  Close:       "Closed",
  Assigned:    "Assigned",
  "Roll Loss": "Roll Loss",
  "Bear Call": "Bear Call Spread",
  "Bear Debit":"Bear Debit Spread",
  Sold:        "Shares Sold",
  Exit:        "Position Exit",
};

const MONTHS = [
  { label: "Jan", month: 0, year: 2026 },
  { label: "Feb", month: 1, year: 2026 },
  { label: "Mar", month: 2, year: 2026 },
  { label: "Apr", month: 3, year: 2026 },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const VERSION = "1.7.0";

// ─── HELPERS ───────────────────────────────────────────────────────────────

function formatDollars(n) {
  if (n == null) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  const str = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toLocaleString()}`;
  return neg ? `-${str}` : str;
}

function formatDollarsFull(n) {
  if (n == null) return "—";
  const neg = n < 0;
  return `${neg ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}

function calcDTE(expiryISO) {
  if (!expiryISO) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryISO + "T00:00:00");
  return Math.max(0, Math.ceil((expiry - today) / (1000 * 60 * 60 * 24)));
}

function isMarketHours() {
  const et  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 9.5 && time <= 16;
}

function useLiveVix(fallbackVix) {
  const [vix, setVix]       = useState(fallbackVix);
  const [source, setSource] = useState("manual");

  useEffect(() => {
    async function fetchVix() {
      try {
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 5000);
        const r    = await fetch("/api/vix", { signal: controller.signal });
        clearTimeout(timeout);
        const data = await r.json();
        if (data.vix != null) {
          setVix(data.vix);
          setSource("live");
        } else {
          setSource(fallbackVix != null ? "manual" : "null");
        }
      } catch {
        setSource(fallbackVix != null ? "manual" : "null");
      }
    }

    fetchVix();

    const interval = setInterval(() => {
      if (isMarketHours()) fetchVix();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return { vix, source };
}

function getVixBand(vix) {
  if (vix == null) return null;
  if (vix <= 12) return { label: "≤12",   floorPct: 0.40, ceilingPct: 0.50 };
  if (vix <= 15) return { label: "12–15", floorPct: 0.30, ceilingPct: 0.40 };
  if (vix <= 20) return { label: "15–20", floorPct: 0.20, ceilingPct: 0.25 };
  if (vix <= 25) return { label: "20–25", floorPct: 0.10, ceilingPct: 0.15 };
  if (vix <= 30) return { label: "25–30", floorPct: 0.05, ceilingPct: 0.10 };
  return               { label: "≥30",   floorPct: 0.00, ceilingPct: 0.05 };
}

function allocColor(pct) {
  if (pct >= 0.15) return "#f85149";  // red — at hard ceiling
  if (pct >= 0.10) return "#e3b341";  // amber — approaching limit
  return "#8b949e";                    // gray — normal
}

function formatExpiry(expiryISO) {
  if (!expiryISO) return "—";
  return new Date(expiryISO + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getCalendarWeeks(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const weeks = [];
  let current = new Date(firstDay);
  current.setDate(current.getDate() - current.getDay());
  while (current <= lastDay || current.getDay() !== 0) {
    if (weeks.length === 0 || current.getDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push(new Date(current));
    current.setDate(current.getDate() + 1);
    if (current.getDay() === 0 && current > lastDay) break;
  }
  return weeks;
}

// ─── DATA CONTEXT ──────────────────────────────────────────────────────────
// Provides live trades/positions/account to all components.
// Initialized from the static JSON imports; in production the TradeDashboard
// fetches /api/data on mount and replaces the data with fresh sheet values.

const DataContext = createContext(null);
function useData() { return useContext(DataContext); }

// ─── SUMMARY TAB ───────────────────────────────────────────────────────────

function SummaryTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDuration, setSelectedDuration }) {
  const { trades: TRADES_ALL } = useData();
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
    </div>
  );
}

// ─── CALENDAR TAB ───────────────────────────────────────────────────────────

function CalendarTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDay, setSelectedDay }) {
  const { trades: TRADES } = useData();
  const [calMonth, setCalMonth] = useState(3); // default to April

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
  }, [selectedTicker, selectedType]);

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
  }, [selectedTicker]);

  const selectedDayTrades = useMemo(() => {
    if (!selectedDay) return [];
    return dailyData[selectedDay]?.trades || [];
  }, [selectedDay, dailyData]);

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

      {/* Month selector + monthly total */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {MONTHS.map((m, i) => (
            <button
              key={m.label}
              onClick={() => { setCalMonth(i); setSelectedDay(null); }}
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
              const isSelected = selectedDay === key;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={di}
                  onClick={() => { if (hasTrades) setSelectedDay(isSelected ? null : key); }}
                  style={{
                    padding: "10px 12px", minHeight: 80,
                    borderBottom: wi < weeks.length - 1 ? "1px solid #21262d" : "none",
                    borderRight: di < 6 ? "1px solid #161b22" : "none",
                    background: isSelected ? "#1c2333" : hasTrades ? getCellBg(data.premium) : (isWeekend && inMonth ? "#0a0e14" : "#0d1117"),
                    cursor: hasTrades ? "pointer" : "default",
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
                  {!hasTrades && inMonth && !isWeekend && (
                    <div style={{ fontSize: 13, color: "#21262d" }}>$0</div>
                  )}
                </div>
              );
            })}
            {/* Weekly total column */}
            <div style={{
              padding: "10px 12px", minHeight: 80,
              borderBottom: wi < weeks.length - 1 ? "1px solid #21262d" : "none",
              background: "#161b22",
              display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            }}>
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
          </div>
        ))}
      </div>

      {/* Selected day detail */}
      {selectedDay && selectedDayTrades.length > 0 && (
        <div style={{ marginTop: 20, padding: "16px 20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>
              {new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: dailyData[selectedDay].premium >= 0 ? "#3fb950" : "#f85149" }}>
              {formatDollarsFull(dailyData[selectedDay].premium)} · {selectedDayTrades.length} trade{selectedDayTrades.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  {["Ticker", "Type", "", "Strike", "Ct", "Open", "Close", "Days", "Premium", "Kept"].map((h) => (
                    <th key={h} style={{ padding: "8px", textAlign: "left", color: "#8b949e", fontWeight: 500, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedDayTrades.map((t, i) => {
                  const tc = TYPE_COLORS[t.type] || {};
                  const isLoss = t.premium < 0;
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #161b22" }}>
                      <td style={{ padding: "7px 8px", fontWeight: 600, color: "#e6edf3" }}>{t.ticker}</td>
                      <td style={{ padding: "7px 8px" }}>
                        <span style={{ background: tc.bg, color: tc.text, padding: "2px 7px", borderRadius: 3, fontSize: 12, fontWeight: 500 }}>
                          {t.type}
                        </span>
                      </td>
                      <td style={{ padding: "7px 8px", color: "#8b949e", fontSize: 12 }}>{SUBTYPE_LABELS[t.subtype] || t.subtype}</td>
                      <td style={{ padding: "7px 8px", color: "#c9d1d9" }}>{t.strike ? `$${t.strike}` : "—"}</td>
                      <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.contracts || "—"}</td>
                      <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.open}</td>
                      <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.close}</td>
                      <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.days != null ? `${t.days}d` : "—"}</td>
                      <td style={{ padding: "7px 8px", fontWeight: 600, color: isLoss ? "#f85149" : "#3fb950" }}>
                        {formatDollarsFull(t.premium)}
                      </td>
                      <td style={{ padding: "7px 8px", color: "#8b949e" }}>{t.kept}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 60/60 QUICK-CHECK WIDGET ──────────────────────────────────────────────

function SixtyCheck() {
  const [premiumOpen, setPremiumOpen] = useState("");
  const [premiumMark, setPremiumMark] = useState("");
  const [dteOpen, setDteOpen] = useState("");
  const [dteRemaining, setDteRemaining] = useState("");

  const result = useMemo(() => {
    const po = parseFloat(premiumOpen);
    const pm = parseFloat(premiumMark);
    const dO = parseFloat(dteOpen);
    const dR = parseFloat(dteRemaining);
    if (!po || po <= 0 || pm == null || isNaN(pm) || !dO || dO <= 0 || dR == null || isNaN(dR)) return null;

    const profitPct = (po - pm) / po;
    const dtePct    = dR / dO;

    if (dR < 5) {
      return { profitPct, dtePct, status: "near-expiry", label: "Near expiry — evaluate independently", color: "#8b949e" };
    }
    if (profitPct >= 0.60 && dtePct >= 0.60) {
      return { profitPct, dtePct, triggered: true, status: "close", label: "Close now", color: "#3fb950" };
    }
    if (dtePct < 0.60) {
      return { profitPct, dtePct, triggered: false, status: "past-dte", label: "Past 60% DTE threshold — use judgment", color: "#f2d96d" };
    }
    return { profitPct, dtePct, triggered: false, status: "not-yet", label: "Not yet", color: "#8b949e" };
  }, [premiumOpen, premiumMark, dteOpen, dteRemaining]);

  const inputStyle = {
    background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3",
    borderRadius: 4, padding: "8px 10px", fontSize: 14, fontFamily: "inherit",
    width: "100%", outline: "none",
  };
  const labelStyle = { fontSize: 12, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" };

  return (
    <div style={{ padding: "20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d" }}>
      <div style={{ fontSize: 13, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 16, fontWeight: 500 }}>
        60/60 Quick-Check
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Premium at open</label>
          <input style={inputStyle} type="number" placeholder="e.g. 500" value={premiumOpen} onChange={(e) => setPremiumOpen(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Current mark</label>
          <input style={inputStyle} type="number" placeholder="e.g. 180" value={premiumMark} onChange={(e) => setPremiumMark(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>DTE at open</label>
          <input style={inputStyle} type="number" placeholder="e.g. 21" value={dteOpen} onChange={(e) => setDteOpen(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>DTE remaining</label>
          <input style={inputStyle} type="number" placeholder="e.g. 14" value={dteRemaining} onChange={(e) => setDteRemaining(e.target.value)} />
        </div>
      </div>

      {result ? (
        <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "14px 16px", background: "#0d1117", borderRadius: 6, border: `1px solid ${result.color}40` }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: result.color }}>{result.label}</div>
          <div style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Profit captured</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: result.profitPct >= 0.60 ? "#3fb950" : "#e6edf3" }}>
                {(result.profitPct * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>DTE remaining</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: result.dtePct >= 0.60 ? "#3fb950" : "#f85149" }}>
                {(result.dtePct * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>60/60 triggered</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: result.triggered ? "#3fb950" : "#8b949e" }}>
                {result.status === "near-expiry" ? "N/A" : result.triggered ? "YES" : "NO"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "14px 16px", background: "#0d1117", borderRadius: 6, border: "1px solid #21262d", fontSize: 14, color: "#6e7681" }}>
          Enter all four values to evaluate the 60/60 rule.
        </div>
      )}
    </div>
  );
}

// ─── OPEN POSITIONS TAB ────────────────────────────────────────────────────

function OpenPositionsTab() {
  const { positions, account } = useData();
  const { assigned_shares, open_csps, open_leaps } = positions;

  // Collect ALL open LEAPS: standalone ones + those nested inside assigned shares cards
  const allOpenLeaps = [
    ...open_leaps,
    ...assigned_shares.flatMap(pos => pos.open_leaps ?? []),
  ];

  // ── Per-ticker allocation breakdown — drives the chart at the top ──
  const accountValue = account?.account_value || 1;
  const allocMap = {};
  open_csps.forEach(p => {
    if (!allocMap[p.ticker]) allocMap[p.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[p.ticker].csp += (p.capital_fronted || 0);
  });
  assigned_shares.forEach(s => {
    const sharesTotal = s.positions.reduce((sum, lot) => sum + (lot.fronted || 0), 0);
    const leapsTotal  = (s.open_leaps ?? []).reduce((sum, l) => sum + (l.capital_fronted || 0), 0);
    if (!allocMap[s.ticker]) allocMap[s.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[s.ticker].shares += sharesTotal;
    allocMap[s.ticker].leaps  += leapsTotal;
  });
  open_leaps.forEach(l => {
    if (!allocMap[l.ticker]) allocMap[l.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[l.ticker].leaps += (l.capital_fronted || 0);
  });
  const allocRows = Object.entries(allocMap)
    .map(([ticker, { csp, shares, leaps }]) => ({
      ticker,
      cspPct:    csp    / accountValue,
      sharesPct: shares / accountValue,
      leapsPct:  leaps  / accountValue,
      totalPct:  (csp + shares + leaps) / accountValue,
    }))
    .sort((a, b) => b.totalPct - a.totalPct);
  const SCALE = Math.max(allocRows[0]?.totalPct ?? 0.20, 0.20); // scale to largest bar, min 20%

  const sectionHeader = (title) => (
    <div style={{ fontSize: 13, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500, marginBottom: 14 }}>
      {title}
    </div>
  );

  const panel = (children, style = {}) => (
    <div style={{ padding: "20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d", marginBottom: 16, ...style }}>
      {children}
    </div>
  );

  return (
    <div>
      {/* ── Allocation Chart ── */}
      {panel(
        <>
          {sectionHeader("Portfolio Allocation by Ticker")}
          <div>
            {allocRows.map((row) => {
              const sharesW = (row.sharesPct / SCALE) * 100;
              const leapsW  = (row.leapsPct  / SCALE) * 100;
              const cspW    = (row.cspPct    / SCALE) * 100;
              return (
                <div key={row.ticker} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                  <div style={{ width: 52, fontSize: 12, fontWeight: 700, color: "#e6edf3", textAlign: "right", flexShrink: 0 }}>
                    {row.ticker}
                  </div>
                  <div style={{ flex: 1, height: 16, background: "#21262d", borderRadius: 2, position: "relative" }}>
                    {row.sharesPct > 0 && <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${sharesW}%`, background: "#2eb88a", borderRadius: "2px 0 0 2px" }} />}
                    {row.leapsPct  > 0 && <div style={{ position: "absolute", left: `${sharesW}%`, top: 0, height: "100%", width: `${leapsW}%`, background: "#f0c040" }} />}
                    {row.cspPct    > 0 && <div style={{ position: "absolute", left: `${sharesW + leapsW}%`, top: 0, height: "100%", width: `${cspW}%`, background: "#58a6ff", borderRadius: "0 2px 2px 0" }} />}
                    {/* Threshold reference lines */}
                    <div style={{ position: "absolute", left: `${(0.10 / SCALE) * 100}%`, top: -3, bottom: -3, width: 1, background: "#8b949e", opacity: 0.8, zIndex: 2 }} />
                    <div style={{ position: "absolute", left: `${(0.15 / SCALE) * 100}%`, top: -3, bottom: -3, width: 1, background: "#f85149", opacity: 0.8, zIndex: 2 }} />
                  </div>
                  <div style={{ width: 42, fontSize: 12, fontWeight: 600, color: allocColor(row.totalPct), textAlign: "right", flexShrink: 0 }}>
                    {(row.totalPct * 100).toFixed(1)}%
                  </div>
                </div>
              );
            })}
            {/* Legend */}
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingLeft: 62, fontSize: 11, color: "#6e7681" }}>
              <span><span style={{ color: "#2eb88a" }}>■</span> Shares</span>
              <span><span style={{ color: "#f0c040" }}>■</span> LEAPS</span>
              <span><span style={{ color: "#58a6ff" }}>■</span> CSP</span>
              <span style={{ marginLeft: 8 }}><span style={{ color: "#8b949e" }}>│</span> 10%</span>
              <span><span style={{ color: "#f85149" }}>│</span> 15%</span>
            </div>
          </div>
        </>
      )}

      {/* ── Open CSPs ── */}
      {panel(
        <>
          {sectionHeader(`Open Cash-Secured Puts (${open_csps.length})`)}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  {["Ticker", "Strike", "Expiry", "DTE", "% DTE Left", "Premium", "Capital", "ROI"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#8b949e", fontWeight: 500, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open_csps.map((csp, i) => {
                  const dte = calcDTE(csp.expiry_date);
                  const roi = csp.capital_fronted ? ((csp.premium_collected / csp.capital_fronted) * 100).toFixed(2) : null;

                  // % DTE remaining = (expiry - today) / (expiry - open_date)
                  let dtePct = null;
                  if (csp.open_date && csp.expiry_date && dte != null) {
                    const totalDays = Math.ceil(
                      (new Date(csp.expiry_date + "T00:00:00") - new Date(csp.open_date + "T00:00:00")) / 86400000
                    );
                    dtePct = totalDays > 0 ? (dte / totalDays) * 100 : 0;
                  }
                  // Green ≥ 60% (plenty of time), yellow 20–59% (watch it), red < 20% (near expiry)
                  const dtePctColor = dtePct == null ? "#8b949e"
                    : dtePct >= 60 ? "#3fb950"
                    : dtePct >= 20 ? "#f2d96d"
                    : "#f85149";

                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #21262d" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#1a3a5c22")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: "#e6edf3" }}>{csp.ticker}</td>
                      <td style={{ padding: "9px 10px", color: "#e6edf3" }}>${csp.strike}</td>
                      <td style={{ padding: "9px 10px", color: "#8b949e" }}>{formatExpiry(csp.expiry_date)}</td>
                      <td style={{ padding: "9px 10px", color: dte != null && dte <= 5 ? "#f85149" : "#8b949e", fontWeight: dte != null && dte <= 5 ? 600 : 400 }}>
                        {dte != null ? `${dte}d` : "—"}
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: 600, color: dtePctColor }}>
                        {dtePct != null ? `${dtePct.toFixed(0)}%` : "—"}
                      </td>
                      <td style={{ padding: "9px 10px", color: "#3fb950", fontWeight: 600 }}>{formatDollarsFull(csp.premium_collected)}</td>
                      <td style={{ padding: "9px 10px", color: "#8b949e" }}>{formatDollarsFull(csp.capital_fronted)}</td>
                      <td style={{ padding: "9px 10px", color: "#58a6ff", fontWeight: 500 }}>{roi ? `${roi}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Assigned Shares ── */}
      {panel(
        <>
          {sectionHeader(`Assigned Shares (${assigned_shares.length} tickers)`)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {assigned_shares.map((pos) => {
              const cc  = pos.active_cc;
              const dte = cc ? calcDTE(cc.expiry_date) : null;

              return (
                <div key={pos.ticker} style={{ background: "#0d1117", borderRadius: 6, border: "1px solid #21262d", padding: "16px" }}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#e6edf3" }}>{pos.ticker}</span>
                    <span style={{ fontSize: 13, color: "#8b949e" }}>
                      Cost basis: <span style={{ color: "#e6edf3", fontWeight: 600 }}>{formatDollarsFull(pos.cost_basis_total)}</span>
                    </span>
                  </div>

                  {/* Lots */}
                  <div style={{ marginBottom: 10 }}>
                    {pos.positions.map((p, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#6e7681", marginBottom: 2 }}>
                        {p.description} — {formatDollarsFull(p.fronted)}
                      </div>
                    ))}
                  </div>

                  {/* Active CC */}
                  {cc ? (
                    <div style={{ padding: "10px 12px", background: "#1a4a3a", border: "1px solid #2a6a5a", borderRadius: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: "#6dd9a0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Active CC</span>
                        <span style={{ fontSize: 12, color: dte != null && dte <= 3 ? "#f85149" : "#8b949e" }}>
                          {dte != null ? `${dte}d DTE` : "—"} · exp {formatExpiry(cc.expiry_date)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 16 }}>
                        <div>
                          <span style={{ fontSize: 11, color: "#6e7681" }}>Strike </span>
                          <span style={{ fontSize: 14, color: "#e6edf3", fontWeight: 600 }}>${cc.strike}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: 11, color: "#6e7681" }}>Contracts </span>
                          <span style={{ fontSize: 14, color: "#e6edf3", fontWeight: 600 }}>{cc.contracts}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: 11, color: "#6e7681" }}>Premium </span>
                          <span style={{ fontSize: 14, color: "#3fb950", fontWeight: 600 }}>{formatDollarsFull(cc.premium_collected)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "8px 12px", background: "#3a1a1a", border: "1px solid #7c2a2a", borderRadius: 5, fontSize: 13, color: "#f85149", fontWeight: 500 }}>
                      NO ACTIVE CC
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Open LEAPS ── */}
      {panel(
        <>
          {sectionHeader(`Open LEAPS (${allOpenLeaps.length})`)}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allOpenLeaps.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#2a1a3a", border: "1px solid #4a2a5c", borderRadius: 6 }}>
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#e6edf3", marginRight: 12 }}>{l.ticker}</span>
                  <span style={{ fontSize: 13, color: "#f0c040" }}>{l.description}</span>
                </div>
                <div style={{ fontSize: 14, color: "#8b949e" }}>
                  Capital: <span style={{ color: "#e6edf3", fontWeight: 600 }}>{formatDollarsFull(l.capital_fronted)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 60/60 Quick-Check ── */}
      <SixtyCheck />
    </div>
  );
}

// ─── SYNC BUTTON ───────────────────────────────────────────────────────────

function SyncButton() {
  const { refreshData } = useData();
  const [status, setStatus] = useState("idle"); // "idle" | "syncing" | "done" | "error"
  const [detail, setDetail] = useState("");
  const isProd = import.meta.env.PROD;

  async function handleSync() {
    if (status === "syncing") return;
    setStatus("syncing");
    setDetail("");
    try {
      if (isProd) {
        // Production: fetch live data from the Vercel serverless function
        const res  = await fetch("/api/data");
        const data = await res.json();
        if (data.ok) {
          refreshData(data);
          setStatus("done");
          setDetail(`${data.trades?.length ?? 0} trades · ${data.positions?.open_csps?.length ?? 0} open CSPs`);
          setTimeout(() => setStatus("idle"), 4000);
        } else {
          throw new Error(data.error ?? "Unknown error");
        }
      } else {
        // Dev: POST to /api/sync which writes JSON files and triggers HMR
        const res  = await fetch("/api/sync", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          setStatus("done");
          // Extract the one-line summary (last non-empty line of sync output)
          const lines = data.output.split("\n").map(l => l.trim()).filter(Boolean);
          setDetail(lines[lines.length - 1] ?? "");
          // Page will hot-reload automatically as JSON files update.
          // Reset button state after 4 s (in case HMR is slow).
          setTimeout(() => setStatus("idle"), 4000);
        } else {
          throw new Error(data.error?.slice(0, 120) ?? "Unknown error");
        }
      }
    } catch (err) {
      setStatus("error");
      setDetail(err.message);
      setTimeout(() => setStatus("idle"), 6000);
    }
  }

  const label  = { idle: "⟳ Sync Sheet", syncing: "Syncing…", done: "✓ Synced", error: "✗ Error" }[status];
  const color  = { idle: "#8b949e", syncing: "#58a6ff", done: "#3fb950", error: "#f85149" }[status];
  const spin   = status === "syncing";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        onClick={handleSync}
        disabled={spin}
        style={{
          background: "transparent",
          border: `1px solid ${color}`,
          color,
          borderRadius: 5,
          padding: "6px 14px",
          fontSize: 13,
          fontFamily: "inherit",
          fontWeight: 500,
          cursor: spin ? "default" : "pointer",
          letterSpacing: "0.3px",
          transition: "all 0.2s",
          animation: spin ? "pulse 1.2s ease-in-out infinite" : "none",
        }}
      >
        {label}
      </button>
      {detail && (
        <div style={{ fontSize: 11, color: status === "error" ? "#f85149" : "#6e7681", maxWidth: 260, textAlign: "right" }}>
          {detail}
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  );
}

// ─── ACCOUNT SUMMARY BAR ───────────────────────────────────────────────────

function AccountBar() {
  const { account: accountData } = useData();
  const mtd      = accountData.month_to_date_premium;
  const baseline = accountData.monthly_targets?.baseline ?? 15000;
  const stretch  = accountData.monthly_targets?.stretch  ?? 25000;
  const progress = Math.min((mtd / baseline) * 100, 100);

  // Free cash comes directly from the Allocations sheet (cell I7) via sync/api
  const freeCashEst    = accountData.free_cash_est    ?? null;
  const freeCashPctEst = accountData.free_cash_pct_est ?? null;

  // Live VIX — fetches /api/vix on mount, falls back to account.vix_current
  const { vix: liveVix, source: vixSource } = useLiveVix(accountData.vix_current);
  const band   = getVixBand(liveVix);
  const status = !band || freeCashPctEst == null ? "unknown"
    : freeCashPctEst < band.floorPct   ? "over"
    : freeCashPctEst > band.ceilingPct ? "under"
    : "ok";
  const deltaAmt = accountData.account_value != null && band ? (() => {
    if (status === "over")  return (band.floorPct   - freeCashPctEst) * accountData.account_value;
    if (status === "under") return (freeCashPctEst  - band.ceilingPct) * accountData.account_value;
    return null;
  })() : null;
  const statusColor = { ok: "#3fb950", over: "#f85149", under: "#e3b341", unknown: "#6e7681" }[status];

  return (
    <div style={{ display: "flex", gap: 24, padding: "12px 20px", background: "#161b22", border: "1px solid #21262d", borderRadius: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Account</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>{formatDollarsFull(accountData.account_value)}</div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Free Cash</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>
          {freeCashEst != null
            ? <>{formatDollarsFull(freeCashEst)}{" "}<span style={{ fontSize: 12, color: "#8b949e" }}>({(freeCashPctEst * 100).toFixed(1)}%)</span></>
            : <span style={{ fontSize: 13, color: "#6e7681" }}>—</span>
          }
        </div>
        {band && (
          <div style={{ fontSize: 11, color: "#6e7681", marginTop: 1 }}>
            Target {(band.floorPct * 100).toFixed(0)}–{(band.ceilingPct * 100).toFixed(0)}%
          </div>
        )}
        {status !== "unknown" && (
          <div style={{ fontSize: 11, fontWeight: 500, color: statusColor, marginTop: 1 }}>
            {status === "ok"    && "✓ Within band"}
            {status === "over"  && `⚠ ${((band.floorPct - freeCashPctEst) * 100).toFixed(1)}% below floor · ~${formatDollars(deltaAmt)} to free up`}
            {status === "under" && `↓ ${((freeCashPctEst - band.ceilingPct) * 100).toFixed(1)}% above ceiling · ~${formatDollars(deltaAmt)} to deploy`}
          </div>
        )}
        {status === "unknown" && (
          <div style={{ fontSize: 11, color: "#4e5a65", marginTop: 1 }}>Set VIX in account.json</div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>MTD Premium</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: mtd >= baseline ? "#3fb950" : "#e6edf3" }}>{formatDollarsFull(mtd)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
          <span>Monthly target</span>
          <span>{formatDollars(baseline)} baseline · {formatDollars(stretch)} stretch</span>
        </div>
        <div style={{ height: 6, background: "#21262d", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: progress >= 100 ? "#3fb950" : "#1f6feb", borderRadius: 3, transition: "width 0.3s" }} />
        </div>
      </div>
      {liveVix != null && (
        <div>
          <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>VIX</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>{liveVix.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: vixSource === "live" ? "#3fb950" : "#4e5a65", marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
            {vixSource === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3fb950", display: "inline-block" }} />}
            {vixSource === "live" ? "live" : vixSource === "manual" ? "manual" : "closed"}
          </div>
        </div>
      )}
      <SyncButton />
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────

export default function TradeDashboard() {
  // ── Data state — initialized from static JSON imports ──
  // In production, a useEffect below replaces this with live data from /api/data.
  const [trades,    setTrades]    = useState(() => tradesData.trades.map(normalizeTrade));
  const [positions, setPositions] = useState(() => positionsData);
  const [account,   setAccount]   = useState(() => accountData);

  // refreshData is called by SyncButton in production after fetching /api/data
  function refreshData(data) {
    if (data.trades)    setTrades(data.trades.map(normalizeTrade));
    if (data.positions) setPositions(data.positions);
    if (data.account)   setAccount(prev => ({ ...prev, ...data.account })); // preserve manual fields
  }

  // In production, fetch fresh data from Google Sheets on every page load
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    fetch("/api/data")
      .then(r => r.json())
      .then(data => { if (data.ok) refreshData(data); })
      .catch(err => console.warn("[TradeDashboard] /api/data fetch failed:", err.message));
  }, []);

  const [activeTab, setActiveTab] = useState("positions");
  const [selectedTicker, setSelectedTicker]     = useState(null);
  const [selectedType, setSelectedType]         = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [selectedDay, setSelectedDay]           = useState(null);

  const tabStyle = (tab) => ({
    padding: "10px 24px", fontSize: 15, fontFamily: "inherit",
    cursor: "pointer", fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? "#e6edf3" : "#8b949e",
    background: "transparent", border: "none",
    borderBottom: activeTab === tab ? "2px solid #58a6ff" : "2px solid transparent",
    transition: "all 0.15s", letterSpacing: "0.3px",
  });

  return (
    <DataContext.Provider value={{ trades, positions, account, refreshData }}>
    <div style={{ fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace", background: "#0d1117", color: "#c9d1d9", minHeight: "100vh", padding: "20px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#e6edf3", marginBottom: 4, letterSpacing: "0.5px" }}>
          TRADE DASHBOARD
        </h1>
        <div style={{ fontSize: 13, color: "#6e7681", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span>as of {account.last_updated}</span>
          <span style={{ fontSize: 11, color: "#30363d" }}>v{VERSION}</span>
        </div>

        <AccountBar />

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #21262d", marginBottom: 20 }}>
          <button style={tabStyle("positions")} onClick={() => setActiveTab("positions")}>
            Open Positions
          </button>
          <button style={tabStyle("summary")} onClick={() => setActiveTab("summary")}>
            Q1 Summary
          </button>
          <button style={tabStyle("calendar")} onClick={() => setActiveTab("calendar")}>
            Monthly Calendar
          </button>
        </div>

        {/* Active filter chips — shown on Summary and Calendar */}
        {activeTab !== "positions" && (selectedTicker || selectedType) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 14, color: "#8b949e", padding: "8px 12px", background: "#161b22", borderRadius: 6, border: "1px solid #21262d" }}>
            <span style={{ color: "#6e7681" }}>Filters:</span>
            {selectedTicker && (
              <span style={{ background: "#1c2333", border: "1px solid #30363d", padding: "3px 10px", borderRadius: 4, color: "#58a6ff", fontWeight: 500 }}>
                {selectedTicker}
                <span onClick={() => setSelectedTicker(null)} style={{ marginLeft: 6, cursor: "pointer", color: "#6e7681" }}>×</span>
              </span>
            )}
            {selectedType && (
              <span style={{ background: TYPE_COLORS[selectedType]?.bg || "#1c2333", border: `1px solid ${TYPE_COLORS[selectedType]?.border || "#30363d"}`, padding: "3px 10px", borderRadius: 4, color: TYPE_COLORS[selectedType]?.text || "#e6edf3", fontWeight: 500 }}>
                {selectedType}
                <span onClick={() => setSelectedType(null)} style={{ marginLeft: 6, cursor: "pointer", color: "#6e7681" }}>×</span>
              </span>
            )}
            {selectedDuration != null && activeTab === "summary" && (
              <span style={{ background: "#1c2333", border: "1px solid #30363d", padding: "3px 10px", borderRadius: 4, color: "#58a6ff", fontWeight: 500 }}>
                {["0-1d", "2-3d", "4-7d", "8-14d", "15-30d", "30d+"][selectedDuration]}
                <span onClick={() => setSelectedDuration(null)} style={{ marginLeft: 6, cursor: "pointer", color: "#6e7681" }}>×</span>
              </span>
            )}
            <button
              onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); setSelectedDay(null); }}
              style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13, fontFamily: "inherit", marginLeft: "auto", textDecoration: "underline" }}
            >
              Clear all
            </button>
          </div>
        )}

        {activeTab === "summary" && (
          <SummaryTab
            selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
            selectedType={selectedType}     setSelectedType={setSelectedType}
            selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
          />
        )}
        {activeTab === "calendar" && (
          <CalendarTab
            selectedTicker={selectedTicker} setSelectedTicker={setSelectedTicker}
            selectedType={selectedType}     setSelectedType={setSelectedType}
            selectedDay={selectedDay}       setSelectedDay={setSelectedDay}
          />
        )}
        {activeTab === "positions" && <OpenPositionsTab />}
      </div>
    </div>
    </DataContext.Provider>
  );
}
