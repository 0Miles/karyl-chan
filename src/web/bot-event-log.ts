import { BotEvent } from '../models/bot-event.model.js';

export type BotEventLevel = 'info' | 'warn' | 'error';
export type BotEventCategory = 'bot' | 'auth' | 'feature' | 'web' | 'error';

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
        context?: Record<string, unknown>
    ): void {
        BotEvent.create({
            level,
            category,
            message: message.slice(0, 500),
            context: context ?? null
        }).catch((err: unknown) => {
            console.error('[bot-event-log] DB write failed:', err);
        });
    }
}

export const botEventLog = new BotEventLog();
