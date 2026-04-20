import { T } from "../../theme.js";
import { Frame } from "../../primitives.jsx";

// Roll candidates come from the rollMap populated by useRollAnalysis.
// rollMap: Map<ticker, { candidates: [{strike, dte, delta, premium, credit, ror}], ...}>
export function RollCandidates({ positions, rollMap }) {
  const rolls = buildRollRows(positions, rollMap);

  if (rolls.length === 0) return null;

  return (
    <Frame
      accent="quiet"
      title="ROLL CANDIDATES"
      subtitle="best viable · from roll analysis"
    >
      <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
        {rolls.map((r, i) => (
          <div key={i} style={{
            padding: "9px 11px", background: T.surf,
            display: "grid", gridTemplateColumns: "52px 1fr auto", gap: 10, alignItems: "center",
          }}>
            <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1 }}>{r.ticker}</span>
            <div>
              <div style={{ fontSize: T.sm, color: T.tm }}>
                {r.from} →{" "}
                <span style={{ color: T.t1 }}>{r.best}</span>
              </div>
            </div>
            <span style={{ fontSize: T.xs, color: r.score >= 4 ? T.green : r.score >= 3 ? T.amber : T.red, letterSpacing: "0.08em" }}>
              {"●".repeat(r.score)}{"○".repeat(5 - r.score)}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function buildRollRows(positions, rollMap) {
  if (!rollMap || Object.keys(rollMap).length === 0) return [];
  const rows = [];

  const process = (list, type) => {
    (list || []).forEach(pos => {
      const entry = rollMap?.[pos.ticker];
      if (!entry?.candidates?.length) return;
      const best = entry.candidates[0];
      const credit = best.credit ?? best.net_credit ?? 0;
      const score = credit > 0.5 ? 4 : credit > 0 ? 3 : 2;
      rows.push({
        ticker: pos.ticker,
        from: `$${pos.strike} · ${best.fromDte ?? "?"}d`,
        best: `$${best.strike} · ${best.dte}d · +$${credit.toFixed(2)} credit`,
        score,
      });
    });
  };

  process(positions?.open_csps,       "CSP");
  process(positions?.assigned_shares, "CC");

  return rows.slice(0, 4);
}
