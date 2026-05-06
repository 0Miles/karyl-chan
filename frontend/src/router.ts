import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { isAuthenticated } from "./auth";
import { guildFeatureRoutes } from "./modules/guild-features/routes";
import { useCurrentUserStore } from "./stores/currentUserStore";
import {
  accessibleBehaviorTargetIds,
  accessibleGuildIds,
  hasAdminCapability,
  type GlobalCapability,
} from "./libs/admin-capabilities";

/**
 * Optional capability gate for a route. Pass either a literal global
 * capability key (`admin`, `dm.message`, `system.read`), `'guild-any'`
 * for routes that just require some guild access, or `'behavior-any'`
 * for routes that accept any per-target behavior token. The router's
 * beforeEach checks `meta.requiresCapability` against the current
 * user's grants and bounces unauthorized callers back to the
 * dashboard.
 */
type RouteCapability = GlobalCapability | "guild-any" | "behavior-any";

// Route names stay stable so programmatic `router.replace({ name: '...' })`
// calls elsewhere keep working — only paths moved under /admin. The root
// path is reserved for future public (no-login) surfaces.
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("./views/home/HomePage.vue"),
    // Public, standalone page: the app shell (nav / mobile drawer / FAB)
    // is suppressed for routes with `publicPage: true`. Future no-login
    // surfaces should live on their own paths with the same meta flag.
    meta: { publicPage: true },
  },
  {
    path: "/admin",
    name: "dashboard",
    component: () => import("./views/admin/dashboard/DashboardPage.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/admin/messages",
    name: "messages",
    component: () => import("./views/admin/messages/MessagesPage.vue"),
    // Messages page hosts both DM and guild surfaces; satisfied by
    // dm.message OR any guild scope. The page itself filters lists
    // by accessible guilds, but gate the route too so users with
    // zero capabilities never even land here.
    meta: {
      requiresAuth: true,
      requiresCapability: [
        "dm.message",
        "guild-any",
      ] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/guilds",
    name: "guilds",
    component: () => import("./views/admin/guilds/GuildsPage.vue"),
    meta: {
      requiresAuth: true,
      requiresCapability: ["guild-any"] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/users",
    name: "admin-users",
    component: () => import("./views/admin/users/UsersPage.vue"),
    meta: {
      requiresAuth: true,
      requiresCapability: ["admin"] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/behaviors",
    name: "behaviors",
    component: () => import("./views/admin/behaviors/BehaviorsPage.vue"),
    // Admin / behavior.manage / any per-target token unlocks the
    // page; the page itself filters the sidebar to the targets the
    // current user is allowed to see.
    meta: {
      requiresAuth: true,
      requiresCapability: [
        "admin",
        "behavior.manage",
        "behavior-any",
      ] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/plugins",
    name: "plugins",
    component: () => import("./views/admin/plugins/PluginsPage.vue"),
    meta: {
      requiresAuth: true,
      requiresCapability: ["admin"] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/plugins/:pluginKey",
    name: "plugin-detail",
    component: () => import("./views/admin/plugins/PluginDetailPage.vue"),
    meta: {
      requiresAuth: true,
      requiresCapability: ["admin"] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/system-settings",
    name: "system-settings",
    component: () =>
      import(
        "./views/admin/system-settings/SystemSettingsPage.vue"
      ),
    meta: {
      requiresAuth: true,
      requiresCapability: ["admin"] satisfies RouteCapability[],
    },
  },
  {
    path: "/admin/profile",
    name: "profile",
    component: () => import("./views/admin/profile/ProfilePage.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/admin/auth",
    name: "auth",
    component: () => import("./views/admin/auth/AuthPage.vue"),
  },
  // Routes auto-generated from the guild-feature registry — only
  // entries that ship a `FrontComponent` produce a route. Each
  // lives at `/<feature-name>`.
  ...guildFeatureRoutes(),
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (to.meta.requiresAuth && !isAuthenticated.value) {
    return { name: "auth" };
  }

  const required = to.meta.requiresCapability as RouteCapability[] | undefined;
  if (!required || required.length === 0) return;

  // Lazily fetch the current user's capability set. The store is
  // refreshed on auth transitions in App.vue, but a cold deep-link
  // (browser tab opened straight at /admin/users) reaches the guard
  // before App's onMounted runs — refresh here so the capability
  // check has data to work with.
  const currentUser = useCurrentUserStore();
  if (!currentUser.user && isAuthenticated.value) {
    await currentUser.refresh();
  }
  const caps = currentUser.user?.capabilities ?? [];

  const satisfied = required.some((req) => {
    if (req === "guild-any") {
      const access = accessibleGuildIds(caps);
      return access === "all" || access.size > 0;
    }
    if (req === "behavior-any") {
      const access = accessibleBehaviorTargetIds(caps);
      return access === "all" || access.size > 0;
    }
    return hasAdminCapability(caps, req);
  });
  if (satisfied) return;

  // Bounce unauthorized navigations back to the dashboard rather
  // than landing on a page that would render a 403 — the dashboard
  // is reachable by anyone with a valid session.
  return { name: "dashboard" };
});
