import type { Message as DjsMessage, MessageReaction as DjsReaction, MessageType as DjsMessageType, User } from 'discord.js';
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
// HTTP 415), but discord.js's displayAvatarURL still forces .gif whenever the
// hash starts with `a_`. Build the URL ourselves and request animated webp
// instead, which Discord serves reliably for both static and animated avatars.
export function avatarUrlFor(userId: string, avatarHash: string | null, size = 128): string {
    if (!avatarHash) {
        const idx = Number((BigInt(userId) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    }
    const animated = avatarHash.startsWith('a_');
    const params = new URLSearchParams({ size: String(size) });
    if (animated) params.set('animated', 'true');
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?${params.toString()}`;
}

export function authorFromUser(user: Pick<User, 'id' | 'username' | 'globalName' | 'bot' | 'avatar'>): MessageAuthor {
    return {
        id: user.id,
        username: user.username,
        globalName: user.globalName ?? null,
        avatarUrl: avatarUrlFor(user.id, user.avatar),
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
        image: e.image ? { url: e.image.url, width: e.image.width ?? undefined, height: e.image.height ?? undefined } : null,
        thumbnail: e.thumbnail ? { url: e.thumbnail.url, width: e.thumbnail.width ?? undefined, height: e.thumbnail.height ?? undefined } : null,
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
        author: authorFromUser(message.author),
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
        pinned: message.pinned,
        tts: message.tts
    };
}

export function isReplyType(type: DjsMessageType): boolean {
    // MessageType.Reply = 19
    return Number(type) === 19;
}
