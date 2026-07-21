/**
 * Forced refresh chain for /api/agent-scan.
 *
 * Re-runs every ingest that feeds a Radar row before the scan reads Supabase,
 * so a polling agent never sees data left over from the last cron.
 *
 * ORDERING IS NOT ARBITRARY — these endpoints share tables:
 *
 *   quotes chain (serial):  /api/quotes → /api/bb?force=1 → /api/uw-iv
 *     All three write the `quotes` table. quotes/bb both set last & prev_close,
 *     so running them concurrently races on the same columns. bb runs after
 *     quotes so its BB math sees the fresh price.
 *
 *   uw chain (serial):      /api/uw-snapshot → /api/uw-gex
 *     uw-snapshot UPSERTS whole `uw_signals` rows; uw-gex PATCHES gex_* on the
 *     same rows. Concurrent, the upsert can clobber the patch — so snapshot
 *     must land first.
 *
 * The two chains touch disjoint tables, so they run in parallel with each other.
 *
 * FAIL-SOFT BY DESIGN: a refresh failure must never cost you the scan. Every
 * step catches, and the caller still gets rows — just with `refresh.steps`
 * reporting what broke. A UW outage degrades freshness, not availability.
 */

// Per-step ceiling. uw-gex is the slow one (maxDuration 120 in vercel.json);
// the rest are well under 60s. This bounds a single hung feed.
const STEP_TIMEOUT_MS = 90_000;

// Whole-chain budget. Vercel gives the function 300s; we stop starting new
// steps past this so there is always headroom left to actually run the scan
// and serialize a response. Unstarted steps report as "skipped".
const CHAIN_BUDGET_MS = 210_000;

export const QUOTES_CHAIN = ["/api/quotes", "/api/bb?force=1", "/api/uw-iv"];
export const UW_CHAIN     = ["/api/uw-snapshot", "/api/uw-gex"];

export function resolveHost() {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";
}

async function callStep(host, path, secret, deadline) {
  const label = path.split("?")[0];
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return { step: label, ok: false, skipped: true, error: "chain budget exhausted" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(STEP_TIMEOUT_MS, remaining));
  const started = Date.now();

  try {
    const res = await fetch(`${host}${path}`, {
      headers: {
        authorization: `Bearer ${secret}`,
        "User-Agent": "internal/agent-scan",
      },
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { step: label, ok: false, status: res.status, ms };
    }
    return { step: label, ok: true, status: res.status, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const aborted = err?.name === "AbortError";
    return { step: label, ok: false, ms, error: aborted ? `timed out after ${ms}ms` : (err?.message ?? String(err)) };
  } finally {
    clearTimeout(timeout);
  }
}

async function runSerial(host, paths, secret, deadline) {
  const out = [];
  for (const path of paths) {
    out.push(await callStep(host, path, secret, deadline));
  }
  return out;
}

/**
 * Run both chains. Never throws.
 * @returns {{ ran: boolean, ms: number, steps: object[], allOk: boolean }}
 */
export async function runRefreshChain({ host = resolveHost(), secret, now = Date.now() } = {}) {
  if (!secret) {
    return {
      ran: false,
      ms: 0,
      allOk: false,
      steps: [{ step: "all", ok: false, error: "CRON_SECRET not configured — refresh skipped" }],
    };
  }

  const started  = now;
  const deadline = started + CHAIN_BUDGET_MS;

  const [quotesSteps, uwSteps] = await Promise.all([
    runSerial(host, QUOTES_CHAIN, secret, deadline),
    runSerial(host, UW_CHAIN, secret, deadline),
  ]);

  const steps = [...quotesSteps, ...uwSteps];
  return {
    ran: true,
    ms: Date.now() - started,
    allOk: steps.every(s => s.ok),
    steps,
  };
}
