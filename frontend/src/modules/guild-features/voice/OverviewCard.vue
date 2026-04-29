<script setup lang="ts">
import type { GuildDetail } from "../../../api/guilds";
import OverviewTile from "../_shared/OverviewTile.vue";

const props = defineProps<{ detail: GuildDetail }>();
</script>

<template>
    <OverviewTile
        icon="material-symbols:volume-up-outline-rounded"
        label="語音播放"
        :count="0"
        :guild-id="props.detail.guild.id"
        sub="voice"
    />
</template>
