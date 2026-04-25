import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Router } from 'vue-router';
import { createDiscordMessageLinkHandler } from './discord-link-handler';
import type { DiscordMessageLinkInfo } from '../../api/discord';

const flashSpy = vi.fn();
vi.mock('../../libs/messages/scroll-flash', () => ({
    flashMessage: (id: string) => flashSpy(id)
}));

const resolveSpy = vi.fn<(url: string) => Promise<DiscordMessageLinkInfo | null>>();
vi.mock('./stores/messageLinkStore', () => ({
    useMessageLinkStore: () => ({ resolve: resolveSpy })
}));

function makeHandler(overrides: Partial<{
    currentChannelId: string | null;
    currentGuildId: string | null;
}> = {}) {
    const push = vi.fn();
    const router = { push } as unknown as Router;
    const handler = createDiscordMessageLinkHandler({
        router,
        currentChannelId: () => overrides.currentChannelId ?? null,
        currentGuildId: () => overrides.currentGuildId ?? null,
        unknownLabel: '# 不明'
    });
    return { handler, push };
}

beforeEach(() => {
    setActivePinia(createPinia());
    flashSpy.mockReset();
    resolveSpy.mockReset();
    document.body.innerHTML = '';
});

describe('matches', () => {
    it('accepts a canonical guild message link', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://discord.com/channels/111/222/333')).toBe(true);
    });

    it('accepts the discordapp.com legacy host', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://discordapp.com/channels/111/222/333')).toBe(true);
    });

    it('accepts ptb./canary./www. subdomains', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://ptb.discord.com/channels/111/222/333')).toBe(true);
        expect(handler.matches('https://canary.discord.com/channels/111/222/333')).toBe(true);
        expect(handler.matches('https://www.discord.com/channels/111/222/333')).toBe(true);
    });

    it('accepts a channel-only link (no message id)', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://discord.com/channels/111/222')).toBe(true);
    });

    it('accepts a DM link with @me', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://discord.com/channels/@me/222/333')).toBe(true);
    });

    it('tolerates a trailing slash, query string, or fragment', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://discord.com/channels/111/222/333/')).toBe(true);
        expect(handler.matches('https://discord.com/channels/111/222/333?utm=foo')).toBe(true);
        expect(handler.matches('https://discord.com/channels/111/222/333#x')).toBe(true);
    });

    it('rejects non-Discord URLs', () => {
        const { handler } = makeHandler();
        expect(handler.matches('https://example.com/channels/111/222/333')).toBe(false);
        expect(handler.matches('https://discord.com/invite/abc')).toBe(false);
        expect(handler.matches('not a url at all')).toBe(false);
    });
});

describe('resolve', () => {
    it('returns null when the store cannot resolve the link', async () => {
        resolveSpy.mockResolvedValueOnce(null);
        const { handler } = makeHandler();
        const r = await handler.resolve!('https://discord.com/channels/111/222/333');
        expect(r).toBeNull();
    });

    it('formats a guild message link with the 💬 preview and guild label', async () => {
        resolveSpy.mockResolvedValueOnce({
            guildId: '111', guildName: 'My Guild', guildIconUrl: 'https://cdn/icon.png',
            channelId: '222', channelName: 'general',
            messageId: '333', preview: 'hello'
        });
        const { handler } = makeHandler();
        const r = await handler.resolve!('https://discord.com/channels/111/222/333');
        expect(r).toEqual({
            iconUrl: 'https://cdn/icon.png',
            iconFallback: 'M',
            label: 'My Guild',
            preview: '💬'
        });
    });

    it('formats a guild channel link with #channel preview', async () => {
        resolveSpy.mockResolvedValueOnce({
            guildId: '111', guildName: 'My Guild', guildIconUrl: null,
            channelId: '222', channelName: 'general',
            messageId: null, preview: null
        });
        const { handler } = makeHandler();
        const r = await handler.resolve!('https://discord.com/channels/111/222');
        expect(r).toEqual({
            iconUrl: null,
            iconFallback: 'M',
            label: 'My Guild',
            preview: '#general'
        });
    });

    it('uses ? as the icon fallback when the guild has no name', async () => {
        resolveSpy.mockResolvedValueOnce({
            guildId: '111', guildName: null, guildIconUrl: null,
            channelId: '222', channelName: 'general',
            messageId: '333', preview: null
        });
        const { handler } = makeHandler();
        const r = await handler.resolve!('https://discord.com/channels/111/222/333');
        expect(r).toMatchObject({ iconFallback: '?', label: '' });
    });

    it('formats a DM link with the # prefix and 💬 preview', async () => {
        resolveSpy.mockResolvedValueOnce({
            guildId: null, guildName: null, guildIconUrl: null,
            channelId: '222', channelName: 'alice',
            messageId: '333', preview: 'hi'
        });
        const { handler } = makeHandler();
        const r = await handler.resolve!('https://discord.com/channels/@me/222/333');
        expect(r).toEqual({
            labelPrefix: '#',
            label: 'alice',
            preview: '💬'
        });
    });
});

