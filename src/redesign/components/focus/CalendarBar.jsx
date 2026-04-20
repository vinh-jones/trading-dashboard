import { T } from "../../theme.js";
import { Frame } from "../../primitives.jsx";
import { calcDTE } from "../../../lib/trading.js";

// Build a 21-day forward calendar from today, marking expiry clusters and earnings.
export function CalendarBar({ positions, marketContext }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 21 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dow = d.getDay();
    return {
      date: d,
      dayOfMonth: d.getDate(),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      isWeekend: dow === 0 || dow === 6,
      isToday: i === 0,
    };
  });

  // Expiry tickers per day (keyed by YYYY-MM-DD)
  const expiryMap = buildExpiryMap(positions);

  // Earnings per day from marketContext (or focusItems earnings flags)
  const earningsMap = buildEarningsMap(marketContext);

  return (
    <Frame accent="quiet" title="NEXT 21 DAYS" subtitle="expiries · earnings · macro">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(21, 1fr)", gap: 2 }}>
        {days.map((day, i) => {
          const key = fmtKey(day.date);
          const expiries = expiryMap[key] || [];
          const earnings = earningsMap[key] || [];
          const big = expiries.length >= 2;

          return (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{
                fontSize: 9, color: day.isToday ? T.blue : T.tf,
                fontFamily: T.mono, marginBottom: 2,
              }}>
                {day.dayOfMonth}
              </div>
              <div style={{
                height: 28, marginTop: 0,
                background: day.isWeekend ? T.bg : big ? T.amber + "22" : T.hair,
                border: `1px solid ${big ? T.amber : day.isToday ? T.blue : T.bd}`,
                borderRadius: 1,
                position: "relative",
                display: "flex", flexDirection: "column",
                justifyContent: "flex-end", alignItems: "center",
                padding: 1, gap: 1,
              }}>
                {expiries.length > 0 && (
                  <div style={{ height: big ? 16 : 8, width: "100%", background: T.amber, borderRadius: 1 }} />
                )}
                {earnings.length > 0 && expiries.length === 0 && (
                  <div style={{ height: 4, width: "100%", background: T.mag, borderRadius: 1 }} />
                )}
              </div>
              {earnings.length > 0 && (
                <div style={{ fontSize: 7, color: T.mag, marginTop: 2, letterSpacing: "0.05em", lineHeight: 1.2 }}>
                  {earnings[0]}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: T.xs, color: T.ts, letterSpacing: "0.08em" }}>
        <span>
          <span style={{ display: "inline-block", width: 8, height: 8, background: T.amber, marginRight: 4, verticalAlign: "middle" }} />
          EXPIRY
        </span>
        <span>
          <span style={{ display: "inline-block", width: 8, height: 8, background: T.mag, marginRight: 4, verticalAlign: "middle" }} />
          EARNINGS
        </span>
      </div>
    </Frame>
  );
}

function fmtKey(d) {
  return d.toISOString().slice(0, 10);
}

function buildExpiryMap(positions) {
  const map = {};
  const addPos = (list) => {
    (list || []).forEach(pos => {
      if (!pos.expiry_date) return;
      const key = pos.expiry_date;
      if (!map[key]) map[key] = [];
      map[key].push(pos.ticker);
    });
  };
  addPos(positions?.open_csps);
  addPos(positions?.assigned_shares);
  addPos(positions?.open_leaps);
  return map;
}

function buildEarningsMap(marketContext) {
  const map = {};
  // marketContext may have earningsDates or similar — scan macroEvents for EARNINGS type
  (marketContext?.macroEvents || []).forEach(e => {
    if ((e.eventType || "").toLowerCase().includes("earn") && e.dateTime) {
      const key = e.dateTime.slice(0, 10);
      if (!map[key]) map[key] = [];
      if (e.ticker) map[key].push(e.ticker);
    }
  });
  return map;
}
