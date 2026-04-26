import type { RouteRecordRaw } from 'vue-router';
import { plugins } from './registry';

/**
 * Router routes auto-generated for plugins that ship a `FrontComponent`.
 * Each such plugin exposes itself at `/<plugin-name>` so it can host a
 * public-facing surface alongside the admin workbench.
 *
 * Plugins without a `FrontComponent` produce no routes — they only
 * surface inside the admin guilds workbench.
 */
export function pluginRoutes(): RouteRecordRaw[] {
    const routes: RouteRecordRaw[] = [];
    for (const plugin of plugins) {
        if (!plugin.FrontComponent) continue;
        routes.push({
            path: `/${plugin.name}`,
            name: `plugin-${plugin.name}`,
            component: plugin.FrontComponent
        });
    }
    return routes;
}
