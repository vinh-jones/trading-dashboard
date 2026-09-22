/**
 * Daily assigned-share exposure — docs/spec_share_exposure_daily_v1.md
 *
 * ONE algorithm for both the live row (api/snapshot.js) and the ledger
 * backfill, so the two paths agree by construction (spec §6.1). The live path
 * is just "the ledger evaluated at today".
 *
 * Lot sources:
 *   - closed lots: `trades` (closed-only). Shares need subtype = 'Sold';
 *     subtype = 'Assigned' rows are same-day event markers that duplicate a
 *     Sold row or a still-open `positions` lot, so they're dropped (§3).
 *   - open lots:   `positions`. Shares come from lots[] (the row itself has no
 *     open_date); LEAPS and CSPs are one lot per row.
 *
 * A lot is open on day d when open_date <= d < close_date (open lots: no
 * close_date). All amounts are gross basis (capital_fronted), never market
 * value.
 *
 * CCs are stored under position_type = 'open_csp' with type = 'CC' (see
 * CLAUDE.md). They are collateralised by shares already counted here, so the
 * CSP bucket filters on type, never position_type alone.
 */

export const BACKFILL_START = "2025-11-21";
// §4: account_value has been static since before account_snapshots began.
// Days before the first account_snapshots row use this, un-guessed.
export const FALLBACK_BOOK = 875131.25;
const DESCRIPTION_BASIS_TOLERANCE = 100;

const num = v => Number(v) || 0;

/**
 * Normalise positions + closed trades into three lot lists.
 * @returns {{ shares: Lot[], leaps: Lot[], csp: Lot[] }}
 *   Lot = { ticker, open_date, close_date|null, amount, description|null, source }
 */
export function buildExposureLots({ positions = [], trades = [] }) {
  const shares = [];
  const leaps  = [];
  const csp    = [];

  for (const t of trades) {
    if (!t.open_date || !t.close_date) continue;
    const lot = {
      ticker:      t.ticker,
      open_date:   t.open_date,
      close_date:  t.close_date,
      amount:      num(t.capital_fronted),
      description: t.description ?? null,
      source:      "trades",
    };
    if (t.type === "Shares" && t.subtype === "Sold") shares.push(lot);
    else if (t.type === "LEAPS")                     leaps.push(lot);
    else if (t.type === "CSP")                       csp.push(lot);
  }

  for (const p of positions) {
    if (p.position_type === "assigned_shares") {
      for (const l of Array.isArray(p.lots) ? p.lots : []) {
        shares.push({
          ticker:      p.ticker,
          open_date:   l.open_date ?? null,
          close_date:  null,
          amount:      num(l.fronted),
          description: l.description ?? null,
          source:      "positions",
        });
      }
    } else if (p.position_type === "open_leaps") {
      leaps.push({ ticker: p.ticker, open_date: p.open_date ?? null, close_date: null,
                   amount: num(p.capital_fronted), description: null, source: "positions" });
    } else if (p.position_type === "open_csp" && p.type === "CSP") {
      csp.push({ ticker: p.ticker, open_date: p.open_date ?? null, close_date: null,
                 amount: num(p.capital_fronted), description: null, source: "positions" });
    }
  }

  return { shares, leaps, csp };
}

// An open lot with no open_date is counted as open (it's in positions right
// now); a closed lot with none never reaches here (filtered above).
function isOpenOn(lot, d) {
  if (lot.open_date && lot.open_date > d) return false;
  if (lot.close_date && d >= lot.close_date) return false;
  return true;
}

/**
 * Parse "Shares (1000, $20)" / "Shares ($121, 300)" into an implied basis.
 * Returns null when the description doesn't carry both a share count and a
 * price (e.g. "Shares ($18)").
 */
export function impliedBasisFromDescription(description) {
  if (!description) return null;
  const inner = description.match(/\(([^)]*)\)/)?.[1];
  if (!inner) return null;
  let price = null;
  let qty   = null;
  for (const part of inner.split(",").map(s => s.trim())) {
    const m = part.match(/^\$([\d.]+)$/);
    if (m) price = Number(m[1]);
    else if (/^\d+$/.test(part)) qty = Number(part);
  }
  return price != null && qty != null ? price * qty : null;
}

/**
 * §5: flag share lots whose description implies a basis more than $100 away
 * from the stored capital_fronted. Surfaced, never corrected.
 */
export function findDescriptionConflicts(shareLots) {
  const out = [];
  for (const lot of shareLots) {
    const implied = impliedBasisFromDescription(lot.description);
    if (implied == null) continue;
    if (Math.abs(implied - lot.amount) > DESCRIPTION_BASIS_TOLERANCE) {
      out.push({
        ticker:      lot.ticker,
        open_date:   lot.open_date,
        description: lot.description,
        implied,
        stored:      lot.amount,
        source:      lot.source,
      });
    }
  }
  return out;
}

