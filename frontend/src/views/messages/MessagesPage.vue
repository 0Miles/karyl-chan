<script setup lang="ts">
import { onMounted, ref } from 'vue';
import DmWorkspace from './DmWorkspace.vue';
import GuildWorkspace from './GuildWorkspace.vue';
import { listGuilds, type GuildSummary } from '../../api/guilds';
import { useBreakpoint } from '../../composables/use-breakpoint';
import { useFlushMain, useOverlayExtras } from '../../composables/use-app-shell';

const mode = ref<string>('dm');
const guilds = ref<GuildSummary[]>([]);
const { isMobile } = useBreakpoint();

useFlushMain();
useOverlayExtras();

onMounted(async () => {
    try {
        guilds.value = await listGuilds();
    } catch {
        // guilds dropdown stays empty; DM mode still works
    }
});
</script>

<template>
    <section class="messages-page" :class="{ 'messages-page--mobile': isMobile }">
        <DmWorkspace
            v-if="mode === 'dm'"
            :guilds="guilds"
            :mode="mode"
            :is-mobile="isMobile"
            @mode-change="mode = $event"
        />
        <GuildWorkspace
            v-else
            :guilds="guilds"
            :mode="mode"
            :guild-id="mode"
            :is-mobile="isMobile"
            @mode-change="mode = $event"
        />
    </section>
</template>

<style scoped>
.messages-page {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    overflow: hidden;
}
.messages-page--mobile {
    grid-template-columns: 1fr;
    border: none;
    border-radius: 0;
}
</style>
