/**
 * api/spike-roll-analysis.js — Spike: Roll-to-Assignment-Price Opportunity Detection
 *
 * GET /api/spike-roll-analysis
 *
 * Feasibility investigation for fetching real-time option mid prices at
 * assignment-price strikes for ~14 DTE and ~28 DTE windows, for each
 * assigned-shares position with a below-cost covered call.
 *
 * Tests:
 *   Step 1 — Is current CC mid already in the quotes table?
 *   Step 2 — Can we determine target expiry dates (tries all upcoming Fridays,
 *             not just monthly 3rd Fridays, so weeklies are tested implicitly)
 *   Step 3 — Does fetchPublicQuotes return mid prices for assignment-strike OCC
 *             symbols we constructed (i.e. options we don't currently hold)?
 *   Step 4 — Does the roll math produce interpretable results?
 *   Step 5 — Response time + outcome rates at expected call volume
 *
 * Requires X-Ingest-Secret header.
 *
 * Usage:
 *   curl -H "X-Ingest-Secret: <secret>" https://<host>/api/spike-roll-analysis
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

// ── Public.com auth (reuses cached token) ─────────────────────────────────────

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Public.com auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.accessToken) throw new Error("Public.com auth: no accessToken in response");

  const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_MINUTES * 60 * 1000).toISOString();
  await supabase
    .from("app_cache")
    .upsert({ key: "public_com_token", value: data.accessToken, expires_at: expiresAt });

  return data.accessToken;
}

// ── Public.com quotes fetch ───────────────────────────────────────────────────

async function fetchPublicQuotes(token, instruments) {
  if (!ACCOUNT_ID) throw new Error("PUBLIC_COM_ACCOUNT_ID env var not set");
  const res = await fetch(
    `${PUBLIC_COM_BASE}/userapigateway/marketdata/${ACCOUNT_ID}/quotes`,
    {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ instruments }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Public.com quotes failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.quotes || [];
}

// ── OCC symbol builder ────────────────────────────────────────────────────────

function buildOccSymbol(ticker, expiryIso, isCall, strike) {
  const [y, m, d] = expiryIso.split("-");
  const expiry        = y.slice(2) + m + d;
  const side          = isCall ? "C" : "P";
  const strikePadded  = String(Math.round(parseFloat(strike) * 1000)).padStart(8, "0");
  return `${ticker}${expiry}${side}${strikePadded}`;
}

// ── Expiry date helpers ───────────────────────────────────────────────────────

/**
 * Returns all upcoming Fridays (including monthly expiries) within `days` days
 * of fromDateStr.  Monthly 3rd-Friday expiries are flagged so callers can tell
 * which Fridays are standard monthly options vs. weeklies-only.
 */
function getUpcomingFridays(fromDateStr, days = 70) {
  const results = [];
  const from  = new Date(fromDateStr + "T00:00:00");
  const until = new Date(from.getTime() + days * 86400000);

  const d = new Date(from);
  d.setDate(d.getDate() + 1); // start tomorrow

  while (d <= until) {
    if (d.getDay() === 5) { // Friday
      const iso       = d.toISOString().slice(0, 10);
      const dte       = Math.round((d - from) / 86400000);
      const isMonthly = isThirdFriday(d);
      results.push({ expiry: iso, dte, isMonthly });
    }
    d.setDate(d.getDate() + 1);
  }

  return results;
}

function isThirdFriday(date) {
  if (date.getDay() !== 5) return false;
  // A Friday is the 3rd Friday if (day-of-month - 1) / 7 === 2  (i.e. 15–21)
  const dom = date.getDate();
  return dom >= 15 && dom <= 21;
}

function calcDTE(expiryIso, fromDateStr) {
  const from   = new Date(fromDateStr + "T00:00:00");
  const expiry = new Date(expiryIso   + "T00:00:00");
  return Math.round((expiry - from) / 86400000);
}

