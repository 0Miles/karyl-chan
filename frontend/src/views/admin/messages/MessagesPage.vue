<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DmWorkspace from './DmWorkspace.vue';
import GuildWorkspace from './GuildWorkspace.vue';
import { listGuilds, type GuildSummary } from '../../../api/guilds';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import { loadLastSurface } from '../../../modules/discord-chat/last-channel';

const route = useRoute();
const router = useRouter();

// The active surface is serialised in `?guild=`: present → guild mode
// with that id, absent → DMs. Channel id lives alongside in `?channel=`,
// persisted by each workspace. Internally we still route through a
// single `mode` string (`'dm'` or a guild id) so the existing sidebar
// emit / v-if branch stays unchanged.
function queryMode(): string {
    const v = route.query.guild;
    return typeof v === 'string' && v.length > 0 ? v : 'dm';
}

// Initial mode: explicit URL first, then the localStorage-saved
// "last surface" (which guild or DM the user was last on), finally
// plain DM as the default. The URL is rewritten in onMounted below
// so a refresh lands in the same place.
function initialMode(): string {
    if (typeof route.query.guild === 'string' && route.query.guild.length > 0) {
        return route.query.guild;
    }
    if (typeof route.query.channel === 'string' && route.query.channel.length > 0) {
        // Explicit DM channel deep-link — respect it, don't restore.
        return 'dm';
    }
    return loadLastSurface()?.mode ?? 'dm';
}

const mode = ref<string>(initialMode());
const guilds = ref<GuildSummary[]>([]);
const { isMobile } = useBreakpoint();

async function handleModeChange(next: string) {
    if (mode.value === next) return;
    // Replace the URL first, then flip the mode. If we flipped mode
    // synchronously, the new workspace would mount while `route.query`
    // still carried the previous surface's `channel=` — its setup would
    // read the stale id before `router.replace` settled and try to apply
    // it. Awaiting the navigation guarantees a clean query by the time
    // the v-if swap happens.
    await router.replace({ query: next === 'dm' ? {} : { guild: next } });
    mode.value = next;
}

watch(() => route.query.guild, () => {
    const next = queryMode();
    if (next !== mode.value) mode.value = next;
});

onMounted(async () => {
    // When the URL came in empty but we restored a previous surface,
    // push the restoration into the URL so the next refresh keeps the
    // user here without re-reading localStorage (and sharable URLs
    // reflect what's on screen).
    if (!route.query.guild && !route.query.channel) {
        const last = loadLastSurface();
        if (last) {
            const query = last.mode === 'dm'
                ? { channel: last.channelId }
                : { guild: last.mode, channel: last.channelId };
            router.replace({ query });
        }
    }
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
        @mode-change="handleModeChange"
    />
    <GuildWorkspace
        v-else
        :guilds="guilds"
        :mode="mode"
        :guild-id="mode"
        :is-mobile="isMobile"
        @mode-change="handleModeChange"
    />
</template>
