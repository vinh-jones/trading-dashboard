import { T } from "../../theme.js";
import { Frame, Datum } from "../../primitives.jsx";

// Fallback flat-60% pipeline estimate — used when v2 forecast fields aren't
// present on the account yet (e.g. dev with no snapshot, or pre-v2 data).
function flatPipelineEstimate(positions) {
  const openCSPs = positions?.open_csps ?? [];
  const openCCs  = (positions?.assigned_shares ?? [])
    .filter(s => s.active_cc).map(s => s.active_cc);
  const gross = [...openCSPs, ...openCCs].reduce((s, p) => s + (p.premium_collected || 0), 0);
  return Math.round(gross * 0.60);
}

function fmtK(n, digits = 1) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return `$${Math.round(n)}`;
  return `$${(n / 1000).toFixed(digits)}k`;
}

function emitGoto(surface, mode) {
  window.dispatchEvent(new CustomEvent("tw-goto", { detail: { surface, mode } }));
}

export function PipelineGauge({ account, positions }) {
  const mtd     = account?.month_to_date_premium ?? 0;
  const base    = account?.monthly_targets?.baseline ?? 15000;
  const stretch = account?.monthly_targets?.stretch  ?? 25000;

  const fc = account?.forecast ?? null;
  const thisMonthRemaining = fc?.this_month_remaining ?? flatPipelineEstimate(positions);
  const monthTotal         = fc?.month_total          ?? mtd + thisMonthRemaining;
  const targetGap          = fc?.target_gap          ?? (base - monthTotal);
  const forwardPipeline    = fc?.forward_pipeline_premium ?? null;
  const cspPipe            = fc?.csp_pipeline_premium     ?? null;
  const ccPipe             = fc?.cc_pipeline_premium      ?? null;
  const belowCostCc        = fc?.below_cost_cc_premium    ?? 0;
  const phase              = fc?.pipeline_phase           ?? null;

  const captured = Math.min(mtd / stretch, 1) * 100;
  const pipeW    = Math.min((thisMonthRemaining / stretch) * 100, 100 - captured);
  const baseAt   = (base / stretch) * 100;
  const gapToBase = Math.max(0, base - mtd - thisMonthRemaining);

  // CSP/CC split ratio for the Pipeline Health block
  const pipeTotal = (cspPipe ?? 0) + (ccPipe ?? 0);
  const cspPct = pipeTotal > 0 ? Math.round((cspPipe / pipeTotal) * 100) : null;
  const ccPct  = pipeTotal > 0 ? 100 - cspPct : null;

  const phaseLabel = phase
    ? phase.charAt(0).toUpperCase() + phase.slice(1)
    : "—";
  const phaseColor = phase === "flexible" ? T.green
                   : phase === "constraint" ? T.amber
                   : phase === "mixed" ? T.blue
                   : T.tm;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Frame accent="quiet" title={`${monthName()} INCOME`} subtitle="realized + expected vs target">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 30, color: T.t1, fontWeight: 300, fontFamily: T.mono, letterSpacing: "-0.03em" }}>
            {fmtK(monthTotal, 2).replace(/^\$/, "$")}
          </span>
          <span style={{ fontSize: T.sm, color: T.tm }}>
            forecast · ${(base / 1000).toFixed(0)}k target
          </span>
        </div>

        {/* Progress bar: captured + remaining-this-month (hatched) */}
        <div style={{ position: "relative", height: 28, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
          <div style={{
            position: "absolute", top: 0, bottom: 0, left: 0,
            width: `${captured}%`,
            background: `linear-gradient(90deg, ${T.green} 0%, ${T.green}cc 100%)`,
          }} />
          <div style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${captured}%`, width: `${pipeW}%`,
            backgroundImage: `repeating-linear-gradient(45deg, ${T.green}44 0 4px, transparent 4px 8px)`,
            borderLeft: `1px solid ${T.green}88`,
          }} />
          <div style={{
            position: "absolute", top: -4, bottom: -4,
            left: `${baseAt}%`, width: 1, background: T.amber,
          }}>
            <div style={{ position: "absolute", top: -10, left: -16, fontSize: 9, color: T.amber, letterSpacing: "0.1em" }}>
              BASE
            </div>
          </div>
          <div style={{
            position: "absolute", top: -4, bottom: -4, right: 0, width: 1, background: T.t1,
          }}>
            <div style={{ position: "absolute", top: -10, right: 0, fontSize: 9, color: T.t1, letterSpacing: "0.1em" }}>
              MAX
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginTop: 16 }}>
          <Datum label="REALIZED" value={fmtK(mtd)}                color={T.green} size={T.md} />
          <Datum label="EXPECTED" value={fmtK(thisMonthRemaining)} size={T.md} />
          <Datum label="FORECAST" value={fmtK(monthTotal)}         size={T.md} />
          <Datum
            label="VS TARGET"
            value={targetGap > 0 ? `↓ ${fmtK(targetGap)}` : targetGap < 0 ? `↑ ${fmtK(-targetGap)}` : "MET ✓"}
            color={targetGap > 0 ? T.amber : T.green}
            size={T.md}
          />
        </div>
      </Frame>

      <Frame
        accent="quiet"
        title="PIPELINE HEALTH"
        subtitle={fc ? "v2 forecast · open positions" : "flat-60% estimate"}
        right={
          <button
            onClick={() => emitGoto("review", "pipeline")}
            style={{
              background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
              padding: "4px 10px", fontSize: 10, letterSpacing: "0.12em",
              fontFamily: T.mono, borderRadius: T.rSm, cursor: "pointer",
            }}
            title="Open pipeline detail"
          >
            DETAIL →
          </button>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Datum
            label="FORWARD PREM"
            value={fmtK(forwardPipeline ?? thisMonthRemaining)}
            size={T.md}
          />
          <Datum
            label="CSP / CC"
            value={cspPct != null ? `${cspPct}/${ccPct}%` : "—"}
            size={T.md}
          />
          <Datum
            label="PHASE"
            value={phaseLabel}
            color={phaseColor}
            size={T.md}
          />
        </div>

        {belowCostCc > 0 && (
          <div style={{
            marginTop: 12, padding: "6px 10px",
            background: T.amber + "12",
            border: `1px solid ${T.amber}44`,
            borderRadius: T.rSm,
            fontSize: T.xs, color: T.amber, letterSpacing: "0.08em",
          }}>
            ▲ BELOW-COST CC EXPOSURE · {fmtK(belowCostCc)} at negative capture risk
          </div>
        )}
      </Frame>
    </div>
  );
}

function monthName() {
  return new Date().toLocaleDateString("en-US", { month: "long" }).toUpperCase();
}
