import { useState } from "react";
import { useData } from "../hooks/useData";

export function SyncButton() {
  const { refreshData } = useData();
  const [status, setStatus] = useState("idle"); // "idle" | "syncing" | "done" | "error"
  const [detail, setDetail] = useState("");
  const isProd = import.meta.env.PROD;

  async function handleSync() {
    if (status === "syncing") return;
    setStatus("syncing");
    setDetail("");
    try {
      if (isProd) {
        // Production: POST /api/sync → Google Sheets → Supabase, then re-read
        const syncRes  = await fetch("/api/sync", { method: "POST" });
        const syncData = await syncRes.json();
        if (!syncData.ok) throw new Error(syncData.error ?? "Sync failed");

        // Re-fetch fresh data from Supabase (cache-bust to avoid stale CDN response)
        const dataRes = await fetch(`/api/data?t=${Date.now()}`);
        const data    = await dataRes.json();
        if (data.ok) {
          refreshData(data);
          setStatus("done");
          setDetail(`${syncData.tradesCount} trades · ${syncData.positionsCount} positions synced`);
          setTimeout(() => setStatus("idle"), 4000);
        } else {
          throw new Error(data.error ?? "Unknown error");
        }
      } else {
        // Dev: POST to /api/sync which writes JSON files and triggers HMR
        const res  = await fetch("/api/sync", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          setStatus("done");
          // Extract the one-line summary (last non-empty line of sync output)
          const lines = data.output.split("\n").map(l => l.trim()).filter(Boolean);
          setDetail(lines[lines.length - 1] ?? "");
          // Page will hot-reload automatically as JSON files update.
          // Reset button state after 4 s (in case HMR is slow).
          setTimeout(() => setStatus("idle"), 4000);
        } else {
          throw new Error(data.error?.slice(0, 120) ?? "Unknown error");
        }
      }
    } catch (err) {
      setStatus("error");
      setDetail(err.message);
      setTimeout(() => setStatus("idle"), 6000);
    }
  }

  const label  = { idle: "⟳ Sync Sheet", syncing: "Syncing…", done: "✓ Synced", error: "✗ Error" }[status];
  const color  = { idle: "#8b949e", syncing: "#58a6ff", done: "#3fb950", error: "#f85149" }[status];
  const spin   = status === "syncing";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        onClick={handleSync}
        disabled={spin}
        style={{
          background: "transparent",
          border: `1px solid ${color}`,
          color,
          borderRadius: 5,
          padding: "6px 14px",
          fontSize: 13,
          fontFamily: "inherit",
          fontWeight: 500,
          cursor: spin ? "default" : "pointer",
          letterSpacing: "0.3px",
          transition: "all 0.2s",
          animation: spin ? "pulse 1.2s ease-in-out infinite" : "none",
        }}
      >
        {label}
      </button>
      {detail && (
        <div style={{ fontSize: 11, color: status === "error" ? "#f85149" : "#6e7681", maxWidth: 260, textAlign: "right" }}>
          {detail}
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  );
}
