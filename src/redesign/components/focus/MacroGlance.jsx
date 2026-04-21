import { T } from "../../theme.js";
import { Frame } from "../../primitives.jsx";

// Accepts macroData from /api/macro (preferred) and falls back to marketContext
// shape for signals that only come from the Supabase focus-context snapshot.
export function MacroGlance({ macroData, marketContext }) {
  const signals = buildSignals(macroData, marketContext);
  const posture = macroData?.posture ?? null;
  const score   = posture?.avg ?? null;
  const label   = posture?.posture ?? null;

  return (
    <Frame
      accent="quiet"
      title="MACRO"
      subtitle={`${signals.length} signals${label ? ` · ${label.toLowerCase()}` : ""}`}
      right={
        score != null ? (
          <span style={{ fontSize: T.xs, color: scoreColor(score), letterSpacing: "0.1em", fontFamily: T.mono }}>
            {score.toFixed(1)}/5 ▸ {(label || "").toUpperCase()}
          </span>
        ) : null
      }
    >
      {signals.length === 0 ? (
        <div style={{ fontSize: T.sm, color: T.ts, fontFamily: T.mono, padding: "8px 0" }}>
          Loading macro signals…
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: T.bd, border: `1px solid ${T.bd}` }}>
          {signals.map((s, i) => <MacroCell key={i} {...s} />)}
        </div>
      )}
      {posture?.deploymentGuidance && (
        <div style={{
          marginTop: 10, padding: "8px 10px",
          background: T.bg, border: `1px solid ${T.bd}`,
          fontSize: T.xs, color: T.tm, fontFamily: T.mono, lineHeight: 1.5,
        }}>
          {posture.deploymentGuidance}
        </div>
      )}
    </Frame>
  );
}

function MacroCell({ k, v, score, tag, delta, color }) {
  const dotColor = color === "green" ? T.green : color === "red" ? T.red : T.amber;
  return (
    <div style={{ padding: "8px 11px", background: T.surf }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: T.xs, letterSpacing: "0.15em", color: T.tm, fontFamily: T.mono }}>{k.toUpperCase()}</span>
        {score != null && (
          <span style={{ fontSize: T.xs, color: dotColor, letterSpacing: "0.05em", fontFamily: T.mono }}>
            {"●".repeat(score)}{"○".repeat(5 - score)}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 3, gap: 6 }}>
        <span style={{ fontSize: 15, color: T.t1, fontFamily: T.mono, fontWeight: 500, letterSpacing: "-0.02em" }}>{v}</span>
        <span style={{ fontSize: T.xs, color: dotColor, textAlign: "right", fontFamily: T.mono }}>{tag}</span>
      </div>
      {delta && (
        <div style={{ fontSize: T.xs, color: T.tf, marginTop: 1, fontFamily: T.mono }}>{delta}</div>
      )}
    </div>
  );
}

function scoreColor(avg) {
  if (avg >= 4.0) return T.green;
  if (avg >= 2.6) return T.amber;
  return T.red;
}

// Build signal cells from /api/macro data (preferred) + marketContext fallback
function buildSignals(macro, ctx) {
  if (macro?.signals) return buildFromMacro(macro, ctx);
  if (ctx) return buildFromContext(ctx);
  return [];
}

