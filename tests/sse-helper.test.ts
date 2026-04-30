/**
 * Unit tests for src/modules/web-core/sse-helper.ts
 *
 * All external side-effects (botEventLog, metrics, shouldRecord) are
 * mocked so this test has zero DB / Prometheus dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test.
vi.mock("../src/modules/bot-events/bot-event-log.js", () => ({
  botEventLog: { record: vi.fn() },
}));

vi.mock("../src/modules/bot-events/bot-event-dedup.js", () => ({
  shouldRecord: vi.fn(() => true),
}));

vi.mock("../src/modules/web-core/metrics.js", () => ({
  sseBackpressureDisconnectsTotal: { inc: vi.fn() },
}));

import {
  safeWriteSseEvent,
  SSE_BACKPRESSURE_THRESHOLD_BYTES,
} from "../src/modules/web-core/sse-helper.js";
import { sseBackpressureDisconnectsTotal } from "../src/modules/web-core/metrics.js";

/**
 * Build a minimal mock of FastifyReply where only reply.raw is used.
 * `writableLength` and `destroyed`/`writable` are controllable.
 */
function makeReply(opts: {
  destroyed?: boolean;
  writable?: boolean;
  writableLength?: number;
}) {
  const raw = {
    destroyed: opts.destroyed ?? false,
    writable: opts.writable ?? true,
    writableLength: opts.writableLength ?? 0,
    write: vi.fn(),
    destroy: vi.fn(),
  };
  return { raw } as unknown as import("fastify").FastifyReply;
}

describe("safeWriteSseEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok:true and calls raw.write when writableLength is 0", () => {
    const reply = makeReply({ writableLength: 0 });
    const result = safeWriteSseEvent(reply, "data: hello\n\n", {
      path: "/api/dm/events",
    });
    expect(result).toEqual({ ok: true });
    expect(reply.raw.write).toHaveBeenCalledWith("data: hello\n\n");
    expect(reply.raw.destroy).not.toHaveBeenCalled();
  });

  it("returns ok:false reason:backpressure and calls destroy when writableLength > 1MB", () => {
    // writableLength is checked AFTER the write, so we set it to 2 MB
    // to simulate a slow client whose buffer has built up.
    const reply = makeReply({
      writableLength: 2 * SSE_BACKPRESSURE_THRESHOLD_BYTES,
    });
    const result = safeWriteSseEvent(reply, "data: flood\n\n", {
      path: "/api/dm/events",
    });
    expect(result).toEqual({ ok: false, reason: "backpressure" });
    expect(reply.raw.write).toHaveBeenCalledWith("data: flood\n\n");
    expect(reply.raw.destroy).toHaveBeenCalledOnce();
    expect(
      sseBackpressureDisconnectsTotal.inc as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith({ path: "/api/dm/events" });
  });

  it("returns ok:false reason:closed when reply.raw.destroyed is true", () => {
    const reply = makeReply({ destroyed: true });
    const result = safeWriteSseEvent(reply, "data: ignored\n\n", {
      path: "/api/guilds/events",
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
    // Must not attempt to write to a destroyed socket.
    expect(reply.raw.write).not.toHaveBeenCalled();
    expect(reply.raw.destroy).not.toHaveBeenCalled();
  });

  it("returns ok:false reason:closed when reply.raw.writable is false", () => {
    const reply = makeReply({ writable: false });
    const result = safeWriteSseEvent(reply, "data: ignored\n\n", {
      path: "/api/guilds/events",
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it("returns ok:true when writableLength equals the threshold exactly (boundary)", () => {
    // At exactly the threshold the check is `> THRESHOLD`, so it should pass.
    const reply = makeReply({
      writableLength: SSE_BACKPRESSURE_THRESHOLD_BYTES,
    });
    const result = safeWriteSseEvent(reply, "data: boundary\n\n", {
      path: "/api/dm/events",
    });
    expect(result).toEqual({ ok: true });
    expect(reply.raw.destroy).not.toHaveBeenCalled();
  });
});
