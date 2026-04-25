import { computed, onMounted, provide, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { MessageContextKey, type ComposerSuggestionItem } from '../../libs/messages';
import { createDiscordMessageContext } from './createMessageContext';
import { createDiscordMessageLinkHandler } from './discord-link-handler';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useDiscordChat } from './useDiscordChat';
import { loadLastGuildChannel, saveLastGuildChannel, saveLastSurface } from './last-channel';
import { useWorkspace } from './useWorkspace';
import { useBotStore } from './stores/botStore';
import { useGuildChannelStore } from './stores/guildChannelStore';
import { useUnreadSync } from './useUnreadSync';

export interface UseDiscordGuildChannelOptions {
    onAuthError?: () => void;
    /** Called when the server rejects the request with 403 — the
     *  workspace should swap in an access-denied view. */
    onForbidden?: () => void;
    /** Fired when the workspace machine's pending scroll target resolves (found or gave up). */
    onScrollFinished?: (messageId: string, found: boolean) => void;
    /** Scroller-aware scroll attempt — see UseWorkspaceOptions.attemptScroll. */
    attemptScroll?: (messageId: string) => boolean;
}

export function useDiscordGuildChannel(guildId: Ref<string | null>, opts: UseDiscordGuildChannelOptions = {}) {
    const guildStore = useGuildChannelStore();
    const botStore = useBotStore();
    const router = useRouter();
    const { t } = useI18n();

    const bailOnAuthError = createAuthErrorBail({
        onAuthError: opts.onAuthError,
        onForbidden: opts.onForbidden
    });

    const botUserId = computed(() => botStore.userId);
    const botDisplayName = () => botStore.displayName();

    const categories = computed(() =>
        guildId.value ? guildStore.getCategories(guildId.value) : []
    );
    const channels = computed(() => categories.value.flatMap(c => c.channels));
    const availableChannelIds = computed(() => channels.value.map(c => c.id));

    // Workspace machine owns selection + scroll lifecycle. Side effects
    // (save localStorage, ensureChannelMembers) are surfaced here where
    // the guildStore is reachable.
    const workspace = useWorkspace({
        guildId,
        availableChannelIds,
        readLastChannel: (gid) => gid ? loadLastGuildChannel(gid) : null,
        onChannelCommitted: (gid, channelId) => {
            if (!gid) return;
            saveLastGuildChannel(gid, channelId);
            saveLastSurface({ mode: gid, channelId });
            guildStore.ensureChannelMembers(gid, channelId).catch(() => {
                /* best-effort mention cache */
            });
        },
        onScrollFinished: opts.onScrollFinished,
        attemptScroll: opts.attemptScroll
    });

    const selectedChannelId = workspace.selectedChannelId;

    const chat = useDiscordChat({
        channelId: selectedChannelId,
        botUserId,
        api: {
            listMessages: (channelId, o) => guildStore.listMessages(guildId.value!, channelId, o),
            sendMessage: (channelId, content, files, stickerIds, replyToMessageId, replyPingAuthor) =>
                guildStore.sendMessage(guildId.value!, channelId, content, files, stickerIds, replyToMessageId, replyPingAuthor),
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

    // Feed the scroll region of the machine: every time the chat
    // messages ref changes identity (a load batch arrives), we notify
    // so pending scroll targets can retry against the freshly-rendered
    // DOM.
    watch(chat.messages, () => workspace.notifyMessagesChanged());

    useUnreadSync(
        selectedChannelId,
        computed(() => channels.value.map(c => ({ id: c.id, lastMarker: c.lastMessageId }))),
        guildId,
    );

    // When a scroll target is pending but the message isn't in the
    // loaded batch (typical message-link case — target is older than
    // the default latest page), fetch a window centred on it. One
    // request is enough; the resulting MESSAGES_CHANGED will let the
    // machine retry the scroll.
    let lastAroundFetch = '';
    watch(
        [workspace.pendingScrollTo, chat.messages],
        ([scrollTarget, msgs]) => {
            if (!scrollTarget || lastAroundFetch === scrollTarget) return;
            if (msgs.some(m => m.id === scrollTarget)) return;
            lastAroundFetch = scrollTarget;
            chat.loadAround(scrollTarget).catch(() => { /* best-effort */ });
        }
    );
    watch(workspace.pendingScrollTo, (v) => {
        if (v === null) lastAroundFetch = '';
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
        onReplyClick: (messageId) => workspace.requestScroll(messageId),
        async fetchReactionUsers(messageId, emoji) {
            const gid = guildId.value;
            const channelId = selectedChannelId.value;
            if (!gid || !channelId) return [];
            const { getGuildReactionUsers } = await import('../../api/guilds');
            return getGuildReactionUsers(gid, channelId, messageId, { id: emoji.id ?? null, name: emoji.name });
        },
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

    // Kick off remote fetches whenever the guild changes. The workspace
    // machine handles selection bookkeeping; we just make sure the
    // guildStore has the channel list + roles to feed it.
    async function loadGuild(id: string) {
        try {
            await guildStore.ensureChannels(id);
            guildStore.ensureRoles(id).catch(() => { /* best-effort mention cache */ });
        } catch (err) {
            bailOnAuthError(err);
        }
    }

    watch(guildId, async (id) => {
        if (id) await loadGuild(id);
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
        selectChannel: workspace.select,
        requestScroll: workspace.requestScroll
    };
}
