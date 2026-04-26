import { defineAsyncComponent } from 'vue';
import type { GuildFeature } from '../types';

export const pictureOnlyFeature: GuildFeature = {
    name: 'picture-only',
    capabilityPrefix: 'picture-only',
    labelKey: 'guilds.subtabs.features.picture',
    icon: 'material-symbols:image-outline-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