/** Returns the Friday entry whose DTE is closest to targetDTE. */
function findNearestExpiry(fridays, targetDTE) {
  let best = null, bestDiff = Infinity;
  for (const f of fridays) {
    const diff = Math.abs(f.dte - targetDTE);
    if (diff < bestDiff) { bestDiff = diff; best = f; }
  }
  return best;
}

// ── Strike rounding ───────────────────────────────────────────────────────────

/**
 * Round a cost-basis price to the nearest standard option strike increment.
 * Returns { exact, rounded_1, rounded_250, rounded_500 } so the spike can
 * test multiple candidates and see which yields a successful quote.
 *
 * Standard US equity option strike increments (approximate):
 *   ≤$25    → $0.50 or $1
 *   $25–$200 → $1 or $2.50
 *   >$200   → $5 or $10
 *
 * We test three rounding levels for each ticker; the spike reports which one
 * returns a valid mid.
 */
function candidateStrikes(costBasis) {
  const exact        = parseFloat(costBasis.toFixed(2));
  const rounded_1    = Math.round(exact);
  const rounded_250  = Math.round(exact / 2.5) * 2.5;
  const rounded_500  = Math.round(exact / 5)   * 5;
  // Deduplicate
  return [...new Set([rounded_1, rounded_250, rounded_500])];
}

// ── Cost-basis helpers ────────────────────────────────────────────────────────

/**
 * Parse share count from the lot description string, e.g.:
 *   "Shares (300, $175)"  → 300
 *   "100 @ $126"          → 100
 * Falls back to 0 if unparseable.
 */
