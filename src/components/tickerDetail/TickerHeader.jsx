import { theme } from "../../lib/theme";
import { formatDollarsFull, formatExpiry } from "../../lib/format";
import { computePositionHealth } from "../../lib/tickerHealth";

const ALLOC_CAP_PCT = 15;

function HeaderField({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: theme.size.md, color: theme.text.primary }}>{children}</div>
    </div>
  );
}

function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  return Math.round(
    (new Date(toIso + "T00:00:00Z") - new Date(fromIso + "T00:00:00Z")) / 86_400_000
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}


function buildStatusSummary({ openPositions, lifespans, ticker, shareCount, ccCount, cspCount, leapCount }) {
  if (shareCount > 0 && ccCount > 0) {
    const cc = openPositions.shares.flatMap((s) => s.active_cc ? [s.active_cc] : [])[0];
    return `Active wheel — ${shareCount} shares assigned${cc ? `, CC $${cc.strike} expiring ${formatExpiry(cc.expiry_date)}` : ""}`;
  }
  if (cspCount > 0 && shareCount === 0) {
    return `CSP-only — ${cspCount} active CSP${cspCount > 1 ? "s" : ""}, no assignments`;
  }
  if (cspCount === 0 && shareCount === 0 && leapCount === 0) {
    const last = lifespans?.[0];
    if (last?.exit_date) {
      return `Idle — no current positions. Last activity ${last.exit_date}.`;
    }
    return `Idle — no current positions on ${ticker}.`;
  }
  return `${shareCount} shares, ${cspCount} CSPs, ${ccCount} CCs, ${leapCount} LEAPS`;
}

export function TickerHeader({ data, accountValue }) {
  const { ticker, quote, earningsDate, openPositions, lifespans, companyName } = data;

  const dayChangeAbs = quote?.last != null && quote?.prev_close != null
    ? quote.last - quote.prev_close : null;
  const dayChangePct = dayChangeAbs != null && quote.prev_close
    ? (dayChangeAbs / quote.prev_close) * 100 : null;

  const cspCapital = (openPositions?.csps  ?? []).reduce((s, p) => s + (p.capital_fronted || 0), 0);
  const sharesCapital = (openPositions?.shares ?? []).reduce((s, sh) =>
    s + (sh.cost_basis_total ?? sh.positions?.reduce((ss, p) => ss + (p.fronted ?? 0), 0) ?? 0), 0);
  const leapsCapital = (openPositions?.leaps ?? []).reduce((s, p) => s + (p.capital_fronted || 0), 0);
  const totalCapital = cspCapital + sharesCapital + leapsCapital;

  const allocPct = accountValue > 0 ? (totalCapital / accountValue) * 100 : 0;

  const cspCount  = openPositions?.csps?.length ?? 0;
  const ccCount   = openPositions?.shares?.reduce((s, sh) => s + (sh.active_cc ? 1 : 0), 0) ?? 0;
  const leapCount = openPositions?.leaps?.length ?? 0;

  // Active lifespan total_shares_at_peak is the most reliable share count
  const activeLifespan = lifespans?.find((l) => l.lifespan_status === "active");
  const shareCount = activeLifespan?.total_shares_at_peak ?? 0;

  // Blended cost basis from active lifespan
  const blendedBasis = activeLifespan?.blended_cost_basis ?? null;

  const earningsSoon = (() => {
    if (!earningsDate) return null;
    const days = daysBetween(todayIso(), earningsDate);
    return days != null && days >= 0 && days <= 30 ? days : null;
  })();

  const health = computePositionHealth({ openPositions, quote });
  const statusSummary = buildStatusSummary({
    openPositions, lifespans, ticker, shareCount, ccCount, cspCount, leapCount,
  });

  return (
    <div style={{
      padding:      theme.space[5],
      background:   theme.bg.surface,
      border:       `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: theme.space[5], alignItems: "flex-start" }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: theme.text.primary, letterSpacing: "0.5px" }}>{ticker}</div>
          {companyName && <div style={{ fontSize: theme.size.sm, color: theme.text.muted }}>{companyName}</div>}
          <div style={{ marginTop: theme.space[2], fontSize: theme.size.lg, color: theme.text.primary }}>
            {quote?.last != null ? `$${quote.last.toFixed(2)}` : "—"}
            {dayChangeAbs != null && (
              <span style={{
                marginLeft: theme.space[2],
                color: dayChangeAbs >= 0 ? theme.green : theme.red,
                fontSize: theme.size.sm,
              }}>
                {dayChangeAbs >= 0 ? "+" : ""}{dayChangeAbs.toFixed(2)} ({dayChangePct >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%)
              </span>
            )}
            {earningsSoon != null && (
              <span style={{
                marginLeft: theme.space[2], fontSize: theme.size.xs,
                color: theme.amber, padding: "2px 6px",
                border: `1px solid ${theme.amber}`, borderRadius: theme.radius.sm,
              }}>
                Earnings {earningsDate} ({earningsSoon}d)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[4], flex: 1 }}>
          <HeaderField label="Capital">
            <div style={{ color: theme.text.primary }}>{formatDollarsFull(totalCapital)}</div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>{allocPct.toFixed(1)}% of portfolio</div>
          </HeaderField>

          <HeaderField label="Open">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: theme.size.sm }}>
              {cspCount   > 0 && <span style={{ color: theme.blue }}>CSP ×{cspCount}</span>}
              {ccCount    > 0 && <span style={{ color: theme.green }}>CC ×{ccCount}</span>}
              {leapCount  > 0 && <span style={{ color: theme.chart.leaps }}>LEAPS ×{leapCount}</span>}
              {shareCount > 0 && <span style={{ color: theme.text.primary }}>{shareCount} sh</span>}
              {(cspCount + ccCount + leapCount + shareCount) === 0 && <span style={{ color: theme.text.muted }}>none</span>}
            </div>
            {blendedBasis != null && (
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>cb ${blendedBasis.toFixed(2)}</div>
            )}
          </HeaderField>

          <HeaderField label="Allocation">
            <div style={{ background: theme.bg.elevated, height: 6, borderRadius: theme.radius.sm, position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", inset: 0,
                width: `${Math.min(100, (allocPct / ALLOC_CAP_PCT) * 100)}%`,
                background: allocPct > ALLOC_CAP_PCT ? theme.red : theme.blueBold,
              }} />
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 4 }}>
              {allocPct.toFixed(1)}% / {ALLOC_CAP_PCT}% cap
            </div>
          </HeaderField>

          <HeaderField label="Health">
            <div style={{ display: "flex", alignItems: "center", gap: theme.space[1] }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: health.color, display: "inline-block" }} />
              <span style={{ color: health.color }}>{health.label}</span>
            </div>
          </HeaderField>
        </div>
      </div>

      <div style={{
        marginTop: theme.space[4], padding: theme.space[3],
        background: theme.bg.elevated, borderRadius: theme.radius.sm,
        fontSize: theme.size.sm, color: theme.text.secondary,
      }}>
        {statusSummary}
      </div>
    </div>
  );
}
