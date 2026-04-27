/**
 * api/_lib/loadFocusData.js
 *
 * Supabase loaders used by the EOD notification pipeline in api/snapshot.js.
 * Each loader is wrapped in try/catch and returns a safe fallback on error —
 * one table being unavailable must NOT break the whole notification step.
 *
 * Shapes match what src/lib/focusEngine.js expects:
 *   - quoteMap        : Map<symbol, quoteRow>   — ticker or OCC symbol keyed
 *   - marketContext   : { asOf, positions, macroEvents } | null
 *   - rollAnalysisMap : { [ticker]: rollRow }
 */

export async function loadQuoteMap(supabase) {
  try {
    const { data, error } = await supabase.from("quotes").select("*");
    if (error) throw error;
    return new Map((data ?? []).map(q => [q.symbol, q]));
  } catch (err) {
    console.warn("[loadFocusData] quotes load failed:", err.message);
    return new Map();
  }
}

export async function loadMarketContext(supabase) {
  try {
    const { data, error } = await supabase
      .from("market_context")
      .select("*")
      .order("as_of", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") throw error;
    if (!data) return null;

    return {
      asOf:        data.as_of,
      positions:   data.positions,
      macroEvents: data.macro_events,
    };
  } catch (err) {
    console.warn("[loadFocusData] market_context load failed:", err.message);
    return null;
  }
}

export async function loadAssignedShareIncome(supabase) {
  try {
    const { data, error } = await supabase
      .from("app_cache")
      .select("value")
      .eq("key", "assigned_share_income_latest")
      .maybeSingle();
    if (error) throw error;
    if (!data?.value) return null;
    // app_cache stores JSON as text — parse defensively
    return typeof data.value === "string" ? JSON.parse(data.value) : data.value;
  } catch (err) {
    console.warn("[loadFocusData] assigned_share_income load failed:", err.message);
    return null;
  }
}

export async function loadRollAnalysisMap(supabase) {
  try {
    const { data, error } = await supabase.from("roll_analysis").select("*");
    if (error) throw error;
    const map = {};
    for (const row of data ?? []) {
      if (row.ticker) map[row.ticker] = row;
    }
    return map;
  } catch (err) {
    console.warn("[loadFocusData] roll_analysis load failed:", err.message);
    return {};
  }
}
