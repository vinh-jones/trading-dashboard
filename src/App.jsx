import { useState, useEffect } from "react";
// Static JSON data files were removed for security — app loads live data from /api/data in production.
// Empty fallbacks prevent build errors; useEffect below replaces them with real data on mount.
const tradesData = { trades: [] };
const positionsData = { open_csps: [], assigned_shares: [], open_leaps: [], open_spreads: [] };
const accountData = {};
import { normalizeTrade } from "./lib/trading";
import { TYPE_COLORS, VERSION } from "./lib/constants";
import { theme } from "./lib/theme";
import { DataContext } from "./hooks/useData";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { AccountBar } from "./components/AccountBar";
import { SummaryTab } from "./components/SummaryTab";
import { CalendarTab } from "./components/CalendarTab";
import { OpenPositionsTab } from "./components/OpenPositionsTab";
import { JournalTab } from "./components/journal/JournalTab";
import { FocusTab } from "./components/FocusTab";
import { RadarTab } from "./components/RadarTab";
import { MacroTab } from "./components/MacroTab";

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
    padding: isMobile ? "10px 14px" : "10px 24px", fontSize: theme.size.md, fontFamily: "inherit",
    cursor: "pointer", fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? theme.text.primary : theme.text.muted,
    background: "transparent", border: "none",
    borderBottom: activeTab === tab ? `2px solid ${theme.blue}` : "2px solid transparent",
    transition: "all 0.15s", letterSpacing: "0.3px",
    whiteSpace: "nowrap",
  });

  return (
    <DataContext.Provider value={{ trades, positions, account, refreshData, deleteTrade }}>
    <div style={{ fontFamily: theme.font.mono, background: theme.bg.base, color: theme.text.secondary, minHeight: "100vh", padding: theme.space[5] }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: theme.text.primary, marginBottom: 4, letterSpacing: "0.5px" }}>
          TRADE DASHBOARD
        </h1>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[4], display: "flex", alignItems: "center", gap: theme.space[3] }}>
          <span>as of {account.last_updated}</span>
          <span style={{ fontSize: theme.size.xs, color: theme.border.strong }}>v{VERSION}</span>
        </div>

        <AccountBar captureRate={captureRate} />

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${theme.border.default}`, marginBottom: theme.space[5], overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <button style={tabStyle("positions")} onClick={() => setActiveTab("positions")}>
            Open Positions
          </button>
          <button style={tabStyle("focus")} onClick={() => setActiveTab("focus")}>
            Focus
          </button>
          <button style={tabStyle("radar")} onClick={() => setActiveTab("radar")}>
            Radar
          </button>
          <button style={tabStyle("journal")} onClick={() => setActiveTab("journal")}>
            Journal
          </button>
          <button style={tabStyle("calendar")} onClick={() => setActiveTab("calendar")}>
            Monthly Calendar
          </button>
          <button style={tabStyle("summary")} onClick={() => setActiveTab("summary")}>
            YTD Summary
          </button>
          <button style={tabStyle("macro")} onClick={() => setActiveTab("macro")}>
            Macro
          </button>
        </div>

        {/* Active filter chips — shown on Summary and Calendar */}
        {activeTab !== "positions" && activeTab !== "journal" && (selectedTicker || selectedType) && (
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], marginBottom: theme.space[4], fontSize: theme.size.md, color: theme.text.muted, padding: `${theme.space[2]}px ${theme.space[3]}px`, background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
            <span style={{ color: theme.text.subtle }}>Filters:</span>
            {selectedTicker && (
              <span style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: theme.blue, fontWeight: 500 }}>
                {selectedTicker}
                <span onClick={() => setSelectedTicker(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
              </span>
            )}
            {selectedType && (
              <span style={{ background: TYPE_COLORS[selectedType]?.bg || theme.bg.elevated, border: `1px solid ${TYPE_COLORS[selectedType]?.border || theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: TYPE_COLORS[selectedType]?.text || theme.text.primary, fontWeight: 500 }}>
                {selectedType}
                <span onClick={() => setSelectedType(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
              </span>
            )}
            {selectedDuration != null && activeTab === "summary" && (
              <span style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: theme.blue, fontWeight: 500 }}>
                {["0-1d", "2-3d", "4-7d", "8-14d", "15-30d", "30d+"][selectedDuration]}
                <span onClick={() => setSelectedDuration(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
              </span>
            )}
            <button
              onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); setSelectedDay(null); }}
              style={{ background: "transparent", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.size.sm, fontFamily: "inherit", marginLeft: "auto", textDecoration: "underline" }}
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
        {activeTab === "focus" && <FocusTab />}
        {activeTab === "positions" && <OpenPositionsTab />}
        {activeTab === "journal" && <JournalTab />}
        {activeTab === "radar" && <RadarTab positions={positions} />}
        {activeTab === "macro" && <MacroTab />}
      </div>
    </div>
    </DataContext.Provider>
  );
}
