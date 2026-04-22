import { useState } from "react";
import { useData } from "../hooks/useData";
import { useLiveVix } from "../hooks/useLiveVix";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull } from "../lib/format";
import { calcPipeline } from "../lib/trading";
import { getVixBand } from "../lib/vixBand";
import { theme } from "../lib/theme";
import { SyncButton } from "./SyncButton";

// Slot wrapper — uniform label/value stacking with optional right-edge divider.
function Slot({ children, divider = true, style }) {
  return (
    <div style={{
      paddingRight:  divider ? theme.space[4] : 0,
      borderRight:   divider ? `1px solid ${theme.border.default}` : "none",
      minWidth:      0,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SlotLabel({ children }) {
  return (
    <div style={{
      fontSize:      theme.size.xs,
      color:         theme.text.muted,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      marginBottom:  theme.space[1],
    }}>
      {children}
    </div>
  );
}

export function PersistentHeader({ captureRate, p1Count = 0 }) {
  const { account, positions } = useData();
  const windowWidth = useWindowWidth();
  const isMobile    = windowWidth < 600;

  // ── Free cash + VIX band status ─────────────────────────────────────────────
  const freeCashEst    = account.free_cash_est ?? null;
  const freeCashPctEst = account.free_cash_pct_est ?? null;
  const { vix: liveVix, source: vixSource } = useLiveVix(account.vix_current);
  const band = getVixBand(liveVix);
  const status = !band || freeCashPctEst == null ? "unknown"
    : freeCashPctEst < band.floorPct   ? "over"
    : freeCashPctEst > band.ceilingPct ? "under"
    : "ok";
  const deltaAmt = account.account_value != null && band ? (() => {
    if (status === "over")  return (band.floorPct   - freeCashPctEst) * account.account_value;
    if (status === "under") return (freeCashPctEst  - band.ceilingPct) * account.account_value;
    return null;
  })() : null;
  const statusColor = { ok: theme.green, over: theme.red, under: theme.amber, unknown: theme.text.subtle }[status];

  // ── MTD progress ────────────────────────────────────────────────────────────
  const mtd      = account.month_to_date_premium ?? 0;
  const baseline = account.monthly_targets?.baseline ?? 15000;
  const progress = Math.min((mtd / baseline) * 100, 100);

  // ── Pipeline ────────────────────────────────────────────────────────────────
  // Prefer v2 forecast (auto-calibrated per-position capture) when available,
  // fall back to the flat captureRate estimate otherwise.
  const { grossOpenPremium, expectedPipeline: flatExpected, hasPositions: hasPipeline } = calcPipeline(positions, captureRate);
  const v2Forward      = account?.forecast?.forward_pipeline_premium ?? null;
  const expectedPipeline = v2Forward ?? flatExpected;
  const pipelineIsV2    = v2Forward != null;

  // Mobile uses 3 compact slots; desktop uses 5-slot grid.
  const gridCols = isMobile
    ? "1.3fr 0.9fr 0.8fr"
    : "1.4fr 1fr 0.9fr 1.4fr auto";

  return (
    <div style={{
      position:           "relative",
      display:            "grid",
      gridTemplateColumns: gridCols,
      gap:                theme.space[4],
      padding:            `${theme.space[3]}px ${theme.space[5]}px`,
      background:         theme.bg.surface,
      border:             `1px solid ${theme.border.default}`,
      borderRadius:       theme.radius.md,
      marginBottom:       theme.space[4],
      alignItems:         "center",
    }}>

      {/* ── Slot 1: Free cash deployment ─────────────────────────────────── */}
      <Slot>
        <SlotLabel>Free Cash</SlotLabel>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>
          {freeCashEst != null
            ? <>{formatDollarsFull(freeCashEst)}{" "}<span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>({(freeCashPctEst * 100).toFixed(1)}%)</span></>
            : <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>—</span>
          }
        </div>
        {band && (
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: theme.space[1] }}>
            Target {(band.floorPct * 100).toFixed(0)}–{(band.ceilingPct * 100).toFixed(0)}%
          </div>
        )}
        {status !== "unknown" && (
          <div style={{ fontSize: theme.size.xs, fontWeight: 500, color: statusColor, marginTop: theme.space[1] }}>
            {status === "ok"    && "✓ Within band"}
            {status === "over"  && `⚠ ${((band.floorPct - freeCashPctEst) * 100).toFixed(1)}% below floor · ~${formatDollars(deltaAmt)} to free up`}
            {status === "under" && `↓ ${((freeCashPctEst - band.ceilingPct) * 100).toFixed(1)}% above ceiling · ~${formatDollars(deltaAmt)} to deploy`}
          </div>
        )}
        {status === "unknown" && (
          <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: theme.space[1] }}>Set VIX in account.json</div>
        )}
      </Slot>

      {/* ── Slot 2: VIX + posture band ───────────────────────────────────── */}
      <Slot>
        <SlotLabel>VIX</SlotLabel>
        <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.text.primary }}>
          {liveVix != null ? liveVix.toFixed(2) : "—"}
        </div>
        <div style={{ fontSize: theme.size.xs, marginTop: theme.space[1], display: "flex", alignItems: "center", gap: 4 }}>
          {band && (
            <span style={{
              padding:      "1px 7px",
              borderRadius: theme.radius.pill,
              border:       `1px solid ${theme.border.strong}`,
              color:        theme.text.secondary,
              fontSize:     theme.size.xs,
            }}>
              {band.sentiment}
            </span>
          )}
          <span style={{ color: vixSource === "live" ? theme.green : theme.text.faint, display: "flex", alignItems: "center", gap: 3 }}>
            {vixSource === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: theme.green, display: "inline-block" }} />}
            {vixSource === "live" ? "live" : vixSource === "manual" ? "manual" : "closed"}
          </span>
        </div>
      </Slot>

      {/* ── Slot 3: P1 alert count ───────────────────────────────────────── */}
      <Slot>
        <SlotLabel>Alerts</SlotLabel>
        {p1Count > 0 ? (
          <>
            <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.red }}>
              P1 · {p1Count}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>
              needs action today
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: theme.green }}>
              ✓ clear
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>
              no P1 alerts
            </div>
          </>
        )}
      </Slot>

      {/* ── Slot 4: MTD Premium + pipeline (hidden on mobile) ────────────── */}
      {!isMobile && (
        <Slot>
          <SlotLabel>MTD Premium</SlotLabel>
          <div style={{ fontSize: theme.size.lg, fontWeight: 600, color: mtd >= baseline ? theme.green : theme.text.primary }}>
            {formatDollarsFull(mtd)}
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, fontWeight: 400 }}>{" "}/ {formatDollars(baseline)}</span>
          </div>
          <div style={{ height: 4, background: theme.border.default, borderRadius: theme.radius.sm, overflow: "hidden", marginTop: theme.space[1] }}>
            <div style={{ height: "100%", width: `${progress}%`, background: progress >= 100 ? theme.green : theme.blueBold, borderRadius: theme.radius.sm, transition: "width 0.3s" }} />
          </div>
          {hasPipeline && (
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: theme.space[1] }}>
              Pipeline {formatDollarsFull(grossOpenPremium)} · {formatDollarsFull(expectedPipeline)} est
              {pipelineIsV2 && (
                <span style={{ color: theme.green, marginLeft: 4 }} title="v2 auto-calibrated forecast">·v2</span>
              )}
            </div>
          )}
        </Slot>
      )}

      {/* ── Slot 5: Sync (desktop only — mobile uses corner button) ────────── */}
      {!isMobile && (
        <Slot divider={false} style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
          <SyncButton />
        </Slot>
      )}

      {/* ── Mobile sync corner button ─────────────────────────────────────── */}
      {isMobile && (
        <div style={{ position: "absolute", top: theme.space[2], right: theme.space[3] }}>
          <SyncButton iconOnly />
        </div>
      )}

    </div>
  );
}
