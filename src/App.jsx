import { useState, useMemo, useEffect, createContext, useContext } from "react";
import tradesData from "./data/trades.json";
import positionsData from "./data/positions.json";
import accountData from "./data/account.json";
import { supabase } from "./lib/supabase";

// ─── ADAPTER ───────────────────────────────────────────────────────────────
// Converts trades.json field names to the shape the components expect.

function normalizeTrade(t) {
  const fmtDate = (iso) => (iso ? iso.slice(5).replace("-", "/") : "—");
  const closeDate = t.close_date ? new Date(t.close_date + "T12:00:00") : null;
  const keptStr =
    t.kept_pct != null ? `${Math.round(t.kept_pct * 100)}%` : "—";
  return {
    id: t.id ?? null,
    ticker: t.ticker,
    type: t.type,
    subtype: t.subtype,
    strike: t.strike ?? null,
    contracts: t.contracts ?? null,
    open: fmtDate(t.open_date),
    close: fmtDate(t.close_date),
    expiry: fmtDate(t.expiry_date),  // option expiration date (separate from close)
    closeDate,               // Date object — used by calendar
    days: t.days_held ?? null,
    premium: t.premium_collected ?? 0,
    kept: keptStr,
    fronted: t.capital_fronted ?? null,
    expiry_date: t.expiry_date ?? null,
    open_date:   t.open_date   ?? null,
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

const VERSION = "1.14.0";

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

// Builds the metadata JSONB snapshot stored on every EOD journal entry.
// Pure function — all inputs passed in, no side effects.
function computeEodMetadata({ freeCashPct, vix, pipelineTotal, mtdRealized, activity, cspSnapshot }) {
  const band    = getVixBand(vix);
  const ceiling = band?.ceilingPct ?? null;
  const floor   = band?.floorPct   ?? null;
  const cashFrac = (freeCashPct != null && freeCashPct !== "") ? freeCashPct / 100 : null;
  const floorStatus =
    cashFrac == null || ceiling == null ? null
    : cashFrac > ceiling ? "above"
    : cashFrac < floor   ? "below"
    : "within";
  const floorDelta =
    floorStatus === "above" ? +(cashFrac - ceiling).toFixed(3)
    : floorStatus === "below" ? +(floor - cashFrac).toFixed(3)
    : null;
  return {
    free_cash_pct:   freeCashPct != null && freeCashPct !== "" ? +freeCashPct : null,
    vix:             vix         != null && vix         !== "" ? +vix         : null,
    mtd_realized:    mtdRealized  ?? null,
    pipeline_total:  pipelineTotal != null && pipelineTotal !== "" ? +pipelineTotal : null,
    pipeline_est:    pipelineTotal != null && pipelineTotal !== "" ? Math.round(+pipelineTotal * 0.60) : null,
    floor_band_low:  floor   != null ? Math.round(floor   * 100) : null,
    floor_band_high: ceiling != null ? Math.round(ceiling * 100) : null,
    floor_status:    floorStatus,
    floor_delta:     floorDelta,
    activity:        activity    ?? { closed: [], opened: [] },
    csp_snapshot:    cspSnapshot ?? [],
  };
}

function calcPipeline(positions, captureRate) {
  const openPositions = [
    ...positions.open_csps,
    ...positions.assigned_shares
      .filter(s => s.active_cc)
      .map(s => s.active_cc),
  ];
  const grossOpenPremium = openPositions.reduce((sum, p) => sum + (p.premium_collected || 0), 0);
  const expectedPipeline = Math.round(grossOpenPremium * captureRate);
  return { grossOpenPremium, expectedPipeline, hasPositions: openPositions.length > 0 };
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

function CalendarTab({ selectedTicker, setSelectedTicker, selectedType, setSelectedType, selectedDay, setSelectedDay, captureRate, setCaptureRate }) {
  const { trades: TRADES, positions, account, deleteTrade } = useData();
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

  // Unified display: selected day, or whole month when nothing selected
  const displayClosed   = selectedDay ? (dailyData[selectedDay]?.trades || []) : monthClosedTrades;
  const displayExpiring = selectedDay ? (expiryMap[selectedDay]?.positions || []) : monthExpiringPositions;
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
      <div style={{ padding: "16px 20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d", marginBottom: 16 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
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
                <div style={{ fontSize: 11, color: "#6e7681", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color }}>{value}</div>
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
              const hasExpiry = inMonth && !!expiryMap[key];
              const isClickable = hasTrades || hasExpiry;
              const isSelected = selectedDay === key;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={di}
                  onClick={() => { if (isClickable) setSelectedDay(isSelected ? null : key); }}
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

      {/* Unified detail panel — selected day or whole month default */}
      {hasDisplay && (
        <div style={{ marginTop: 20, padding: "16px 20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>
              {selectedDay
                ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                : `${MONTHS[calMonth].label} 2026 — All Transactions`}
            </div>
            {selectedDay && displayClosed.length > 0 && dailyData[selectedDay] && (
              <div style={{ fontSize: 15, fontWeight: 600, color: dailyData[selectedDay].premium >= 0 ? "#3fb950" : "#f85149" }}>
                {formatDollarsFull(dailyData[selectedDay].premium)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
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
        // Production: POST /api/sync → Google Sheets → Supabase, then re-read
        const syncRes  = await fetch("/api/sync", { method: "POST" });
        const syncData = await syncRes.json();
        if (!syncData.ok) throw new Error(syncData.error ?? "Sync failed");

        // Re-fetch fresh data from Supabase (cache-bust to avoid stale CDN response)
        const dataRes = await fetch(`/api/data?t=${Date.now()}`);
        const data    = await dataRes.json();
        if (data.ok) {
          refreshData(data);
          setStatus("done");
          setDetail(`${syncData.tradesCount} trades · ${syncData.positionsCount} positions synced`);
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

function AccountBar({ captureRate }) {
  const { account: accountData, positions } = useData();
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

  const { grossOpenPremium, expectedPipeline, hasPositions: hasPipeline } = calcPipeline(positions, captureRate);

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
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Pipeline</div>
        {hasPipeline ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>{formatDollarsFull(grossOpenPremium)}</div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 1 }}>
              {formatDollarsFull(expectedPipeline)} est.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 15, color: "#6e7681" }}>—</div>
        )}
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

// ─── JOURNAL TAB ───────────────────────────────────────────────────────────

const JOURNAL_BADGE = {
  trade_note:    { label: "TRADE NOTE",    color: "#58a6ff" },
  eod_update:    { label: "EOD UPDATE",    color: "#3fb950" },
  position_note: { label: "POSITION NOTE", color: "#e3b341" },
};

const MOODS = [
  { emoji: "🟢", label: "Clean",    activeBg: "#1a4a2a", activeBorder: "#3fb950" },
  { emoji: "🟡", label: "Mixed",    activeBg: "#4a3a1a", activeBorder: "#e3b341" },
  { emoji: "🔴", label: "Rough",    activeBg: "#4a1a1a", activeBorder: "#f85149" },
  { emoji: "🌪️", label: "Volatile", activeBg: "#2a1a4a", activeBorder: "#8b5cf6" },
  { emoji: "🎯", label: "Target",   activeBg: "#1a3a5c", activeBorder: "#58a6ff" },
];

// Computed at render time from a normalized trade object (from DataContext).
// Returns null only when called with null (unlinked/unmatched note — show nothing).
function getTradeEmoji(trade) {
  const premium = trade.premium ?? 0;
  const subtype = trade.subtype;
  const keptPct = trade.kept && trade.kept !== "—" ? parseFloat(trade.kept) / 100 : null;
  const days    = trade.days;
  const type    = trade.type;

  if (premium < 0)                                         return "🔴";
  if (subtype === "Assigned")                              return "📌";
  if (subtype === "Expired")                               return "💨";
  if (keptPct != null && keptPct >= 0.80 && days <= 7)    return "⚡";
  if (keptPct != null && keptPct >= 0.80)                  return "🎯";
  if (keptPct != null && keptPct >= 0.60 && days <= 3)    return "⚡";
  if (keptPct != null && keptPct >= 0.60)                  return "✅";
  if (keptPct != null && keptPct >= 0.40)                  return "🟡";
  if (keptPct != null && keptPct < 0.40 && premium > 0)   return "🏃";
  if (type === "Spread")                                   return "🛡️";
  if (type === "LEAPS")                                    return "🔭";
  if (type === "Shares" && premium > 0)                    return "💰";
  if (type === "Shares" && premium < 0)                    return "💸";
  if (type === "Interest")                                 return "💵";
  return "📋";
}

const JOURNAL_ENTRY_TYPES = [
  { key: "trade_note",    label: "Trade Note",    activeColor: "#58a6ff", activeBg: "#0d419d" },
  { key: "eod_update",    label: "EOD Update",    activeColor: "#3fb950", activeBg: "#1a4a2a" },
  { key: "position_note", label: "Position Note", activeColor: "#e3b341", activeBg: "#4a3a1a" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function journalSinceDate(filter) {
  const d = new Date();
  if (filter === "this_month") return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  if (filter === "last_30")    { d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }
  if (filter === "last_90")    { d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
  return null;
}

function fmtEntryDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildAutoTitle(entryType, linkedPosition, linkedTrade) {
  if (entryType === "eod_update") return `EOD — ${todayISO()}`;
  if (linkedPosition) {
    const p = linkedPosition;
    if (p.type === "CSP")   return `CSP $${p.strike} ${formatExpiry(p.expiry_date)} — Open`;
    if (p.type === "CC")    return `CC $${p.strike} ${formatExpiry(p.expiry_date)} — Active`;
    if (p.type === "LEAPS") return `LEAPS — ${p.description || "Open"}`;
    return `Shares — Open`;
  }
  if (linkedTrade) {
    const t = linkedTrade;
    const strike = t.strike ? ` $${t.strike}` : "";
    return `${t.type}${strike} — Closed ${t.close} (${t.kept})`;
  }
  return "";
}

// Helper: floor status label + color for EOD stinger line
function eodFloorLabel(status) {
  if (status === "above") return { text: "↑ ceiling", color: "#e3b341" };
  if (status === "below") return { text: "↓ floor",   color: "#f85149" };
  if (status === "within") return { text: "✓ in band", color: "#3fb950" };
  return null;
}

// Helper: build activity count label for stinger (e.g. "2 closes", "1 open · 1 close")
function eodActivityLabel(activity) {
  if (!activity) return null;
  const c = activity.closed?.length ?? 0;
  const o = activity.opened?.length ?? 0;
  if (c === 0 && o === 0) return null;
  const parts = [];
  if (o > 0) parts.push(`${o} open`);
  if (c > 0) parts.push(`${c} close${c !== 1 ? "s" : ""}`);
  return parts.join(" · ");
}

function JournalEntryCard({ entry, onEdit, onDelete }) {
  const { trades, account } = useData();
  const [expanded, setExpanded] = useState(false);

  // Look up the matching trade for emoji computation.
  // Match on ticker + entry_date (= close_date for backfilled entries) + type + strike parsed from title.
  // Returns null if no match — emoji is suppressed for unlinked/unmatched notes.
  const linkedTrade = useMemo(() => {
    if (entry.entry_type !== "trade_note" || !entry.ticker) return null;
    const typeMatch   = entry.title?.match(/^(\w+)/);
    const strikeMatch = entry.title?.match(/\$(\d+(?:\.\d+)?)/);
    const titleType   = typeMatch?.[1];
    const titleStrike = strikeMatch ? parseFloat(strikeMatch[1]) : null;
    return trades.find(t =>
      t.ticker === entry.ticker &&
      t.closeDate?.toISOString().slice(0, 10) === entry.entry_date &&
      (!titleType   || t.type   === titleType) &&
      (!titleStrike || t.strike === titleStrike)
    ) ?? null;
  }, [trades, entry.ticker, entry.entry_date, entry.title, entry.entry_type]);

  // Emoji for context line: computed for trade notes, fixed for position notes, none for EOD
  const cardEmoji =
    entry.entry_type === "trade_note"    ? (linkedTrade ? getTradeEmoji(linkedTrade) : null) :
    entry.entry_type === "position_note" ? "👁️" :
    null;

  const badge  = JOURNAL_BADGE[entry.entry_type] || { label: entry.entry_type, color: "#8b949e" };
  const isEOD  = entry.entry_type === "eod_update";
  const hasMeta = isEOD && entry.metadata?.vix != null;

  // ── New-style EOD card (has metadata) ─────────────────────────────────────
  if (hasMeta) {
    const md = entry.metadata;
    const floorLbl    = eodFloorLabel(md.floor_status);
    const activityLbl = eodActivityLabel(md.activity);
    const truncatedBody = entry.body
      ? (entry.body.length > 120 ? entry.body.slice(0, 120) + "…" : entry.body)
      : "";

    return (
      <div style={{ marginBottom: 12 }}>
        {/* ── Collapsed card ── */}
        <div
          onClick={() => setExpanded(prev => !prev)}
          style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: 16, cursor: "pointer", userSelect: "none" }}
        >
          {/* Header: badge + mood + date */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: badge.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
                {badge.label}
              </span>
              {entry.mood && <span style={{ fontSize: 16, lineHeight: 1 }}>{entry.mood}</span>}
            </div>
            <span style={{ color: "#8b949e", fontSize: 12 }}>{fmtEntryDate(entry.entry_date)}</span>
          </div>

          {/* Stinger line */}
          <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 8, display: "flex", flexWrap: "wrap", gap: "0 6px" }}>
            {md.vix != null && <span>VIX {md.vix}</span>}
            {md.free_cash_pct != null && (
              <>
                <span style={{ color: "#6e7681" }}>·</span>
                <span>
                  Cash {md.free_cash_pct}%
                  {floorLbl && <span style={{ color: floorLbl.color, marginLeft: 4 }}>{floorLbl.text}</span>}
                </span>
              </>
            )}
            {md.mtd_realized != null && (
              <>
                <span style={{ color: "#6e7681" }}>·</span>
                <span>MTD ${md.mtd_realized.toLocaleString()}</span>
              </>
            )}
            {activityLbl && (
              <>
                <span style={{ color: "#6e7681" }}>·</span>
                <span>{activityLbl}</span>
              </>
            )}
          </div>

          <div style={{ borderTop: "1px solid #21262d", marginBottom: 8 }} />

          {/* Body preview + expand toggle */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ color: truncatedBody ? "#c9d1d9" : "#6e7681", fontSize: 13, lineHeight: 1.6, fontStyle: truncatedBody ? "normal" : "italic", flex: 1 }}>
              {truncatedBody || "No notes yet."}
            </div>
            <span style={{ color: "#8b949e", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
              {expanded ? "Collapse ↑" : "Expand ↓"}
            </span>
          </div>

          {/* Delete only (Edit lives in expanded view) */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
              style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}
            >
              Delete
            </button>
          </div>
        </div>

        {/* ── Expanded detail view ── */}
        {expanded && (
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderTop: "none", borderRadius: "0 0 6px 6px", padding: 16, fontSize: 12 }}>

            {/* Full body (if truncated) */}
            {entry.body && entry.body.length > 120 && (
              <div style={{ color: "#c9d1d9", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #21262d" }}>
                {entry.body}
              </div>
            )}

            {/* ── Section A: Metadata grid ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginBottom: 16 }}>
              {/* Row 1 */}
              <div>
                <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, marginBottom: 3 }}>Free Cash</div>
                <div style={{ color: "#e6edf3", fontWeight: 600 }}>{md.free_cash_pct != null ? `${md.free_cash_pct}%` : "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, marginBottom: 3 }}>Deployment Status</div>
                {floorLbl
                  ? <div style={{ color: floorLbl.color, fontWeight: 600 }}>
                      {floorLbl.text}
                      {md.floor_delta != null && <span style={{ fontWeight: 400, color: "#8b949e" }}> ({(md.floor_delta * 100).toFixed(1)}%)</span>}
                    </div>
                  : <div style={{ color: "#6e7681" }}>—</div>}
                {md.floor_band_low != null && (
                  <div style={{ color: "#6e7681", fontSize: 11 }}>Floor: {md.floor_band_low}–{md.floor_band_high}%</div>
                )}
              </div>
              <div>
                <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, marginBottom: 3 }}>VIX</div>
                <div style={{ color: "#e6edf3", fontWeight: 600 }}>{md.vix ?? "—"}</div>
              </div>
              {/* Row 2 */}
              <div>
                <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, marginBottom: 3 }}>MTD Realized</div>
                <div style={{ color: "#3fb950", fontWeight: 600 }}>{md.mtd_realized != null ? `$${md.mtd_realized.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, marginBottom: 3 }}>Pipeline Total</div>
                <div style={{ color: "#e6edf3", fontWeight: 600 }}>{md.pipeline_total != null ? `$${md.pipeline_total.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, marginBottom: 3 }}>Pipeline Est.</div>
                <div style={{ color: "#e6edf3", fontWeight: 600 }}>{md.pipeline_est != null ? `$${md.pipeline_est.toLocaleString()}` : "—"}</div>
              </div>
            </div>

            {/* Monthly targets */}
            {account?.monthly_targets && (
              <div style={{ color: "#6e7681", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #21262d", fontSize: 11 }}>
                Targets — Baseline: ${account.monthly_targets.baseline.toLocaleString()}
                {md.mtd_realized != null && (
                  <span style={{ color: md.mtd_realized >= account.monthly_targets.baseline ? "#3fb950" : "#8b949e" }}>
                    {" "}({Math.round(md.mtd_realized / account.monthly_targets.baseline * 100)}%)
                  </span>
                )}
                {" · "}
                Stretch: ${account.monthly_targets.stretch.toLocaleString()}
                {md.mtd_realized != null && (
                  <span style={{ color: "#8b949e" }}>
                    {" "}({Math.round(md.mtd_realized / account.monthly_targets.stretch * 100)}%)
                  </span>
                )}
              </div>
            )}

            {/* ── Section B: Today's Activity ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>
                Today's Activity
              </div>
              <div style={{ borderTop: "1px solid #21262d", paddingTop: 8 }}>
                {(!md.activity?.closed?.length && !md.activity?.opened?.length) ? (
                  <div style={{ color: "#6e7681", fontStyle: "italic" }}>No trades on this date</div>
                ) : (
                  <>
                    {(md.activity.closed || []).map((t, i) => (
                      <div key={i} style={{ color: "#c9d1d9", marginBottom: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ color: "#8b949e", minWidth: 42 }}>Closed</span>
                        <span style={{ fontWeight: 600 }}>{t.ticker}</span>
                        <span style={{ color: "#8b949e" }}>{t.type} ${t.strike}</span>
                        {t.pct_kept != null && <span style={{ color: "#3fb950" }}>+{t.pct_kept}%</span>}
                        {t.dte_remaining != null && <span style={{ color: "#6e7681" }}>({t.dte_remaining}d DTE rem.)</span>}
                      </div>
                    ))}
                    {(md.activity.opened || []).length > 0
                      ? (md.activity.opened || []).map((p, i) => (
                          <div key={i} style={{ color: "#c9d1d9", marginBottom: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ color: "#8b949e", minWidth: 42 }}>Opened</span>
                            <span style={{ fontWeight: 600 }}>{p.ticker}</span>
                            <span style={{ color: "#8b949e" }}>{p.type} ${p.strike}</span>
                            {p.expiry && <span style={{ color: "#6e7681" }}>exp {formatExpiry(p.expiry)}</span>}
                            {p.premium && <span style={{ color: "#3fb950" }}>+${p.premium.toLocaleString()}</span>}
                          </div>
                        ))
                      : <div style={{ color: "#6e7681" }}><span style={{ color: "#8b949e", minWidth: 42, display: "inline-block" }}>Opened</span> —</div>
                    }
                  </>
                )}
              </div>
            </div>

            {/* ── Section C: Open CSP Snapshot ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#6e7681", textTransform: "uppercase", letterSpacing: "0.6px", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>
                Open CSP Positions (as of save time)
              </div>
              <div style={{ borderTop: "1px solid #21262d", paddingTop: 8 }}>
                {!md.csp_snapshot?.length ? (
                  <div style={{ color: "#6e7681", fontStyle: "italic" }}>No open CSPs at time of save</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>
                          {["Ticker", "Strike", "Expiry", "DTE", "% Left", "Premium", "Capital", "ROI"].map(h => (
                            <th key={h} style={{ color: "#6e7681", textAlign: "left", padding: "3px 8px 6px 0", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {md.csp_snapshot.map((row, i) => (
                          <tr key={i}>
                            <td style={{ color: "#e6edf3", fontWeight: 600, padding: "3px 8px 3px 0" }}>{row.ticker}</td>
                            <td style={{ color: "#c9d1d9", padding: "3px 8px 3px 0" }}>${row.strike}</td>
                            <td style={{ color: "#8b949e", padding: "3px 8px 3px 0" }}>{formatExpiry(row.expiry)}</td>
                            <td style={{ color: "#c9d1d9", padding: "3px 8px 3px 0" }}>{row.dte}d</td>
                            <td style={{ color: row.dte_pct >= 60 ? "#3fb950" : "#c9d1d9", padding: "3px 8px 3px 0" }}>{row.dte_pct}%</td>
                            <td style={{ color: "#3fb950", padding: "3px 8px 3px 0" }}>${row.premium?.toLocaleString()}</td>
                            <td style={{ color: "#8b949e", padding: "3px 8px 3px 0" }}>${row.capital?.toLocaleString()}</td>
                            <td style={{ color: "#c9d1d9", padding: "3px 8px 3px 0" }}>{row.roi}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Edit button inside expanded view */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => onEdit(entry)}
                style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: "5px 12px", borderRadius: 4 }}
              >
                Edit
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Legacy EOD card (no metadata) and all non-EOD cards ───────────────────
  return (
    <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: 16, marginBottom: 12 }}>
      {/* Header row: badge (+ mood for EOD) and date */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: badge.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
            {badge.label}
          </span>
          {isEOD && entry.mood && (
            <span style={{ fontSize: 16, lineHeight: 1 }}>{entry.mood}</span>
          )}
        </div>
        <span style={{ color: "#8b949e", fontSize: 12 }}>{fmtEntryDate(entry.entry_date)}</span>
      </div>

      {/* Context line: emoji + ticker + title (trade/position notes only) */}
      {!isEOD && (entry.ticker || entry.title) && (
        <div style={{ fontSize: 13, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 5 }}>
          {cardEmoji && <span style={{ fontSize: 15 }}>{cardEmoji}</span>}
          {entry.ticker && <span style={{ color: "#e6edf3", fontWeight: 600 }}>{entry.ticker}</span>}
          {entry.ticker && entry.title && <span style={{ color: "#8b949e" }}> · {entry.title}</span>}
          {!entry.ticker && entry.title && <span style={{ color: "#e6edf3", fontWeight: 500 }}>{entry.title}</span>}
        </div>
      )}

      {/* Trade metadata row: premium, strike, expiry, days, % kept */}
      {linkedTrade && (() => {
        const strikeSuffix = linkedTrade.type === "CSP" ? "p" : linkedTrade.type === "CC" ? "c" : "";
        const premStr = linkedTrade.premium != null
          ? (linkedTrade.premium >= 0 ? "+" : "") + formatDollars(linkedTrade.premium)
          : "—";
        return (
          <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{premStr}</span>
            {linkedTrade.strike && <span>· ${linkedTrade.strike}{strikeSuffix}</span>}
            {linkedTrade.expiry && linkedTrade.expiry !== "—" && <span>· exp {linkedTrade.expiry}</span>}
            {linkedTrade.days && <span>· {linkedTrade.days}d</span>}
            {linkedTrade.kept && linkedTrade.kept !== "—" && <span>· {linkedTrade.kept} kept</span>}
          </div>
        );
      })()}

      {/* Body */}
      <div style={{ color: entry.body ? "#c9d1d9" : "#6e7681", fontSize: 13, lineHeight: 1.6, marginBottom: entry.tags?.length ? 10 : 6, whiteSpace: "pre-wrap", fontStyle: entry.body ? "normal" : "italic" }}>
        {entry.body || "No notes yet — click Edit to add."}
      </div>

      {/* Tags */}
      {entry.tags?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {entry.tags.map(tag => (
            <span key={tag} style={{ background: "#1c2333", color: "#58a6ff", fontSize: 11, padding: "2px 8px", borderRadius: 4, marginRight: 6, display: "inline-block", marginBottom: 4 }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button onClick={() => onEdit(entry)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>Edit</button>
        <button onClick={() => onDelete(entry.id)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>Delete</button>
      </div>
    </div>
  );
}

// ── Shared journal form styles — module-level so React never remounts form elements ──
const JOURNAL_INPUT_ST = {
  background: "#0d1117", border: "1px solid #21262d", color: "#c9d1d9",
  borderRadius: 4, padding: "8px 10px", fontFamily: "inherit", fontSize: 13,
  width: "100%", boxSizing: "border-box",
};
const JOURNAL_LABEL_ST = {
  display: "block", color: "#8b949e", fontSize: 11, textTransform: "uppercase",
  letterSpacing: "0.8px", marginBottom: 6, fontWeight: 500,
};

function JournalField({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={JOURNAL_LABEL_ST}>{label}</label>
      {children}
    </div>
  );
}

function JournalAutoTextarea({ value, onChange, minH, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      onInput={e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
      placeholder={placeholder}
      style={{ ...JOURNAL_INPUT_ST, minHeight: minH, resize: "none", lineHeight: 1.6 }}
    />
  );
}

// Inline edit form — expands in-place inside the feed, replacing the card being edited.
function JournalInlineEditForm({ entry, title, onTitleChange, body, onBodyChange, tags, onTagsChange, source, onSourceChange, mood, onMoodChange, freeCash, onFreeCashChange, vix, onVixChange, pipeline, onPipelineChange, onSave, onCancel, saving, error }) {
  const isEOD = entry.entry_type === "eod_update";
  const badge = JOURNAL_BADGE[entry.entry_type] || { label: entry.entry_type, color: "#8b949e" };
  return (
    <div style={{ background: "#161b22", border: "2px solid #e3b341", borderRadius: 6, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e3b341", textTransform: "uppercase", letterSpacing: "0.8px" }}>
          Editing — <span style={{ color: badge.color }}>{badge.label}</span>
        </span>
        <span style={{ color: "#8b949e", fontSize: 12 }}>{fmtEntryDate(entry.entry_date)}</span>
      </div>

      {/* Title (not for EOD — title is auto-generated) */}
      {!isEOD && (
        <JournalField label="Title">
          <input type="text" style={JOURNAL_INPUT_ST} value={title} onChange={onTitleChange} />
        </JournalField>
      )}

      {/* Mood (EOD only) */}
      {isEOD && (
        <JournalField label="Mood">
          <div style={{ display: "flex", gap: 6 }}>
            {MOODS.map(m => {
              const active = mood === m.emoji;
              return (
                <button key={m.emoji} onClick={() => onMoodChange(m.emoji)} style={{
                  flex: 1, padding: "8px 2px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                  border: `2px solid ${active ? m.activeBorder : "#30363d"}`,
                  background: active ? m.activeBg : "transparent",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{m.emoji}</span>
                  <span style={{ fontSize: 10, color: active ? m.activeBorder : "#6e7681" }}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </JournalField>
      )}

      {/* Snapshot numeric fields (EOD only) */}
      {isEOD && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div>
            <label style={JOURNAL_LABEL_ST}>Free Cash %</label>
            <input type="number" step="0.1" style={JOURNAL_INPUT_ST} value={freeCash} onChange={onFreeCashChange} placeholder="15.4" />
          </div>
          <div>
            <label style={JOURNAL_LABEL_ST}>VIX</label>
            <input type="number" step="0.01" style={JOURNAL_INPUT_ST} value={vix} onChange={onVixChange} placeholder="24.42" />
          </div>
          <div>
            <label style={JOURNAL_LABEL_ST}>Pipeline $</label>
            <input type="number" style={JOURNAL_INPUT_ST} value={pipeline} onChange={onPipelineChange} placeholder="6391" />
          </div>
        </div>
      )}

      {/* Notes */}
      <JournalField label="Notes">
        <JournalAutoTextarea value={body} onChange={onBodyChange} minH={140} placeholder="Your notes..." />
      </JournalField>

      {/* Source (trade / position notes) */}
      {!isEOD && (
        <JournalField label="Source">
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            {["Ryan", "Self"].map(s => (
              <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#c9d1d9" }}>
                <input type="radio" name="inline-source" value={s} checked={source === s} onChange={() => onSourceChange(s)} style={{ accentColor: "#58a6ff" }} />
                {s}
              </label>
            ))}
          </div>
        </JournalField>
      )}

      {/* Tags (trade / position notes) */}
      {!isEOD && (
        <JournalField label="Tags (comma separated, optional)">
          <input type="text" style={JOURNAL_INPUT_ST} value={tags} onChange={onTagsChange} placeholder="ryan-signal, lower-bb, vix-elevated" />
        </JournalField>
      )}

      {error && (
        <div style={{ color: "#f85149", fontSize: 12, marginBottom: 10, padding: "8px 10px", background: "#1a1a1a", borderRadius: 4 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 12px" }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saving} style={{ background: "#238636", border: "none", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 16px", borderRadius: 4, fontWeight: 500, opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function JournalTab() {
  const { trades, positions, account } = useData();

  // Feed
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [feedError, setFeedError] = useState(null);

  // Filters
  const [filterType,   setFilterType]   = useState("all");
  const [filterTicker, setFilterTicker] = useState("all");
  const [filterSince,  setFilterSince]  = useState("this_month");

  // Form
  const [entryType,      setEntryType]      = useState("trade_note");
  const [linkedPosition, setLinkedPosition] = useState(null);

  // Inline edit state (replaces right-panel edit mode)
  const [inlineEditId,  setInlineEditId]  = useState(null);
  const [inlineTitle,   setInlineTitle]   = useState("");
  const [inlineBody,    setInlineBody]    = useState("");
  const [inlineTags,    setInlineTags]    = useState("");
  const [inlineSource,  setInlineSource]  = useState("Self");
  const [inlineMood,    setInlineMood]    = useState("🟡");
  const [inlineSaving,     setInlineSaving]     = useState(false);
  const [inlineError,      setInlineError]      = useState(null);
  const [inlineFreeCash,   setInlineFreeCash]   = useState("");
  const [inlineVix,        setInlineVix]        = useState("");
  const [inlinePipeline,   setInlinePipeline]   = useState("");
  const [linkedTrade,    setLinkedTrade]    = useState(null);
  const [formTitle,      setFormTitle]      = useState("");
  const [formSource,     setFormSource]     = useState("Self");
  const [formTags,       setFormTags]       = useState("");
  const [formDate,       setFormDate]       = useState(todayISO());
  const [formBody,       setFormBody]       = useState("");
  const [saveError,      setSaveError]      = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [formMood,       setFormMood]       = useState("🟡");
  const [formFreeCash,   setFormFreeCash]   = useState("");
  const [formVix,        setFormVix]        = useState("");
  const [formPipeline,   setFormPipeline]   = useState("");

  // Backfill state
  const [backfilling,    setBackfilling]    = useState(false);
  const [backfillMsg,    setBackfillMsg]    = useState(null);

  // Tickers seen in the feed (for filter dropdown)
  const feedTickers = useMemo(
    () => [...new Set(entries.map(e => e.ticker).filter(Boolean))].sort(),
    [entries]
  );

  // All open positions flattened into selectable options
  const positionOptions = useMemo(() => {
    const opts = [];
    (positions.open_csps || []).forEach(p => opts.push({
      label: `${p.ticker} CSP $${p.strike} exp ${formatExpiry(p.expiry_date)}`,
      ticker: p.ticker, obj: p, group: "Open CSPs",
    }));
    (positions.assigned_shares || []).forEach(s => {
      if (s.active_cc) opts.push({
        label: `${s.ticker} CC $${s.active_cc.strike} exp ${formatExpiry(s.active_cc.expiry_date)}`,
        ticker: s.ticker, obj: s.active_cc, group: "Active CCs",
      });
      opts.push({
        label: `${s.ticker} Shares — ${formatDollars(s.cost_basis_total)}`,
        ticker: s.ticker, obj: { ...s, type: "Shares" }, group: "Assigned Shares",
      });
    });
    (positions.open_leaps || []).forEach(l => opts.push({
      label: `${l.ticker} LEAPS — ${l.description || ""}`,
      ticker: l.ticker, obj: l, group: "Open LEAPS",
    }));
    return opts;
  }, [positions]);

  // Closed trades sorted newest-first for the trade link dropdown
  const closedTradeOptions = useMemo(() =>
    [...trades]
      .sort((a, b) => (b.closeDate ?? 0) - (a.closeDate ?? 0))
      .map(t => ({
        label: `${t.ticker} ${t.type}${t.strike ? ` $${t.strike}` : ""} — ${t.close} (${t.kept})`,
        ticker: t.ticker, obj: t,
      })),
  [trades]);

  // ── EOD preview data — derived from existing app state, no extra API call ──

  // Today's closed CSP trades (for EOD form preview + metadata snapshot)
  const eodClosedToday = useMemo(() => {
    const dateKey = formDate;
    return trades
      .filter(t => t.closeDate?.toISOString().slice(0, 10) === dateKey)
      .map(t => {
        const dteRemaining = t.expiry_date && t.closeDate
          ? Math.max(0, Math.ceil(
              (new Date(t.expiry_date + "T12:00:00") - t.closeDate) / 86400000
            ))
          : null;
        return {
          ticker:        t.ticker,
          type:          t.type,
          strike:        t.strike,
          pct_kept:      t.kept !== "—" ? Math.round(parseFloat(t.kept)) : null,
          dte_remaining: dteRemaining,
        };
      });
  }, [trades, formDate]);

  // Today's opened CSP positions
  const eodOpenedToday = useMemo(() => {
    const dateKey = formDate;
    return (positions.open_csps || [])
      .filter(p => p.open_date === dateKey)
      .map(p => ({
        ticker:  p.ticker,
        type:    p.type,
        strike:  p.strike,
        expiry:  p.expiry_date,
        premium: p.premium_collected,
      }));
  }, [positions, formDate]);

  // Current open CSPs with computed DTE metrics (for EOD form preview + metadata snapshot)
  const eodOpenCsps = useMemo(() => {
    const refDate = formDate || todayISO();
    return (positions.open_csps || [])
      .filter(p => p.type === "CSP")
      .map(p => {
        const expiryMs   = new Date(p.expiry_date + "T12:00:00").getTime();
        const refMs      = new Date(refDate       + "T12:00:00").getTime();
        const openMs     = new Date(p.open_date   + "T12:00:00").getTime();
        const dte        = Math.max(0, Math.ceil((expiryMs - refMs)    / 86400000));
        const totalDays  = Math.max(1, Math.ceil((expiryMs - openMs)   / 86400000));
        const dte_pct    = Math.round(dte / totalDays * 100);
        const roi        = p.capital_fronted > 0
          ? +(p.premium_collected / p.capital_fronted * 100).toFixed(2)
          : 0;
        return {
          ticker:   p.ticker,
          strike:   p.strike,
          expiry:   p.expiry_date,
          dte,
          dte_pct,
          premium:  p.premium_collected,
          capital:  p.capital_fronted,
          roi,
        };
      });
  }, [positions, formDate]);

  // Live deployment status preview from form inputs
  const eodDeploymentPreview = useMemo(() => {
    if (!formFreeCash || !formVix) return null;
    const band    = getVixBand(+formVix);
    if (!band) return null;
    const cashFrac = +formFreeCash / 100;
    const status   =
      cashFrac > band.ceilingPct ? "above"
      : cashFrac < band.floorPct ? "below"
      : "within";
    const delta =
      status === "above" ? +(cashFrac - band.ceilingPct).toFixed(3)
      : status === "below" ? +(band.floorPct - cashFrac).toFixed(3)
      : null;
    return { band, status, delta };
  }, [formFreeCash, formVix]);

  useEffect(() => { fetchEntries(); }, [filterType, filterTicker, filterSince]);

  async function fetchEntries() {
    setLoading(true);
    setFeedError(null);
    try {
      let query = supabase
        .from("journal_entries")
        .select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (filterType !== "all")   query = query.eq("entry_type", filterType);
      if (filterTicker !== "all") query = query.eq("ticker", filterTicker);
      const sd = journalSinceDate(filterSince);
      if (sd) query = query.gte("entry_date", sd);
      const { data, error } = await query;
      if (error) throw error;
      setEntries(data ?? []);
    } catch (err) {
      setFeedError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBackfill(resync = false) {
    const msg = resync
      ? "Re-sync will delete all unannotated backfilled entries (empty body) and re-insert them with corrected dates.\n\nAny entries you've already added notes to will be preserved.\n\nContinue?"
      : "Backfill journal with all trades opened on or after Mar 1, 2026?\n\nExisting entries won't be duplicated. Each entry will have an empty body — click Edit to add your notes.";
    if (!window.confirm(msg)) return;
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const url  = resync ? "/api/backfill-journal?resync=1" : "/api/backfill-journal";
      const res  = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setBackfillMsg(data.created === 0
        ? "Already up to date — nothing new to backfill."
        : `Done. Created ${data.created} journal entr${data.created === 1 ? "y" : "ies"}.`
      );
      await fetchEntries();
    } catch (err) {
      setBackfillMsg(`Failed: ${err.message}`);
    } finally {
      setBackfilling(false);
    }
  }

  function resetForm() {
    setFormTitle(""); setFormBody(""); setFormTags(""); setFormSource("Self");
    setLinkedPosition(null); setLinkedTrade(null);
    setFormDate(todayISO());
    setFormMood("🟡");
    setFormFreeCash(""); setFormVix(""); setFormPipeline("");
    setSaveError(null);
  }

  function handleEdit(entry) {
    setInlineEditId(entry.id);
    setInlineTitle(entry.title ?? "");
    setInlineBody(entry.body ?? "");
    setInlineTags((entry.tags || []).join(", "));
    setInlineSource(entry.source ?? "Self");
    setInlineMood(entry.mood ?? "🟡");
    setInlineFreeCash(entry.metadata?.free_cash_pct  != null ? String(entry.metadata.free_cash_pct)  : "");
    setInlineVix(entry.metadata?.vix                 != null ? String(entry.metadata.vix)             : "");
    setInlinePipeline(entry.metadata?.pipeline_total != null ? String(entry.metadata.pipeline_total)  : "");
    setInlineError(null);
  }

  function handleInlineCancel() {
    setInlineEditId(null);
    setInlineError(null);
  }

  async function handleInlineSave(entryType, existingEntry) {
    const isEOD = entryType === "eod_update";
    const titleToSave = isEOD ? inlineTitle : inlineTitle.trim();
    if (!isEOD && !titleToSave) { setInlineError("Title is required."); return; }
    if (!inlineBody.trim())     { setInlineError("Notes are required."); return; }
    setInlineSaving(true);
    setInlineError(null);
    try {
      const tags = [...new Set(
        inlineTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
      )];
      const src  = isEOD ? null : (inlineSource || null);
      const mood = isEOD ? inlineMood : null;
      const now  = new Date().toISOString();

      // For EOD entries, rebuild metadata preserving stored activity + csp_snapshot snapshots.
      const metadata = isEOD ? computeEodMetadata({
        freeCashPct:   inlineFreeCash,
        vix:           inlineVix,
        pipelineTotal: inlinePipeline,
        mtdRealized:   existingEntry?.metadata?.mtd_realized ?? null,
        activity:      existingEntry?.metadata?.activity     ?? { closed: [], opened: [] },
        cspSnapshot:   existingEntry?.metadata?.csp_snapshot ?? [],
      }) : undefined;

      const updateFields = { title: titleToSave, body: inlineBody.trim(), tags, source: src, mood, updated_at: now };
      if (isEOD) updateFields.metadata = metadata;

      const { error } = await supabase
        .from("journal_entries")
        .update(updateFields)
        .eq("id", inlineEditId);
      if (error) throw error;
      setEntries(prev => prev.map(e =>
        e.id === inlineEditId
          ? { ...e, title: titleToSave, body: inlineBody.trim(), tags, source: src, mood, ...(isEOD ? { metadata } : {}) }
          : e
      ));
      setInlineEditId(null);
    } catch (err) {
      setInlineError(err.message);
    } finally {
      setInlineSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) { window.alert(`Delete failed: ${error.message}`); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function handleSave() {
    const isEOD = entryType === "eod_update";
    const titleToSave = isEOD ? `EOD — ${formDate}` : formTitle.trim();
    if (!isEOD && !titleToSave) { setSaveError("Title is required."); return; }
    if (!formBody.trim())       { setSaveError("Notes are required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const tags = [...new Set(
        formTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
      )];
      const ticker = linkedPosition?.ticker ?? linkedTrade?.ticker ?? null;
      const now    = new Date().toISOString();
      const src    = isEOD ? null : (formSource || null);

      const mood = isEOD ? formMood : null;

      const metadata = isEOD ? computeEodMetadata({
        freeCashPct:   formFreeCash,
        vix:           formVix,
        pipelineTotal: formPipeline,
        mtdRealized:   account?.month_to_date_premium ?? null,
        activity:      { closed: eodClosedToday, opened: eodOpenedToday },
        cspSnapshot:   eodOpenCsps,
      }) : null;

      const payload = {
        entry_type:  entryType,
        trade_id:    null,
        position_id: linkedPosition?.id ?? null,
        entry_date:  formDate,
        ticker,
        title:       titleToSave,
        body:        formBody.trim(),
        tags,
        source:      src,
        mood,
        metadata,
        created_at:  now,
        updated_at:  now,
      };
      const { data, error } = await supabase
        .from("journal_entries")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setEntries(prev => [data, ...prev]);
      resetForm();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleLinkPosition(posOpt) {
    setLinkedPosition(posOpt ? posOpt.obj : null);
    setLinkedTrade(null);
    if (posOpt) setFormTitle(buildAutoTitle(entryType, posOpt.obj, null));
  }

  function handleLinkTrade(tradeOpt) {
    setLinkedTrade(tradeOpt ? tradeOpt.obj : null);
    setLinkedPosition(null);
    if (tradeOpt) setFormTitle(buildAutoTitle(entryType, null, tradeOpt.obj));
  }

  // Shared input style
  // Current select indices for position/trade dropdowns
  const posSelectIdx  = linkedPosition ? positionOptions.findIndex(o => o.obj === linkedPosition) : -1;
  const tradeSelectIdx = linkedTrade   ? closedTradeOptions.findIndex(o => o.obj === linkedTrade) : -1;

  const posSelectEl = (label, optional = true) => (
    <JournalField label={label}>
      <select
        style={JOURNAL_INPUT_ST}
        value={posSelectIdx >= 0 ? posSelectIdx : ""}
        onChange={e => handleLinkPosition(e.target.value !== "" ? positionOptions[+e.target.value] : null)}
      >
        <option value="">{optional ? "— none —" : "— select position —"}</option>
        {positionOptions.map((o, i) => <option key={i} value={i}>[{o.group}] {o.label}</option>)}
      </select>
    </JournalField>
  );

  const filterSelectSt = {
    background: "#0d1117", border: "1px solid #21262d", color: "#c9d1d9",
    borderRadius: 4, padding: "4px 8px", fontFamily: "inherit", fontSize: 12,
  };

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>

      {/* ── LEFT: Activity Feed ──────────────────────────────────────────── */}
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>

        {/* Filter bar */}
        <div style={{
          display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
          padding: "10px 12px", background: "#161b22", borderRadius: 6,
          border: "1px solid #21262d", marginBottom: 16,
        }}>
          <span style={{ color: "#6e7681", fontSize: 12, marginRight: 4 }}>Filter:</span>
          <select style={filterSelectSt} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">All types</option>
            <option value="trade_note">Trade Notes</option>
            <option value="eod_update">EOD Updates</option>
            <option value="position_note">Position Notes</option>
          </select>
          <select style={filterSelectSt} value={filterTicker} onChange={e => setFilterTicker(e.target.value)}>
            <option value="all">All tickers</option>
            {feedTickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select style={filterSelectSt} value={filterSince} onChange={e => setFilterSince(e.target.value)}>
            <option value="this_month">This month</option>
            <option value="last_30">Last 30 days</option>
            <option value="last_90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        {/* Backfill / re-sync controls */}
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => handleBackfill(false)}
            disabled={backfilling}
            style={{
              background: "transparent", border: "1px solid #30363d", color: "#8b949e",
              borderRadius: 4, padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
              cursor: backfilling ? "not-allowed" : "pointer", opacity: backfilling ? 0.6 : 1,
            }}
          >
            {backfilling ? "Working..." : "Backfill (Mar 1+)"}
          </button>
          <button
            onClick={() => handleBackfill(true)}
            disabled={backfilling}
            style={{
              background: "transparent", border: "1px solid #30363d", color: "#8b949e",
              borderRadius: 4, padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
              cursor: backfilling ? "not-allowed" : "pointer", opacity: backfilling ? 0.6 : 1,
            }}
          >
            {backfilling ? "Working..." : "Re-sync backfill"}
          </button>
          {backfillMsg && (
            <span style={{ fontSize: 12, color: backfillMsg.startsWith("Failed") ? "#f85149" : "#3fb950" }}>
              {backfillMsg}
            </span>
          )}
        </div>

        {/* Feed content */}
        {loading && (
          <div style={{ color: "#8b949e", fontSize: 13, padding: "20px 0" }}>Loading...</div>
        )}
        {feedError && (
          <div style={{ color: "#f85149", fontSize: 13, padding: "10px 12px", background: "#1a1a1a", borderRadius: 4, marginBottom: 12 }}>
            Error loading feed: {feedError}
          </div>
        )}
        {!loading && !feedError && entries.length === 0 && (
          <div style={{ color: "#8b949e", fontSize: 13, padding: "40px 0", textAlign: "center", lineHeight: 1.9 }}>
            No journal entries yet.<br />
            Use the form to add your first trade note or EOD update.
          </div>
        )}
        {!loading && entries.map(entry =>
          entry.id === inlineEditId
            ? <JournalInlineEditForm
                key={entry.id}
                entry={entry}
                title={inlineTitle}           onTitleChange={e => setInlineTitle(e.target.value)}
                body={inlineBody}             onBodyChange={e => setInlineBody(e.target.value)}
                tags={inlineTags}             onTagsChange={e => setInlineTags(e.target.value)}
                source={inlineSource}         onSourceChange={setInlineSource}
                mood={inlineMood}             onMoodChange={setInlineMood}
                freeCash={inlineFreeCash}     onFreeCashChange={e => setInlineFreeCash(e.target.value)}
                vix={inlineVix}              onVixChange={e => setInlineVix(e.target.value)}
                pipeline={inlinePipeline}     onPipelineChange={e => setInlinePipeline(e.target.value)}
                onSave={() => handleInlineSave(entry.entry_type, entry)}
                onCancel={handleInlineCancel}
                saving={inlineSaving}
                error={inlineError}
              />
            : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
        )}
      </div>

      {/* ── RIGHT: New Entry Form ────────────────────────────────────────── */}
      <div style={{ flex: "0 0 340px", minWidth: 300 }}>
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: 16 }}>

          {/* Form header */}
          <div style={{ marginBottom: 14, fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>
            New Entry
          </div>

          {/* Entry type selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {JOURNAL_ENTRY_TYPES.map(({ key, label, activeColor, activeBg }) => {
              const active = entryType === key;
              return (
                <button
                  key={key}
                  onClick={() => { resetForm(); setEntryType(key); }}
                  style={{
                    flex: 1, padding: "7px 0", fontSize: 12, fontFamily: "inherit",
                    cursor: "pointer", borderRadius: 4,
                    fontWeight: active ? 600 : 400,
                    background: active ? activeBg : "transparent",
                    color: active ? activeColor : "#8b949e",
                    border: `1px solid ${active ? activeColor : "#30363d"}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── Trade Note fields ── */}
          {entryType === "trade_note" && (
            <>
              {posSelectEl("Link to open position (optional)", true)}
              {(
                <JournalField label="Link to closed trade (optional)">
                  <select
                    style={JOURNAL_INPUT_ST}
                    value={tradeSelectIdx >= 0 ? tradeSelectIdx : ""}
                    onChange={e => handleLinkTrade(e.target.value !== "" ? closedTradeOptions[+e.target.value] : null)}
                  >
                    <option value="">— none —</option>
                    {closedTradeOptions.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
                  </select>
                </JournalField>
              )}
              <JournalField label="Title">
                <input
                  type="text" style={JOURNAL_INPUT_ST} value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Auto-filled from linked trade, or enter manually"
                />
              </JournalField>
              <JournalField label="Source">
                <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                  {["Ryan", "Self"].map(s => (
                    <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#c9d1d9" }}>
                      <input type="radio" name="journal-source" value={s} checked={formSource === s} onChange={() => setFormSource(s)} style={{ accentColor: "#58a6ff" }} />
                      {s}
                    </label>
                  ))}
                </div>
              </JournalField>
              <JournalField label="Tags (comma separated, optional)">
                <input
                  type="text" style={JOURNAL_INPUT_ST} value={formTags}
                  onChange={e => setFormTags(e.target.value)}
                  placeholder="ryan-signal, lower-bb, vix-elevated"
                />
              </JournalField>
              <JournalField label="Notes">
                <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={120} placeholder="Trade rationale, setup details..." />
              </JournalField>
            </>
          )}

          {/* ── EOD Update fields ── */}
          {entryType === "eod_update" && (
            <>
              <JournalField label="Date">
                <input type="date" style={JOURNAL_INPUT_ST} value={formDate} onChange={e => setFormDate(e.target.value)} />
              </JournalField>
              <JournalField label="Mood">
                <div style={{ display: "flex", gap: 6 }}>
                  {MOODS.map(m => {
                    const active = formMood === m.emoji;
                    return (
                      <button
                        key={m.emoji}
                        onClick={() => setFormMood(m.emoji)}
                        style={{
                          flex: 1, padding: "8px 2px", borderRadius: 4, cursor: "pointer",
                          border: `2px solid ${active ? m.activeBorder : "#30363d"}`,
                          background: active ? m.activeBg : "transparent",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                          fontFamily: "inherit",
                        }}
                      >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>{m.emoji}</span>
                        <span style={{ fontSize: 10, color: active ? m.activeBorder : "#6e7681" }}>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </JournalField>

              {/* Numeric snapshot fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                <div>
                  <label style={JOURNAL_LABEL_ST}>Free Cash %</label>
                  <input type="number" step="0.1" style={JOURNAL_INPUT_ST} value={formFreeCash} onChange={e => setFormFreeCash(e.target.value)} placeholder="15.4" />
                </div>
                <div>
                  <label style={JOURNAL_LABEL_ST}>VIX</label>
                  <input type="number" step="0.01" style={JOURNAL_INPUT_ST} value={formVix} onChange={e => setFormVix(e.target.value)} placeholder="24.42" />
                </div>
                <div>
                  <label style={JOURNAL_LABEL_ST}>Pipeline $</label>
                  <input type="number" style={JOURNAL_INPUT_ST} value={formPipeline} onChange={e => setFormPipeline(e.target.value)} placeholder="6391" />
                </div>
              </div>

              {/* Auto-populated preview panel */}
              <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
                <div style={{ color: "#6e7681", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8, fontSize: 11 }}>
                  Preview (auto-populated)
                </div>

                {/* Deployment status */}
                {eodDeploymentPreview ? (
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ color: "#8b949e" }}>Deployment: </span>
                    <span style={{
                      color: eodDeploymentPreview.status === "above" ? "#e3b341"
                           : eodDeploymentPreview.status === "below" ? "#f85149"
                           : "#3fb950",
                    }}>
                      {eodDeploymentPreview.status === "above"
                        ? `↑ ${(eodDeploymentPreview.delta * 100).toFixed(1)}% above ceiling`
                        : eodDeploymentPreview.status === "below"
                        ? `↓ ${(eodDeploymentPreview.delta * 100).toFixed(1)}% below floor`
                        : "✓ in band"}
                    </span>
                    <span style={{ color: "#6e7681" }}> · Floor: {eodDeploymentPreview.band.floorPct * 100}–{eodDeploymentPreview.band.ceilingPct * 100}%</span>
                  </div>
                ) : (
                  <div style={{ color: "#6e7681", marginBottom: 6 }}>Deployment: — (enter VIX + Free Cash)</div>
                )}

                {/* MTD Realized */}
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: "#8b949e" }}>MTD Realized: </span>
                  <span style={{ color: "#c9d1d9" }}>
                    {account?.month_to_date_premium != null
                      ? `$${account.month_to_date_premium.toLocaleString()}`
                      : "—"}
                  </span>
                </div>

                {/* Pipeline Est (60%) */}
                {formPipeline && (
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ color: "#8b949e" }}>Pipeline Est. (60%): </span>
                    <span style={{ color: "#c9d1d9" }}>${Math.round(+formPipeline * 0.60).toLocaleString()}</span>
                  </div>
                )}

                {/* Today's activity */}
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: "#8b949e" }}>Today's activity: </span>
                  {eodClosedToday.length === 0 && eodOpenedToday.length === 0
                    ? <span style={{ color: "#6e7681" }}>No trades on {formDate}</span>
                    : null}
                </div>
                {eodClosedToday.map((t, i) => (
                  <div key={i} style={{ color: "#6e7681", paddingLeft: 8, marginBottom: 2 }}>
                    Closed {t.ticker} {t.type} ${t.strike}
                    {t.pct_kept != null && <span> · {t.pct_kept}%</span>}
                    {t.dte_remaining != null && <span> · {t.dte_remaining}d DTE rem.</span>}
                  </div>
                ))}
                {eodOpenedToday.map((p, i) => (
                  <div key={i} style={{ color: "#6e7681", paddingLeft: 8, marginBottom: 2 }}>
                    Opened {p.ticker} {p.type} ${p.strike} · exp {formatExpiry(p.expiry)}
                    {p.premium && <span> · ${p.premium.toLocaleString()}</span>}
                  </div>
                ))}

                {/* Open CSPs count */}
                <div style={{ marginTop: 4, color: "#8b949e" }}>
                  Open CSPs: <span style={{ color: "#c9d1d9" }}>{eodOpenCsps.length} position{eodOpenCsps.length !== 1 ? "s" : ""}</span>
                </div>
              </div>

              <JournalField label="Notes">
                <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={200} placeholder="What happened today, macro context, anything worth noting for the monthly review..." />
              </JournalField>
            </>
          )}

          {/* ── Position Note fields ── */}
          {entryType === "position_note" && (
            <>
              {posSelectEl("Position", false)}
              <JournalField label="Title">
                <input
                  type="text" style={JOURNAL_INPUT_ST} value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Auto-filled from position, or enter manually"
                />
              </JournalField>
              <JournalField label="Notes">
                <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={120} placeholder="Ongoing observations, roll considerations, delta watch..." />
              </JournalField>
            </>
          )}

          {/* Save error */}
          {saveError && (
            <div style={{ color: "#f85149", fontSize: 12, marginBottom: 10, padding: "8px 10px", background: "#1a1a1a", borderRadius: 4 }}>
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={resetForm}
              style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: "6px 12px" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: "#238636", border: "none", color: "#fff",
                cursor: saving ? "not-allowed" : "pointer",
                fontSize: 13, fontFamily: "inherit", padding: "6px 16px",
                borderRadius: 4, fontWeight: 500, opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : entryType === "eod_update" ? "Save Update" : "Save Note"}
            </button>
          </div>

        </div>
      </div>

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

  async function deleteTrade(trade) {
    // Optimistic update — remove from local state immediately
    setTrades(prev => prev.filter(t => t !== trade));
    // Persist to Supabase in production (id is null for local JSON trades)
    if (trade.id && import.meta.env.PROD) {
      try {
        await fetch(`/api/delete-trade?id=${encodeURIComponent(trade.id)}`, { method: "DELETE" });
      } catch (err) {
        console.warn("[deleteTrade] failed:", err.message);
      }
    }
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
  const [captureRate, setCaptureRate]           = useState(0.60);

  const tabStyle = (tab) => ({
    padding: "10px 24px", fontSize: 15, fontFamily: "inherit",
    cursor: "pointer", fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? "#e6edf3" : "#8b949e",
    background: "transparent", border: "none",
    borderBottom: activeTab === tab ? "2px solid #58a6ff" : "2px solid transparent",
    transition: "all 0.15s", letterSpacing: "0.3px",
  });

  return (
    <DataContext.Provider value={{ trades, positions, account, refreshData, deleteTrade }}>
    <div style={{ fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace", background: "#0d1117", color: "#c9d1d9", minHeight: "100vh", padding: "20px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#e6edf3", marginBottom: 4, letterSpacing: "0.5px" }}>
          TRADE DASHBOARD
        </h1>
        <div style={{ fontSize: 13, color: "#6e7681", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span>as of {account.last_updated}</span>
          <span style={{ fontSize: 11, color: "#30363d" }}>v{VERSION}</span>
        </div>

        <AccountBar captureRate={captureRate} />

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
          <button style={tabStyle("journal")} onClick={() => setActiveTab("journal")}>
            Journal
          </button>
        </div>

        {/* Active filter chips — shown on Summary and Calendar */}
        {activeTab !== "positions" && activeTab !== "journal" && (selectedTicker || selectedType) && (
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
            captureRate={captureRate}       setCaptureRate={setCaptureRate}
          />
        )}
        {activeTab === "positions" && <OpenPositionsTab />}
        {activeTab === "journal" && <JournalTab />}
      </div>
    </div>
    </DataContext.Provider>
  );
}
