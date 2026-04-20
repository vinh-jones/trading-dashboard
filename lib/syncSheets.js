/**
 * lib/syncSheets.js — shared sync logic
 *
 * Exported as syncFromSheets(supabase) so it can be called by:
 *   api/sync.js      (POST /api/sync — manual sync button)
 *   api/snapshot.js  (cron — runs sync before computing EOD snapshot)
 *
 * Returns { tradesCount, positionsCount } on success; throws on failure.
 */

import { fetchSheetData } from "./parseSheets.js";

export async function syncFromSheets(supabase) {
  const { trades, positions, account } = await fetchSheetData();
  const { assigned_shares, open_csps, open_leaps } = positions;

  // ── 1. Upsert closed trades (append-only) ────────────────────────────────
  const tradeRows = trades.map(t => ({
    ticker:            t.ticker,
    type:              t.type,
    subtype:           t.subtype    || null,
    description:       t.description || null,
    strike:            t.strike     ?? null,
    contracts:         t.contracts  ?? null,
    open_date:         t.open_date,
    close_date:        t.close_date,
    expiry_date:       t.expiry_date || null,
    days_held:         t.days_held  ?? null,
    premium_collected: t.premium_collected != null ? Math.round(t.premium_collected) : null,
    kept_pct:          t.kept_pct   ?? null,
    entry_cost:        t.entry_cost ?? null,
    exit_cost:         t.exit_cost  ?? null,
    delta:             t.delta      ?? null,
    roi:               t.roi        ?? null,
    capital_fronted:   t.capital_fronted != null ? Math.round(t.capital_fronted) : null,
    source:            t.source     || "Ryan",
    notes:             t.notes      || "",
    synced_at:         new Date().toISOString(),
  }));

  // Trades with strike/contracts can use DB-level conflict resolution.
  // Trades without them (LEAPS, Shares, Spreads, Interest) have NULL strike/contracts,
  // and NULL != NULL in Postgres unique constraints, so every sync would insert duplicates.
  // Handle those with a manual pre-dedup check instead.
  const strikeRows     = tradeRows.filter(t => t.strike != null || t.contracts != null);
  const nullStrikeRows = tradeRows.filter(t => t.strike == null && t.contracts == null);

  if (strikeRows.length > 0) {
    // Detect stale rows where close_date changed for the same trade identity
    // (ticker+type+open_date+strike+contracts). Since close_date is part of the
    // upsert conflict key, filling in an earlyClose date would otherwise leave a
    // ghost row with the old expiry date alongside the corrected row.
    const { data: existingStrike } = await supabase
      .from("trades")
      .select("id, ticker, type, open_date, close_date, strike, contracts")
      .not("strike", "is", null);

    if (existingStrike?.length) {
      const existingByKey = {};
      for (const r of existingStrike) {
        const k = `${r.ticker}|${r.type}|${r.open_date}|${r.strike}|${r.contracts}`;
        if (!existingByKey[k]) existingByKey[k] = [];
        existingByKey[k].push(r);
      }
      const staleRows = [];
      for (const t of strikeRows) {
        const k = `${t.ticker}|${t.type}|${t.open_date}|${t.strike}|${t.contracts}`;
        for (const r of (existingByKey[k] || [])) {
          if (r.close_date !== t.close_date) staleRows.push(r);
        }
      }
      if (staleRows.length > 0) {
        const staleIds = staleRows.map(r => r.id);
        // Clean up empty-body journal entries that referenced these stale trades
        // (match by ticker + stale close_date, since trade_id may be null on old entries)
        for (const r of staleRows) {
          await supabase.from("journal_entries")
            .delete()
            .eq("entry_type", "trade_note")
            .eq("ticker", r.ticker)
            .eq("entry_date", r.close_date)
            .eq("body", "");
        }
        await supabase.from("trades").delete().in("id", staleIds);
      }
    }

    const { error } = await supabase
      .from("trades")
      .upsert(strikeRows, {
        onConflict: "ticker,type,open_date,close_date,strike,contracts",
        ignoreDuplicates: false,
      });
    if (error) throw new Error(`Trades upsert failed: ${error.message}`);
  }

  if (nullStrikeRows.length > 0) {
    const { data: existingNullStrike } = await supabase
      .from("trades")
      .select("id, ticker, type, open_date, close_date, description")
      .is("strike", null)
      .is("contracts", null);

    // Group by stable key (without close_date) to detect close_date changes
    const existingNullByKey = {};
    for (const r of existingNullStrike || []) {
      const k = `${r.ticker}|${r.type}|${r.open_date}|${r.description}`;
      if (!existingNullByKey[k]) existingNullByKey[k] = [];
      existingNullByKey[k].push(r);
    }

    const newNullStrikeRows = [];
    const staleNullRows = [];
    const seenNullKeys = new Set();
    for (const t of nullStrikeRows) {
      const k = `${t.ticker}|${t.type}|${t.open_date}|${t.description}`;
      if (seenNullKeys.has(k)) continue; // within-batch dedup for identical lots
      seenNullKeys.add(k);
      const existing = existingNullByKey[k] || [];
      const exactMatches = existing.filter(r => r.close_date === t.close_date);
      if (exactMatches.length > 0) {
        // Row is current — purge any extra copies left over from a previous-sync dupe bug
        for (const r of exactMatches.slice(1)) staleNullRows.push(r);
        for (const r of existing.filter(r => r.close_date !== t.close_date)) staleNullRows.push(r);
        continue;
      }
      // Brand new or close_date changed → delete all stale, insert fresh
      for (const r of existing) staleNullRows.push(r);
      newNullStrikeRows.push(t);
      // Mark as seen so same-sync duplicates (e.g. multiple lots with identical key) are skipped
      if (!existingNullByKey[k]) existingNullByKey[k] = [];
      existingNullByKey[k].push({ close_date: t.close_date });
    }

    if (staleNullRows.length > 0) {
      for (const r of staleNullRows) {
        await supabase.from("journal_entries")
          .delete()
          .eq("entry_type", "trade_note")
          .eq("ticker", r.ticker)
          .eq("entry_date", r.close_date)
          .eq("body", "");
      }
      await supabase.from("trades").delete().in("id", staleNullRows.map(r => r.id));
    }

    if (newNullStrikeRows.length > 0) {
      const { error } = await supabase.from("trades").insert(newNullStrikeRows);
      if (error) throw new Error(`LEAPS/Shares trades insert failed: ${error.message}`);
    }
  }

  // ── 2. Replace positions entirely ────────────────────────────────────────
  const { error: delError } = await supabase
    .from("positions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delError) throw new Error(`Positions delete failed: ${delError.message}`);

  const positionRows = [
    // Assigned shares — one row per ticker (lots stored as JSONB)
    ...assigned_shares.map(s => ({
      position_type:   "assigned_shares",
      ticker:          s.ticker,
      type:            "Shares",
      capital_fronted: s.cost_basis_total != null ? Math.round(s.cost_basis_total) : null,
      has_active_cc:   !!s.active_cc,
      lots:            s.positions,   // JSONB: [{ description, fronted }]
      notes:           s.notes || "",
      synced_at:       new Date().toISOString(),
    })),

    // Active covered calls — one row per ticker that has one
    ...assigned_shares
      .filter(s => s.active_cc)
      .map(s => ({
        position_type:     "open_csp",
        ticker:            s.active_cc.ticker,
        type:              "CC",
        strike:            s.active_cc.strike,
        contracts:         s.active_cc.contracts,
        open_date:         s.active_cc.open_date,
        expiry_date:       s.active_cc.expiry_date,
        days_to_expiry:    s.active_cc.days_to_expiry,
        premium_collected: s.active_cc.premium_collected != null ? Math.round(s.active_cc.premium_collected) : null,
        entry_cost:        s.active_cc.entry_cost ?? null,
        delta:             s.active_cc.delta      ?? null,
        roi:               s.active_cc.roi        ?? null,
        capital_fronted:   s.active_cc.capital_fronted  != null ? Math.round(s.active_cc.capital_fronted)  : null,
        source:            s.active_cc.source || "Ryan",
        notes:             s.active_cc.notes  || "",
        synced_at:         new Date().toISOString(),
      })),

    // LEAPS nested inside assigned shares
    ...assigned_shares.flatMap(s =>
      (s.open_leaps || []).map(l => ({
        position_type:   "open_leaps",
        ticker:          l.ticker,
        type:            "LEAPS",
        subtype:         l.subtype || "Held",
        description:     l.description || null,
        open_date:       l.open_date,
        expiry_date:     l.expiry_date    ?? null,
        contracts:       l.contracts      ?? null,
        strike:          l.strike         ?? null,
        entry_cost:      l.entry_cost     ?? null,
        capital_fronted: l.capital_fronted != null ? Math.round(l.capital_fronted) : null,
        source:          l.source || "Ryan",
        notes:           l.notes  || "",
        synced_at:       new Date().toISOString(),
      }))
    ),

    // Open CSPs
    ...open_csps.map(c => ({
      position_type:     "open_csp",
      ticker:            c.ticker,
      type:              "CSP",
      strike:            c.strike,
      contracts:         c.contracts,
      open_date:         c.open_date,
      expiry_date:       c.expiry_date,
      days_to_expiry:    c.days_to_expiry,
      premium_collected: c.premium_collected != null ? Math.round(c.premium_collected) : null,
      entry_cost:        c.entry_cost ?? null,
      delta:             c.delta      ?? null,
      roi:               c.roi        ?? null,
      capital_fronted:   c.capital_fronted   != null ? Math.round(c.capital_fronted)   : null,
      source:            c.source || "Ryan",
      notes:             c.notes  || "",
      synced_at:         new Date().toISOString(),
    })),

    // Standalone LEAPS (not nested in any assigned share)
    ...open_leaps.map(l => ({
      position_type:   "open_leaps",
      ticker:          l.ticker,
      type:            "LEAPS",
      subtype:         l.subtype || "Held",
      description:     l.description || null,
      open_date:       l.open_date,
      expiry_date:     l.expiry_date    ?? null,
      contracts:       l.contracts      ?? null,
      strike:          l.strike         ?? null,
      entry_cost:      l.entry_cost     ?? null,
      capital_fronted: l.capital_fronted != null ? Math.round(l.capital_fronted) : null,
      source:          l.source || "Ryan",
      notes:           l.notes  || "",
      synced_at:       new Date().toISOString(),
    })),
  ];

  if (positionRows.length > 0) {
    const { error } = await supabase.from("positions").insert(positionRows);
    if (error) throw new Error(`Positions insert failed: ${error.message}`);
  }

  // ── 3. Upsert today's account snapshot ───────────────────────────────────
  const TODAY = new Date().toISOString().slice(0, 10);
  const { error: snapError } = await supabase
    .from("account_snapshots")
    .upsert({
      snapshot_date:         TODAY,
      account_value:         account.account_value,
      cost_basis:            account.cost_basis,
      free_cash_est:         account.free_cash_est,
      free_cash_pct_est:     account.free_cash_pct_est,
      month_to_date_premium: account.month_to_date_premium,
      current_month:         account.current_month,
      current_year:          account.year,
      synced_at:             new Date().toISOString(),
    }, { onConflict: "snapshot_date" });
  if (snapError) throw new Error(`Account snapshot upsert failed: ${snapError.message}`);

  return { tradesCount: tradeRows.length, positionsCount: positionRows.length };
}
