// Pure grouping / rollup for the History income-breakdown bars. Extracted from
// HistoryTab so the top-N + "Other" logic and share math are unit-testable
// without a DOM. Input rows are the already-summed group objects HistoryTab
// computes: tickerSummary (key "ticker", countKey "trades") or typeSummary
// (key "type", countKey "count").

/**
 * @param {Array<object>} list group summaries; each has `premium` (number),
 *                             a count field, and an id under `key`.
 * @param {object} opts
 * @param {string} opts.key              id property ("ticker" | "type")
 * @param {string} opts.countKey         count property ("trades" | "count")
 * @param {number} [opts.cap=Infinity]   max named rows before rolling into "Other"
 * @param {number} [opts.minTotalForShare=1] suppress share % when |total| below this
 * @returns {{ rows: Array<object>, total: number, maxAbs: number }}
 */
export function buildBreakdownRows(
  list,
  { key, countKey, cap = Infinity, minTotalForShare = 1 } = {}
) {
  const items = list.map((it) => ({
    id: it[key],
    label: String(it[key]),
    premium: it.premium,
    count: it[countKey] ?? 0,
    isOther: false,
  }));

  const total = items.reduce((s, r) => s + r.premium, 0);
  const byPremiumDesc = (a, b) => b.premium - a.premium;

  let shown;
  if (Number.isFinite(cap) && items.length > cap) {
    // Cut by magnitude so a big loss is never hidden in "Other".
    const ranked = [...items].sort((a, b) => Math.abs(b.premium) - Math.abs(a.premium));
    const kept = ranked.slice(0, cap).sort(byPremiumDesc);
    const rest = ranked.slice(cap);
    const other = {
      id: null,
      label: "Other",
      premium: rest.reduce((s, r) => s + r.premium, 0),
      count: rest.reduce((s, r) => s + r.count, 0),
      isOther: true,
      groups: rest.length,
    };
    shown = [...kept, other];
  } else {
    shown = items.sort(byPremiumDesc);
  }

  const shareOn = Math.abs(total) >= minTotalForShare;
  const rows = shown.map((r) => ({
    ...r,
    share: shareOn ? (r.premium / total) * 100 : null,
  }));

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.premium)), 1);

  return { rows, total, maxAbs };
}
