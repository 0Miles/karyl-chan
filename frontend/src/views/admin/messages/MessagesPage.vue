<script setup lang="ts">
import { onMounted, ref } from 'vue';
import DmWorkspace from './DmWorkspace.vue';
import GuildWorkspace from './GuildWorkspace.vue';
import { listGuilds, type GuildSummary } from '../../../api/guilds';
import { useBreakpoint } from '../../../composables/use-breakpoint';

const mode = ref<string>('dm');
const guilds = ref<GuildSummary[]>([]);
const { isMobile } = useBreakpoint();

onMounted(async () => {
    try {
        guilds.value = await listGuilds();
    } catch {
        // guilds dropdown stays empty; DM mode still works
    }
});
</script>

<template>
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
</template>
