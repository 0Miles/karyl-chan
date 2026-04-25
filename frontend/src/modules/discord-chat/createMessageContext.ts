import type { Ref } from 'vue';
import type {
    ComposerSuggestionProvider,
    MediaProvider,
    MessageContext,
    ResolvedChannel,
    ResolvedRole,
    ResolvedUser,
    RichLinkHandler
} from '../../libs/messages';
import { flashMessage } from '../../libs/messages/scroll-flash';
import { createDiscordComposerTokenCodec } from './composer-token-codec';
import { createDefaultDiscordMediaProvider } from './createMediaProvider';
import { useUserContextMenuStore } from './stores/userContextMenuStore';
import { useUserProfileStore } from './stores/userProfileStore';

export interface DiscordMessageContextOptions {
    /** Bot user id ref — exposed as `currentUserId` via a live getter. */
    botUserId: Ref<string | null>;
    /** Guild the conversation lives in — null for DMs. Threaded into MessageContext.guildId. */
    guildId?: Ref<string | null>;
    onReactionAdd: NonNullable<MessageContext['onReactionAdd']>;
    onReactionRemove: NonNullable<MessageContext['onReactionRemove']>;
    fetchReactionUsers?: NonNullable<MessageContext['fetchReactionUsers']>;
    /** Platform-specific user resolver (DM: recipient+bot; guild: members). */
    resolveUser?: (id: string) => ResolvedUser | null;
    resolveChannel?: (id: string) => ResolvedChannel | null;
    resolveRole?: (id: string) => ResolvedRole | null;
    suggestionProviders?: ComposerSuggestionProvider[];
    /** Override the default Discord media provider (tests / custom scopes). */
    mediaProvider?: MediaProvider;
    /** Override the default "scroll to referenced message" behavior. */
    onReplyClick?: (messageId: string) => void;
    /**
     * URL handlers to register on the generated context. Pass any
     * number of platform-specific handlers (Discord message links,
     * invite links, …) and `MessageContent` will pick the first match.
     */
    linkHandlers?: RichLinkHandler[];
}

function defaultScrollToReply(messageId: string) {
    document.querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashMessage(messageId);
}

/**
 * Build a `MessageContext` for a Discord chat workspace. Pure factory: the
 * caller is responsible for `provide(MessageContextKey, ctx)` so the Vue DI
 * scope stays explicit and the result is trivially testable.
 *
 * The composer token codec captures `ctx` by reference, so `resolveUser` /
 * `mediaProvider` reads inside the codec stay live after this returns.
 */
export function createDiscordMessageContext(opts: DiscordMessageContextOptions): MessageContext {
    const userCard = useUserProfileStore();
    const userMenu = useUserContextMenuStore();
    const guildIdRef = opts.guildId;
    const ctx: MessageContext = {
        onReactionAdd: opts.onReactionAdd,
        onReactionRemove: opts.onReactionRemove,
        fetchReactionUsers: opts.fetchReactionUsers,
        onReplyClick: opts.onReplyClick ?? defaultScrollToReply,
        onUserClick: (userId, anchor) => userCard.openFor(userId, anchor, guildIdRef?.value ?? null),
        onUserContextMenu: (userId, anchor, point, displayName) => userMenu.open({
            userId,
            anchor,
            x: point.x,
            y: point.y,
            guildId: guildIdRef?.value ?? null,
            displayName
        }),
        get currentUserId() { return opts.botUserId.value; },
        get guildId() { return guildIdRef?.value ?? null; },
        resolveUser: opts.resolveUser,
        resolveChannel: opts.resolveChannel,
        resolveRole: opts.resolveRole,
        mediaProvider: opts.mediaProvider ?? createDefaultDiscordMediaProvider(),
        suggestionProviders: opts.suggestionProviders,
        linkHandlers: opts.linkHandlers
    };
    ctx.composerTokenCodec = createDiscordComposerTokenCodec(ctx);
    return ctx;
}
