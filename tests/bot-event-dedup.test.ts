import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Import after potential hoisting so the module-level Map starts fresh
// for each test via vi.resetModules() in beforeEach.
describe("bot-event-dedup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  async function importFresh() {
    const mod = await import("../src/modules/bot-events/bot-event-dedup.js?t=" + Date.now());
    return mod.shouldRecord;
  }

  it("returns true on the first call for a key", async () => {
    const shouldRecord = await importFresh();
    expect(shouldRecord("event:a")).toBe(true);
  });

  it("returns false on a second call within the window", async () => {
    const shouldRecord = await importFresh();
    shouldRecord("event:b");
    vi.advanceTimersByTime(30_000); // still inside 60s window
    expect(shouldRecord("event:b")).toBe(false);
  });

  it("returns true after the window has elapsed", async () => {
    const shouldRecord = await importFresh();
    shouldRecord("event:c");
    vi.advanceTimersByTime(60_001);
    expect(shouldRecord("event:c")).toBe(true);
  });

  it("different keys are independent — one suppressed does not affect another", async () => {
    const shouldRecord = await importFresh();
    shouldRecord("key:x");
    vi.advanceTimersByTime(10_000);
    // key:x is suppressed, key:y has never been seen
    expect(shouldRecord("key:x")).toBe(false);
    expect(shouldRecord("key:y")).toBe(true);
  });

  it("evicts the oldest key when the 1000-key cap is reached", async () => {
    const shouldRecord = await importFresh();
    // Fill the map to 999 with cheap filler keys that are never reused.
    for (let i = 0; i < 999; i++) {
      shouldRecord(`filler:${i}`);
    }
    // Record the key we care about — it becomes the 1000th entry.
    shouldRecord("sentinel");
    // The 1001st insert should evict 'filler:0' (oldest / first-inserted).
    shouldRecord("overflow");
    // 'sentinel' was recorded AFTER all fillers and before 'overflow',
    // so it is still within the map — within-window call returns false.
    expect(shouldRecord("sentinel")).toBe(false);
    // 'filler:0' was the first inserted and should have been evicted,
    // so a fresh call for it is treated as a new key → true.
    expect(shouldRecord("filler:0")).toBe(true);
  });
});
