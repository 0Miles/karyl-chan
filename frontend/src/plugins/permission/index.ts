import { defineAsyncComponent } from 'vue';
import type { BotPlugin } from '../types';

// Capability-grant management is a meta-feature — it manages other
// plugins' capability grants but isn't itself gated by a capability,
// so `capabilityPrefix` is omitted.
export const permissionPlugin: BotPlugin = {
    name: 'permission',
    labelKey: 'guilds.subtabs.features.capability',
    icon: 'material-symbols:vpn-key-outline-rounded',
    SettingsCard: defineAsyncComponent(() => import('./SettingsCard.vue')),
    OverviewCard: defineAsyncComponent(() => import('./OverviewCard.vue'))
};
