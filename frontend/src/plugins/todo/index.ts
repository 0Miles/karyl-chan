import { defineAsyncComponent } from 'vue';
import type { BotPlugin } from '../types';

export const todoPlugin: BotPlugin = {
    name: 'todo',
    capabilityPrefix: 'todo',
    labelKey: 'guilds.subtabs.features.todo',
    icon: 'material-symbols:checklist-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
