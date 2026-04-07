import { useState, useEffect } from "react";
import tradesData from "./data/trades.json";
import positionsData from "./data/positions.json";
import accountData from "./data/account.json";
import { normalizeTrade } from "./lib/trading";
import { TYPE_COLORS, VERSION } from "./lib/constants";
import { DataContext } from "./hooks/useData";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { AccountBar } from "./components/AccountBar";
import { SummaryTab } from "./components/SummaryTab";
import { CalendarTab } from "./components/CalendarTab";
import { OpenPositionsTab } from "./components/OpenPositionsTab";
import { JournalTab } from "./components/journal/JournalTab";

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

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 600;

  const [activeTab, setActiveTab] = useState("positions");
  const [selectedTicker, setSelectedTicker]     = useState(null);
  const [selectedType, setSelectedType]         = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [selectedDay, setSelectedDay]           = useState(null);
  const [captureRate, setCaptureRate]           = useState(0.60);

  const tabStyle = (tab) => ({
    padding: isMobile ? "10px 14px" : "10px 24px", fontSize: 15, fontFamily: "inherit",
    cursor: "pointer", fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? "#e6edf3" : "#8b949e",
    background: "transparent", border: "none",
    borderBottom: activeTab === tab ? "2px solid #58a6ff" : "2px solid transparent",
    transition: "all 0.15s", letterSpacing: "0.3px",
    whiteSpace: "nowrap",
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
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #21262d", marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <button style={tabStyle("positions")} onClick={() => setActiveTab("positions")}>
            Open Positions
          </button>
          <button style={tabStyle("journal")} onClick={() => setActiveTab("journal")}>
            Journal
          </button>
          <button style={tabStyle("calendar")} onClick={() => setActiveTab("calendar")}>
            Monthly Calendar
          </button>
          <button style={tabStyle("summary")} onClick={() => setActiveTab("summary")}>
            Q1 Summary
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
