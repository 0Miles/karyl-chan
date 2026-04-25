import { describe, it, expect } from 'vitest';
import { isContinuation } from './grouping';
import type { Message, MessageAuthor } from './types';

const author = (id: string): MessageAuthor => ({
    id,
    username: id,
    globalName: null,
    avatarUrl: '',
    bot: false
});

function msg(overrides: Partial<Message> & { id: string; authorId: string; ts: string }): Message {
    return {
        channelId: 'c-1',
        guildId: null,
        author: author(overrides.authorId),
        content: '',
        createdAt: overrides.ts,
        attachments: [],
        ...overrides
    } as Message;
}

describe('isContinuation', () => {
    it('returns false when there is no previous message', () => {
        const curr = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        expect(isContinuation(undefined, curr)).toBe(false);
    });

    it('returns true when same author posts again within the window', () => {
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        const curr = msg({ id: 'm-2', authorId: 'u-1', ts: '2026-04-25T12:01:00.000Z' });
        expect(isContinuation(prev, curr)).toBe(true);
    });

    it('returns false when authors differ', () => {
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        const curr = msg({ id: 'm-2', authorId: 'u-2', ts: '2026-04-25T12:01:00.000Z' });
        expect(isContinuation(prev, curr)).toBe(false);
    });

    it('returns false when the time gap exceeds the default window', () => {
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        // 6 minutes — past the 5-minute default.
        const curr = msg({ id: 'm-2', authorId: 'u-1', ts: '2026-04-25T12:06:00.000Z' });
        expect(isContinuation(prev, curr)).toBe(false);
    });

    it('returns true at exactly the window boundary (inclusive)', () => {
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        const curr = msg({ id: 'm-2', authorId: 'u-1', ts: '2026-04-25T12:05:00.000Z' });
        expect(isContinuation(prev, curr)).toBe(true);
    });

    it('returns false when the next message references a parent (reply ⇒ break)', () => {
        // A reply to anyone — even the same author — breaks grouping
        // so the user sees the quoted-message header on its own row.
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        const curr = msg({
            id: 'm-2',
            authorId: 'u-1',
            ts: '2026-04-25T12:00:30.000Z',
            referencedMessage: { id: 'm-prev' } as Message
        });
        expect(isContinuation(prev, curr)).toBe(false);
    });

    it('returns false when the timestamps go backwards', () => {
        // Out-of-order messages shouldn't accidentally collapse — the
        // diff is required to be non-negative.
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:01:00.000Z' });
        const curr = msg({ id: 'm-2', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        expect(isContinuation(prev, curr)).toBe(false);
    });

    it('respects a custom windowMs override', () => {
        const prev = msg({ id: 'm-1', authorId: 'u-1', ts: '2026-04-25T12:00:00.000Z' });
        const curr = msg({ id: 'm-2', authorId: 'u-1', ts: '2026-04-25T12:00:30.000Z' });
        // 10 second window — 30s gap should break.
        expect(isContinuation(prev, curr, 10_000)).toBe(false);
        expect(isContinuation(prev, curr, 60_000)).toBe(true);
    });
});
