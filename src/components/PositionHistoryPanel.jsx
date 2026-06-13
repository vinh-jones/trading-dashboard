import { useEffect, useState } from "react";
import { theme } from "../lib/theme";
import { cohortCaptureSeries } from "../lib/cohorts";
import { EvolutionChart } from "./EvolutionChart";

const MIN_HISTORY_POINTS = 5; // ~1 trading week; below this the chart is hidden

// Capture-%-over-time chart for a single open position, shown in its expand
// panel. Mounts only when the row is expanded, so the fetch is lazy. Renders
// nothing until there are at least MIN_HISTORY_POINTS snapshot days — and
// nothing on loading/error, since this is secondary content.
export function PositionHistoryPanel({ position }) {
  const [series, setSeries] = useState(null);

  const { ticker, type, strike, expiry_date } = position;

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ ticker, type, strike: String(strike), expiry: expiry_date }).toString();
        const res = await fetch(`/api/position-history?${qs}`);
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const member = {
          status: "open", ticker, type, strike, expiry: expiry_date,
          closeDate: null, keptPct: null,
          premiumCollected: position.premium_collected, contracts: position.contracts ?? 1,
        };
        setSeries(cohortCaptureSeries([member], json.data ?? []));
      } catch {
        if (!cancelled) setSeries([]); // silent — secondary panel
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, type, strike, expiry_date, position.premium_collected, position.contracts]);

  if (!series || series.length < MIN_HISTORY_POINTS) return null;

  return (
    <div style={{ padding: `${theme.space[3]}px ${theme.space[4]}px`, borderTop: `1px solid ${theme.border.default}` }}>
      <EvolutionChart series={series} />
    </div>
  );
}
