// Backend mirror of the frontend messages module shape; kept in sync by
// hand. Adding a field here is cheap, so prefer extending here over a
// shared package while there's only one caller.

export interface MessageAuthor {
    id: string;
    username: string;
    globalName: string | null;
    /** Per-guild nickname when the message came from a guild channel. */
    nickname?: string | null;
    avatarUrl: string | null;
    bot?: boolean;
}

export interface MessageAttachment {
    id: string;
    filename: string;
    url: string;
    proxyUrl?: string;
    contentType?: string | null;
    size: number;
    width?: number | null;
    height?: number | null;
    description?: string | null;
}

export interface MessageEmoji {
    id: string | null;
    name: string;
    animated?: boolean;
}

export interface MessageReaction {
    emoji: MessageEmoji;
    count: number;
    me: boolean;
}

export type StickerFormat = 1 | 2 | 3 | 4;

export interface MessageSticker {
    id: string;
    name: string;
    formatType: StickerFormat;
}

export interface MessageReference {
    messageId?: string | null;
    channelId?: string | null;
    guildId?: string | null;
}

export interface MessageEmbedField {
    name: string;
    value: string;
    inline?: boolean;
}

export interface MessageEmbed {
    title?: string | null;
    description?: string | null;
    url?: string | null;
    color?: number | null;
    image?: { url: string; proxyUrl?: string; width?: number; height?: number } | null;
    thumbnail?: { url: string; proxyUrl?: string; width?: number; height?: number } | null;
    footer?: { text: string; iconUrl?: string } | null;
    author?: { name: string; url?: string; iconUrl?: string } | null;
    fields?: MessageEmbedField[];
    timestamp?: string | null;
}

export interface MessageThreadSummary {
    id: string;
    name: string;
    archived: boolean;
    messageCount: number;
}

export interface Message {
    id: string;
    channelId: string;
    guildId?: string | null;
    author: MessageAuthor;
    content: string;
    createdAt: string;
    editedAt?: string | null;
    attachments?: MessageAttachment[];
    reactions?: MessageReaction[];
    stickers?: MessageSticker[];
    embeds?: MessageEmbed[];
    reference?: MessageReference | null;
    referencedMessage?: Message | null;
    mentionEveryone?: boolean;
    /** True when this message pings the bot — direct user mention,
     *  role the bot holds, @everyone/@here, or a reply to the bot.
     *  Source of truth for the unread "@mention" indicator. */
    mentionsMe?: boolean;
    pinned?: boolean;
    tts?: boolean;
    /** Set when the message has a thread attached — i.e. the message
     *  was used as the starter for a public/private thread. The
     *  frontend renders this as a "view thread" chip below the body. */
    thread?: MessageThreadSummary | null;
}
