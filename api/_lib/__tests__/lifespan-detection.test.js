import { describe, it, expect } from "vitest";
import { detectLifespans, DATA_QUALITY_THRESHOLD } from "../lifespan.js";

// Re-export smoke test. Three serverless functions — position-lifespan,
// ticker-detail, eod-snapshot — import detectLifespans and
// DATA_QUALITY_THRESHOLD from lifespan.js, which now just re-exports them
// from src/lib/lifespanChains.js. Nothing else would catch that shim being
// dropped or broken, so this file exists purely to fail loudly if it is.
// The real chain-detection tests live in src/lib/__tests__/lifespanChains.test.js.

describe("lifespan.js re-export shim", () => {
  it("re-exports detectLifespans as a function", () => {
    expect(typeof detectLifespans).toBe("function");
  });

  it("re-exports DATA_QUALITY_THRESHOLD unchanged", () => {
    expect(DATA_QUALITY_THRESHOLD).toBe("2026-01-01");
  });
});
