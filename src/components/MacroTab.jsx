import { useState } from "react";
import { theme } from "../lib/theme";
import { useMacro } from "../hooks/useMacro";
import { useWindowWidth } from "../hooks/useWindowWidth";

// Intentional hardcoded hex — semantic data colors (same pattern as TYPE_COLORS)
const POSTURE_COLORS = {
  BULLISH:      { text: "#3fb950", bg: "#0d1f0d" },
  CONSTRUCTIVE: { text: "#3fb950", bg: "#0d1f0d" },
  NEUTRAL:      { text: "#e3b341", bg: "#1f1a0d" },
  DEFENSIVE:    { text: "#e3b341", bg: "#1f1a0d" },
  BEARISH:      { text: "#f85149", bg: "#1f0d0d" },
};

const COLOR_MAP = {
  green: theme.green,
  amber: theme.amber,
  red:   theme.red,
};

// Intentional hardcoded hex — arrow colors for rate direction indicator
const ARROW_COLORS = {
  "↑": "#3fb950",   // dovish = green
  "↓": "#f85149",   // hawkish = red
  "↔": "#8b949e",   // unchanged = gray
};

function buildDirectionExplanation(weeklyChangeBps) {
  if (weeklyChangeBps == null) return "";
  const absBps = Math.abs(weeklyChangeBps);
  if (weeklyChangeBps < -5) {
    return `\n\nOver the past week, the bond market has shifted toward expecting ${absBps} basis points more in rate cuts — a dovish move. This typically happens when economic data disappoints, inflation cools, or risk-off sentiment drives demand for safe assets. More cuts priced in generally supports risk assets and benefits the wheel strategy.`;
  }
  if (weeklyChangeBps > 5) {
    return `\n\nOver the past week, the bond market has shifted toward expecting ${absBps} basis points fewer rate cuts — a hawkish move. This typically happens when economic data comes in strong, inflation stays sticky, or the Fed signals a "higher for longer" stance. Fewer cuts priced in can pressure growth stocks and reduce the tailwind for the wheel strategy.`;
  }
  return `\n\nRate expectations have been stable this week (${weeklyChangeBps > 0 ? "+" : ""}${weeklyChangeBps} bps), suggesting the bond market sees no new information that materially changes the rate outlook. Watch for FOMC commentary, CPI, or jobs data that could shift this.`;
}

function ScoreDots({ score, max = 5, color }) {
  const resolved = COLOR_MAP[color] ?? theme.text.muted;
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {Array.from({ length: max }, (_, i) => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%",
          background: i < score ? resolved : theme.border.default,
        }} />
      ))}
    </div>
  );
}

function SignalCard({ name, value, label, color, direction, score, explanation, children, labelSuffix }) {
  const [expanded, setExpanded] = useState(true);
  const resolved = COLOR_MAP[color] ?? theme.text.muted;

  return (
    <div style={{
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      padding: theme.space[4],
      display: "flex",
      flexDirection: "column",
      gap: theme.space[2],
    }}>
      {/* Header row: name + score dots + toggle (dots always near top) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          fontSize: theme.size.xs,
          color: theme.text.subtle,
          fontFamily: theme.font.mono,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}>{name}</span>
        <ScoreDots score={score} color={color} />
      </div>

      {/* Value row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{
          fontSize: theme.size.xl,
          color: theme.text.primary,
          fontFamily: theme.font.mono,
          fontWeight: 600,
        }}>{value ?? "—"}</span>
        <span style={{
          fontSize: theme.size.sm,
          color: resolved,
          fontFamily: theme.font.mono,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {label ?? "—"}
          {labelSuffix}
        </span>
      </div>

      {/* Direction */}
      {direction && (
        <div style={{
          fontSize: theme.size.xs,
          color: theme.text.muted,
          fontFamily: theme.font.mono,
        }}>{direction}</div>
      )}

      {/* Extra content */}
      {children}

      {/* Explanation toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          color: theme.text.subtle,
          fontSize: theme.size.xs,
          fontFamily: theme.font.mono,
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
          alignSelf: "flex-start",
        }}
      >
        {expanded ? "▴" : "▾"} Why this matters
      </button>

      {/* Explanation */}
      {expanded && explanation && (
        <div style={{
          fontSize: theme.size.sm,
          color: theme.text.muted,
          fontFamily: theme.font.mono,
          lineHeight: 1.5,
          borderTop: `1px solid ${theme.border.default}`,
          paddingTop: theme.space[2],
        }}>{explanation}</div>
      )}
    </div>
  );
}

