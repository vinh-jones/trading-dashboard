import { theme } from "../lib/theme";
import { formatDollarsFull } from "../lib/format";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" → "Jul 2026" */
function monthLabel(month) {
  const [y, m] = month.split("-");
  return `${MONTH_LABELS[Number(m) - 1]} ${y}`;
}

const TH = {
  padding: `${theme.space[2]}px ${theme.space[2]}px`,
  fontSize: theme.size.xs,
  color: theme.text.muted,
  fontWeight: 600,
  textAlign: "right",
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${theme.border.default}`,
};

const TD = {
  padding: `${theme.space[2]}px ${theme.space[2]}px`,
  fontSize: theme.size.md,
  textAlign: "right",
  fontFamily: theme.font.mono,
  whiteSpace: "nowrap",
};

/**
 * Self-check. The ledger's defining identity is
 *   cumulative booked − cumulative distributable ≡ outstanding deferred
 * and a pool can only ever be drained down to zero, never past it. A negative
 * outstanding balance, or a chain still holding premium against zero shares,
 * means the pool and the month rows have desynchronized — the figures below
 * cannot be trusted to size a withdrawal. Surface it loudly rather than
 * letting a wrong number look authoritative.
 */
function findIntegrityFault(ledger) {
  if (ledger.outstandingDeferred < 0) {
    return "Outstanding deferred premium is negative, which is not a reachable state.";
  }
  const stranded = ledger.openChains.filter(
    (c) => c.sharesHeld === 0 && c.deferredRemaining !== 0
  );
  if (stranded.length > 0) {
    return `${stranded.length} position${stranded.length === 1 ? "" : "s"} hold${stranded.length === 1 ? "s" : ""} deferred premium against zero shares, so it can never be released.`;
  }
  const identity =
    +(ledger.cumulativeBooked - ledger.cumulativeDistributable).toFixed(2);
  if (identity !== ledger.outstandingDeferred) {
    return `Booked minus distributable (${formatDollarsFull(identity)}) does not equal outstanding deferred (${formatDollarsFull(ledger.outstandingDeferred)}).`;
  }
  return null;
}

/**
 * Month-by-month booked vs distributable income.
 *
 * @param {object} props
 * @param {object} props.ledger output of buildRecognitionLedger
 */
export function RecognitionLedger({ ledger }) {
  const { months, outstandingDeferred, openChains } = ledger;

  if (months.length === 0) {
    return (
      <div style={{ padding: theme.space[4], color: theme.text.muted, fontSize: theme.size.md }}>
        No closed trades yet.
      </div>
    );
  }

  const fault = findIntegrityFault(ledger);

  return (
    <div style={{ marginBottom: theme.space[5] }}>
      {fault && (
        <div
          style={{
            background: theme.alert.dangerBg,
            border: `1px solid ${theme.alert.dangerBorder}`,
            borderRadius: theme.radius.md,
            padding: theme.space[3],
            marginBottom: theme.space[3],
            fontSize: theme.size.sm,
            color: theme.text.primary,
            lineHeight: 1.5,
          }}
        >
          <strong>Ledger integrity check failed.</strong> {fault} Do not size a
          withdrawal from these figures until this is resolved.
        </div>
      )}

      {/* Headline — the number this whole view exists to surface */}
      <div
        style={{
          background: theme.bg.elevated,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md,
          padding: theme.space[4],
          marginBottom: theme.space[4],
        }}
      >
        <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginBottom: theme.space[1] }}>
          RECOGNIZED AHEAD OF BROKERAGE
        </div>
        <div
          style={{
            fontSize: theme.size.xxl,
            fontFamily: theme.font.mono,
            fontWeight: 600,
            color: outstandingDeferred > 0 ? theme.amber : theme.text.primary,
          }}
        >
          {formatDollarsFull(outstandingDeferred)}
        </div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginTop: theme.space[2], lineHeight: 1.5 }}>
          Premium booked as income from assigned puts, still sitting in share cost
          basis at the brokerage. Releases as those shares are called away or sold.
          {openChains.length > 0 && ` Held across ${openChains.length} open position${openChains.length === 1 ? "" : "s"}.`}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "left" }}>Month</th>
              <th style={TH}>Booked</th>
              <th style={TH}>Distributable</th>
              <th style={TH}>Booked ahead</th>
              <th style={TH}>Deferred +</th>
              <th style={TH}>Released −</th>
              <th style={TH}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} style={{ borderBottom: `1px solid ${theme.border.default}` }}>
                <td style={{ ...TD, textAlign: "left", fontFamily: "inherit", color: theme.text.primary }}>
                  {monthLabel(m.month)}
                </td>
                <td style={{ ...TD, color: theme.text.secondary }}>{formatDollarsFull(m.booked)}</td>
                <td style={{ ...TD, color: theme.text.primary, fontWeight: 600 }}>
                  {formatDollarsFull(m.distributable)}
                </td>
                <td style={{ ...TD, color: m.delta === 0 ? theme.text.faint : m.delta > 0 ? theme.amber : theme.green }}>
                  {m.delta === 0 ? "—" : formatDollarsFull(m.delta)}
                </td>
                <td style={{ ...TD, color: m.deferredAdded ? theme.text.secondary : theme.text.faint }}>
                  {m.deferredAdded ? formatDollarsFull(m.deferredAdded) : "—"}
                </td>
                <td style={{ ...TD, color: m.deferredReleased ? theme.green : theme.text.faint }}>
                  {m.deferredReleased ? formatDollarsFull(m.deferredReleased) : "—"}
                </td>
                <td style={{ ...TD, color: m.outstandingAtMonthEnd ? theme.text.secondary : theme.text.faint }}>
                  {m.outstandingAtMonthEnd ? formatDollarsFull(m.outstandingAtMonthEnd) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: theme.space[3], lineHeight: 1.6 }}>
        Booked is what every other view in this app reports. Distributable defers
        assigned-put premium into share cost basis and recognizes it at disposal,
        matching how Fidelity accounts for it. "Booked ahead" is booked minus
        distributable — positive means this app recognized income the brokerage
        had not. Covers all history and ignores the date filter above. Months
        before 2026 are provisional: pre-2026 bookkeeping is excluded from share-cycle
        matching unless the position carried into the trusted window.
      </div>
    </div>
  );
}
