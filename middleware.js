// Vercel Edge Middleware — single-user authentication gate for /api/*.
//
// The app has no auth layer and Supabase RLS now denies the anon key on every
// personal/financial table, but all serverless endpoints fall back to the
// service-role key (which bypasses RLS). Without this gate, GET /api/data,
// POST /api/sync, DELETE /api/delete-trade, etc. expose / mutate the entire
// book unauthenticated. This middleware requires a shared APP_SECRET for every
// protected route. The SPA stores the secret and sends it as the `app_auth`
// cookie (same-origin), so individual fetch() call sites need no changes.
//
// Endpoints that carry their own secret (cron CRON_SECRET, ingest
// x-ingest-secret) or serve market-only data with no PII are bypassed here and
// remain governed by their existing checks / intentionally public.

export const config = { matcher: "/api/:path*" };

// Self-gated (own Bearer/x-ingest-secret) or market-only public endpoints.
// These are intentionally NOT gated by APP_SECRET:
//  - cron endpoints: invoked by Vercel Cron with Bearer CRON_SECRET
//  - ingest endpoints: external pushers with x-ingest-secret
//  - market endpoints: quotes/macro/bb/vix/option-chain/earnings — no positions,
//    trades, or account data; safe to serve publicly
const BYPASS = new Set([
  "/api/snapshot",
  "/api/alert-check",
  "/api/calibrate-forecast",
  "/api/uw-snapshot",
  "/api/uw-assignment-data",
  "/api/uw-earnings-dates",
  "/api/uw-gex",
  "/api/ingest",
  "/api/ingest-iv",
  "/api/ingest-s5fi",
  "/api/ingest-wheel-earnings",
  "/api/macro",
  "/api/quotes",
  "/api/bb",
  "/api/vix",
  "/api/radar-sample",
  "/api/earnings-dates",
  "/api/earnings-chain",
]);

// Length-independent constant-time string comparison.
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a));
  const bb = enc.encode(String(b));
  // Fold length difference into the result without early-return.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function extractToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "app_auth") return decodeURIComponent(v.join("="));
  }

  // Secret is never accepted via query string — keeps it out of logs,
  // browser history, and Referer headers. Cookie/Bearer only.
  return null;
}

function deny(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default function middleware(request) {
  const { pathname } = new URL(request.url);

  if (BYPASS.has(pathname)) return; // continue — handled by its own check / public

  const secret = process.env.APP_SECRET;
  // Fail closed: never serve protected data if the gate is misconfigured.
  if (!secret) return deny(503, "Auth gate not configured");

  const token = extractToken(request);
  if (!token || !timingSafeEqual(token, secret)) {
    return deny(401, "Unauthorized");
  }

  return; // authenticated — continue to the API handler
}
