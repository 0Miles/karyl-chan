import { Op } from "sequelize";
import { BotEvent } from "./models/bot-event.model.js";
import { moduleLogger } from "../../logger.js";

const log = moduleLogger("bot-event-log");

/**
 * Keep at most this many rows in `bot_events`. Beyond that the table
 * grows unbounded — `record()` is called from every plugin send,
 * every reaction event, every gateway connect, the heartbeat reaper,
 * etc. The dashboard cursor query slows linearly with row count and
 * the SQLite file inflates without limit.
 *
 * 50k rows × ~300 B average ≈ 15 MB, which is comfortably under the
 * `synchronous = NORMAL` WAL pressure threshold and gives the admin
 * recent-events page meaningful history.
 */
const MAX_ROWS = 50_000;
/**
 * Run the pruner every 10 minutes. Even at the cap of one event per
 * gateway frame, 10 min worth of overshoot is bounded; running more
 * frequently just burns DELETE cost without changing the steady state.
 */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

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

/**
 * Drop the oldest rows so the table stays at most `MAX_ROWS`. Single
 * SQLite delete keyed by primary key, runs in O(deleted rows). Cheap
 * if we're at or under the cap (nothing to delete), proportional
 * otherwise.
 */
async function pruneOldRows(): Promise<void> {
  try {
    const total = await BotEvent.count();
    if (total <= MAX_ROWS) return;
    // Cut-off: the id immediately below the newest MAX_ROWS rows.
    const cutoffRow = await BotEvent.findOne({
      attributes: ["id"],
      order: [["id", "DESC"]],
      offset: MAX_ROWS,
      raw: true,
    });
    if (!cutoffRow) return;
    const cutoffId = (cutoffRow as unknown as { id: number }).id;
    const deleted = await BotEvent.destroy({
      where: { id: { [Op.lte]: cutoffId } },
    });
    log.info({ deleted, cutoffId, totalBefore: total }, "pruned old bot_events rows");
  } catch (err) {
    log.error({ err }, "bot_events prune failed");
  }
}

let pruneTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Wire the periodic pruner from `main.ts` after the DB has been
 * `authenticate()`d. Idempotent — calling more than once is a no-op.
 * Timer is `unref`'d so it doesn't hold the event loop alive on
 * shutdown.
 */
export function startBotEventLogPruner(): void {
  if (pruneTimer) return;
  // Kick once on startup so a long-stopped instance prunes
  // immediately, then settle into the periodic cadence.
  void pruneOldRows();
  pruneTimer = setInterval(pruneOldRows, PRUNE_INTERVAL_MS);
  pruneTimer.unref();
}

export function stopBotEventLogPruner(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}
