import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../../../api/client';

export const useBotStore = defineStore('discord-bot', () => {
    const userId = ref<string | null>(null);
    const userTag = ref<string | null>(null);
    const username = ref<string | null>(null);
    const globalName = ref<string | null>(null);
    const avatarUrl = ref<string | null>(null);
    let pending = false;

    async function init(): Promise<void> {
        if (userId.value !== null || pending) return;
        pending = true;
        try {
            const status = await api.getBotStatus();
            userId.value = status.userId;
            userTag.value = status.userTag;
            username.value = status.username;
            globalName.value = status.globalName;
            avatarUrl.value = status.avatarUrl;
        } catch {
            // best-effort; auth failures surface via actual API calls
        } finally {
            pending = false;
        }
    }

    function displayName(): string | null {
        if (globalName.value) return globalName.value;
        if (username.value) return username.value;
        const tag = userTag.value;
        if (!tag) return null;
        return tag.includes('#') ? tag.split('#')[0] : tag;
    }

    return { userId, userTag, username, globalName, avatarUrl, init, displayName };
});
