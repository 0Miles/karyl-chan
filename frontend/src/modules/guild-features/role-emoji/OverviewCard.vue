<script setup lang="ts">
import { computed } from 'vue';
import type { GuildDetail } from '../../../api/guilds';
import OverviewTile from '../_shared/OverviewTile.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ detail: GuildDetail }>();
const { t } = useI18n();

// Reaction roles is a merged feature — combine the two underlying
// counts (emoji↔role mappings + watched messages) into one tile.
const total = computed(() =>
    props.detail.roleEmojis.length + props.detail.roleReceiveMessages.length
);
</script>

<template>
    <OverviewTile
        icon="material-symbols:add-reaction-outline-rounded"
        :label="t('guilds.subtabs.features.reactionRoles')"
        :count="total"
        :guild-id="props.detail.guild.id"
        sub="role-emoji"
    />
</template>
