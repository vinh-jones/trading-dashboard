import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite dev-server plugin that adds a POST /api/sync endpoint.
 * The React app calls this when you click the Sync button.
 * Uses process.execPath (the running node binary) so no PATH issues.
 */
function syncPlugin() {
  return {
    name: "google-sheets-sync",
    configureServer(server) {
      server.middlewares.use("/api/sync", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        console.log("[sync] Fetching from Google Sheets...");

        const child = spawn(
          process.execPath,                          // the node.exe running Vite right now
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
    },
  };
}

export default defineConfig({
  plugins: [react(), syncPlugin()],
});
