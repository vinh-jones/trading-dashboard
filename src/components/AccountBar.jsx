import { useData } from "../hooks/useData";
import { useLiveVix } from "../hooks/useLiveVix";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { calcPipeline, allocColor } from "../lib/trading";
import { getVixBand } from "../lib/vixBand";
import { SyncButton } from "./SyncButton";

export function AccountBar({ captureRate }) {
  const { account: accountData, positions } = useData();
  const mtd      = accountData.month_to_date_premium;
  const baseline = accountData.monthly_targets?.baseline ?? 15000;
  const stretch  = accountData.monthly_targets?.stretch  ?? 25000;
  const progress = Math.min((mtd / baseline) * 100, 100);

  // Free cash comes directly from the Allocations sheet (cell I7) via sync/api
  const freeCashEst    = accountData.free_cash_est    ?? null;
  const freeCashPctEst = accountData.free_cash_pct_est ?? null;

  // Live VIX — fetches /api/vix on mount, falls back to account.vix_current
  const { vix: liveVix, source: vixSource } = useLiveVix(accountData.vix_current);
  const band   = getVixBand(liveVix);
  const status = !band || freeCashPctEst == null ? "unknown"
    : freeCashPctEst < band.floorPct   ? "over"
    : freeCashPctEst > band.ceilingPct ? "under"
    : "ok";
  const deltaAmt = accountData.account_value != null && band ? (() => {
    if (status === "over")  return (band.floorPct   - freeCashPctEst) * accountData.account_value;
    if (status === "under") return (freeCashPctEst  - band.ceilingPct) * accountData.account_value;
    return null;
  })() : null;
  const statusColor = { ok: "#3fb950", over: "#f85149", under: "#e3b341", unknown: "#6e7681" }[status];

  const { grossOpenPremium, expectedPipeline, hasPositions: hasPipeline } = calcPipeline(positions, captureRate);

  return (
    <div style={{ display: "flex", gap: 24, padding: "12px 20px", background: "#161b22", border: "1px solid #21262d", borderRadius: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Free Cash</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>
          {freeCashEst != null
            ? <>{formatDollarsFull(freeCashEst)}{" "}<span style={{ fontSize: 12, color: "#8b949e" }}>({(freeCashPctEst * 100).toFixed(1)}%)</span></>
            : <span style={{ fontSize: 13, color: "#6e7681" }}>—</span>
          }
        </div>
        {band && (
          <div style={{ fontSize: 11, color: "#6e7681", marginTop: 1 }}>
            Target {(band.floorPct * 100).toFixed(0)}–{(band.ceilingPct * 100).toFixed(0)}%
          </div>
        )}
        {status !== "unknown" && (
          <div style={{ fontSize: 11, fontWeight: 500, color: statusColor, marginTop: 1 }}>
            {status === "ok"    && "✓ Within band"}
            {status === "over"  && `⚠ ${((band.floorPct - freeCashPctEst) * 100).toFixed(1)}% below floor · ~${formatDollars(deltaAmt)} to free up`}
            {status === "under" && `↓ ${((freeCashPctEst - band.ceilingPct) * 100).toFixed(1)}% above ceiling · ~${formatDollars(deltaAmt)} to deploy`}
          </div>
        )}
        {status === "unknown" && (
          <div style={{ fontSize: 11, color: "#4e5a65", marginTop: 1 }}>Set VIX in account.json</div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>MTD Premium</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: mtd >= baseline ? "#3fb950" : "#e6edf3" }}>{formatDollarsFull(mtd)}</div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Pipeline</div>
        {hasPipeline ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>{formatDollarsFull(grossOpenPremium)}</div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 1 }}>
              {formatDollarsFull(expectedPipeline)} est.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 15, color: "#6e7681" }}>—</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
          <span>Monthly target</span>
          <span>{formatDollars(baseline)} baseline · {formatDollars(stretch)} stretch</span>
        </div>
        <div style={{ height: 6, background: "#21262d", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: progress >= 100 ? "#3fb950" : "#1f6feb", borderRadius: 3, transition: "width 0.3s" }} />
        </div>
      </div>
      {liveVix != null && (
        <div>
          <div style={{ fontSize: 11, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>VIX</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}>{liveVix.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: vixSource === "live" ? "#3fb950" : "#4e5a65", marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
            {vixSource === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3fb950", display: "inline-block" }} />}
            {vixSource === "live" ? "live" : vixSource === "manual" ? "manual" : "closed"}
          </div>
        </div>
      )}
      <SyncButton />
    </div>
  );
}
