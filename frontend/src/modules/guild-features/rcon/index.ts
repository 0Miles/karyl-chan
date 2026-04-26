import { defineAsyncComponent } from 'vue';
import type { GuildFeature } from '../types';

export const rconFeature: GuildFeature = {
    name: 'rcon',
    capabilityPrefix: 'rcon',
    labelKey: 'guilds.subtabs.features.rcon',
    icon: 'material-symbols:terminal-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
