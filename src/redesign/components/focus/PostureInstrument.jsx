import { T, getVixBand } from "../../theme.js";
import { Frame, Datum } from "../../primitives.jsx";

const VIX_LADDER = [
  { lbl: "≤12",   s: "Ext Greed",  f: "40", c: "50" },
  { lbl: "12–15", s: "Greed",      f: "30", c: "40" },
  { lbl: "15–20", s: "Slight",     f: "20", c: "25" },
  { lbl: "20–25", s: "Fear",       f: "10", c: "15" },
  { lbl: "25–30", s: "V.Fear",     f: "5",  c: "10" },
  { lbl: "≥30",   s: "Ext Fear",   f: "0",  c: "5"  },
];

function activeLadderIdx(vix) {
  if (vix <= 12)  return 0;
  if (vix <= 15)  return 1;
  if (vix <= 20)  return 2;
  if (vix <= 25)  return 3;
  if (vix <= 30)  return 4;
  return 5;
}

export function PostureInstrument({ account }) {
  const vix = account?.vix_current ?? null;
  const freeCashPct = account?.free_cash_pct_est ?? account?.free_cash_pct ?? null;
  const freeCashDollars = account?.free_cash_est ?? account?.free_cash ?? null;

  if (vix == null) {
    return (
      <Frame accent="posture" title="POSTURE — VIX × FREE CASH" subtitle="loading…" pad={20}>
        <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: T.ts, fontSize: T.sm }}>
          Waiting for account data…
        </div>
      </Frame>
    );
  }

  const band = getVixBand(vix);
  const pct = (freeCashPct ?? 0) * 100;
  const floor = band.floorPct * 100;
  const ceil  = band.ceilingPct * 100;
  const status = pct < floor ? "over" : pct > ceil ? "under" : "ok";
  const statusColor = { ok: T.green, over: T.red, under: T.amber }[status];
  const statusLabel = { ok: "WITHIN BAND", over: "BELOW FLOOR", under: "ABOVE CEILING" }[status];
  const activeIdx = activeLadderIdx(vix);

  // Band instrument geometry — 0–60% cash range
  const range = 60;
  const markerLeft = Math.min(pct / range, 1) * 100;
  const bandLeft   = (floor / range) * 100;
  const bandWidth  = ((ceil - floor) / range) * 100;

  return (
    <Frame
      accent="posture"
      title="POSTURE — VIX × FREE CASH"
      subtitle="contrarian deployment band"
      pad={20}
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, display: "inline-block", animation: "pulse-dot 2s infinite" }} />
          <span style={{ fontSize: T.xs, color: T.ts, letterSpacing: "0.1em" }}>LIVE</span>
        </div>
      }
    >
      {/* Hero line — VIX + Free Cash */}
      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto", gap: 20, alignItems: "baseline", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 52, fontWeight: 300, color: T.t1, letterSpacing: "-0.04em", lineHeight: 1, fontFamily: T.mono }}>
            {vix.toFixed(2)}
            <span style={{ fontSize: T.sm, color: T.tm, letterSpacing: "0.1em", marginLeft: 10, verticalAlign: "middle" }}>VIX</span>
          </div>
          <div style={{ fontSize: T.sm, color: T.post, letterSpacing: "0.15em", marginTop: 6, fontWeight: 500 }}>
            {band.sentiment.toUpperCase()} · {band.label}
          </div>
        </div>
        <div style={{ height: 40, borderLeft: `1px dashed ${T.bd}`, marginLeft: 20 }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 52, fontWeight: 300, color: statusColor, letterSpacing: "-0.04em", lineHeight: 1, fontFamily: T.mono }}>
            {pct.toFixed(1)}
            <span style={{ fontSize: 18, color: statusColor, opacity: 0.6, marginLeft: 2 }}>%</span>
          </div>
          <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.15em", marginTop: 6 }}>
            FREE CASH{freeCashDollars != null ? ` · $${Math.round(freeCashDollars / 1000)}k` : ""}
          </div>
        </div>
      </div>

      {/* Horizontal band instrument */}
      <div style={{ position: "relative", marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: T.xs, color: T.tf, marginBottom: 4, letterSpacing: "0.1em", fontFamily: T.mono }}>
          <span>0%</span><span>15%</span><span>30%</span><span>45%</span><span>60%</span>
        </div>
        <div style={{
          position: "relative", height: 44,
          backgroundImage: `repeating-linear-gradient(90deg, ${T.hair} 0 1px, transparent 1px 20px)`,
          border: `1px solid ${T.bd}`, borderRadius: T.rSm,
        }}>
          {/* Target band */}
          <div style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${bandLeft}%`, width: `${bandWidth}%`,
            background: `linear-gradient(180deg, ${T.post}33 0%, ${T.post}18 100%)`,
            borderLeft: `1px solid ${T.post}`,
            borderRight: `1px solid ${T.post}`,
          }}>
            <div style={{
              position: "absolute", top: -13, left: "50%",
              transform: "translateX(-50%)",
              fontSize: 9, color: T.post, letterSpacing: "0.15em", whiteSpace: "nowrap",
            }}>
              TARGET {floor}–{ceil}%
            </div>
          </div>
          {/* Cash marker */}
          <div style={{
            position: "absolute", top: -4, bottom: -4,
            left: `${markerLeft}%`, width: 2,
            background: statusColor,
            boxShadow: `0 0 10px ${statusColor}`,
          }}>
            <div style={{
              position: "absolute", top: -5, left: "50%",
              transform: "translateX(-50%) rotate(45deg)",
              width: 6, height: 6, background: statusColor,
            }} />
          </div>
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 8, fontSize: T.xs, color: T.ts, letterSpacing: "0.1em", fontFamily: T.mono,
        }}>
          <span>CONTRARIAN · HIGHER VIX → DEPLOY MORE</span>
          <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
        </div>
      </div>

      {/* VIX ladder */}
      <div style={{
        marginTop: 18,
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
        gap: 1, background: T.bd,
        border: `1px solid ${T.bd}`, borderRadius: T.rSm, overflow: "hidden",
      }}>
        {VIX_LADDER.map((b, i) => {
          const active = i === activeIdx;
          return (
            <div key={i} style={{
              background: active ? T.post + "18" : T.bg,
              padding: "7px 6px",
              borderTop: active ? `2px solid ${T.post}` : "2px solid transparent",
            }}>
              <div style={{ fontSize: 9, color: active ? T.post : T.tm, letterSpacing: "0.1em", fontFamily: T.mono, fontWeight: 600 }}>
                VIX {b.lbl}
              </div>
              <div style={{ fontSize: 9, color: active ? T.t1 : T.ts, marginTop: 2 }}>{b.s}</div>
              <div style={{ fontSize: T.sm, color: active ? T.t1 : T.tm, marginTop: 4, fontFamily: T.mono, fontWeight: 500 }}>
                {b.f}–{b.c}%
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
