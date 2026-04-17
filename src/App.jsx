import { useState, useEffect } from "react";
// Static JSON fallbacks — replaced by /api/data on mount in prod (see useEffect below).
const tradesData    = { trades: [] };
const positionsData = { open_csps: [], assigned_shares: [], open_leaps: [], open_spreads: [] };
const accountData   = {};

import { normalizeTrade } from "./lib/trading";
import { TYPE_COLORS, VERSION } from "./lib/constants";
import { theme } from "./lib/theme";
import { defaultSubView, isValidMode, isValidSubView } from "./lib/modes";
import { DataContext } from "./hooks/useData";

import { PersistentHeader } from "./components/PersistentHeader";
import { ModeNav } from "./components/ModeNav";
import { FocusTab } from "./components/FocusTab";
import { ExploreView } from "./components/ExploreView";
import { ReviewView } from "./components/ReviewView";

export default function TradeDashboard() {
  const [trades,    setTrades]    = useState(() => tradesData.trades.map(normalizeTrade));
  const [positions, setPositions] = useState(() => positionsData);
  const [account,   setAccount]   = useState(() => accountData);

  function refreshData(data) {
    if (data.trades)    setTrades(data.trades.map(normalizeTrade));
    if (data.positions) setPositions(data.positions);
    if (data.account)   setAccount(prev => ({ ...prev, ...data.account }));
  }

  async function deleteTrade(trade) {
    setTrades(prev => prev.filter(t => t !== trade));
    if (trade.id && import.meta.env.PROD) {
      try {
        await fetch(`/api/delete-trade?id=${encodeURIComponent(trade.id)}`, { method: "DELETE" });
      } catch (err) {
        console.warn("[deleteTrade] failed:", err.message);
      }
    }
  }

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    fetch("/api/data")
      .then(r => r.json())
      .then(data => { if (data.ok) refreshData(data); })
      .catch(err => console.warn("[TradeDashboard] /api/data fetch failed:", err.message));
  }, []);

  // ── Mode + sub-view state ─────────────────────────────────────────────────
  // Focus is the default home mode per spec.
  const [mode, setModeRaw]       = useState("focus");
  const [subView, setSubViewRaw] = useState(defaultSubView("focus"));

  function setMode(next) {
    if (!isValidMode(next)) return;
    setModeRaw(next);
    setSubViewRaw(defaultSubView(next));
  }

  function setSubView(next) {
    if (!isValidSubView(mode, next)) return;
    setSubViewRaw(next);
  }

  // ── Filter state — preserved from prior shell ─────────────────────────────
  const [selectedTicker,   setSelectedTicker]   = useState(null);
  const [selectedType,     setSelectedType]     = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [selectedDay,      setSelectedDay]      = useState(null);
  const [captureRate,      setCaptureRate]      = useState(0.60);

  // Filter chips are relevant only to Review sub-views (Monthly, YTD).
  const showFilterChips =
    mode === "review" &&
    (subView === "monthly" || subView === "ytd") &&
    (selectedTicker || selectedType || selectedDuration != null);

  return (
    <DataContext.Provider value={{ trades, positions, account, refreshData, deleteTrade }}>
      <div style={{
        fontFamily: theme.font.mono,
        background: theme.bg.base,
        color:      theme.text.secondary,
        minHeight:  "100vh",
        padding:    theme.space[5],
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: theme.text.primary, marginBottom: 4, letterSpacing: "0.5px" }}>
            TRADE DASHBOARD
          </h1>
          <div style={{
            fontSize:     theme.size.sm,
            color:        theme.text.subtle,
            marginBottom: theme.space[4],
            display:      "flex",
            alignItems:   "center",
            gap:          theme.space[3],
          }}>
            <span>as of {account.last_updated}</span>
            <span style={{ fontSize: theme.size.xs, color: theme.border.strong }}>v{VERSION}</span>
          </div>

          <PersistentHeader captureRate={captureRate} />
          <ModeNav mode={mode} onChange={setMode} />

          {showFilterChips && (
            <div style={{
              display:      "flex",
              alignItems:   "center",
              gap:          theme.space[2],
              marginBottom: theme.space[4],
              fontSize:     theme.size.md,
              color:        theme.text.muted,
              padding:      `${theme.space[2]}px ${theme.space[3]}px`,
              background:   theme.bg.surface,
              borderRadius: theme.radius.md,
              border:       `1px solid ${theme.border.default}`,
            }}>
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
              {selectedDuration != null && subView === "ytd" && (
                <span style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`, padding: "3px 10px", borderRadius: theme.radius.sm, color: theme.blue, fontWeight: 500 }}>
                  {["0-1d", "2-3d", "4-7d", "8-14d", "15-30d", "30d+"][selectedDuration]}
                  <span onClick={() => setSelectedDuration(null)} style={{ marginLeft: 6, cursor: "pointer", color: theme.text.subtle }}>×</span>
                </span>
              )}
              <button
                onClick={() => { setSelectedTicker(null); setSelectedType(null); setSelectedDuration(null); setSelectedDay(null); }}
                style={{
                  background:    "transparent",
                  border:        "none",
                  color:         theme.text.muted,
                  cursor:        "pointer",
                  fontSize:      theme.size.sm,
                  fontFamily:    "inherit",
                  marginLeft:    "auto",
                  textDecoration:"underline",
                }}
              >
                Clear all
              </button>
            </div>
          )}

          {mode === "focus"   && <FocusTab />}
          {mode === "explore" && (
            <ExploreView
              subView={subView}
              onSubViewChange={setSubView}
            />
          )}
          {mode === "review" && (
            <ReviewView
              subView={subView}
              onSubViewChange={setSubView}
              selectedTicker={selectedTicker}     setSelectedTicker={setSelectedTicker}
              selectedType={selectedType}         setSelectedType={setSelectedType}
              selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
              selectedDay={selectedDay}           setSelectedDay={setSelectedDay}
              captureRate={captureRate}           setCaptureRate={setCaptureRate}
            />
          )}
        </div>
      </div>
    </DataContext.Provider>
  );
}
