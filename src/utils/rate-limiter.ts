export class RateLimiter {
    private rateLimiter = new Map<string, number[]>();
    private readonly rateLimit = {
        windowMs: 60 * 1000, // 1 minute
        maxCommands: 10
    };
    private cleanupTimer: NodeJS.Timeout;

    constructor(cleanupIntervalMs: number = 10 * 60 * 1000) {
        this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
        this.cleanupTimer.unref();
    }

    isRateLimited(channelId: string): boolean {
        const now = Date.now();
        const commands = this.rateLimiter.get(channelId) || [];
        const recentCommands = commands.filter(time => now - time < this.rateLimit.windowMs);
        
        if (recentCommands.length >= this.rateLimit.maxCommands) {
            this.rateLimiter.set(channelId, recentCommands);
            return true;
        }
        
        recentCommands.push(now);
        this.rateLimiter.set(channelId, recentCommands);
        return false;
    }

    cleanup(): void {
        const now = Date.now();
        for (const [channelId, timestamps] of this.rateLimiter.entries()) {
            const recentCommands = timestamps.filter(time => now - time < this.rateLimit.windowMs);
            if (recentCommands.length === 0) {
                this.rateLimiter.delete(channelId);
            } else {
                this.rateLimiter.set(channelId, recentCommands);
            }
        }
    }

    get maxCommandsPerWindow(): number {
        return this.rateLimit.maxCommands;
    }
}
