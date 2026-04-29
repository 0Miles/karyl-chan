import { defineAsyncComponent } from "vue";
import type { GuildFeature } from "../types";

export const voiceFeature: GuildFeature = {
  name: "voice",
  capabilityPrefix: "voice",
  labelKey: "guilds.subtabs.features.voice",
  icon: "material-symbols:volume-up-outline-rounded",
  SettingsCard: defineAsyncComponent(() => import("./SettingsCard.vue")),
  OverviewCard: defineAsyncComponent(() => import("./OverviewCard.vue")),
};
