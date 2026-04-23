export interface MessageAuthor {
    id: string;
    username: string;
    globalName?: string | null;
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

export type StickerFormat = 1 | 2 | 3 | 4; // PNG, APNG, LOTTIE, GIF

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
    image?: { url: string; width?: number; height?: number } | null;
    thumbnail?: { url: string; width?: number; height?: number } | null;
    footer?: { text: string; iconUrl?: string } | null;
    author?: { name: string; url?: string; iconUrl?: string } | null;
    fields?: MessageEmbedField[];
    timestamp?: string | null;
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
    pinned?: boolean;
    tts?: boolean;
}

export interface OutgoingMessage {
    content: string;
    attachments?: File[];
    stickerIds?: string[];
    reference?: MessageReference | null;
}
