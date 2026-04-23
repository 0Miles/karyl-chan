import { onMounted, ref } from 'vue';
import { api as botApi } from '../../api/client';

/**
 * Bot's own user identity, fetched once per mount. Shared between DM and
 * guild workspaces so "messaging as" labels and edit/delete permission
 * checks resolve identically.
 */
export function useBotIdentity() {
    const botUserId = ref<string | null>(null);
    const botUserTag = ref<string | null>(null);

    function displayName(): string | null {
        const tag = botUserTag.value;
        if (!tag) return null;
        return tag.includes('#') ? tag.split('#')[0] : tag;
    }

    onMounted(() => {
        botApi.getBotStatus().then(status => {
            botUserId.value = status.userId;
            botUserTag.value = status.userTag;
        }).catch(() => { /* best-effort; auth failures surface via real API calls */ });
    });

    return { botUserId, botUserTag, displayName };
}
