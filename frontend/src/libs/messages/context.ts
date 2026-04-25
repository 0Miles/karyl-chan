import { inject, type InjectionKey } from 'vue';
import type { ComposerTokenCodec } from './composer-editor';
import type { ComposerSuggestionProvider, MediaProvider, MessageEmoji } from './types';

export interface ResolvedUser {
    name: string;
    color?: string | null;
}

export interface ResolvedChannel {
    name: string;
    type?: 'text' | 'voice' | 'category' | 'thread' | 'forum' | 'unknown';
}

export interface ResolvedRole {
    name: string;
    color?: string | null;
}

export interface ResolvedCustomEmoji {
    url: string;
    alt: string;
}

/**
 * Generic shape for a "rich" link chip. Platform handlers map their own
 * concepts (a Discord message link, a GitHub issue URL, …) onto these
 * display-only fields so the chip component stays agnostic.
 */
export interface RichLink {
    /** Absolute icon URL; when null the chip uses `iconFallback` instead. */
    iconUrl?: string | null;
    /** Short text (1–2 chars) rendered in a badge when `iconUrl` is absent. */
    iconFallback?: string | null;
    /** Prepended directly to the label, no space (e.g. `#`). */
    labelPrefix?: string;
    /** Primary label text. */
    label: string;
    /** Secondary text shown after a `›` separator. */
    preview?: string | null;
}

/**
 * Pluggable URL handler. Wired through `MessageContext.linkHandlers` so
 * callers can teach the messages module about their own link schemes
 * without the module learning any platform-specific syntax.
 */
export interface RichLinkHandler {
    /** Cheap synchronous predicate so the renderer can decide whether to spawn a chip. */
    matches(url: string): boolean;
    /** Async resolve to chip data. Returning null means "known scheme, unreachable target". */
    resolve(url: string): Promise<RichLink | null>;
    /** Invoked when the user activates a resolved chip. */
    onClick(link: RichLink, url: string): void;
    /** Label rendered when `resolve` returns null (e.g. `# 不明` in Traditional Chinese). */
    unknownLabel: string;
}

export interface MessageContext {
    resolveUser?: (id: string) => ResolvedUser | null;
    resolveChannel?: (id: string) => ResolvedChannel | null;
    resolveRole?: (id: string) => ResolvedRole | null;
    resolveCustomEmoji?: (id: string, animated: boolean, name: string) => ResolvedCustomEmoji;
    resolveSlashCommand?: (name: string, id: string) => { display: string } | null;
    currentUserId?: string | null;
    /** Present in guild-scoped contexts; used by profile lookups to pull member info. */
    guildId?: string | null;
    onReactionAdd?: (messageId: string, emoji: MessageEmoji) => void;
    onReactionRemove?: (messageId: string, emoji: MessageEmoji) => void;
    /** Pull the list of users who reacted with `emoji` on `messageId`.
     *  Surface-specific (DM vs guild) so the workspace passes the
     *  matching API call. Returning a rejected promise surfaces in
     *  the reaction popover as an error message. */
    fetchReactionUsers?: (messageId: string, emoji: MessageEmoji) => Promise<Array<{
        id: string;
        username: string;
        globalName: string | null;
        avatarUrl: string;
    }>>;
    onReplyClick?: (messageId: string) => void;
    /** Fired when the user clicks a message avatar, author name, or user mention. */
    onUserClick?: (userId: string, anchor: HTMLElement) => void;
    /** Fired when the user right-clicks a message avatar / author name / mention.
     *  When provided, the host is expected to show a per-user context menu. */
    onUserContextMenu?: (userId: string, anchor: HTMLElement, point: { x: number; y: number }, displayName: string | null) => void;
    onAttachmentOpen?: (attachmentId: string) => void;
    mediaProvider?: MediaProvider;
    /** Providers consulted by the MessageComposer when the user types a trigger char. */
    suggestionProviders?: ComposerSuggestionProvider[];
    /** Platform-specific codec that translates between canonical text and chip elements. */
    composerTokenCodec?: ComposerTokenCodec;
    /**
     * URL handlers consulted in order when rendering a link node. The
     * first `matches(url)` wins and produces a rich chip; unmatched URLs
     * fall back to a plain anchor. Keeps link-scheme knowledge out of
     * this module.
     */
    linkHandlers?: RichLinkHandler[];
}

export const MessageContextKey: InjectionKey<MessageContext> = Symbol('MessageContext');

export function useMessageContext(): MessageContext {
    return inject(MessageContextKey, {});
}