function parseSharesFromDescription(description) {
  if (!description) return 0;
  // Pattern 1: "Shares (300, $175)"
  const m1 = description.match(/\((\d[\d,]*)[,\s]/);
  if (m1) return parseInt(m1[1].replace(/,/g, ""), 10);
  // Pattern 2: "100 @ $126" or "100 shares"
  const m2 = description.match(/^(\d[\d,]*)/);
  if (m2) return parseInt(m2[1].replace(/,/g, ""), 10);
  return 0;
}

function getCostBasisPerShare(assignedSharesPosition) {
  const totalFronted = assignedSharesPosition.positions
    .reduce((sum, lot) => sum + (lot.fronted || 0), 0);
  const totalShares  = assignedSharesPosition.positions
    .reduce((sum, lot) => sum + parseSharesFromDescription(lot.description), 0);
  if (!totalShares) return null;
  return Math.round((totalFronted / totalShares) * 100) / 100;
}

// ── Roll math ─────────────────────────────────────────────────────────────────

function analyzeRollOpportunity({ ticker, costBasisPerShare, currentCCMid, roll14, roll28 }) {
  const assignmentStrike = Math.round(costBasisPerShare); // nearest whole dollar

  function leg(roll) {
    if (!roll || roll.mid == null) return { expiry: roll?.expiry ?? null, dte: roll?.dte ?? null, strike: roll?.strike ?? null, premium: null, net: null, viable: null };
    const net = roll.mid - currentCCMid;
    return {
      expiry:  roll.expiry,
      dte:     roll.dte,
      strike:  roll.strike,
      symbol:  roll.symbol,
      premium: Math.round(roll.mid * 100) / 100,
      net:     Math.round(net * 100) / 100,
      viable:  net >= 0,
    };
  }

  const leg14 = leg(roll14);
  const leg28 = leg(roll28);

  return {
    ticker,
    cost_basis_per_share: costBasisPerShare,
    assignment_strike:    assignmentStrike,
    current_cc_mid:       Math.round(currentCCMid * 100) / 100,
    roll_14dte:           leg14,
    roll_28dte:           leg28,
    any_viable:           (leg14.viable === true) || (leg28.viable === true),
  };
}

// ── 25% below-cost UX filter ──────────────────────────────────────────────────

/**
 * Returns true if the position qualifies for roll analysis:
 *   - Active CC strike below cost basis (below-cost situation)
 *   - Stock price within 25% of cost basis (not so far underwater that roll math is useless)
 *   - If stockPrice is not available, qualifies on CC-strike criterion alone
 */
function qualifiesForRollAnalysis(costBasisPerShare, ccStrike, stockPrice) {
  if (ccStrike >= costBasisPerShare) return false; // at or above cost basis — not a below-cost CC
  if (stockPrice == null) return true;             // no live price, include anyway
  const pctBelow = (costBasisPerShare - stockPrice) / costBasisPerShare;
  return pctBelow <= 0.25;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret     = process.env.MARKET_CONTEXT_INGEST_SECRET;
  const authHeader = req.headers["x-ingest-secret"];
  if (secret && authHeader !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized — X-Ingest-Secret required" });
  }

  const TODAY = new Date().toISOString().slice(0, 10);

  try {
    const supabase = getSupabase();

    // ── Step 1: Load positions + existing quotes ───────────────────────────────

    const [{ data: posRows }, { data: ccRows }, { data: cachedQuotes }] = await Promise.all([
      supabase
        .from("positions")
        .select("ticker, position_type, lots, capital_fronted")
        .eq("position_type", "assigned_shares"),
      supabase
        .from("positions")
        .select("ticker, type, strike, expiry_date, position_type")
        .eq("type", "CC"),
      supabase
        .from("quotes")
        .select("symbol, mid, bid, ask, refreshed_at")
        .eq("instrument_type", "OPTION"),
    ]);

    const ccByTicker    = Object.fromEntries((ccRows || []).map(r => [r.ticker, r]));
    const quotedMidMap  = Object.fromEntries((cachedQuotes || []).map(q => [q.symbol, q]));

    // ── Step 2: Identify positions in scope + check step-1 CC mid ────────────

    const step1Results = [];
    const qualifiedPositions = [];

    for (const pos of posRows || []) {
      const cc = ccByTicker[pos.ticker];
      if (!cc) continue;

      // Reconstruct the lots array from the DB field
      const lots = pos.lots || [];
      const mockPos = { positions: lots };
      const costBasisPerShare = getCostBasisPerShare(mockPos);

      // Check step-1 availability of current CC mid from existing quotes cache
      const ccOccSymbol     = cc.expiry_date ? buildOccSymbol(cc.ticker, cc.expiry_date, true, cc.strike) : null;
      const cachedCCQuote   = ccOccSymbol ? quotedMidMap[ccOccSymbol] : null;
      const cachedCCMid     = cachedCCQuote?.mid ?? null;

      step1Results.push({
        ticker:             pos.ticker,
        cc_strike:          cc.strike,
        cc_expiry:          cc.expiry_date,
        cc_occ_symbol:      ccOccSymbol,
        cost_basis_per_share: costBasisPerShare,
        cc_mid_in_cache:    cachedCCMid != null,
        cc_mid:             cachedCCMid,
        cache_age_min:      cachedCCQuote?.refreshed_at
          ? Math.round((Date.now() - new Date(cachedCCQuote.refreshed_at).getTime()) / 60000)
          : null,
      });

      if (costBasisPerShare != null && cc.strike < costBasisPerShare) {
        qualifiedPositions.push({ pos, cc, costBasisPerShare, ccOccSymbol, cachedCCMid });
      }
    }

    // ── Step 2: Calculate target expiry dates ─────────────────────────────────

    const allFridays   = getUpcomingFridays(TODAY, 70);
    const target14     = findNearestExpiry(allFridays, 14);
    const target28     = findNearestExpiry(allFridays, 28);

    // ── Step 3: Build instrument list for assignment-strike mids ──────────────

    // We need live CC mids (in case cache is stale) + roll candidates
    const instruments = [];
    const positionPlans = [];

    for (const { pos, cc, costBasisPerShare, ccOccSymbol } of qualifiedPositions) {
      const ticker     = pos.ticker;
      const strikes    = candidateStrikes(costBasisPerShare);
      const primaryStrike = strikes[0]; // rounded to nearest $1

      // Current CC — always include to get a fresh mid
      if (ccOccSymbol) instruments.push({ symbol: ccOccSymbol, type: "OPTION" });

      // Roll candidates at each target expiry × each candidate strike
      const rollCandidates14 = [], rollCandidates28 = [];

      for (const strike of strikes) {
        if (target14) {
          const sym = buildOccSymbol(ticker, target14.expiry, true, strike);
          instruments.push({ symbol: sym, type: "OPTION" });
          rollCandidates14.push({ symbol: sym, strike, expiry: target14.expiry, dte: target14.dte });
        }
        if (target28) {
          const sym = buildOccSymbol(ticker, target28.expiry, true, strike);
          instruments.push({ symbol: sym, type: "OPTION" });
          rollCandidates28.push({ symbol: sym, strike, expiry: target28.expiry, dte: target28.dte });
        }
      }

      positionPlans.push({ ticker, costBasisPerShare, cc, ccOccSymbol, primaryStrike, rollCandidates14, rollCandidates28 });
    }

    // Deduplicate instruments by symbol
    const uniqueInstruments = [];
    const seen = new Set();
    for (const inst of instruments) {
      if (!seen.has(inst.symbol)) { seen.add(inst.symbol); uniqueInstruments.push(inst); }
    }

    // ── Step 3 + 5: Fetch quotes, measure response time ───────────────────────

    const token     = await getPublicAccessToken(supabase);
    const fetchStart = Date.now();
    const rawQuotes = uniqueInstruments.length > 0
      ? await fetchPublicQuotes(token, uniqueInstruments)
      : [];
    const responseTimeMs = Date.now() - fetchStart;

    const liveQuoteMap = {};
    for (const q of rawQuotes) {
      const sym = q.instrument?.symbol;
      if (!sym) continue;
      const bid = q.bid != null ? parseFloat(q.bid) : null;
      const ask = q.ask != null ? parseFloat(q.ask) : null;
      liveQuoteMap[sym] = {
        outcome: q.outcome,
        bid,
        ask,
        mid: bid != null && ask != null ? Math.round((bid + ask) / 2 * 100) / 100 : null,
      };
    }

    // ── Step 4: Run roll math per ticker ──────────────────────────────────────

    const rollFindings = [];

    for (const plan of positionPlans) {
      const { ticker, costBasisPerShare, cc, ccOccSymbol, rollCandidates14, rollCandidates28 } = plan;

      // Live CC mid (prefer fresh, fall back to cache)
      const liveCC        = liveQuoteMap[ccOccSymbol];
      const currentCCMid  = liveCC?.mid ?? null;

      // Find the best (SUCCESS + highest mid) roll candidate per window
      function bestRollCandidate(candidates) {
        let best = null;
        for (const c of candidates) {
          const q = liveQuoteMap[c.symbol];
          if (q?.outcome === "SUCCESS" && q.mid != null) {
            if (!best || q.mid > best.mid) best = { ...c, mid: q.mid, outcome: q.outcome };
          }
        }
        // If no SUCCESS, record the first failure for diagnostics
        if (!best && candidates.length) {
          const first = candidates[0];
          const q     = liveQuoteMap[first.symbol] || {};
          return { ...first, mid: null, outcome: q.outcome || "NO_RESPONSE" };
        }
        return best;
      }

      const roll14 = bestRollCandidate(rollCandidates14);
      const roll28 = bestRollCandidate(rollCandidates28);

      // All outcomes for diagnostics
      const allOutcomes14 = rollCandidates14.map(c => ({
        symbol: c.symbol, strike: c.strike,
        outcome: liveQuoteMap[c.symbol]?.outcome ?? "NO_RESPONSE",
        mid:     liveQuoteMap[c.symbol]?.mid ?? null,
      }));
      const allOutcomes28 = rollCandidates28.map(c => ({
        symbol: c.symbol, strike: c.strike,
        outcome: liveQuoteMap[c.symbol]?.outcome ?? "NO_RESPONSE",
        mid:     liveQuoteMap[c.symbol]?.mid ?? null,
      }));

      const analysis = currentCCMid != null
        ? analyzeRollOpportunity({ ticker, costBasisPerShare, currentCCMid, roll14, roll28 })
        : null;

      rollFindings.push({
        ticker,
        cost_basis_per_share: costBasisPerShare,
        cc_occ_symbol:        ccOccSymbol,
        cc_outcome:           liveCC?.outcome,
        current_cc_mid:       currentCCMid,
        roll_14dte_candidates: allOutcomes14,
        roll_14dte_best:       roll14,
        roll_28dte_candidates: allOutcomes28,
        roll_28dte_best:       roll28,
        roll_analysis:         analysis,
        data_sufficient:       currentCCMid != null && (roll14?.mid != null || roll28?.mid != null),
      });
    }

    // ── Summary + go/no-go ────────────────────────────────────────────────────

    const ccSuccessCount   = rollFindings.filter(f => f.cc_outcome   === "SUCCESS").length;
    const roll14SuccessCount = rollFindings.filter(f => f.roll_14dte_best?.outcome === "SUCCESS").length;
    const roll28SuccessCount = rollFindings.filter(f => f.roll_28dte_best?.outcome === "SUCCESS").length;
    const dataCompleteCount  = rollFindings.filter(f => f.data_sufficient).length;
    const total              = rollFindings.length;

    // Go = can compute roll math for ≥60% of positions in scope
    // Partial = can compute for some but not all
    // No-go = rate limits hit, or <30% success, or no mid prices at all
    let goNogo = "NO_GO";
    if (dataCompleteCount / total >= 0.6) goNogo = "GO";
    else if (dataCompleteCount > 0)       goNogo = "PARTIAL_GO";

    // Step 1 summary: what % of positions already have CC mid in quotes cache?
    const step1CachedCount = step1Results.filter(r => r.cc_mid_in_cache).length;

    return res.status(200).json({
      ok:         true,
      spike_date: TODAY,

      // Step 2: expiry calendar findings
      expiry_calendar: {
        today: TODAY,
        all_upcoming_fridays: allFridays,
        target_14dte: target14,
        target_28dte: target28,
        note: "All Fridays within 70 days. isMonthly=true marks 3rd-Friday standard monthly expiries.",
      },

      // Step 1: CC mid availability from existing quotes cache
      step1_cc_mid_in_cache: {
        covered: step1CachedCount,
        total:   step1Results.length,
        pct:     total > 0 ? Math.round((step1CachedCount / step1Results.length) * 100) : null,
        detail:  step1Results,
      },

      // Steps 3-5: roll analysis per ticker
      instruments_requested: uniqueInstruments.length,
      response_time_ms:      responseTimeMs,
      success_rates: {
        current_cc:    `${ccSuccessCount}/${total}`,
        roll_14dte:    `${roll14SuccessCount}/${total}`,
        roll_28dte:    `${roll28SuccessCount}/${total}`,
        data_complete: `${dataCompleteCount}/${total}`,
      },
      roll_findings: rollFindings,

      // Verdict
      go_nogo: goNogo,
      go_nogo_rationale: goNogo === "GO"
        ? `${dataCompleteCount}/${total} positions have sufficient data for roll analysis.`
        : goNogo === "PARTIAL_GO"
        ? `Only ${dataCompleteCount}/${total} positions have sufficient data. Consider showing partial results with fallback message for unsupported names.`
        : `Insufficient data to build Roll Analysis section. Check rate limits and outcome details above.`,
    });

  } catch (err) {
    console.error("[api/spike-roll-analysis]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
