import type { Router } from 'vue-router';
import type { RichLinkHandler } from '../../libs/messages';
import { useMessageLinkStore } from './stores/messageLinkStore';

// Discord permalink URLs come in several flavours:
//   https://discord.com/channels/<guildId>/<channelId>/<messageId>        (message link)
//   https://discord.com/channels/<guildId>/<channelId>                     (channel link)
//   https://discord.com/channels/@me/<channelId>[/<messageId>]             (DM variants)
//   https://ptb.discord.com/... / canary.discord.com/... / discordapp.com  (beta + legacy)
// `@me` maps to `guildId === null`; omitting the trailing id makes it a
// channel-only link. A trailing slash, query string or fragment is
// tolerated so users can copy-paste URLs that carry tracking params.

const MSG_LINK_RE = /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?(?:[/?#].*)?$/;

interface Parsed {
    guildId: string | null;
    channelId: string;
    messageId: string | null;
}

function parse(url: string): Parsed | null {
    const m = MSG_LINK_RE.exec(url);
    if (!m) return null;
    return {
        guildId: m[1] === '@me' ? null : m[1],
        channelId: m[2],
        messageId: m[3] ?? null
    };
}

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
        matches: (url) => !!parse(url),
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
            const parsed = parse(url);
            if (!parsed) return;
            const sameGuild = parsed.guildId === opts.currentGuildId();
            if (sameGuild && parsed.channelId === opts.currentChannelId()) {
                // Same channel already — either jump to the referenced
                // message or, for channel-only links, stay put.
                if (parsed.messageId) {
                    document.querySelector(`[data-message-id="${parsed.messageId}"]`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
