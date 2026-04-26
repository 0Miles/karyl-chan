import { defineAsyncComponent } from 'vue';
import type { GuildFeature } from '../types';

export const todoFeature: GuildFeature = {
    name: 'todo',
    capabilityPrefix: 'todo',
    labelKey: 'guilds.subtabs.features.todo',
    icon: 'material-symbols:checklist-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
