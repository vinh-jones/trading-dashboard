import { T } from "../../theme.js";
import { Frame, Datum } from "../../primitives.jsx";

export function PipelineGauge({ account }) {
  const mtd      = account?.mtd_premium ?? 0;
  const pipeline = account?.mtd_pipeline_est ?? account?.mtd_pipeline_gross ?? 0;
  const base     = account?.baseline_target ?? 15000;
  const stretch  = account?.stretch_target  ?? 25000;

  const captured = Math.min(mtd / stretch, 1) * 100;
  const pipeW    = Math.min((pipeline / stretch) * 100, 100 - captured);
  const baseAt   = (base / stretch) * 100;
  const gap      = Math.max(0, base - mtd - pipeline);

  return (
    <Frame accent="quiet" title="MTD · PREMIUM" subtitle="captured vs targets">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 30, color: T.t1, fontWeight: 300, fontFamily: T.mono, letterSpacing: "-0.03em" }}>
          ${(mtd / 1000).toFixed(2)}k
        </span>
        <span style={{ fontSize: T.sm, color: T.tm }}>
          / ${(base / 1000).toFixed(0)}k base · ${(stretch / 1000).toFixed(0)}k stretch
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ position: "relative", height: 28, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
        {/* Captured */}
        <div style={{
          position: "absolute", top: 0, bottom: 0, left: 0,
          width: `${captured}%`,
          background: `linear-gradient(90deg, ${T.green} 0%, ${T.green}cc 100%)`,
        }} />
        {/* Pipeline (hatched) */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${captured}%`, width: `${pipeW}%`,
          backgroundImage: `repeating-linear-gradient(45deg, ${T.green}44 0 4px, transparent 4px 8px)`,
          borderLeft: `1px solid ${T.green}88`,
        }} />
        {/* Baseline marker */}
        <div style={{
          position: "absolute", top: -4, bottom: -4,
          left: `${baseAt}%`, width: 1, background: T.amber,
        }}>
          <div style={{ position: "absolute", top: -10, left: -16, fontSize: 9, color: T.amber, letterSpacing: "0.1em" }}>
            BASE
          </div>
        </div>
        {/* Stretch marker */}
        <div style={{
          position: "absolute", top: -4, bottom: -4, right: 0, width: 1, background: T.t1,
        }}>
          <div style={{ position: "absolute", top: -10, right: 0, fontSize: 9, color: T.t1, letterSpacing: "0.1em" }}>
            MAX
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 16 }}>
        <Datum label="CAPTURED"     value={`$${(mtd      / 1000).toFixed(1)}k`} color={T.green} size={T.md} />
        <Datum label="PIPELINE EST" value={`$${(pipeline / 1000).toFixed(1)}k`} size={T.md} />
        <Datum label="GAP TO BASE"  value={gap > 0 ? `$${(gap / 1000).toFixed(1)}k` : "MET ✓"} color={gap > 0 ? T.amber : T.green} size={T.md} />
      </div>
    </Frame>
  );
}
