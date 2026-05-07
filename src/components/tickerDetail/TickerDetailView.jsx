import { theme } from "../../lib/theme";
import { useTickerDetail } from "../../hooks/useTickerDetail";

function Breadcrumb({ ticker, onClose }) {
  return (
    <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: theme.space[3] }}>
      <button
        onClick={onClose}
        style={{
          background: "transparent", border: "none", padding: 0,
          color: theme.text.muted, fontSize: theme.size.sm, fontFamily: "inherit",
          cursor: "pointer", textDecoration: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = theme.blue)}
        onMouseLeave={(e) => (e.currentTarget.style.color = theme.text.muted)}
      >
        Explore / Positions
      </button>
      <span style={{ margin: `0 ${theme.space[1]}px`, color: theme.text.faint }}>/</span>
      <span style={{ color: theme.text.primary }}>{ticker}</span>
    </div>
  );
}

export function TickerDetailView({ ticker, onClose }) {
  const { data, loading, error } = useTickerDetail(ticker);

  if (loading && !data) {
    return (
      <div>
        <Breadcrumb ticker={ticker} onClose={onClose} />
        <div style={{ color: theme.text.muted, padding: theme.space[5], textAlign: "center" }}>
          Loading {ticker}…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Breadcrumb ticker={ticker} onClose={onClose} />
        <div style={{
          padding: theme.space[5], borderRadius: theme.radius.md,
          background: theme.alert.dangerBg, border: `1px solid ${theme.alert.dangerBorder}`,
          color: theme.text.primary,
        }}>
          Failed to load {ticker}: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      <Breadcrumb ticker={ticker} onClose={onClose} />
      {/* TickerHeader, TickerOpenPositions, TickerLifespanHistory, TickerAllTimeStats, TickerTradeTimeline added in Tasks 7-11 */}
    </div>
  );
}