function buildFromMacro(macro, ctx) {
  const { signals } = macro;
  const rows = [];

  // VIX
  if (signals.vix) {
    const { value, score, label, vixTrend } = signals.vix;
    rows.push({
      k: "VIX", v: value?.toFixed(2) ?? "—", score, tag: label,
      delta: vixTrend ? `${vixTrend.direction} ${vixTrend.changePts > 0 ? "+" : ""}${vixTrend.changePts?.toFixed(2)} 5d` : "",
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // Fear & Greed
  if (signals.fearGreed) {
    const { value, score, label } = signals.fearGreed;
    rows.push({
      k: "Fear & Greed", v: String(value ?? "—"), score, tag: label,
      delta: signals.fearGreed.prev1w != null ? `1w ago: ${signals.fearGreed.prev1w}` : "",
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // S5FI Breadth
  if (signals.s5fi) {
    const { value, score, label } = signals.s5fi;
    rows.push({
      k: "S5FI Breadth", v: `${value ?? "—"}%`, score, tag: label, delta: "",
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // SPY vs ATH
  if (signals.spyVsAth) {
    const { pctFromHigh, score, label } = signals.spyVsAth;
    rows.push({
      k: "SPY vs ATH", v: pctFromHigh != null ? `${pctFromHigh.toFixed(1)}%` : "—",
      score, tag: label, delta: "",
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // Fed Watch
  if (signals.fedWatch) {
    const { cutsPricedIn, score, label, directionLabel, nextMeetingDate } = signals.fedWatch;
    rows.push({
      k: "FedWatch", v: cutsPricedIn != null ? `${cutsPricedIn} cuts` : "—",
      score, tag: label,
      delta: nextMeetingDate ? `next: ${nextMeetingDate.slice(0, 10)}` : (directionLabel || ""),
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // 10-Year Yield
  if (signals.tenYearYield) {
    const { yield: yld, score, label } = signals.tenYearYield;
    rows.push({
      k: "10Y Yield", v: yld != null ? `${yld.toFixed(2)}%` : "—",
      score, tag: label, delta: "",
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // Crude Oil
  if (signals.crudeOil) {
    const { price, score, label } = signals.crudeOil;
    rows.push({
      k: "Crude Oil", v: price != null ? `$${price.toFixed(1)}` : "—",
      score, tag: label, delta: "",
      color: score >= 4 ? "green" : score >= 3 ? "amber" : "red",
    });
  }

  // Supplement with earnings events from marketContext calendar
  const evtsByType = {};
  for (const e of (ctx?.macroEvents || [])) {
    if (!evtsByType[e.eventType]) evtsByType[e.eventType] = e;
  }
  if (evtsByType.CPI) {
    const e = evtsByType.CPI;
    rows.push({
      k: "CPI", v: e.actual != null ? `${e.actual}%` : e.forecast != null ? `~${e.forecast}%` : "—",
      score: null, tag: e.actual != null ? "Actual" : "Forecast",
      delta: e.dateTime ? e.dateTime.slice(0, 10) : "",
      color: "amber",
    });
  }
  if (evtsByType.FOMC_RATE_DECISION) {
    const e = evtsByType.FOMC_RATE_DECISION;
    rows.push({
      k: "FOMC", v: e.actual ?? e.forecast ?? "—",
      score: null, tag: "Rate Decision",
      delta: e.dateTime ? e.dateTime.slice(0, 10) : "",
      color: "amber",
    });
  }

  return rows;
}

function buildFromContext(ctx) {
  const sigs = [];
  if (ctx.vix != null) sigs.push({
    k: "VIX", v: ctx.vix.toFixed(2),
    score: vixScore(ctx.vix),
    tag: ctx.posture_label || "",
    delta: ctx.vix_trend_5d ? trendDelta(ctx.vix_trend_5d) : "",
    color: "amber",
  });
  if (ctx.fear_greed != null) sigs.push({
    k: "Fear & Greed", v: String(ctx.fear_greed),
    score: fearGreedScore(ctx.fear_greed),
    tag: fearGreedTag(ctx.fear_greed), delta: "", color: "amber",
  });
  if (ctx.s5fi != null) sigs.push({
    k: "S5FI Breadth", v: `${ctx.s5fi}%`,
    score: ctx.s5fi >= 60 ? 4 : ctx.s5fi >= 40 ? 3 : 2,
    tag: "Breadth", delta: "", color: "amber",
  });
  const evtsByType = {};
  for (const e of (ctx.macroEvents || [])) if (!evtsByType[e.eventType]) evtsByType[e.eventType] = e;
  if (evtsByType.CPI) {
    const e = evtsByType.CPI;
    sigs.push({ k: "CPI", v: e.actual != null ? `${e.actual}%` : e.forecast != null ? `~${e.forecast}%` : "—", score: null, tag: e.actual != null ? "Actual" : "Forecast", delta: e.dateTime ? e.dateTime.slice(0, 10) : "", color: "amber" });
  }
  if (evtsByType.FOMC_RATE_DECISION) {
    const e = evtsByType.FOMC_RATE_DECISION;
    sigs.push({ k: "FOMC", v: e.actual ?? e.forecast ?? "—", score: null, tag: "Rate Decision", delta: e.dateTime ? e.dateTime.slice(0, 10) : "", color: "amber" });
  }
  return sigs;
}

function vixScore(v) {
  if (v <= 15) return 2;
  if (v <= 20) return 4;
  if (v <= 25) return 4;
  if (v <= 30) return 3;
  return 3;
}
function fearGreedScore(v) {
  if (v >= 60) return 4;
  if (v >= 45) return 3;
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
