import { useState, useMemo } from "react";

export function SixtyCheck() {
  const [premiumOpen, setPremiumOpen] = useState("");
  const [premiumMark, setPremiumMark] = useState("");
  const [dteOpen, setDteOpen] = useState("");
  const [dteRemaining, setDteRemaining] = useState("");

  const result = useMemo(() => {
    const po = parseFloat(premiumOpen);
    const pm = parseFloat(premiumMark);
    const dO = parseFloat(dteOpen);
    const dR = parseFloat(dteRemaining);
    if (!po || po <= 0 || pm == null || isNaN(pm) || !dO || dO <= 0 || dR == null || isNaN(dR)) return null;

    const profitPct = (po - pm) / po;
    const dtePct    = dR / dO;

    if (dR < 5) {
      return { profitPct, dtePct, status: "near-expiry", label: "Near expiry — evaluate independently", color: "#8b949e" };
    }
    if (profitPct >= 0.60 && dtePct >= 0.60) {
      return { profitPct, dtePct, triggered: true, status: "close", label: "Close now", color: "#3fb950" };
    }
    if (dtePct < 0.60) {
      return { profitPct, dtePct, triggered: false, status: "past-dte", label: "Past 60% DTE threshold — use judgment", color: "#f2d96d" };
    }
    return { profitPct, dtePct, triggered: false, status: "not-yet", label: "Not yet", color: "#8b949e" };
  }, [premiumOpen, premiumMark, dteOpen, dteRemaining]);

  const inputStyle = {
    background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3",
    borderRadius: 4, padding: "8px 10px", fontSize: 14, fontFamily: "inherit",
    width: "100%", outline: "none",
  };
  const labelStyle = { fontSize: 12, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" };

  return (
    <div style={{ padding: "20px", background: "#161b22", borderRadius: 8, border: "1px solid #21262d" }}>
      <div style={{ fontSize: 13, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 16, fontWeight: 500 }}>
        60/60 Quick-Check
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Premium at open</label>
          <input style={inputStyle} type="number" placeholder="e.g. 500" value={premiumOpen} onChange={(e) => setPremiumOpen(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Current mark</label>
          <input style={inputStyle} type="number" placeholder="e.g. 180" value={premiumMark} onChange={(e) => setPremiumMark(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>DTE at open</label>
          <input style={inputStyle} type="number" placeholder="e.g. 21" value={dteOpen} onChange={(e) => setDteOpen(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>DTE remaining</label>
          <input style={inputStyle} type="number" placeholder="e.g. 14" value={dteRemaining} onChange={(e) => setDteRemaining(e.target.value)} />
        </div>
      </div>

      {result ? (
        <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "14px 16px", background: "#0d1117", borderRadius: 6, border: `1px solid ${result.color}40` }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: result.color }}>{result.label}</div>
          <div style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Profit captured</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: result.profitPct >= 0.60 ? "#3fb950" : "#e6edf3" }}>
                {(result.profitPct * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>DTE remaining</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: result.dtePct >= 0.60 ? "#3fb950" : "#f85149" }}>
                {(result.dtePct * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>60/60 triggered</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: result.triggered ? "#3fb950" : "#8b949e" }}>
                {result.status === "near-expiry" ? "N/A" : result.triggered ? "YES" : "NO"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "14px 16px", background: "#0d1117", borderRadius: 6, border: "1px solid #21262d", fontSize: 14, color: "#6e7681" }}>
          Enter all four values to evaluate the 60/60 rule.
        </div>
      )}
    </div>
  );
}
