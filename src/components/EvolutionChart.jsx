import { useState } from "react";
import { theme } from "../lib/theme";
import { niceTicks } from "../lib/chartTicks";

function labelStyle() {
  return {
    fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
    letterSpacing: "0.5px", fontWeight: 500, marginBottom: 2,
  };
}

// Hand-rolled SVG line, same spirit as the allocation chart — no chart library.
// Y-domain fits the data (0-anchored); hover/tap shows the nearest point.
export function EvolutionChart({ series }) {
  const [activeIdx, setActiveIdx] = useState(null);

  if (!series.length) {
    return (
      <div style={{ padding: theme.space[3], color: theme.text.subtle, fontSize: theme.size.sm }}>
        No history yet — the chart fills in as daily snapshots accumulate.
      </div>
    );
  }

  const W = 600, H = 150, PAD = 10, GUTTER = 40;
  const plotW = W - GUTTER - PAD;
  const ys = series.map(p => p.capturePct);
  const { ticks, domainMin, domainMax } = niceTicks(Math.min(...ys), Math.max(...ys));

  const x = i => series.length === 1 ? GUTTER + plotW / 2 : GUTTER + (i * plotW) / (series.length - 1);
  const y = v => H - PAD - ((v - domainMin) * (H - 2 * PAD)) / (domainMax - domainMin || 1);
  const points = series.map((p, i) => `${x(i)},${y(p.capturePct)}`).join(" ");
  const last = series[series.length - 1];
  const showMaxLine = domainMax >= 100;

  function handlePointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) * W) / rect.width;
    if (series.length === 1) { setActiveIdx(0); return; }
    const idx = Math.round(((svgX - GUTTER) / plotW) * (series.length - 1));
    setActiveIdx(Math.max(0, Math.min(series.length - 1, idx)));
  }

  const active = activeIdx != null ? series[activeIdx] : null;
  const fmtPct = v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const midIdx = Math.floor((series.length - 1) / 2);

  return (
    <div>
      <div style={{ ...labelStyle(), marginBottom: theme.space[1] }}>
        Capture % over time — now {last.capturePct.toFixed(1)}%
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setActiveIdx(null)}
      >
        {ticks.map(t => (
          <g key={t}>
            <line
              x1={GUTTER} x2={W - PAD} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? theme.border.strong : theme.border.default}
              strokeWidth="1"
            />
            <text
              x={GUTTER - 6} y={y(t) + 2.5}
              textAnchor="end"
              style={{ fontSize: 7.5, fill: theme.text.muted, fontFamily: theme.font.mono }}
            >
              {t}%
            </text>
          </g>
        ))}
        {showMaxLine && (
          <line x1={GUTTER} x2={W - PAD} y1={y(100)} y2={y(100)} stroke={theme.border.default} strokeWidth="1" strokeDasharray="4 4" />
        )}
        <polyline points={points} fill="none" stroke={theme.blue} strokeWidth="2" />
        {series.length === 1 && (
          <circle cx={x(0)} cy={y(series[0].capturePct)} r="3" fill={theme.blue} />
        )}
        {active && (
          <g>
            <circle cx={x(activeIdx)} cy={y(active.capturePct)} r="4" fill={theme.blue} stroke={theme.bg.surface} strokeWidth="1.5" />
            <text
              x={x(activeIdx) + (activeIdx < series.length / 2 ? 8 : -8)}
              y={Math.max(y(active.capturePct) - 8, 12)}
              textAnchor={activeIdx < series.length / 2 ? "start" : "end"}
              style={{ fontSize: 9, fill: theme.text.primary, fontFamily: theme.font.mono, fontWeight: 600 }}
            >
              {active.date.slice(5)} · {fmtPct(active.capturePct)}
            </text>
          </g>
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: GUTTER / 6, fontSize: theme.size.xs, color: theme.text.subtle }}>
        <span>{series[0].date}</span>
        {series.length >= 3 && <span>{series[midIdx].date}</span>}
        <span>{last.date}</span>
      </div>
    </div>
  );
}
