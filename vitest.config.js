import { defineConfig } from "vitest/config";

// Minimal Vitest config — kept separate from vite.config.js so the dev-server
// plugins (Google Sheets sync, etc.) don't run during test collection.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "src/**/__tests__/**/*.test.js"],
  },
});
