import { useState, useEffect, useRef } from "react";
import { T, SURFACE_ACCENT, getVixBand } from "./theme.js";
import { normalizeTrade } from "../lib/trading.js";
import { DataContext } from "../hooks/useData.js";
import { useFocusItems } from "../hooks/useFocusItems.js";
import { FocusCommandCenter } from "./components/focus/FocusCommandCenter.jsx";
import { ExploreSurface } from "./components/explore/ExploreSurface.jsx";
import { ReviewSurface } from "./components/review/ReviewSurface.jsx";
import { PositionDetailHost } from "./components/PositionDetail.jsx";

// ── Global page style injected once ───────────────────────────────────────────
const PAGE_STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: ${T.bg};
    color: ${T.t2};
    font-family: ${T.mono};
    font-size: 14px;
    line-height: 1.55;
    min-height: 100vh;
    font-feature-settings: "ss01","ss02","cv11";
    -webkit-font-smoothing: antialiased;
  }
  button { font-family: inherit; font-size: inherit; color: inherit; cursor: pointer; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.bd}; border-radius: 3px; }
  @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.35} }
  @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @keyframes fade-in { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
`;

function usePageStyle() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = PAGE_STYLE;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
}

// ── Static JSON fallbacks (dev) ───────────────────────────────────────────────
const tradesData    = { trades: [] };
const positionsData = { open_csps: [], assigned_shares: [], open_leaps: [], open_spreads: [] };
const accountData   = {};

export function RedesignApp() {
  usePageStyle();

  const [trades,    setTrades]    = useState(() => tradesData.trades.map(normalizeTrade));
  const [positions, setPositions] = useState(() => positionsData);
  const [account,   setAccount]   = useState(() => accountData);

  function refreshData(data) {
    if (data.trades)    setTrades(data.trades.map(normalizeTrade));
    if (data.positions) setPositions(data.positions);
    if (data.account)   setAccount(prev => ({ ...prev, ...data.account }));
  }

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    fetch("/api/data")
      .then(r => r.json())
      .then(data => { if (data.ok) refreshData(data); })
      .catch(err => console.warn("[RedesignApp] /api/data fetch failed:", err.message));
  }, []);

  const focus = useFocusItems({ positions, account });

  return (
    <DataContext.Provider value={{ trades, positions, account, refreshData, deleteTrade: () => {} }}>
      <AppShell focus={focus} trades={trades} account={account} positions={positions} />
    </DataContext.Provider>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────
const SURFACES = [
  { k: "focus",   label: "FOCUS",   key: "F", accent: T.blue  },
  { k: "explore", label: "EXPLORE", key: "E", accent: T.green },
  { k: "review",  label: "REVIEW",  key: "V", accent: T.mag   },
];

function AppShell({ focus, trades, account, positions }) {
  const [surface, setSurface] = useState("focus");
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") setSurface("focus");
      if (e.key === "e" || e.key === "E") setSurface("explore");
      if (e.key === "r" || e.key === "R") setSurface("review");
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const hhmm = time.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const vix = account?.vix_current ?? focus.liveVix ?? null;
  const band = vix ? getVixBand(vix) : null;

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      {/* CRT grid overlay */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />
      {/* Vignette */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse at top, transparent 40%, rgba(0,0,0,0.5) 100%)",
      }} />

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <Header
          time={hhmm} surface={surface} setSurface={setSurface}
          vix={vix} band={band} p1Count={focus.p1Count}
        />

        <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 24px 80px" }}>
          {surface === "focus" && (
            <FocusCommandCenter
              account={account}
              positions={positions}
              focusItems={focus.items}
              quoteMap={focus.quoteMap}
              marketContext={focus.marketContext}
              liveVix={focus.liveVix}
            />
          )}
          {surface === "explore" && <ExploreSurface positions={positions} account={account} />}
          {surface === "review"  && <ReviewSurface trades={trades} account={account} />}
        </div>

        <Footer />
      </div>

      <PositionDetailHost
        positions={positions}
        trades={trades}
        account={account}
        quoteMap={focus.quoteMap}
      />
    </div>
  );
}

function Header({ time, surface, setSurface, vix, band, p1Count }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 10,
      background: T.deep + "f8",
      backdropFilter: "blur(8px)",
      borderBottom: `1px solid ${T.bd}`,
    }}>
      <div style={{
        maxWidth: 1500, margin: "0 auto", padding: "10px 24px",
        display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160 }}>
          <div style={{
            width: 22, height: 22,
            border: `1px solid ${T.post}`,
            borderRadius: T.rSm,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: T.post, letterSpacing: "0.05em",
            background: T.post + "12",
            fontFamily: T.mono,
          }}>W</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.t1, letterSpacing: "0.15em" }}>WHEEL·OS</div>
            <div style={{ fontSize: 10, color: T.tm, letterSpacing: "0.18em", marginTop: 1 }}>TERMINAL · REDESIGN</div>
          </div>
        </div>

        {/* Surface nav */}
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {SURFACES.map(s => (
            <button key={s.k} onClick={() => setSurface(s.k)} style={{
              padding: "8px 14px",
              background: surface === s.k ? s.accent + "18" : "transparent",
              border: "none",
              borderBottom: `2px solid ${surface === s.k ? s.accent : "transparent"}`,
              color: surface === s.k ? s.accent : T.tm,
              fontSize: 10, letterSpacing: "0.15em", fontWeight: 600,
              fontFamily: T.mono, cursor: "pointer",
            }}>
              {s.label}
              <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 10 }}>[{s.key}]</span>
            </button>
          ))}
        </div>

        {/* Status strip */}
        <div style={{
          display: "flex", gap: 14, alignItems: "center",
          fontSize: 10, fontFamily: T.mono, color: T.tm,
          letterSpacing: "0.1em", flexWrap: "wrap", justifyContent: "flex-end",
        }}>
          {p1Count > 0 && (
            <span style={{ color: T.red, fontWeight: 600 }}>
              ● P1·{p1Count}
            </span>
          )}
          {vix != null && (
            <span style={{ color: T.post }}>VIX {vix.toFixed(2)}</span>
          )}
          {band && (
            <span style={{ color: T.ts }}>{band.sentiment.toUpperCase()}</span>
          )}
          <span style={{ color: T.t1 }}>{time}</span>
          <a href="/" style={{
            background: "transparent", border: `1px solid ${T.bd}`,
            color: T.tm, padding: "4px 8px", fontSize: 10, borderRadius: T.rSm,
            cursor: "pointer", fontFamily: T.mono, lineHeight: 1, textDecoration: "none",
          }}>← CURRENT</a>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  const cmds = [
    { k: "F", label: "Focus" },
    { k: "E", label: "Explore" },
    { k: "R", label: "Review" },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      borderTop: `1px solid ${T.bd}`,
      background: T.deep + "f0",
      padding: "6px 24px",
      display: "flex", justifyContent: "space-between",
      fontSize: 10, color: T.tf, letterSpacing: "0.15em", fontFamily: T.mono,
      zIndex: 10,
    }}>
      <div>▸ WHEEL OS TERMINAL · REDESIGN PREVIEW</div>
      <div style={{ display: "flex", gap: 18 }}>
        {cmds.map((c, i) => (
          <span key={i}><span style={{ color: T.tm }}>{c.k}</span> {c.label}</span>
        ))}
      </div>
    </div>
  );
}

function PlaceholderSurface({ label, color, note }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: 400, gap: 12,
    }}>
      <div style={{ fontSize: 10, color, letterSpacing: "0.2em", fontWeight: 600 }}>▸ {label}</div>
      <div style={{ fontSize: T.md, color: T.t1 }}>Coming soon</div>
      <div style={{ fontSize: T.sm, color: T.ts }}>{note}</div>
    </div>
  );
}