describe('onClick', () => {
    it('does nothing on a non-matching URL', () => {
        const { handler, push } = makeHandler();
        handler.onClick!({} as never, 'https://example.com/x');
        expect(push).not.toHaveBeenCalled();
    });

    it('scrolls in place + flashes when the link points at a message in the current channel', () => {
        const target = document.createElement('div');
        target.setAttribute('data-message-id', '333');
        const scrollIntoView = vi.fn();
        target.scrollIntoView = scrollIntoView;
        document.body.appendChild(target);

        const { handler, push } = makeHandler({ currentGuildId: '111', currentChannelId: '222' });
        handler.onClick!({} as never, 'https://discord.com/channels/111/222/333');

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        expect(flashSpy).toHaveBeenCalledWith('333');
        expect(push).not.toHaveBeenCalled();
    });

    it('does not flash for a channel-only link in the current channel', () => {
        const { handler, push } = makeHandler({ currentGuildId: '111', currentChannelId: '222' });
        handler.onClick!({} as never, 'https://discord.com/channels/111/222');
        expect(flashSpy).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
    });

    it('routes via vue-router to a different channel in the same guild', () => {
        const { handler, push } = makeHandler({ currentGuildId: '111', currentChannelId: 'other' });
        handler.onClick!({} as never, 'https://discord.com/channels/111/222/333');
        expect(push).toHaveBeenCalledWith({
            name: 'messages',
            query: { channel: '222', scrollTo: '333', guild: '111' }
        });
    });

    it('omits scrollTo for a channel-only cross-channel click', () => {
        const { handler, push } = makeHandler({ currentGuildId: '111', currentChannelId: 'other' });
        handler.onClick!({} as never, 'https://discord.com/channels/111/222');
        expect(push).toHaveBeenCalledWith({
            name: 'messages',
            query: { channel: '222', guild: '111' }
        });
    });

    it('omits guild for an @me/DM cross-channel click', () => {
        const { handler, push } = makeHandler({ currentGuildId: null, currentChannelId: 'other' });
        handler.onClick!({} as never, 'https://discord.com/channels/@me/222/333');
        expect(push).toHaveBeenCalledWith({
            name: 'messages',
            query: { channel: '222', scrollTo: '333' }
        });
    });

    it('routes when the channel matches but the guild differs (cross-guild same channel id)', () => {
        // Same channel id but different guild — must round-trip through
        // the router so we leave the current guild surface.
        const { handler, push } = makeHandler({ currentGuildId: '999', currentChannelId: '222' });
        handler.onClick!({} as never, 'https://discord.com/channels/111/222/333');
        expect(push).toHaveBeenCalled();
    });
});

describe('unknownLabel passthrough', () => {
    it('exposes the configured unknown label', () => {
        const { handler } = makeHandler();
        expect(handler.unknownLabel).toBe('# 不明');
    });
});
