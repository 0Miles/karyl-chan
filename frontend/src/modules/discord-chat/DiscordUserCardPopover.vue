<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
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

// The store's `target` is a Pinia singleton shared across workspaces.
// When the user switches DM ↔ guild, this popover instance unmounts
// together with the workspace, but a stale `target` would carry over
// to the new workspace's popover — the new AppPopover would mount with
// `isOpen` already truthy and its internal visibility watchers (which
// only fire on *changes*) would miss the initial state, leaving it
// permanently in the "already open, nothing to show" limbo that made
// subsequent clicks look unresponsive. Clearing here severs the hand-off.
onBeforeUnmount(() => store.close());
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
