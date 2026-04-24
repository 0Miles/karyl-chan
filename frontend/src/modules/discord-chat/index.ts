export { default as DiscordConversation } from './DiscordConversation.vue';

// Shared building blocks — usable by any Discord chat workspace (DM, guild, ...).
export { useDiscordChat, type DiscordChatApi, type ChannelMessageEvent, type UseDiscordChatOptions } from './useDiscordChat';
export { useBotIdentity } from './useBotIdentity';
export { createDiscordMessageContext, type DiscordMessageContextOptions } from './createMessageContext';
export { createDiscordMediaProvider, createDefaultDiscordMediaProvider, type MediaProviderFetchers } from './createMediaProvider';
export { createDiscordComposerTokenCodec } from './composer-token-codec';
export { createAuthErrorBail, type AuthErrorBailOptions } from './useAuthErrorBail';
export { stickerImageUrl } from './sticker-url';
export { animatedAvatarUrl, isAnimatedAvatar, isAnimatedBanner } from './avatar';

// Pinia stores.
export { useBotStore } from './stores/botStore';
export { useMessageCacheStore } from './stores/messageCacheStore';
export { useDmStore } from './stores/dmStore';
export { useGuildChannelStore } from './stores/guildChannelStore';

// Workspace composables — one per Discord chat surface.
export { useDiscordDm, type UseDiscordDmOptions } from './useDiscordDm';
export { useDiscordGuildChannel, type UseDiscordGuildChannelOptions } from './useDiscordGuildChannel';
