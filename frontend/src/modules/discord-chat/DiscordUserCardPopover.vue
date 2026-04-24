<script setup lang="ts">
import { computed } from 'vue';
import AppPopover from '../../components/AppPopover.vue';
import DiscordUserCard from './DiscordUserCard.vue';
import { useUserProfileStore } from './stores/userProfileStore';

/**
 * Conversation-level host for the user profile card. Drives its visibility
 * entirely off useUserProfileStore.target, which message-avatar, username,
 * and user-mention click handlers populate via MessageContext.onUserClick.
 *
 * Renders at most one card at a time; the anchor element swaps as the
 * user clicks around, AppPopover re-positions against the new reference.
 */
const store = useUserProfileStore();

const open = computed<boolean>({
    get: () => store.target !== null,
    set: (v) => { if (!v) store.close(); }
});

const referenceEl = computed(() => store.target?.element ?? null);
const userId = computed(() => store.target?.userId ?? null);
const guildId = computed(() => store.target?.guildId ?? null);
</script>

<template>
    <AppPopover
        v-model:open="open"
        :reference-el="referenceEl"
        placement="right-start"
    >
        <!-- Lazy: only render the card (which fires the fetch) once it's
             actually open, not on every render of the parent. -->
        <DiscordUserCard
            v-if="open && userId"
            :user-id="userId"
            :guild-id="guildId"
            @close="store.close"
        />
    </AppPopover>
</template>
