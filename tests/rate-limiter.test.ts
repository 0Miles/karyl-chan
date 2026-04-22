import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
        vi.useFakeTimers();
        limiter = new RateLimiter();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('basic rate limiting', () => {
        it('does not rate-limit the first command', () => {
            expect(limiter.isRateLimited('channel-1')).toBe(false);
        });

        it('allows up to maxCommandsPerWindow commands', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                expect(limiter.isRateLimited('channel-1')).toBe(false);
            }
        });

        it('blocks the (max + 1)th command within the window', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            expect(limiter.isRateLimited('channel-1')).toBe(true);
        });

        it('continues blocking while at the cap', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            expect(limiter.isRateLimited('channel-1')).toBe(true);
            expect(limiter.isRateLimited('channel-1')).toBe(true);
            expect(limiter.isRateLimited('channel-1')).toBe(true);
        });
    });

    describe('sliding window', () => {
        it('resets after the window fully elapses', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            expect(limiter.isRateLimited('channel-1')).toBe(true);

            vi.advanceTimersByTime(61_000);

            expect(limiter.isRateLimited('channel-1')).toBe(false);
        });

        it('keeps blocking just before the window expires', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            vi.advanceTimersByTime(59_000);
            expect(limiter.isRateLimited('channel-1')).toBe(true);
        });

        it('partially slides (older entries expire, newer still count)', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max - 1; i++) {
                limiter.isRateLimited('channel-1');
            }
            vi.advanceTimersByTime(30_000);
            limiter.isRateLimited('channel-1');
            vi.advanceTimersByTime(31_000);
            // older (max-1) entries are past window, the one at 30s is still inside
            expect(limiter.isRateLimited('channel-1')).toBe(false);
        });
    });

    describe('per-channel isolation', () => {
        it('tracks channels independently', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            expect(limiter.isRateLimited('channel-1')).toBe(true);
            expect(limiter.isRateLimited('channel-2')).toBe(false);
        });

        it('blocking one channel does not impact another even after many windows', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            for (let i = 0; i < max; i++) {
                expect(limiter.isRateLimited('channel-2')).toBe(false);
            }
            expect(limiter.isRateLimited('channel-2')).toBe(true);
            expect(limiter.isRateLimited('channel-1')).toBe(true);
        });
    });

    describe('cleanup', () => {
        it('manual cleanup leaves future rate limiting functional', () => {
            limiter.isRateLimited('channel-1');
            vi.advanceTimersByTime(61_000);
            limiter.cleanup();
            expect(limiter.isRateLimited('channel-1')).toBe(false);
        });

        it('automatic cleanup fires on the interval', () => {
            const cleanupSpy = vi.spyOn(limiter, 'cleanup');
            vi.advanceTimersByTime(10 * 60 * 1000);
            expect(cleanupSpy).toHaveBeenCalled();
        });

        it('cleanup does not trash active (still-windowed) entries', () => {
            const max = limiter.maxCommandsPerWindow;
            for (let i = 0; i < max; i++) {
                limiter.isRateLimited('channel-1');
            }
            limiter.cleanup();
            expect(limiter.isRateLimited('channel-1')).toBe(true);
        });
    });

    describe('maxCommandsPerWindow', () => {
        it('exposes the configured cap', () => {
            expect(limiter.maxCommandsPerWindow).toBe(10);
        });
    });
});
