import { defineAsyncComponent } from 'vue';
import type { GuildFeature } from '../types';

export const roleEmojiFeature: GuildFeature = {
    name: 'role-emoji',
    capabilityPrefix: 'role-emoji',
    labelKey: 'guilds.subtabs.features.reactionRoles',
    icon: 'material-symbols:add-reaction-outline-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
