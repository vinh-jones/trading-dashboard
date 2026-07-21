import { describe, it, expect, vi, afterEach } from "vitest";
import { runRefreshChain, QUOTES_CHAIN, UW_CHAIN } from "../_lib/refreshChain.js";

const SECRET = "test-secret";
const HOST   = "https://example.test";

/** Records call order and lets each path resolve on demand. */
function mockFetch({ failing = new Set(), delays = {}, hang = new Set() } = {}) {
  const events = [];
  const fn = vi.fn(async (url, opts) => {
    const path = url.replace(HOST, "");
    events.push({ path, phase: "start", t: events.length });

    if (hang.has(path)) {
      // Never resolves on its own — only the AbortController can end it.
      await new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    if (delays[path]) await new Promise(r => setTimeout(r, delays[path]));

    events.push({ path, phase: "end", t: events.length });
    if (failing.has(path)) return { ok: false, status: 503 };
    return { ok: true, status: 200 };
  });
  vi.stubGlobal("fetch", fn);
  return { fn, events };
}

const order = (events, phase) => events.filter(e => e.phase === phase).map(e => e.path);

afterEach(() => vi.unstubAllGlobals());

describe("runRefreshChain — ordering", () => {
  it("runs the quotes chain strictly serially (shared `quotes` table)", async () => {
    const { events } = mockFetch();
    await runRefreshChain({ host: HOST, secret: SECRET });

    // Each quotes-chain step must END before the next one STARTS.
    for (let i = 0; i < QUOTES_CHAIN.length - 1; i++) {
      const endOfPrev   = events.findIndex(e => e.path === QUOTES_CHAIN[i]     && e.phase === "end");
      const startOfNext = events.findIndex(e => e.path === QUOTES_CHAIN[i + 1] && e.phase === "start");
      expect(endOfPrev).toBeGreaterThanOrEqual(0);
      expect(startOfNext).toBeGreaterThan(endOfPrev);
    }
  });

  it("runs uw-snapshot before uw-gex (upsert must precede the patch)", async () => {
    const { events } = mockFetch();
    await runRefreshChain({ host: HOST, secret: SECRET });

    const snapshotEnd = events.findIndex(e => e.path === UW_CHAIN[0] && e.phase === "end");
    const gexStart    = events.findIndex(e => e.path === UW_CHAIN[1] && e.phase === "start");
    expect(gexStart).toBeGreaterThan(snapshotEnd);
  });

  it("starts the two chains in parallel with each other", async () => {
    const { events } = mockFetch({ delays: { "/api/quotes": 20 } });
    await runRefreshChain({ host: HOST, secret: SECRET });

    // uw-snapshot should have started before the slow quotes step finished.
    const starts = order(events, "start");
    expect(starts.slice(0, 2).sort()).toEqual(["/api/quotes", "/api/uw-snapshot"]);
  });

  it("hits every ingest that feeds a Radar row", async () => {
    const { events } = mockFetch();
    const result = await runRefreshChain({ host: HOST, secret: SECRET });
    expect(order(events, "start").sort()).toEqual([...QUOTES_CHAIN, ...UW_CHAIN].sort());
    expect(result.steps).toHaveLength(5);
  });

  it("forces the bb stale gate rather than relying on it", async () => {
    const { fn } = mockFetch();
    await runRefreshChain({ host: HOST, secret: SECRET });
    expect(fn.mock.calls.some(([url]) => url.includes("/api/bb?force=1"))).toBe(true);
  });
});

describe("runRefreshChain — auth", () => {
  it("carries the cron secret on every call", async () => {
    const { fn } = mockFetch();
    await runRefreshChain({ host: HOST, secret: SECRET });
    for (const [, opts] of fn.mock.calls) {
      expect(opts.headers.authorization).toBe(`Bearer ${SECRET}`);
    }
  });

  it("reports rather than throws when no secret is configured", async () => {
    mockFetch();
    const result = await runRefreshChain({ host: HOST, secret: undefined });
    expect(result.ran).toBe(false);
    expect(result.steps[0].error).toMatch(/CRON_SECRET/);
  });
});

describe("runRefreshChain — fail-soft", () => {
  it("keeps going after a failing step and reports it", async () => {
    const { events } = mockFetch({ failing: new Set(["/api/quotes"]) });
    const result = await runRefreshChain({ host: HOST, secret: SECRET });

    expect(result.allOk).toBe(false);
    expect(result.steps.find(s => s.step === "/api/quotes")).toMatchObject({ ok: false, status: 503 });
    // The rest of the chain still ran — a dead feed must not cost the scan.
    expect(order(events, "start")).toContain("/api/bb?force=1");
    expect(result.steps.filter(s => s.ok)).toHaveLength(4);
  });

  it("never throws even when every step fails", async () => {
    mockFetch({ failing: new Set([...QUOTES_CHAIN, ...UW_CHAIN]) });
    const result = await runRefreshChain({ host: HOST, secret: SECRET });
    expect(result.ran).toBe(true);
    expect(result.allOk).toBe(false);
    expect(result.steps.every(s => !s.ok)).toBe(true);
  });

  it("survives a thrown network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const result = await runRefreshChain({ host: HOST, secret: SECRET });
    expect(result.allOk).toBe(false);
    expect(result.steps[0].error).toMatch(/ECONNREFUSED/);
  });

  it("skips remaining steps once the chain budget is spent", async () => {
    mockFetch();
    // A `now` far in the past leaves zero budget, so nothing should start.
    const result = await runRefreshChain({ host: HOST, secret: SECRET, now: Date.now() - 10 * 60 * 1000 });
    expect(result.steps.every(s => s.skipped)).toBe(true);
    expect(result.allOk).toBe(false);
  });

  it("aborts a hung step instead of hanging the scan", async () => {
    vi.useFakeTimers();
    mockFetch({ hang: new Set(["/api/uw-gex"]) });
    const promise = runRefreshChain({ host: HOST, secret: SECRET });
    await vi.advanceTimersByTimeAsync(95_000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.steps.find(s => s.step === "/api/uw-gex").error).toMatch(/timed out/);
    expect(result.ran).toBe(true);
  }, 20_000);
});
