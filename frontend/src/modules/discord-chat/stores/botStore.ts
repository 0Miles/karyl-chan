import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../../../api/client';

export const useBotStore = defineStore('discord-bot', () => {
    const userId = ref<string | null>(null);
    const userTag = ref<string | null>(null);
    let pending = false;

    async function init(): Promise<void> {
        if (userId.value !== null || pending) return;
        pending = true;
        try {
            const status = await api.getBotStatus();
            userId.value = status.userId;
            userTag.value = status.userTag;
        } catch {
            // best-effort; auth failures surface via actual API calls
        } finally {
            pending = false;
        }
    }

    function displayName(): string | null {
        const tag = userTag.value;
        if (!tag) return null;
        return tag.includes('#') ? tag.split('#')[0] : tag;
    }

    return { userId, userTag, init, displayName };
});
