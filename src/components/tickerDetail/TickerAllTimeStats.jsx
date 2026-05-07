import { theme } from "../../lib/theme";
import { computeTickerStats } from "../../lib/tickerStats";
import { formatDollars, formatDollarsFull, formatExpiry } from "../../lib/format";

const PORTFOLIO_AVG_KEPT_PCT = 60;

function bestWorstSubtitle(t) {
  if (!t) return null;
  const strikePart = t.strike != null ? ` $${t.strike}` : "";
  return `${t.type}${strikePart} · ${formatExpiry(t.close_date)}`;
}

function Card({ label, value, sub, color, accent, large }) {
  return (
    <div style={{
      padding: large ? theme.space[4] : theme.space[3],
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderLeft: accent ? `3px solid ${accent}` : `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[1],
      }}>{label}</div>
      <div style={{
        fontSize: large ? theme.size.xl : theme.size.lg,
        color: color || theme.text.primary, fontWeight: 600, fontFamily: theme.font.mono,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

export function TickerAllTimeStats({ data }) {
  const stats = computeTickerStats({
    trades:    data.trades ?? [],
    lifespans: data.lifespans ?? [],
  });

  if (stats.tradeCount === 0) return null;

  const realizedColor = stats.realizedPnl >= 0 ? theme.green : theme.red;
  const tertiaryRelevant = stats.wheelsCompleted > 0 || stats.assignmentsTaken > 0;

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
        }}>All-Time Stats</div>
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          across {stats.tradeCount} trade{stats.tradeCount === 1 ? "" : "s"}
          {stats.includesSuspectData && " · includes pre-2026 data flagged as suspect"}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: theme.space[3], marginBottom: theme.space[3],
      }}>
        <Card
          label="Realized P&L"
          value={`${stats.realizedPnl >= 0 ? "+" : ""}${formatDollarsFull(stats.realizedPnl)}`}
          color={realizedColor}
          large
        />
        <Card
          label="Below-cost CC absorption"
          value={stats.belowCostCcAbsorption === 0 ? "$0" : formatDollarsFull(stats.belowCostCcAbsorption)}
          sub={stats.belowCostCcAbsorption === 0 ? "no absorption losses on this ticker" : "specific to wheel strategy on this ticker"}
          color={stats.belowCostCcAbsorption < 0 ? theme.amber : theme.text.primary}
          accent={theme.amber}
          large
        />
        <Card
          label="Premium collected"
          value={formatDollarsFull(stats.premiumCollected)}
          sub="CSP + CC, lifetime"
          large
        />
        <Card
          label="Capital efficiency"
          value={stats.capitalEfficiencyPct != null ? `${stats.capitalEfficiencyPct.toFixed(1)}%` : "—"}
          sub="annualized return on avg capital"
          large
        />
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: theme.space[3], marginBottom: tertiaryRelevant ? theme.space[3] : 0,
      }}>
        <Card label="Avg days CSP" value={stats.avgDaysCsp != null ? `${Math.round(stats.avgDaysCsp)}d` : "—"} />
        <Card label="Avg days CC"  value={stats.avgDaysCc  != null ? `${Math.round(stats.avgDaysCc)}d`  : "—"} />
        <Card
          label="Best trade"
          value={stats.bestTrade ? `${stats.bestTrade.premium_collected >= 0 ? "+" : ""}${formatDollars(stats.bestTrade.premium_collected)}` : "—"}
          sub={bestWorstSubtitle(stats.bestTrade)}
          color={stats.bestTrade ? theme.green : theme.text.muted}
        />
        <Card
          label="Worst trade"
          value={stats.worstTrade ? `${stats.worstTrade.premium_collected >= 0 ? "+" : ""}${formatDollars(stats.worstTrade.premium_collected)}` : "—"}
          sub={bestWorstSubtitle(stats.worstTrade)}
          color={stats.worstTrade && stats.worstTrade.premium_collected < 0 ? theme.red : theme.text.muted}
        />
      </div>

      {tertiaryRelevant && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: theme.space[3],
        }}>
          <Card
            label="Wheels completed"
            value={String(stats.wheelsCompleted)}
            sub={stats.wheelsSuspectExcluded > 0 ? `${stats.wheelsSuspectExcluded} suspect excluded` : null}
          />
          <Card label="Assignments taken" value={String(stats.assignmentsTaken)} />
          <Card label="Times called away" value={String(stats.timesCalledAway)} />
          <Card
            label="Avg kept_pct"
            value={stats.avgKeptPct != null ? `${Math.round(stats.avgKeptPct * 100)}%` : "—"}
            sub={stats.avgKeptPct != null ? `port ${PORTFOLIO_AVG_KEPT_PCT}%` : null}
          />
        </div>
      )}
    </div>
  );
}
