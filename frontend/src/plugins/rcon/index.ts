import { defineAsyncComponent } from 'vue';
import type { BotPlugin } from '../types';

export const rconPlugin: BotPlugin = {
    name: 'rcon',
    capabilityPrefix: 'rcon',
    labelKey: 'guilds.subtabs.features.rcon',
    icon: 'material-symbols:terminal-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
