/**
 * api/roll-analysis.js — Vercel serverless function
 *
 * GET  /api/roll-analysis
 *   Returns current rows from roll_analysis table (no fetch, just reads cache).
 *
 * POST /api/roll-analysis?threshold=25
 *   Triggers a fresh roll analysis for all qualifying below-cost CC positions
 *   within the given proximity threshold (default 25%). Writes results to the
 *   roll_analysis table and returns the rows.
 *
 * Qualifying criteria:
 *   - active CC strike < cost_basis_per_share  (below-cost situation)
 *   - (cost_basis_per_share - stock_price) / cost_basis_per_share <= threshold
 *
 * Roll premiums are fetched from Public.com via the same batch quotes endpoint
 * used for all other option quotes. Current CC mid comes from the existing
 * quotes cache — no extra API call needed for that.
 */

import { createClient } from "@supabase/supabase-js";

const PUBLIC_COM_BASE        = "https://api.public.com";
const ACCOUNT_ID             = process.env.PUBLIC_COM_ACCOUNT_ID;
const TOKEN_VALIDITY_MINUTES = 1440;
const TOKEN_BUFFER_MS        = 5 * 60 * 1000;

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// ── Public.com auth ───────────────────────────────────────────────────────────

async function getPublicAccessToken(supabase) {
  const { data: cached } = await supabase
    .from("app_cache")
    .select("value, expires_at")
    .eq("key", "public_com_token")
    .single();

  if (cached?.value && new Date(cached.expires_at).getTime() - TOKEN_BUFFER_MS > Date.now()) {
    return cached.value;
  }

  const secret = process.env.PUBLIC_COM_SECRET;
  if (!secret) throw new Error("PUBLIC_COM_SECRET not set");

  const res = await fetch(`${PUBLIC_COM_BASE}/userapiauthservice/personal/access-tokens`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ secret, validityInMinutes: TOKEN_VALIDITY_MINUTES }),
  });

  if (!res.ok) throw new Error(`Public.com auth failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  if (!data.accessToken) throw new Error("Public.com auth: no accessToken in response");

  const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_MINUTES * 60 * 1000).toISOString();
  await supabase.from("app_cache").upsert({ key: "public_com_token", value: data.accessToken, expires_at: expiresAt });
  return data.accessToken;
}

// ── Public.com quotes fetch ───────────────────────────────────────────────────

async function fetchPublicQuotes(token, instruments) {
  if (!ACCOUNT_ID) throw new Error("PUBLIC_COM_ACCOUNT_ID env var not set");
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/quotes`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ instruments }),
    }
  );
  if (!res.ok) throw new Error(`Public.com quotes failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.quotes || [];
}

// ── OCC symbol builder ────────────────────────────────────────────────────────

function buildOccSymbol(ticker, expiryIso, isCall, strike) {
  const [y, m, d]    = expiryIso.split("-");
  const expiry       = y.slice(2) + m + d;
  const side         = isCall ? "C" : "P";
  const strikePadded = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return `${ticker}${expiry}${side}${strikePadded}`;
}

// ── Expiry date helpers ───────────────────────────────────────────────────────

function getUpcomingFridays(fromDateStr, days = 70) {
  const results = [];
  const from  = new Date(fromDateStr + "T00:00:00");
  const until = new Date(from.getTime() + days * 86400000);
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d <= until) {
    if (d.getDay() === 5) {
      const iso       = d.toISOString().slice(0, 10);
      const dte       = Math.round((d - from) / 86400000);
      const dom       = d.getDate();
      const isMonthly = dom >= 15 && dom <= 21;
      results.push({ expiry: iso, dte, isMonthly });
    }
    d.setDate(d.getDate() + 1);
  }
  return results;
}

function findNearestExpiry(fridays, targetDTE) {
  let best = null, bestDiff = Infinity;
  for (const f of fridays) {
    const diff = Math.abs(f.dte - targetDTE);
    if (diff < bestDiff) { bestDiff = diff; best = f; }
  }
  return best;
}

// ── Strike rounding ───────────────────────────────────────────────────────────

function candidateStrikes(costBasis) {
  const rounded_1   = Math.round(costBasis);
  const rounded_250 = Math.round(costBasis / 2.5) * 2.5;
  const rounded_500 = Math.round(costBasis / 5) * 5;
  return [...new Set([rounded_1, rounded_250, rounded_500])];
}

// ── Cost basis helpers ────────────────────────────────────────────────────────

function parseSharesFromDescription(description) {
  if (!description) return 0;
  const m1 = description.match(/\((\d[\d,]*)[,\s]/);
  if (m1) return parseInt(m1[1].replace(/,/g, ""), 10);
  const m2 = description.match(/^(\d[\d,]*)/);
  if (m2) return parseInt(m2[1].replace(/,/g, ""), 10);
  return 0;
}

function getCostBasisPerShare(lots) {
  const totalFronted = lots.reduce((sum, lot) => sum + (lot.fronted || 0), 0);
  const totalShares  = lots.reduce((sum, lot) => sum + parseSharesFromDescription(lot.description), 0);
  if (!totalShares) return null;
  return Math.round((totalFronted / totalShares) * 100) / 100;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const supabase = getSupabase();

  // ── GET: return current cached results ────────────────────────────────────
  if (req.method === "GET") {
    const { data: rows, error } = await supabase
      .from("roll_analysis")
      .select("*")
      .order("ticker");

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, rows: rows || [] });
  }

  // ── POST: trigger fresh roll analysis ─────────────────────────────────────
  if (req.method === "POST") {
    const rawThreshold = parseFloat(req.query.threshold || "25");
    const threshold    = isNaN(rawThreshold) ? 25 : Math.min(50, Math.max(10, rawThreshold));
    const thresholdFrac = threshold / 100;
    const TODAY = new Date().toISOString().slice(0, 10);

    try {
      // 1. Load open positions: assigned shares + active CCs
      const [{ data: assignedRows, error: e1 }, { data: ccRows, error: e2 }] = await Promise.all([
        supabase
          .from("positions")
          .select("ticker, lots, capital_fronted")
          .eq("position_type", "assigned_shares"),
        supabase
          .from("positions")
          .select("ticker, strike, expiry_date")
          .eq("type", "CC"),
      ]);
      if (e1) throw new Error(`positions fetch failed: ${e1.message}`);
      if (e2) throw new Error(`CC fetch failed: ${e2.message}`);

      const ccByTicker = Object.fromEntries((ccRows || []).map(r => [r.ticker, r]));

      // 2. Compute cost basis per share; collect CC OCC symbols for cache lookup
      const belowCostPositions = [];
      for (const row of assignedRows || []) {
        const cc = ccByTicker[row.ticker];
        if (!cc?.expiry_date) continue;

        const costBasisPerShare = getCostBasisPerShare(row.lots || []);
        if (!costBasisPerShare) continue;
        if (cc.strike >= costBasisPerShare) continue; // not below cost — skip

        const ccOccSym = buildOccSymbol(row.ticker, cc.expiry_date, true, cc.strike);
        belowCostPositions.push({ ticker: row.ticker, lots: row.lots || [], costBasisPerShare, cc, ccOccSym });
      }

      if (!belowCostPositions.length) {
        // No below-cost positions — clear table and return empty
        await supabase.from("roll_analysis").delete().not("ticker", "is", null);
        return res.status(200).json({ ok: true, rows: [], threshold, note: "No below-cost CC positions found" });
      }

      // 3. Fetch stock prices + current CC mids from existing quotes cache
      const allSymbols = [
        ...belowCostPositions.map(p => p.ticker),
        ...belowCostPositions.map(p => p.ccOccSym),
      ];
      const { data: quoteRows } = await supabase
        .from("quotes")
        .select("symbol, mid")
        .in("symbol", allSymbols);

      const quoteCache = Object.fromEntries((quoteRows || []).map(q => [q.symbol, q.mid]));

      // 4. Apply threshold filter (stock within threshold% of cost basis)
      const qualifiedPositions = belowCostPositions.filter(pos => {
        const stockPrice = quoteCache[pos.ticker];
        if (stockPrice == null) return true; // include when no live price
        const pctBelow = (pos.costBasisPerShare - stockPrice) / pos.costBasisPerShare;
        return pctBelow <= thresholdFrac;
      });

      if (!qualifiedPositions.length) {
        await supabase.from("roll_analysis").delete().not("ticker", "is", null);
        return res.status(200).json({
          ok:   true,
          rows: [],
          threshold,
          note: `All ${belowCostPositions.length} below-cost positions are beyond the ${threshold}% threshold`,
        });
      }

      // 5. Calculate target expiry dates from upcoming Fridays
      const allFridays = getUpcomingFridays(TODAY, 70);
      const target14   = findNearestExpiry(allFridays, 14);
      const target28   = findNearestExpiry(allFridays, 28);

      // 6. Build roll instrument list (3 strike candidates × 2 expiry windows per ticker)
      const rollInstruments   = [];
      const seenSymbols       = new Set();
      const planByTicker      = {};

      for (const pos of qualifiedPositions) {
        const strikes      = candidateStrikes(pos.costBasisPerShare);
        const candidates14 = [];
        const candidates28 = [];

        for (const strike of strikes) {
          if (target14) {
            const sym = buildOccSymbol(pos.ticker, target14.expiry, true, strike);
            if (!seenSymbols.has(sym)) { seenSymbols.add(sym); rollInstruments.push({ symbol: sym, type: "OPTION" }); }
            candidates14.push({ sym, strike });
          }
          if (target28) {
            const sym = buildOccSymbol(pos.ticker, target28.expiry, true, strike);
            if (!seenSymbols.has(sym)) { seenSymbols.add(sym); rollInstruments.push({ symbol: sym, type: "OPTION" }); }
            candidates28.push({ sym, strike });
          }
        }

        planByTicker[pos.ticker] = { pos, candidates14, candidates28 };
      }

      // 7. Fetch roll premiums from Public.com
      let rollQuoteMap = {};
      if (rollInstruments.length > 0) {
        const token     = await getPublicAccessToken(supabase);
        const rawQuotes = await fetchPublicQuotes(token, rollInstruments);
        for (const q of rawQuotes) {
          const sym = q.instrument?.symbol;
          if (!sym) continue;
          const bid = q.bid != null ? parseFloat(q.bid) : null;
          const ask = q.ask != null ? parseFloat(q.ask) : null;
          rollQuoteMap[sym] = {
            outcome: q.outcome,
            mid:     bid != null && ask != null ? Math.round((bid + ask) / 2 * 100) / 100 : null,
          };
        }
      }

      // 8. Run roll math and build result rows
      function bestCandidate(candidates) {
        let best = null;
        for (const c of candidates) {
          const q = rollQuoteMap[c.sym];
          if (q?.outcome === "SUCCESS" && q.mid != null) {
            if (!best || q.mid > best.mid) best = { sym: c.sym, strike: c.strike, mid: q.mid };
          }
        }
        return best;
      }

      const now = new Date().toISOString();
      const upsertRows = [];

      for (const [ticker, plan] of Object.entries(planByTicker)) {
        const { pos, candidates14, candidates28 } = plan;
        const currentCCMid    = quoteCache[pos.ccOccSym] ?? null;
        const stockPrice      = quoteCache[ticker]        ?? null;
        const assignmentStrike = Math.round(pos.costBasisPerShare);

        const best14 = bestCandidate(candidates14);
        const best28 = bestCandidate(candidates28);

        const roll14Mid    = best14?.mid ?? null;
        const roll28Mid    = best28?.mid ?? null;
        const roll14Net    = roll14Mid != null && currentCCMid != null ? Math.round((roll14Mid - currentCCMid) * 100) / 100 : null;
        const roll28Net    = roll28Mid != null && currentCCMid != null ? Math.round((roll28Mid - currentCCMid) * 100) / 100 : null;
        const roll14Viable = roll14Net != null ? roll14Net >= 0 : null;
        const roll28Viable = roll28Net != null ? roll28Net >= 0 : null;

        // Detect monthly-only case: 14 DTE target exists but no candidates succeeded
        const notes = [];
        if (target14 && candidates14.length > 0 && !best14) {
          const monthly14 = allFridays.find(f => f.isMonthly && f.dte >= 10 && f.dte <= 22);
          if (!monthly14 || Math.abs(monthly14.dte - 14) > 4) {
            notes.push(`weekly options not available for ${ticker} 14 DTE window`);
          }
        }

        upsertRows.push({
          ticker,
          fetched_at:           now,
          threshold_pct:        threshold,
          cost_basis_per_share: pos.costBasisPerShare,
          current_stock_price:  stockPrice,
          assignment_strike:    assignmentStrike,
          current_cc_strike:    pos.cc.strike,
          current_cc_expiry:    pos.cc.expiry_date,
          current_cc_mid:       currentCCMid,
          roll_14dte_expiry:    target14?.expiry ?? null,
          roll_14dte_dte:       target14?.dte    ?? null,
          roll_14dte_mid:       roll14Mid,
          roll_14dte_net:       roll14Net,
          roll_14dte_viable:    roll14Viable,
          roll_28dte_expiry:    target28?.expiry ?? null,
          roll_28dte_dte:       target28?.dte    ?? null,
          roll_28dte_mid:       roll28Mid,
          roll_28dte_net:       roll28Net,
          roll_28dte_viable:    roll28Viable,
          any_viable:           roll14Viable === true || roll28Viable === true,
          data_sufficient:      currentCCMid != null && (roll14Mid != null || roll28Mid != null),
          notes:                notes.join("; "),
        });
      }

      // 9. Replace all rows (clean slate — removes stale tickers no longer in scope)
      await supabase.from("roll_analysis").delete().not("ticker", "is", null);
      if (upsertRows.length > 0) {
        const { error: insertErr } = await supabase.from("roll_analysis").insert(upsertRows);
        if (insertErr) throw new Error(`roll_analysis insert failed: ${insertErr.message}`);
      }

      return res.status(200).json({
        ok:           true,
        rows:         upsertRows,
        threshold,
        target_14dte: target14,
        target_28dte: target28,
        instruments:  rollInstruments.length,
      });

    } catch (err) {
      console.error("[api/roll-analysis]", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