// Intentional hardcoded hex — group/legend chrome colors (same role as POSTURE_COLORS)
function SignalGroup({ label, children }) {
  return (
    <div style={{
      border: "1px solid #30363d",
      borderRadius: theme.radius.md,
      padding: theme.space[4],
    }}>
      <div style={{
        fontSize: theme.size.xs,
        fontWeight: 600,
        letterSpacing: "0.8px",
        textTransform: "uppercase",
        color: "#6e7681",
        marginBottom: theme.space[3],
      }}>{label}</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: theme.space[3],
      }}>
        {children}
      </div>
    </div>
  );
}

const RELATIONSHIPS = [
  { emoji: "🛢", text: "Oil rising → rate cuts less likely → hawkish pressure on Rate Expectations" },
  { emoji: "📈", text: "10-yr yield rising → growth stocks pressured → watch SPY vs ATH for confirmation" },
  { emoji: "⚠️", text: "VIX & Fear/Greed usually move together — divergence between them is a warning signal" },
];

function RelationshipLegend() {
  return (
    <div style={{
      padding: `${theme.space[3]}px ${theme.space[4]}px`,
      background: "#161b22",
      border: "1px solid #21262d",
      borderRadius: theme.radius.sm,
    }}>
      <div style={{
        fontSize: theme.size.xs,
        fontWeight: 600,
        letterSpacing: "0.8px",
        textTransform: "uppercase",
        color: "#6e7681",
        marginBottom: theme.space[2],
      }}>Signal Relationships</div>
      {RELATIONSHIPS.map((r, i) => (
        <div key={i} style={{
          display: "flex",
          gap: theme.space[2],
          marginBottom: i < RELATIONSHIPS.length - 1 ? theme.space[2] : 0,
          fontSize: theme.size.sm,
          color: "#8b949e",
          lineHeight: 1.5,
        }}>
          <span style={{ flexShrink: 0 }}>{r.emoji}</span>
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

export function MacroTab() {
  const { data, loading, error, refresh } = useMacro();
  const width = useWindowWidth();
  const isMobile = width < 768;

  if (loading) {
    return (
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "center",
        minHeight: 200, color: theme.text.muted, fontFamily: theme.font.mono,
        fontSize: theme.size.md,
      }}>
        Loading macro signals...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: "center", minHeight: 200, gap: theme.space[3],
      }}>
        <span style={{ color: theme.red, fontFamily: theme.font.mono, fontSize: theme.size.md }}>
          {error}
        </span>
        <button
          onClick={refresh}
          style={{
            background: theme.bg.elevated,
            border: `1px solid ${theme.border.strong}`,
            borderRadius: theme.radius.sm,
            color: theme.text.secondary,
            fontFamily: theme.font.mono,
            fontSize: theme.size.sm,
            padding: `${theme.space[2]}px ${theme.space[4]}px`,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { posture, signals, as_of } = data;
  const postureColors = POSTURE_COLORS[posture?.posture] ?? POSTURE_COLORS.NEUTRAL;
  const asOfDate = as_of ? new Date(as_of) : null;
  const isStale = asOfDate ? (Date.now() - asOfDate.getTime()) > 3 * 60 * 60 * 1000 : false;
  const formattedDate = asOfDate
    ? asOfDate.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

  const { vix, s5fi, fearGreed, fedWatch, spyVsAth, crudeOil, tenYearYield } = signals ?? {};

  const vixDirection = vix?.change != null
    ? `${vix.change >= 0 ? "▲" : "▼"} ${vix.change >= 0 ? "+" : ""}${vix.change.toFixed(1)} today`
    : null;

  const childStyle = {
    fontSize: theme.size.xs,
    color: theme.text.muted,
    fontFamily: theme.font.mono,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.space[4] }}>
      {/* ── Posture Header ──────────────────────────────────── */}
      <div style={{
        background: postureColors.bg,
        border: `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.md,
        padding: theme.space[4],
        display: "flex",
        flexDirection: "column",
        gap: theme.space[2],
      }}>
        {/* Top row: label + as-of + refresh */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: theme.space[2] }}>
          <span style={{
            fontSize: theme.size.xs,
            color: theme.text.subtle,
            fontFamily: theme.font.mono,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}>MACRO OUTLOOK</span>
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
            {isStale && (
              <span style={{
                fontSize: theme.size.xs,
                color: theme.amber,
                fontFamily: theme.font.mono,
              }}>Data may be stale</span>
            )}
            <span style={{
              fontSize: theme.size.xs,
              color: theme.text.muted,
              fontFamily: theme.font.mono,
            }}>as of {formattedDate}</span>
            <button
              onClick={refresh}
              style={{
                background: theme.bg.elevated,
                border: `1px solid ${theme.border.strong}`,
                borderRadius: theme.radius.sm,
                color: theme.text.secondary,
                fontFamily: theme.font.mono,
                fontSize: theme.size.xs,
                padding: `${theme.space[1]}px ${theme.space[2]}px`,
                cursor: "pointer",
              }}
            >↻ Refresh</button>
          </div>
        </div>

        {/* Posture + score */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{
            fontSize: 28,
            fontWeight: 700,
            color: postureColors.text,
            fontFamily: theme.font.mono,
            letterSpacing: 1,
          }}>{posture?.posture ?? "—"}</span>
          <span style={{
            fontSize: theme.size.md,
            color: theme.text.secondary,
            fontFamily: theme.font.mono,
          }}>Score: {posture?.avg?.toFixed(1) ?? "—"} / 5.0</span>
        </div>

        {/* Deployment guidance */}
        {posture?.deploymentGuidance && (
          <div style={{
            fontSize: theme.size.sm,
            color: theme.text.muted,
            fontFamily: theme.font.mono,
            lineHeight: 1.5,
          }}>{posture.deploymentGuidance}</div>
        )}
      </div>

      {/* ── Rate Environment group ──────────────────────────── */}
      <SignalGroup label="Rate Environment">
        {/* Crude Oil */}
        <SignalCard
          name="CRUDE OIL (WTI)"
          value={crudeOil?.price != null ? `$${crudeOil.price.toFixed(2)}` : null}
          label={crudeOil?.label}
          color={crudeOil?.color}
          direction={crudeOil?.change != null
            ? `${crudeOil.change >= 0 ? "▲" : "▼"} ${crudeOil.change >= 0 ? "+" : ""}$${crudeOil.change.toFixed(2)} (${(crudeOil.changePct * 100).toFixed(1)}%) today`
            : null}
          score={crudeOil?.score}
          explanation={crudeOil?.explanation}
        />

        {/* FedWatch / Rate Expectations */}
        <SignalCard
          name="Rate Expectations"
          value={fedWatch?.cutsPricedIn != null ? `${fedWatch.cutsPricedIn.toFixed(1)} cuts` : null}
          label={fedWatch?.label}
          color={fedWatch?.color}
          direction={fedWatch?.directionLabel ? `${fedWatch.directionArrow} ${fedWatch.directionLabel}${fedWatch.weeklyChangeBps != null ? ` (${fedWatch.weeklyChangeBps > 0 ? "+" : ""}${fedWatch.weeklyChangeBps} bps vs last week)` : ""}` : null}
          score={fedWatch?.score}
          explanation={(fedWatch?.explanation ?? "") + buildDirectionExplanation(fedWatch?.weeklyChangeBps)}
          labelSuffix={fedWatch?.directionArrow && fedWatch.directionArrow !== "—" ? (
            <span style={{ color: ARROW_COLORS[fedWatch.directionArrow] ?? theme.text.muted }}>{fedWatch.directionArrow}</span>
          ) : null}
        >
          {fedWatch && (
            <>
              <div style={childStyle}>
                Dec 2026 implied: {fedWatch.endOfYearImplied?.toFixed(3) ?? "—"}% (current: {fedWatch.currentRate?.toFixed(3) ?? "—"}%)
              </div>
              {fedWatch.nextMeetingDate && (
                <div style={childStyle}>
                  Next FOMC: {new Date(fedWatch.nextMeetingDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {fedWatch.probCut != null ? ` — ${fedWatch.probCut.toFixed(0)}% probability of cut` : ""}
                </div>
              )}
              {fedWatch.threshold55Met && (
                <div style={{
                  marginTop: theme.space[2],
                  padding: `${theme.space[2]}px ${theme.space[3]}px`,
                  background: "#1c2d1c",
                  border: "1px solid #238636",
                  borderRadius: theme.radius.sm,
                  fontSize: theme.size.xs,
                  color: "#3fb950",
                  fontFamily: theme.font.mono,
                  lineHeight: 1.5,
                }}>
                  ⚡ 55% Rule: ACTIVE — {fedWatch.probCut.toFixed(0)}% cut probability with {fedWatch.daysToNextMeeting} day{fedWatch.daysToNextMeeting === 1 ? "" : "s"} to FOMC. Historically predicted a cut with 100% accuracy since 1998.
                </div>
              )}
            </>
          )}
        </SignalCard>

        {/* 10-Year Yield */}
        <SignalCard
          name="10-YEAR YIELD"
          value={tenYearYield?.yield != null ? `${tenYearYield.yield.toFixed(2)}%` : null}
          label={tenYearYield?.label}
          color={tenYearYield?.color}
          direction={tenYearYield?.change != null
            ? `${tenYearYield.change >= 0 ? "▲" : "▼"} ${tenYearYield.change >= 0 ? "+" : ""}${Math.round(tenYearYield.change * 100)} bps today`
            : null}
          score={tenYearYield?.score}
          explanation={tenYearYield?.explanation}
        >
          {tenYearYield?.fiftyTwoWeekLow != null && (
            <div style={childStyle}>
              52w: {tenYearYield.fiftyTwoWeekLow.toFixed(2)}% – {tenYearYield.fiftyTwoWeekHigh.toFixed(2)}%
            </div>
          )}
        </SignalCard>
      </SignalGroup>

      {/* ── Market Sentiment group ───────────────────────────── */}
      <SignalGroup label="Market Sentiment">
        {/* VIX */}
        <SignalCard
          name="VIX"
          value={vix?.value?.toFixed(2)}
          label={vix?.label}
          color={vix?.color}
          direction={vixDirection}
          score={vix?.score}
          explanation={vix?.explanation}
        >
          {vix?.cashTarget && (
            <div style={childStyle}>Cash target: {vix.cashTarget}</div>
          )}
        </SignalCard>

        {/* Fear & Greed */}
        <SignalCard
          name="Fear & Greed"
          value={fearGreed?.value?.toFixed(1)}
          label={fearGreed?.label}
          color={fearGreed?.color}
          score={fearGreed?.score}
          explanation={fearGreed?.explanation}
        >
          {fearGreed && (
            <div style={childStyle}>
              1w: {fearGreed.prev1w?.toFixed(1) ?? "—"} · 1m: {fearGreed.prev1m?.toFixed(1) ?? "—"}
            </div>
          )}
        </SignalCard>

        {/* S5FI */}
        <SignalCard
          name="S5FI"
          value={s5fi?.value != null ? `${s5fi.value.toFixed(0)}%` : null}
          label={s5fi?.label}
          color={s5fi?.color}
          direction="Daily close"
          score={s5fi?.score}
          explanation={s5fi?.explanation}
        />

        {/* SPY vs ATH */}
        <SignalCard
          name="SPY vs ATH"
          value={spyVsAth?.pctFromHigh != null ? `${(spyVsAth.pctFromHigh * 100).toFixed(1)}%` : null}
          label={spyVsAth?.label}
          color={spyVsAth?.color}
          score={spyVsAth?.score}
          explanation={spyVsAth?.explanation}
        >
          {spyVsAth && (
            <div style={childStyle}>
              ${spyVsAth.value?.toFixed(2) ?? "—"} / ${spyVsAth.high?.toFixed(2) ?? "—"} high
            </div>
          )}
        </SignalCard>
      </SignalGroup>

      {/* ── Signal Relationships legend ──────────────────────── */}
      <RelationshipLegend />
    </div>
  );
}
