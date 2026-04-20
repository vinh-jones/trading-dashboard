import { T } from "../../theme.js";
import { SectionLabel, Empty, Frame } from "../../primitives.jsx";
import { getVixBand } from "../../theme.js";
import { PostureInstrument } from "./PostureInstrument.jsx";
import { PositionsMatrix } from "./PositionsMatrix.jsx";
import { ActionQueue } from "./ActionQueue.jsx";
import { PipelineGauge } from "./PipelineGauge.jsx";
import { MacroGlance } from "./MacroGlance.jsx";
import { CalendarBar } from "./CalendarBar.jsx";
import { RollCandidates } from "./RollCandidates.jsx";

export function FocusCommandCenter({ account, positions, focusItems, quoteMap, marketContext, liveVix }) {
  // Merge live VIX into account for posture widget
  const acct = liveVix != null ? { ...account, vix_current: liveVix } : account;

  const allPositions = [
    ...(positions?.open_csps        || []),
    ...(positions?.assigned_shares  || []),
    ...(positions?.open_leaps       || []),
  ];
  const isEmpty = allPositions.length === 0 && !(focusItems?.length);

  if (isEmpty) return <FirstRunState acct={acct} />;

  // Deploy headroom: free cash > VIX band ceiling by >3pp
  const vix  = acct?.vix_current ?? null;
  const band = vix ? getVixBand(vix) : null;
  const freePct = acct?.free_cash_pct_est ?? acct?.free_cash_pct ?? 0;
  const headroom = band ? freePct - band.ceilingPct : 0;
  const showDeploy = headroom > 0.03;

  const p1Items = (focusItems || []).filter(it => it.priority === "P1");
  const p2Items = (focusItems || []).filter(it => it.priority === "P2");
  const hasActions = p1Items.length + p2Items.length > 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 14 }}>
      {/* LEFT — CRITICAL: Posture → Positions → Action Queue */}
      <div style={{ display: "grid", gap: 14, minWidth: 0, alignContent: "start" }}>
        <PostureInstrument account={acct} />
        <PositionsMatrix positions={positions} focusItems={focusItems} quoteMap={quoteMap} />
        <ActionQueue focusItems={focusItems} />
      </div>

      {/* RIGHT — QUIET: MTD | Opportunities | Context */}
      <div style={{ display: "grid", gap: 14, minWidth: 0, alignContent: "start" }}>
        <PipelineGauge account={acct} />

        <SectionLabel label="OPPORTUNITIES" right={showDeploy || hasActions ? "active" : "all clear"} />

        {showDeploy && <DeployHint band={band} acct={acct} />}

        {!showDeploy && !hasActions && (
          <div style={{ fontSize: T.sm, color: T.tf, fontStyle: "italic", padding: "4px 2px", letterSpacing: "0.03em" }}>
            nothing to surface — within posture, no targets close
          </div>
        )}

        <RollCandidates positions={positions} rollMap={quoteMap?._rollMap} />

        <SectionLabel label="CONTEXT" />
        <MacroGlance marketContext={marketContext} />
        <CalendarBar positions={positions} marketContext={marketContext} />
      </div>
    </div>
  );
}

// Minimal deploy hint when user has headroom above VIX band ceiling
function DeployHint({ band, acct }) {
  const headroom = (acct.free_cash_pct_est ?? acct.free_cash_pct ?? 0) - band.ceilingPct;
  const room = Math.round((headroom * (acct.account_value ?? 0)) / 1000) * 1000;
  return (
    <Frame accent="quiet" title="▸ DEPLOY" subtitle={`${room > 0 ? `~$${(room / 1000).toFixed(0)}k` : ""} above VIX ceiling · band ${band.label} targets ${Math.round(band.floorPct * 100)}–${Math.round(band.ceilingPct * 100)}%`}>
      <div style={{ fontSize: T.sm, color: T.tm, lineHeight: 1.6 }}>
        Free cash is above the {band.label} ceiling. Open Radar to find CSP candidates from your book.
      </div>
      <div style={{ marginTop: 10 }}>
        <a href="/" style={{
          fontSize: T.xs, color: T.cyan, border: `1px solid ${T.cyan}44`,
          background: T.cyan + "10", padding: "4px 11px",
          letterSpacing: "0.12em", borderRadius: T.rSm,
          textDecoration: "none", display: "inline-block",
        }}>
          OPEN RADAR ▸
        </a>
      </div>
    </Frame>
  );
}

// First-run / no-data empty state
function FirstRunState({ acct }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 14 }}>
      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        <PostureInstrument account={acct} />
        <Frame accent="focus" title="POSITIONS" subtitle="no open positions">
          <Empty glyph="○" accent="focus" compact
            title="No open positions."
            body="When you open your first CSP or CC, it'll appear here with live DTE, greeks, and proximity bar."
          />
        </Frame>
        <Frame accent="warn" title="ACTION QUEUE" subtitle="all clear">
          <Empty glyph="✓" accent="green" tone="positive" compact
            title="All clear."
            body="Alerts and roll decisions appear here as positions age."
          />
        </Frame>
      </div>
      <div style={{ display: "grid", gap: 14, minWidth: 0, alignContent: "start" }}>
        <Frame accent="quiet" title="MTD · PREMIUM" subtitle="no trades yet">
          <Empty glyph="◌" accent="quiet" compact
            title="Pipeline starts with your first sale."
            body="Premium collected month-to-date, pipeline estimate, and progress toward baseline and stretch targets."
          />
        </Frame>
        <SectionLabel label="CONTEXT" />
        <MacroGlance marketContext={null} />
      </div>
    </div>
  );
}
