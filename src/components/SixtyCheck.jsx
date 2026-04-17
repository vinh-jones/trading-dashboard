import { useState, useMemo } from "react";
import { theme } from "../lib/theme";

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
      return { profitPct, dtePct, status: "near-expiry", label: "Near expiry — evaluate independently", color: theme.text.muted };
    }
    if (profitPct >= 0.60 && dtePct >= 0.60) {
      return { profitPct, dtePct, triggered: true, status: "close", label: "Close now", color: theme.green };
    }
    if (dtePct < 0.60) {
      return { profitPct, dtePct, triggered: false, status: "past-dte", label: "Past 60% DTE threshold — use judgment", color: theme.amber };
    }
    return { profitPct, dtePct, triggered: false, status: "not-yet", label: "Not yet", color: theme.text.muted };
  }, [premiumOpen, premiumMark, dteOpen, dteRemaining]);

  const inputStyle = {
    background: theme.bg.base, border: `1px solid ${theme.border.strong}`, color: theme.text.primary,
    borderRadius: theme.radius.sm, padding: "8px 10px", fontSize: theme.size.md, fontFamily: "inherit",
    width: "100%", outline: "none",
  };
  const labelStyle = { fontSize: theme.size.sm, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[1], display: "block" };

  return (
    <div style={{ padding: theme.space[5], background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
      <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[4], fontWeight: 500 }}>
        60/60 Quick-Check
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: theme.space[3], marginBottom: theme.space[4] }}>
        <div>
          <label style={labelStyle}>Premium at open</label>
          <input style={inputStyle} type="number" placeholder="e.g. 500" value={premiumOpen} onChange={(e) => setPremiumOpen(e.target.value)}
            onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 2px ${theme.blue}55`; }}
            onBlur={e => { e.currentTarget.style.boxShadow = "none"; }} />
        </div>
        <div>
          <label style={labelStyle}>Current mark</label>
          <input style={inputStyle} type="number" placeholder="e.g. 180" value={premiumMark} onChange={(e) => setPremiumMark(e.target.value)}
            onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 2px ${theme.blue}55`; }}
            onBlur={e => { e.currentTarget.style.boxShadow = "none"; }} />
        </div>
        <div>
          <label style={labelStyle}>DTE at open</label>
          <input style={inputStyle} type="number" placeholder="e.g. 21" value={dteOpen} onChange={(e) => setDteOpen(e.target.value)}
            onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 2px ${theme.blue}55`; }}
            onBlur={e => { e.currentTarget.style.boxShadow = "none"; }} />
        </div>
        <div>
          <label style={labelStyle}>DTE remaining</label>
          <input style={inputStyle} type="number" placeholder="e.g. 14" value={dteRemaining} onChange={(e) => setDteRemaining(e.target.value)}
            onFocus={e => { e.currentTarget.style.boxShadow = `0 0 0 2px ${theme.blue}55`; }}
            onBlur={e => { e.currentTarget.style.boxShadow = "none"; }} />
        </div>
      </div>

      {result ? (
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[6], padding: "14px 16px", background: theme.bg.base, borderRadius: theme.radius.sm, border: `1px solid ${result.color}40` }}>
          <div style={{ fontSize: theme.size.xl, fontWeight: 700, color: result.color }}>{result.label}</div>
          <div style={{ display: "flex", gap: theme.space[5], marginLeft: "auto" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Profit captured</div>
              <div style={{ fontSize: theme.size.xl, fontWeight: 600, color: result.profitPct >= 0.60 ? theme.green : theme.text.primary }}>
                {(result.profitPct * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>DTE remaining</div>
              <div style={{ fontSize: theme.size.xl, fontWeight: 600, color: result.dtePct >= 0.60 ? theme.green : theme.red }}>
                {(result.dtePct * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>60/60 triggered</div>
              <div style={{ fontSize: theme.size.xl, fontWeight: 600, color: result.triggered ? theme.green : theme.text.muted }}>
                {result.status === "near-expiry" ? "N/A" : result.triggered ? "YES" : "NO"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "14px 16px", background: theme.bg.base, borderRadius: theme.radius.sm, border: `1px solid ${theme.border.default}`, fontSize: theme.size.md, color: theme.text.subtle }}>
          Enter all four values to evaluate the 60/60 rule.
        </div>
      )}
    </div>
  );
}
