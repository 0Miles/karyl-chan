import { describe, expect, it } from 'vitest';
import type { Message as DjsMessage } from 'discord.js';
import { avatarUrlFor, toApiMessage } from '../src/web/message-mapper.js';

const USER_ID = '347738300909617152';
const STATIC_HASH = '67ec57b40058e6c1ebce07277874edb5';
const ANIMATED_HASH = 'a_3fa6164fb22aede0b396d414193465ea';

function fakeMessage(overrides: Partial<Record<string, unknown>> = {}): DjsMessage {
    const base = {
        id: 'm1',
        channelId: 'c1',
        guildId: null,
        content: 'hello',
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        editedAt: null,
        author: {
            id: USER_ID,
            username: 'alice',
            globalName: 'Alice',
            bot: false,
            avatar: STATIC_HASH
        },
        attachments: new Map(),
        reactions: { cache: new Map() },
        stickers: new Map(),
        embeds: [],
        reference: null,
        channel: { messages: { cache: new Map() } },
        mentions: { everyone: false },
        pinned: false,
        tts: false,
        ...overrides
    };
    return base as unknown as DjsMessage;
}

describe('toApiMessage', () => {
    it('maps the basic shape including ISO timestamps', () => {
        const api = toApiMessage(fakeMessage());
        expect(api).toMatchObject({
            id: 'm1',
            channelId: 'c1',
            guildId: null,
            content: 'hello',
            createdAt: '2026-04-23T10:00:00.000Z',
            editedAt: null,
            author: {
                id: USER_ID,
                username: 'alice',
                globalName: 'Alice',
                avatarUrl: `https://cdn.discordapp.com/avatars/${USER_ID}/${STATIC_HASH}.webp?size=128`,
                bot: false
            }
        });
    });

    it('extracts attachments with proxy URL and content type', () => {
        const attachments = new Map();
        attachments.set('a1', {
            id: 'a1',
            name: 'pic.png',
            url: 'https://cdn.test/pic.png',
            proxyURL: 'https://proxy.test/pic.png',
            contentType: 'image/png',
            size: 1024,
            width: 100,
            height: 50,
            description: null
        });
        const api = toApiMessage(fakeMessage({ attachments }));
        expect(api.attachments).toHaveLength(1);
        expect(api.attachments?.[0]).toMatchObject({
            id: 'a1',
            filename: 'pic.png',
            contentType: 'image/png',
            size: 1024,
            width: 100,
            height: 50
        });
    });

    it('flattens reactions, including custom emoji and me state', () => {
        const reactions = new Map();
        reactions.set('👍', { emoji: { id: null, name: '👍' }, count: 3, me: true });
        reactions.set('1', { emoji: { id: '99', name: 'pog', animated: true }, count: 1, me: false });
        const api = toApiMessage(fakeMessage({ reactions: { cache: reactions } }));
        expect(api.reactions).toHaveLength(2);
        expect(api.reactions?.[0]).toMatchObject({ emoji: { id: null, name: '👍' }, count: 3, me: true });
        expect(api.reactions?.[1]).toMatchObject({ emoji: { id: '99', name: 'pog', animated: true } });
    });

    it('inlines the cached referenced message recursively', () => {
        const cache = new Map();
        cache.set('m0', fakeMessage({ id: 'm0', content: 'parent', channel: { messages: { cache: new Map() } } }));
        const api = toApiMessage(fakeMessage({
            reference: { messageId: 'm0', channelId: 'c1', guildId: null },
            channel: { messages: { cache } }
        }));
        expect(api.reference?.messageId).toBe('m0');
        expect(api.referencedMessage?.id).toBe('m0');
        expect(api.referencedMessage?.content).toBe('parent');
    });

    it('emits null referencedMessage when not in cache', () => {
        const api = toApiMessage(fakeMessage({
            reference: { messageId: 'unknown', channelId: 'c1', guildId: null }
        }));
        expect(api.referencedMessage).toBeNull();
    });
});

describe('avatarUrlFor', () => {
    it('returns animated webp for hashes that start with a_', () => {
        const url = avatarUrlFor(USER_ID, ANIMATED_HASH);
        expect(url).toBe(`https://cdn.discordapp.com/avatars/${USER_ID}/${ANIMATED_HASH}.webp?size=128&animated=true`);
    });

    it('returns static webp for non-animated hashes', () => {
        const url = avatarUrlFor(USER_ID, STATIC_HASH);
        expect(url).toBe(`https://cdn.discordapp.com/avatars/${USER_ID}/${STATIC_HASH}.webp?size=128`);
    });

    it('falls back to embed defaultAvatar when no avatar hash is present', () => {
        const url = avatarUrlFor(USER_ID, null);
        expect(url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
    });
});
