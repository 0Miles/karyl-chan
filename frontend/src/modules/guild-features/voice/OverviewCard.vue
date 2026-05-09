<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { GuildDetail } from "../../../api/guilds";
import OverviewTile from "../_shared/OverviewTile.vue";

const props = defineProps<{ detail: GuildDetail }>();
const { t } = useI18n();
</script>

<template>
    <OverviewTile
        icon="material-symbols:volume-up-outline-rounded"
        :label="t('guilds.subtabs.features.voice')"
        :count="0"
        :guild-id="props.detail.guild.id"
        sub="voice"
    />
</template>
