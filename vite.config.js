import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, "src", "data");

/**
 * Vite dev-server plugin that adds two endpoints:
 *
 *   POST /api/sync  — spawns sync.js, writes JSON files, triggers HMR
 *   GET  /api/data  — reads the current JSON files and returns them as JSON
 *                     (mirrors what the Vercel serverless function does in prod)
 *
 * The React app uses /api/data in production (live Google Sheets fetch via
 * Vercel) and falls back to the static JSON imports in dev, while the Sync
 * button in dev calls /api/sync to refresh those files.
 */
function sheetsPlugin() {
  return {
    name: "google-sheets-sync",
    configureServer(server) {

      // ── POST /api/sync ────────────────────────────────────────────────────
      server.middlewares.use("/api/sync", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        console.log("[sync] Fetching from Google Sheets...");

        const child = spawn(
          process.execPath,                         // the node.exe running Vite right now
          [join(__dirname, "sync.js")],
          { stdio: ["ignore", "pipe", "pipe"] }
        );

        let stdout = "", stderr = "";
        child.stdout.on("data", (d) => { stdout += d; process.stdout.write(d); });
        child.stderr.on("data", (d) => { stderr += d; process.stderr.write(d); });

        child.on("close", (code) => {
          res.setHeader("Content-Type", "application/json");
          if (code === 0) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, output: stdout.trim() }));
          } else {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: (stderr || stdout).trim() }));
          }
        });

        child.on("error", (err) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });

      // ── GET /api/data ─────────────────────────────────────────────────────
      // Reads the local JSON files and returns them, matching the shape that
      // the Vercel serverless function returns in production.
      server.middlewares.use("/api/data", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        try {
          const read = (name) => {
            const p = join(DATA_DIR, name);
            return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
          };
          const tradesData    = read("trades.json");
          const positionsData = read("positions.json");
          const accountData   = read("account.json");

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            ok:        true,
            trades:    tradesData?.trades    ?? [],
            positions: positionsData         ?? {},
            account:   accountData           ?? {},
          }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sheetsPlugin()],
  build: {
    rollupOptions: {
      input: {
        main:     new URL("./index.html",    import.meta.url).pathname,
        tradesV2: new URL("./trades-v2.html", import.meta.url).pathname,
      },
    },
  },
});
