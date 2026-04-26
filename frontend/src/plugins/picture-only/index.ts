import { defineAsyncComponent } from 'vue';
import type { BotPlugin } from '../types';

export const pictureOnlyPlugin: BotPlugin = {
    name: 'picture-only',
    capabilityPrefix: 'picture-only',
    labelKey: 'guilds.subtabs.features.picture',
    icon: 'material-symbols:image-outline-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
