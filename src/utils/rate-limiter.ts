export interface RateLimiterOptions {
    /** Rolling window in milliseconds. Default: 60000 (1 minute). */
    windowMs?: number;
    /** Maximum allowed actions within the window. Default: 10. */
    max?: number;
    /** Background cleanup interval in milliseconds. Default: 10 minutes. */
    cleanupIntervalMs?: number;
}

export class RateLimiter {
    private rateLimiter = new Map<string, number[]>();
    private readonly rateLimit: { windowMs: number; max: number };
    private cleanupTimer: NodeJS.Timeout;

    constructor(options: RateLimiterOptions = {}) {
        this.rateLimit = {
            windowMs: options.windowMs ?? 60 * 1000,
            max: options.max ?? 10
        };
        this.cleanupTimer = setInterval(
            () => this.cleanup(),
            options.cleanupIntervalMs ?? 10 * 60 * 1000
        );
        this.cleanupTimer.unref();
    }

    isRateLimited(key: string): boolean {
        const now = Date.now();
        const commands = this.rateLimiter.get(key) || [];
        const recentCommands = commands.filter(time => now - time < this.rateLimit.windowMs);

        if (recentCommands.length >= this.rateLimit.max) {
            this.rateLimiter.set(key, recentCommands);
            return true;
        }

        recentCommands.push(now);
        this.rateLimiter.set(key, recentCommands);
        return false;
    }

    cleanup(): void {
        const now = Date.now();
        for (const [key, timestamps] of this.rateLimiter.entries()) {
            const recentCommands = timestamps.filter(time => now - time < this.rateLimit.windowMs);
            if (recentCommands.length === 0) {
                this.rateLimiter.delete(key);
            } else {
                this.rateLimiter.set(key, recentCommands);
            }
        }
    }

    /** Deprecated alias for `max`; retained for the rcon-queue call site. */
    get maxCommandsPerWindow(): number {
        return this.rateLimit.max;
    }

    get max(): number {
        return this.rateLimit.max;
    }

    get windowMs(): number {
        return this.rateLimit.windowMs;
    }
}
