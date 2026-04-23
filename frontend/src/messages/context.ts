import { inject, type InjectionKey } from 'vue';
import type { MessageEmoji } from './types';

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

export interface MessageContext {
    resolveUser?: (id: string) => ResolvedUser | null;
    resolveChannel?: (id: string) => ResolvedChannel | null;
    resolveRole?: (id: string) => ResolvedRole | null;
    resolveCustomEmoji?: (id: string, animated: boolean, name: string) => ResolvedCustomEmoji;
    resolveSlashCommand?: (name: string, id: string) => { display: string } | null;
    currentUserId?: string | null;
    onReactionAdd?: (messageId: string, emoji: MessageEmoji) => void;
    onReactionRemove?: (messageId: string, emoji: MessageEmoji) => void;
    onReplyClick?: (messageId: string) => void;
    onAttachmentOpen?: (attachmentId: string) => void;
}

export const MessageContextKey: InjectionKey<MessageContext> = Symbol('MessageContext');

export const defaultContext: Required<Pick<MessageContext, 'resolveCustomEmoji'>> = {
    resolveCustomEmoji: (id, animated, name) => ({
        url: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=44&quality=lossless`,
        alt: name ? `:${name}:` : ''
    })
};

export function useMessageContext(): MessageContext {
    return inject(MessageContextKey, {});
}
