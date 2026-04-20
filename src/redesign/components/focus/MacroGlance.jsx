import { T } from "../../theme.js";
import { Frame } from "../../primitives.jsx";

export function MacroGlance({ marketContext }) {
  const signals = buildSignals(marketContext);
  const score   = marketContext?.posture_score ?? marketContext?.score ?? null;
  const label   = marketContext?.posture_label ?? marketContext?.label ?? null;

  return (
    <Frame
      accent="quiet"
      title="MACRO"
      subtitle={`${signals.length} signals`}
      right={
        score != null ? (
          <span style={{ fontSize: T.xs, color: T.green, letterSpacing: "0.1em" }}>
            SCORE {score.toFixed(1)}/5 ▸ {(label || "").toUpperCase()}
          </span>
        ) : null
      }
    >
      {signals.length === 0 ? (
        <div style={{ fontSize: T.sm, color: T.ts, fontStyle: "italic", padding: "8px 0" }}>
          No macro signals — check /api/macro
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: T.bd, border: `1px solid ${T.bd}` }}>
          {signals.map((s, i) => <MacroCell key={i} {...s} />)}
        </div>
      )}
    </Frame>
  );
}

function MacroCell({ k, v, strength, tag, delta }) {
  return (
    <div style={{ padding: "8px 11px", background: T.surf }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: T.xs, letterSpacing: "0.15em", color: T.tm }}>{k.toUpperCase()}</span>
        <span style={{ fontSize: T.xs, color: strength >= 4 ? T.green : strength === 3 ? T.amber : T.red, letterSpacing: "0.05em" }}>
          {"●".repeat(strength)}{"○".repeat(5 - strength)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 3, gap: 6 }}>
        <span style={{ fontSize: 15, color: T.t1, fontFamily: T.mono, fontWeight: 500, letterSpacing: "-0.02em" }}>{v}</span>
        <span style={{ fontSize: T.xs, color: T.ts, textAlign: "right" }}>{tag}</span>
      </div>
      {delta && <div style={{ fontSize: T.xs, color: T.tf, marginTop: 1, fontFamily: T.mono }}>{delta}</div>}
    </div>
  );
}

// Map the marketContext shape from the API/dev fixture into display signals
function buildSignals(ctx) {
  if (!ctx) return [];
  const sigs = [];

  // VIX
  if (ctx.vix != null) sigs.push({
    k: "VIX", v: ctx.vix.toFixed(2),
    strength: vixStrength(ctx.vix),
    tag: ctx.posture_label || "",
    delta: ctx.vix_trend_5d ? trendDelta(ctx.vix_trend_5d) : "",
  });

  // macroEvents → CPI, FOMC, etc.
  const evtsByType = {};
  for (const e of (ctx.macroEvents || [])) {
    if (!evtsByType[e.eventType]) evtsByType[e.eventType] = e;
  }

  if (evtsByType.FOMC_RATE_DECISION) {
    const e = evtsByType.FOMC_RATE_DECISION;
    sigs.push({ k: "FOMC", v: e.actual ?? e.forecast ?? "—", strength: 3, tag: "Rate Decision", delta: e.dateTime ? e.dateTime.slice(0, 10) : "" });
  }
  if (evtsByType.CPI) {
    const e = evtsByType.CPI;
    sigs.push({ k: "CPI", v: e.actual != null ? `${e.actual}%` : e.forecast != null ? `${e.forecast}%` : "—", strength: 3, tag: e.actual != null ? "Actual" : "Forecast", delta: e.dateTime ? e.dateTime.slice(0, 10) : "" });
  }

  // Fear & Greed, breadth from context if present
  if (ctx.fear_greed != null) sigs.push({ k: "Fear & Greed", v: String(ctx.fear_greed), strength: fearGreedStrength(ctx.fear_greed), tag: fearGreedTag(ctx.fear_greed), delta: "" });
  if (ctx.s5fi != null)       sigs.push({ k: "S5FI Breadth", v: `${ctx.s5fi}%`, strength: ctx.s5fi >= 60 ? 4 : ctx.s5fi >= 40 ? 3 : 2, tag: "Breadth", delta: "" });

  return sigs;
}

function vixStrength(v) {
  if (v <= 15) return 2;
  if (v <= 20) return 4;
  if (v <= 25) return 4;
  if (v <= 30) return 3;
  return 3;
}
function fearGreedStrength(v) {
  if (v >= 60) return 4;
  if (v >= 45) return 3;
  if (v >= 30) return 3;
  return 2;
}
function fearGreedTag(v) {
  if (v >= 75) return "Extreme Greed";
  if (v >= 60) return "Greed";
  if (v >= 45) return "Neutral";
  if (v >= 25) return "Fear";
  return "Extreme Fear";
}
function trendDelta(trend) {
  if (!trend || trend.length < 2) return "";
  const diff = (trend[trend.length - 1] - trend[0]).toFixed(2);
  return `${diff > 0 ? "↑" : "↓"}${Math.abs(diff)} 5d`;
}
