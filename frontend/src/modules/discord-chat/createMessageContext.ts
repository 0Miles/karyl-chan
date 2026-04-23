import type { Ref } from 'vue';
import type {
    ComposerSuggestionProvider,
    MediaProvider,
    MessageContext,
    ResolvedChannel,
    ResolvedRole,
    ResolvedUser
} from '../../libs/messages';
import { createDiscordComposerTokenCodec } from './composer-token-codec';
import { createDefaultDiscordMediaProvider } from './createMediaProvider';

export interface DiscordMessageContextOptions {
    /** Bot user id ref — exposed as `currentUserId` via a live getter. */
    botUserId: Ref<string | null>;
    onReactionAdd: NonNullable<MessageContext['onReactionAdd']>;
    onReactionRemove: NonNullable<MessageContext['onReactionRemove']>;
    /** Platform-specific user resolver (DM: recipient+bot; guild: members). */
    resolveUser?: (id: string) => ResolvedUser | null;
    resolveChannel?: (id: string) => ResolvedChannel | null;
    resolveRole?: (id: string) => ResolvedRole | null;
    suggestionProviders?: ComposerSuggestionProvider[];
    /** Override the default Discord media provider (tests / custom scopes). */
    mediaProvider?: MediaProvider;
    /** Override the default "scroll to referenced message" behavior. */
    onReplyClick?: (messageId: string) => void;
}

function defaultScrollToReply(messageId: string) {
    document.querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const ctx: MessageContext = {
        onReactionAdd: opts.onReactionAdd,
        onReactionRemove: opts.onReactionRemove,
        onReplyClick: opts.onReplyClick ?? defaultScrollToReply,
        get currentUserId() { return opts.botUserId.value; },
        resolveUser: opts.resolveUser,
        resolveChannel: opts.resolveChannel,
        resolveRole: opts.resolveRole,
        mediaProvider: opts.mediaProvider ?? createDefaultDiscordMediaProvider(),
        suggestionProviders: opts.suggestionProviders
    };
    ctx.composerTokenCodec = createDiscordComposerTokenCodec(ctx);
    return ctx;
}
