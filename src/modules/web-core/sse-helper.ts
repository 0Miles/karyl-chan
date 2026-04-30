/**
 * Backpressure-aware SSE write helper.
 *
 * Every SSE write goes through this function instead of calling
 * reply.raw.write() directly. After each write we check the socket's
 * buffered-but-not-yet-flushed byte count. If it exceeds the threshold
 * the client is too slow to consume events; we destroy the connection
 * immediately so the bot process doesn't accumulate unbounded memory.
 *
 * Design notes:
 * - `writableLength` is a plain property of Node.js net.Socket / stream.Writable.
 *   It is always available without any async I/O.
 * - We check *after* the write so that the threshold is applied to the
 *   newly-buffered bytes, not the pre-write state. This means a single
 *   large event can trigger the cut-off, which is intentional.
 * - Dedup via shouldRecord() prevents log-flooding when hundreds of slow
 *   clients all trip the limit around the same time.
 */

import type { FastifyReply } from "fastify";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { shouldRecord } from "../bot-events/bot-event-dedup.js";
import { sseBackpressureDisconnectsTotal } from "./metrics.js";

export const SSE_BACKPRESSURE_THRESHOLD_BYTES = 1_048_576; // 1 MB

export type SseWriteResult =
  | { ok: true }
  | { ok: false; reason: "backpressure" | "closed" };

export function safeWriteSseEvent(
  reply: FastifyReply,
  payload: string,
  opts: { path: string; subscriberId?: string },
): SseWriteResult {
  const raw = reply.raw;

  // 1. Already gone — skip the write entirely.
  if (raw.destroyed || !raw.writable) {
    return { ok: false, reason: "closed" };
  }

  // 2. Write the payload.
  raw.write(payload);

  // 3. Check buffer depth after the write.
  if (
    (raw as NodeJS.WritableStream & { writableLength: number }).writableLength >
    SSE_BACKPRESSURE_THRESHOLD_BYTES
  ) {
    const key = `sse-backpressure:${opts.path}:${opts.subscriberId ?? ""}`;
    if (shouldRecord(key)) {
      botEventLog.record(
        "warn",
        "web",
        "SSE client backpressure threshold exceeded — closing connection",
        { path: opts.path, subscriberId: opts.subscriberId },
      );
    }
    sseBackpressureDisconnectsTotal.inc({ path: opts.path });
    raw.destroy();
    return { ok: false, reason: "backpressure" };
  }

  return { ok: true };
}
