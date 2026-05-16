import type { Router } from 'vue-router';
import type { RichLinkHandler } from '../../libs/messages';
import { flashMessage } from '../../libs/messages/scroll-flash';
import { useMessageLinkStore } from './stores/messageLinkStore';
import { parseDiscordLink } from './discord-url';

export interface DiscordMessageLinkHandlerOptions {
    router: Router;
    /** Current channel id — used to short-circuit same-channel clicks into an in-place scroll. */
    currentChannelId: () => string | null;
    /** Current guild id — used to detect same-surface clicks (null in DM mode). */
    currentGuildId: () => string | null;
    /** Translated string for "unknown/inaccessible target" (e.g. `# 不明`). */
    unknownLabel: string;
}

/**
 * Builds a `RichLinkHandler` that recognises Discord message URLs,
 * resolves them through the shared `messageLinkStore`, and jumps the
 * user to the referenced message. Clicks on same-surface links scroll
 * in place; cross-channel/cross-guild clicks round-trip through the
 * router with `?scrollTo=<messageId>` so the target workspace can
 * finish the jump once its messages have loaded.
 */
export function createDiscordMessageLinkHandler(opts: DiscordMessageLinkHandlerOptions): RichLinkHandler {
    const store = useMessageLinkStore();
    return {
        matches: (url) => !!parseDiscordLink(url),
        async resolve(url) {
            const info = await store.resolve(url);
            if (!info) return null;
            // Display rules:
            //   DM (channel or message)  → `#{channelName} › 💬`
            //   Guild channel link       → `{icon} {guildName} › #{channelName}`
            //   Guild message link       → `{icon} {guildName} › 💬`
            // `💬` stands in for "a message" so the chip stays compact;
            // actual message content isn't surfaced here.
            if (info.guildId) {
                const preview = info.messageId
                    ? '💬'
                    : (info.channelName ? `#${info.channelName}` : null);
                return {
                    iconUrl: info.guildIconUrl,
                    iconFallback: info.guildName?.charAt(0).toUpperCase() ?? '?',
                    label: info.guildName ?? '',
                    preview
                };
            }
            return {
                labelPrefix: '#',
                label: info.channelName,
                preview: '💬'
            };
        },
        onClick(_link, url) {
            const parsed = parseDiscordLink(url);
            if (!parsed) return;
            const sameGuild = parsed.guildId === opts.currentGuildId();
            if (sameGuild && parsed.channelId === opts.currentChannelId()) {
                // Same channel already — either jump to the referenced
                // message or, for channel-only links, stay put.
                if (parsed.messageId) {
                    document.querySelector(`[data-message-id="${parsed.messageId}"]`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    flashMessage(parsed.messageId);
                }
                return;
            }
            const query: Record<string, string> = { channel: parsed.channelId };
            if (parsed.messageId) query.scrollTo = parsed.messageId;
            if (parsed.guildId) query.guild = parsed.guildId;
            opts.router.push({ name: 'messages', query });
        },
        unknownLabel: opts.unknownLabel
    };
}
