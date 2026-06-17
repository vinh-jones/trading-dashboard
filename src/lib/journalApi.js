// Journal reads go through the APP_SECRET-gated /api/journal-entry endpoint
// (writes already do). journal_entries is RLS-locked with no anon policy, so
// the public bundle anon key can no longer read it directly. Same-origin fetch
// carries the app_auth cookie set by src/lib/auth.js, so middleware.js enforces
// auth. Throws Error(message) on failure so existing try/catch sites that read
// err.message keep working unchanged.

export async function listJournalEntries(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== "")
  ).toString();
  const res = await fetch(`/api/journal-entry${qs ? `?${qs}` : ""}`);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `journal fetch failed (HTTP ${res.status})`);
  }
  return json.data ?? [];
}

export async function createJournalEntry(payload) {
  const res = await fetch("/api/journal-entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `journal create failed (HTTP ${res.status})`);
  }
  return json.data;
}
