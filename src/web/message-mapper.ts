import type { GuildMember, Message as DjsMessage, MessageReaction as DjsReaction, MessageType as DjsMessageType, User } from 'discord.js';
import type {
    Message as ApiMessage,
    MessageAttachment,
    MessageEmbed,
    MessageReaction,
    MessageSticker,
    StickerFormat,
    MessageAuthor
} from './message-types.js';

// Discord no longer serves the .gif endpoint for many animated avatars (returns
// HTTP 415), so build the URL ourselves and ask for webp; the still frame is
// served by default and the frontend opts into the animated variant on hover
// by appending &animated=true.
export function avatarUrlFor(userId: string, avatarHash: string | null, size = 128): string {
    if (!avatarHash) {
        const idx = Number((BigInt(userId) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=${size}`;
}

// Per-guild avatar: rendered only when a member has set a guild-specific
// avatar distinct from their global one. Same `a_` hash convention as
// global avatars, just hosted under /guilds/:gid/users/:uid/avatars/.
export function guildAvatarUrlFor(guildId: string, userId: string, avatarHash: string, size = 128): string {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.webp?size=${size}`;
}

export function bannerUrlFor(userId: string, bannerHash: string | null | undefined, size = 600): string | null {
    if (!bannerHash) return null;
    return `https://cdn.discordapp.com/banners/${userId}/${bannerHash}.webp?size=${size}`;
}

export function guildBannerUrlFor(guildId: string, userId: string, bannerHash: string | null | undefined, size = 600): string | null {
    if (!bannerHash) return null;
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/banners/${bannerHash}.webp?size=${size}`;
}

export function authorFromUser(
    user: Pick<User, 'id' | 'username' | 'globalName' | 'bot' | 'avatar'>,
    member?: Pick<GuildMember, 'nickname' | 'avatar'> | null,
    guildId?: string | null
): MessageAuthor {
    const memberAvatar = member?.avatar;
    const avatarUrl = memberAvatar && guildId
        ? guildAvatarUrlFor(guildId, user.id, memberAvatar)
        : avatarUrlFor(user.id, user.avatar);
    return {
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        nickname: member?.nickname ?? null,
        avatarUrl,
        bot: !!user.bot
    };
}

function mapAttachments(message: DjsMessage): MessageAttachment[] {
    return [...message.attachments.values()].map(a => ({
        id: a.id,
        filename: a.name,
        url: a.url,
        proxyUrl: a.proxyURL,
        contentType: a.contentType ?? null,
        size: a.size,
        width: a.width ?? null,
        height: a.height ?? null,
        description: a.description ?? null
    }));
}

function mapReactions(message: DjsMessage): MessageReaction[] {
    return [...message.reactions.cache.values()].map((r: DjsReaction) => ({
        emoji: {
            id: r.emoji.id,
            name: r.emoji.name ?? '',
            animated: r.emoji.animated ?? false
        },
        count: r.count,
        me: r.me
    }));
}

function mapStickers(message: DjsMessage): MessageSticker[] {
    return [...message.stickers.values()].map(s => ({
        id: s.id,
        name: s.name,
        formatType: s.format as StickerFormat
    }));
}

function mapEmbeds(message: DjsMessage): MessageEmbed[] {
    return message.embeds.map(e => ({
        title: e.title ?? null,
        description: e.description ?? null,
        url: e.url ?? null,
        color: e.color ?? null,
        image: e.image ? { url: e.image.url, proxyUrl: e.image.proxyURL, width: e.image.width ?? undefined, height: e.image.height ?? undefined } : null,
        thumbnail: e.thumbnail ? { url: e.thumbnail.url, proxyUrl: e.thumbnail.proxyURL, width: e.thumbnail.width ?? undefined, height: e.thumbnail.height ?? undefined } : null,
        footer: e.footer ? { text: e.footer.text, iconUrl: e.footer.iconURL ?? undefined } : null,
        author: e.author ? { name: e.author.name, url: e.author.url ?? undefined, iconUrl: e.author.iconURL ?? undefined } : null,
        fields: e.fields?.map(f => ({ name: f.name, value: f.value, inline: f.inline })) ?? [],
        timestamp: e.timestamp ?? null
    }));
}

export function toApiMessage(message: DjsMessage): ApiMessage {
    const referenced = message.reference?.messageId
        ? message.channel.messages.cache.get(message.reference.messageId) ?? null
        : null;

    return {
        id: message.id,
        channelId: message.channelId,
        guildId: message.guildId ?? null,
        author: authorFromUser(message.author, message.member, message.guildId),
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt ? message.editedAt.toISOString() : null,
        attachments: mapAttachments(message),
        reactions: mapReactions(message),
        stickers: mapStickers(message),
        embeds: mapEmbeds(message),
        reference: message.reference
            ? {
                messageId: message.reference.messageId ?? null,
                channelId: message.reference.channelId,
                guildId: message.reference.guildId ?? null
            }
            : null,
        referencedMessage: referenced ? toApiMessage(referenced) : null,
        mentionEveryone: message.mentions.everyone,
        // `mentions.has(bot.user)` covers direct mentions, any of the
        // bot's guild roles, @everyone/@here, and reply-pings — exactly
        // the signal the unread "@me" indicator cares about. `client`
        // is optional on the mock messages the tests construct, hence
        // the optional-chain.
        mentionsMe: message.client?.user ? message.mentions.has(message.client.user) : false,
        pinned: message.pinned,
        tts: message.tts
    };
}

export function isReplyType(type: DjsMessageType): boolean {
    // MessageType.Reply = 19
    return Number(type) === 19;
}
