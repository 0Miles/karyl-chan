<script setup lang="ts">
import type { GuildDetail } from '../../../api/guilds';
import OverviewTile from '../_shared/OverviewTile.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ detail: GuildDetail }>();
const { t } = useI18n();
</script>

<template>
    <OverviewTile
        icon="material-symbols:vpn-key-outline-rounded"
        :label="t('guilds.capabilityGrants')"
        :count="props.detail.capabilityGrants.length"
        :guild-id="props.detail.guild.id"
        sub="permission"
    />
</template>
