import { computed, onMounted, provide, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { MessageContextKey, type ComposerSuggestionItem } from '../../libs/messages';
import { createDiscordMessageContext } from './createMessageContext';
import { createDiscordMessageLinkHandler } from './discord-link-handler';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useDiscordChat } from './useDiscordChat';
import { loadLastGuildChannel, saveLastGuildChannel } from './last-channel';
import { useBotStore } from './stores/botStore';
import { useGuildChannelStore } from './stores/guildChannelStore';

export interface UseDiscordGuildChannelOptions {
    onAuthError?: () => void;
}

export function useDiscordGuildChannel(guildId: Ref<string | null>, opts: UseDiscordGuildChannelOptions = {}) {
    const guildStore = useGuildChannelStore();
    const botStore = useBotStore();
    const router = useRouter();
    const { t } = useI18n();

    const selectedChannelId = ref<string | null>(null);

    const bailOnAuthError = createAuthErrorBail({ onAuthError: opts.onAuthError });

    const botUserId = computed(() => botStore.userId);
    const botDisplayName = () => botStore.displayName();

    const categories = computed(() =>
        guildId.value ? guildStore.getCategories(guildId.value) : []
    );
    const channels = computed(() => categories.value.flatMap(c => c.channels));

    const chat = useDiscordChat({
        channelId: selectedChannelId,
        botUserId,
        api: {
            listMessages: (channelId, o) => guildStore.listMessages(guildId.value!, channelId, o),
            sendMessage: (channelId, content, files, stickerIds, replyToMessageId) =>
                guildStore.sendMessage(guildId.value!, channelId, content, files, stickerIds, replyToMessageId),
            editMessage: (channelId, messageId, content) =>
                guildStore.editMessage(guildId.value!, channelId, messageId, content),
            deleteMessage: (channelId, messageId) =>
                guildStore.deleteMessage(guildId.value!, channelId, messageId),
            addReaction: (channelId, messageId, emoji) =>
                guildStore.addReaction(guildId.value!, channelId, messageId, emoji),
            removeReaction: (channelId, messageId, emoji) =>
                guildStore.removeReaction(guildId.value!, channelId, messageId, emoji),
        },
        onError: bailOnAuthError,
    });

    const selectedChannel = computed(() =>
        channels.value.find(c => c.id === selectedChannelId.value) ?? null
    );

    function matchesQuery(query: string, ...candidates: (string | null | undefined)[]): boolean {
        if (!query) return true;
        const q = query.toLowerCase();
        return candidates.some(c => !!c && c.toLowerCase().includes(q));
    }

    const messageContext = createDiscordMessageContext({
        botUserId,
        guildId,
        onReactionAdd: chat.reactAdd,
        onReactionRemove: chat.reactRemove,
        linkHandlers: [createDiscordMessageLinkHandler({
            router,
            currentChannelId: () => selectedChannelId.value,
            currentGuildId: () => guildId.value ?? null,
            unknownLabel: t('messages.linkUnknown')
        })],
        resolveUser(id) {
            if (botUserId.value === id) {
                const name = botDisplayName();
                if (name) return { name };
            }
            const gid = guildId.value;
            const channelId = selectedChannelId.value;
            if (gid && channelId) {
                const members = guildStore.getChannelMembers(gid, channelId);
                const hit = members?.find(m => m.id === id);
                if (hit) return {
                    name: hit.nickname ?? hit.globalName ?? hit.username,
                    color: hit.color
                };
            }
            for (const message of chat.messages.value) {
                if (message.author.id === id) {
                    return { name: message.author.globalName ?? message.author.username };
                }
            }
            return null;
        },
        resolveRole(id) {
            const gid = guildId.value;
            if (!gid) return null;
            const role = guildStore.getRoles(gid)?.find(r => r.id === id);
            return role ? { name: role.name, color: role.color } : null;
        },
        suggestionProviders: [
            {
                triggers: ['@'],
                async suggest({ query }) {
                    const gid = guildId.value;
                    const channelId = selectedChannelId.value;
                    if (!gid || !channelId) return [];
                    const [roles, members] = await Promise.all([
                        guildStore.ensureRoles(gid).catch(() => []),
                        guildStore.ensureChannelMembers(gid, channelId).catch(() => [])
                    ]);
                    if (gid !== guildId.value || channelId !== selectedChannelId.value) return [];
                    const items: ComposerSuggestionItem[] = [];
                    const MEMBER_MAX = 20;
                    // With no typed query we only surface the top 3 roles so
                    // the menu doesn't drown the members list. Once the user
                    // filters, every matching role is eligible — the popover
                    // is scrollable, so we let the query do the narrowing.
                    const ROLE_MAX = query ? 10 : 3;
                    for (const m of members) {
                        if (items.length >= MEMBER_MAX) break;
                        const display = m.nickname ?? m.globalName ?? m.username;
                        if (!matchesQuery(query, m.nickname, m.globalName, m.username, m.id)) continue;
                        items.push({
                            key: `user:${m.id}`,
                            label: display,
                            secondary: m.username !== display ? `@${m.username}` : null,
                            iconUrl: m.avatarUrl,
                            insert: `<@${m.id}>`
                        });
                    }
                    let roleCount = 0;
                    for (const role of roles) {
                        if (roleCount >= ROLE_MAX) break;
                        if (!matchesQuery(query, role.name)) continue;
                        items.push({
                            key: `role:${role.id}`,
                            label: `@${role.name}`,
                            secondary: 'role',
                            iconUrl: null,
                            color: role.color,
                            insert: `<@&${role.id}>`
                        });
                        roleCount++;
                    }
                    return items;
                }
            }
        ]
    });
    provide(MessageContextKey, messageContext);

    async function loadGuild(id: string) {
        try {
            await guildStore.ensureChannels(id);
            guildStore.ensureRoles(id).catch(() => { /* best-effort mention cache */ });
        } catch (err) {
            bailOnAuthError(err);
        }
    }

    watch(guildId, async (id) => {
        selectedChannelId.value = null;
        if (id) await loadGuild(id);
    });

    // Central channel-selection policy: every time the channel list for
    // the active guild updates (initial load, guild switch, channel
    // created/deleted) or `selectedChannelId` is externally set (URL
    // `?channel=`, programmatic navigation), ensure it points at a live
    // channel in the current guild. Watching both refs is load-bearing:
    // a cross-surface navigation may seed a stale id before the channel
    // list refreshes, and without the selectedChannelId dep the watcher
    // would not re-fire to correct it. Falls back to the per-guild
    // localStorage record, then the first channel.
    watch([channels, selectedChannelId], ([list, current]) => {
        const gid = guildId.value;
        if (!gid || list.length === 0) return;
        if (current && list.some(c => c.id === current)) return;
        const remembered = loadLastGuildChannel(gid);
        const match = remembered ? list.find(c => c.id === remembered) : null;
        selectedChannelId.value = match ? match.id : list[0].id;
    }, { immediate: true });

    // Persist the active channel and prefetch mention members. Depends on
    // `channels` as well as `selectedChannelId` so the validation fires
    // again when the channel list arrives after a URL-seeded selection:
    // without that, reloading `?guild=A&channel=X` would set the id before
    // channels loaded, the list-membership guard would reject it, and no
    // ensureChannelMembers call would ever happen — leaving messages
    // rendered without role colours. The list-membership guard also stops
    // a transient stale id (e.g. carried over from another guild) from
    // poisoning the localStorage record or triggering a bad fetch.
    watch([selectedChannelId, channels], ([channelId, list]) => {
        const gid = guildId.value;
        if (!gid || !channelId) return;
        if (!list.some(c => c.id === channelId)) return;
        saveLastGuildChannel(gid, channelId);
        guildStore.ensureChannelMembers(gid, channelId).catch(() => { /* best-effort */ });
    });

    onMounted(async () => {
        botStore.init();
        guildStore.startSSE();
        if (guildId.value) await loadGuild(guildId.value);
    });

    return {
        categories,
        channels,
        selectedChannelId,
        selectedChannel,
        loadingChannels: computed(() => guildId.value ? guildStore.isLoading(guildId.value) : false),
        channelsError: computed(() => guildId.value ? guildStore.getError(guildId.value) : null),
        botUserId,
        chat,
        send: chat.send,
        reactWithSelection: chat.reactWithSelection,
        refreshChannels: () => guildId.value ? guildStore.loadChannels(guildId.value) : Promise.resolve(),
    };
}
