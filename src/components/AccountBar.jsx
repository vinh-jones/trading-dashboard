import { useData } from "../hooks/useData";
import { useLiveVix } from "../hooks/useLiveVix";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { calcPipeline, allocColor } from "../lib/trading";
import { getVixBand } from "../lib/vixBand";
import { theme } from "../lib/theme";
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
  const statusColor = { ok: theme.green, over: theme.red, under: theme.amber, unknown: theme.text.subtle }[status];

  const { grossOpenPremium, expectedPipeline, hasPositions: hasPipeline } = calcPipeline(positions, captureRate);

  return (
    <div style={{ display: "flex", gap: theme.space[6], padding: `${theme.space[3]}px ${theme.space[5]}px`, background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, marginBottom: theme.space[5], flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Free Cash</div>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>
          {freeCashEst != null
            ? <>{formatDollarsFull(freeCashEst)}{" "}<span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>({(freeCashPctEst * 100).toFixed(1)}%)</span></>
            : <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>—</span>
          }
        </div>
        {band && (
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 1 }}>
            Target {(band.floorPct * 100).toFixed(0)}–{(band.ceilingPct * 100).toFixed(0)}%
          </div>
        )}
        {status !== "unknown" && (
          <div style={{ fontSize: theme.size.xs, fontWeight: 500, color: statusColor, marginTop: 1 }}>
            {status === "ok"    && "✓ Within band"}
            {status === "over"  && `⚠ ${((band.floorPct - freeCashPctEst) * 100).toFixed(1)}% below floor · ~${formatDollars(deltaAmt)} to free up`}
            {status === "under" && `↓ ${((freeCashPctEst - band.ceilingPct) * 100).toFixed(1)}% above ceiling · ~${formatDollars(deltaAmt)} to deploy`}
          </div>
        )}
        {status === "unknown" && (
          <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: 1 }}>Set VIX in account.json</div>
        )}
      </div>
      <div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>MTD Premium</div>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: mtd >= baseline ? theme.green : theme.text.primary }}>{formatDollarsFull(mtd)}</div>
      </div>
      <div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Pipeline</div>
        {hasPipeline ? (
          <>
            <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>{formatDollarsFull(grossOpenPremium)}</div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 1 }}>
              {formatDollarsFull(expectedPipeline)} est.
            </div>
          </>
        ) : (
          <div style={{ fontSize: theme.size.lg, color: theme.text.subtle }}>—</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: theme.size.xs, color: theme.text.muted, marginBottom: theme.space[1] }}>
          <span>Monthly target</span>
          <span>{formatDollars(baseline)} baseline · {formatDollars(stretch)} stretch</span>
        </div>
        <div style={{ height: 6, background: theme.border.default, borderRadius: theme.radius.sm, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: progress >= 100 ? theme.green : theme.blueBold, borderRadius: theme.radius.sm, transition: "width 0.3s" }} />
        </div>
      </div>
      {liveVix != null && (
        <div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>VIX</div>
          <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>{liveVix.toFixed(2)}</div>
          <div style={{ fontSize: theme.size.xs, color: vixSource === "live" ? theme.green : theme.text.faint, marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
            {vixSource === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: theme.green, display: "inline-block" }} />}
            {vixSource === "live" ? "live" : vixSource === "manual" ? "manual" : "closed"}
          </div>
        </div>
      )}
      <SyncButton />
    </div>
  );
}
