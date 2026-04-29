import { BotEvent } from "./models/bot-event.model.js";
import { moduleLogger } from "../../logger.js";

const log = moduleLogger("bot-event-log");

export type BotEventLevel = "info" | "warn" | "error";
export type BotEventCategory = "bot" | "auth" | "feature" | "web" | "error";

/**
 * Fire-and-forget persistent bot event logger.
 *
 * Writes are internally async — the caller always sees a void return.
 * Any DB failure is caught and logged to stderr so a broken SQLite
 * connection never propagates into bot event handlers.
 */
class BotEventLog {
  record(
    level: BotEventLevel,
    category: BotEventCategory,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    // Lazy import + lazy require: dynamic-style read avoids ESM
    // circular at module load time. metrics.ts imports
    // plugin-registry which imports this module. Top-level access
    // of metrics counters here would trip the cycle; deferring to
    // call-time is safe because by the time .record() runs, all
    // modules have finished initialising.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = botEventLogWritesTotalRef;
      if (m) m.inc({ level, category });
    } catch {
      /* metrics-failure must never affect log writes */
    }
    BotEvent.create({
      level,
      category,
      message: message.slice(0, 500),
      context: context ?? null,
    }).catch((err: unknown) => {
      log.error({ err }, "DB write failed");
    });
  }
}

// Setter-injection avoids the circular import. main.ts wires this
// up after the metrics module has finished initialising. If a record
// arrives before injection (during boot before metrics module loads),
// the inc() is silently skipped — acceptable, the boot path is short.
let botEventLogWritesTotalRef: {
  inc: (labels: { level: string; category: string }) => void;
} | null = null;

export function setBotEventLogMetric(
  counter: {
    inc: (labels: { level: string; category: string }) => void;
  } | null,
): void {
  botEventLogWritesTotalRef = counter;
}

export const botEventLog = new BotEventLog();
