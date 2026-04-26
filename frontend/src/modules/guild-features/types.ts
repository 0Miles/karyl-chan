import type { Component } from 'vue';

/**
 * Guild-feature manifest. Each entry pairs a Discord slash-group with
 * the admin-side UI surfaces for managing it: a settings card inside
 * the guild workbench and a status mini-card on the guild overview.
 * Adding a new feature to `registry.ts` automatically wires it into:
 *   - the guilds page features sub-tab
 *   - the overview's feature-usage grid
 *   - the router (when `FrontComponent` is set)
 *
 * Feature names are kebab-case and match the bot's slash-group name so
 * `<name>.<command>` capabilities and `/<name>` routes line up with
 * what the bot actually handles.
 */
export interface GuildFeature {
    /** URL/sub-tab identifier; mirrors the slash-group name. */
    name: string;
    /**
     * Capability prefix this feature's commands check against (e.g.
     * `todo` covers `todo.manage`). Omit for meta-features (e.g.
     * capability grant management) that aren't gated by their own
     * capability.
     */
    capabilityPrefix?: string;
    /** i18n key for the feature's display name. */
    labelKey: string;
    /** Iconify icon name shown in the overview tile and sub-tab. */
    icon: string;
    /** Settings card rendered inside the features sub-tab. */
    SettingsCard: Component;
    /** Mini-card rendered inside the overview's feature-usage grid. */
    OverviewCard: Component;
    /**
     * Optional public-facing component. When set, the router exposes
     * the feature at `/<name>` so it can have its own surface outside
     * the admin workbench.
     */
    FrontComponent?: Component;
}