/**
 * Denominator for day d: the latest account_snapshots.account_value on or
 * before d, else FALLBACK_BOOK (§4).
 * @param {Array<{snapshot_date, account_value}>} accountRows sorted ascending
 */
export function denominatorFor(d, accountRows) {
  let value = null;
  for (const r of accountRows) {
    if (r.snapshot_date > d) break;
    if (r.account_value != null) value = Number(r.account_value);
  }
  return value ?? FALLBACK_BOOK;
}

/** Compute one share_exposure_daily row (minus computed_at). */
export function computeExposureRow({ lots, date, denominator, source }) {
  const byTicker = {};
  let sharesTotal = 0;
  for (const lot of lots.shares) {
    if (!isOpenOn(lot, date)) continue;
    sharesTotal += lot.amount;
    byTicker[lot.ticker] = (byTicker[lot.ticker] || 0) + lot.amount;
  }
  const sumOpen = list => list.reduce((s, l) => (isOpenOn(l, date) ? s + l.amount : s), 0);

  return {
    snapshot_date:        date,
    shares_basis_total:   sharesTotal,
    shares_basis_pct:     denominator > 0 ? Math.round((sharesTotal / denominator) * 1e6) / 1e4 : null,
    book_denominator:     denominator,
    n_tickers:            Object.keys(byTicker).length,
    by_ticker:            byTicker,
    leaps_basis_total:    sumOpen(lots.leaps),
    csp_collateral_total: sumOpen(lots.csp),
    source,
  };
}

/** Inclusive list of YYYY-MM-DD calendar days from `from` to `to`. */
export function calendarDays(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Rows for every calendar day in [from, to]. `to` gets `source = 'live'` when
 * `liveDate === to`; every other day is a ledger reconstruction.
 */
export function buildExposureRows({ positions, trades, accountRows, from, to, liveDate = null }) {
  const lots = buildExposureLots({ positions, trades });
  const sortedAccounts = [...(accountRows || [])].sort((a, b) =>
    a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0);
  const rows = calendarDays(from, to).map(date =>
    computeExposureRow({
      lots,
      date,
      denominator: denominatorFor(date, sortedAccounts),
      source:      date === liveDate ? "live" : "backfill_ledger",
    }));
  return { rows, conflicts: findDescriptionConflicts(lots.shares) };
}

/**
 * Live-path writer used by api/snapshot.js: upserts today's row plus any
 * calendar days missing since the last stored row (weekends — the snapshot
 * cron is Mon–Fri — and missed runs). An empty table fills from
 * BACKFILL_START, so the first run doubles as the one-time backfill.
 */
export async function writeShareExposure({ supabase, positions, today }) {
  const [lastRes, tradesRes, acctRes] = await Promise.all([
    supabase.from("share_exposure_daily")
      .select("snapshot_date").lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false }).limit(1),
    supabase.from("trades")
      .select("ticker, type, subtype, description, open_date, close_date, capital_fronted")
      .in("type", ["Shares", "LEAPS", "CSP"])
      // Newest first: if this ever hits PostgREST's 1000-row cap, the rows
      // dropped are the oldest — irrelevant to a recent gap-fill.
      .order("close_date", { ascending: false }).limit(1000),
    supabase.from("account_snapshots")
      .select("snapshot_date, account_value").lte("snapshot_date", today)
      .order("snapshot_date", { ascending: true }),
  ]);
  for (const r of [lastRes, tradesRes, acctRes]) if (r.error) throw r.error;

  const last = lastRes.data?.[0]?.snapshot_date;
  let from = BACKFILL_START;
  if (last) {
    const next = new Date(`${last}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    from = next.toISOString().slice(0, 10);
  }

  const { rows, conflicts } = buildExposureRows({
    positions, trades: tradesRes.data || [], accountRows: acctRes.data || [],
    from, to: today, liveDate: today,
  });
  for (const c of conflicts) {
    console.warn(`[share-exposure] ${c.ticker} lot ${c.open_date}: description "${c.description}" implies $${c.implied}, capital_fronted is $${c.stored}`);
  }

  const computed_at = new Date().toISOString();
  const { error } = await supabase.from("share_exposure_daily")
    .upsert(rows.map(r => ({ ...r, computed_at })), { onConflict: "snapshot_date" });
  if (error) throw error;

  return { written: rows.length, from, today: rows[rows.length - 1], conflicts };
}
