export type {
    Message,
    MessageAuthor,
    MessageAttachment,
    MessageEmoji,
    MessageReaction,
    MessageSticker,
    StickerFormat,
    MessageReference,
    MessageEmbed,
    MessageEmbedField,
    OutgoingMessage,
    ComposerSuggestionItem,
    ComposerSuggestionTrigger,
    ComposerSuggestionProvider
} from './types';

export { default as ComposerSuggestions } from './ComposerSuggestions.vue';
export { findActiveTrigger } from './composer-suggestions';

export type {
    MessageContext,
    ResolvedUser,
    ResolvedChannel,
    ResolvedRole,
    ResolvedCustomEmoji
} from './context';

export { MessageContextKey, useMessageContext } from './context';
export { parseMessageContent, type ASTNode } from './markdown';
export { twemojiUrl } from './twemoji';

export { default as MessageView } from './MessageView.vue';
export { default as MessageComposer } from './MessageComposer.vue';

export { isContinuation } from './grouping';
