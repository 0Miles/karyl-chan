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
    image?: { url: string; proxyUrl?: string; width?: number; height?: number } | null;
    thumbnail?: { url: string; proxyUrl?: string; width?: number; height?: number } | null;
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

export interface CustomEmoji {
    id: string;
    name: string;
    animated: boolean;
}

export interface GuildSticker {
    id: string;
    name: string;
    formatType: number;
    description: string | null;
}

export interface GuildBucket<T> {
    guildId: string;
    guildName: string;
    items: T[];
}

export interface ComposerSuggestionItem {
    /** Stable id used as v-for key and the value emitted on select. */
    key: string;
    label: string;
    secondary?: string | null;
    iconUrl?: string | null;
    /** Text inserted in place of the trigger range when the user picks this item. */
    insert: string;
}

export interface ComposerSuggestionTrigger {
    /** The trigger character (e.g. '@', '#', ':', '/'). */
    char: string;
    /** Text the user has typed after the trigger char, up to the cursor. */
    query: string;
    /** [start, end] in the input. start = position of the trigger char; end = current cursor. */
    range: [number, number];
}

export interface ComposerSuggestionProvider {
    /** Trigger characters this provider responds to. */
    triggers: string[];
    /** Return matching items for the active trigger; an empty list hides the menu. */
    suggest(trigger: ComposerSuggestionTrigger): ComposerSuggestionItem[] | Promise<ComposerSuggestionItem[]>;
}

export interface MediaProvider {
    listEmojis(): Promise<GuildBucket<CustomEmoji>[]>;
    listStickers(): Promise<GuildBucket<GuildSticker>[]>;
    loadLottieSticker(stickerId: string): Promise<unknown | null>;
    /** URL to render a sticker as a static image (size hint optional). */
    stickerUrl(sticker: { id: string; formatType: number }, size?: number): string;
    /** URL to render a custom emoji at the given size. */
    customEmojiUrl(emoji: { id: string; animated: boolean; name?: string }, size?: number): string;
    /** When the avatar URL belongs to an animated avatar, return its hover/animated variant. Otherwise null. */
    avatarHoverUrl?(staticUrl: string): string | null;
    /** Synchronous peek at cached emoji buckets. Returns null if nothing is cached yet. */
    cachedEmojis?(): GuildBucket<CustomEmoji>[] | null;
    /** Synchronous peek at cached sticker buckets. Returns null if nothing is cached yet. */
    cachedStickers?(): GuildBucket<GuildSticker>[] | null;
}
