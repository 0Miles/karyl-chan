import type { RouteRecordRaw } from 'vue-router';
import { guildFeatures } from './registry';

/**
 * Router routes auto-generated for features that ship a
 * `FrontComponent`. Each such feature exposes itself at `/<name>` so
 * it can host a public-facing surface alongside the admin workbench.
 *
 * Features without a `FrontComponent` produce no routes — they only
 * surface inside the admin guilds workbench.
 */
export function guildFeatureRoutes(): RouteRecordRaw[] {
    const routes: RouteRecordRaw[] = [];
    for (const feature of guildFeatures) {
        if (!feature.FrontComponent) continue;
        routes.push({
            path: `/${feature.name}`,
            name: `guild-feature-${feature.name}`,
            component: feature.FrontComponent
        });
    }
    return routes;
}
