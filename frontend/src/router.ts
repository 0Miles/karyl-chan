import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isAuthenticated } from './auth';
import { pluginRoutes } from './plugins/routes';

// Route names stay stable so programmatic `router.replace({ name: '...' })`
// calls elsewhere keep working — only paths moved under /admin. The root
// path is reserved for future public (no-login) surfaces.
const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'home',
        component: () => import('./views/home/HomePage.vue'),
        // Public, standalone page: the app shell (nav / mobile drawer / FAB)
        // is suppressed for routes with `publicPage: true`. Future no-login
        // surfaces should live on their own paths with the same meta flag.
        meta: { publicPage: true }
    },
    {
        path: '/admin',
        name: 'dashboard',
        component: () => import('./views/admin/dashboard/DashboardPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/messages',
        name: 'messages',
        component: () => import('./views/admin/messages/MessagesPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/guilds',
        name: 'guilds',
        component: () => import('./views/admin/guilds/GuildsPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/users',
        name: 'admin-users',
        component: () => import('./views/admin/users/UsersPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/profile',
        name: 'profile',
        component: () => import('./views/admin/profile/ProfilePage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/auth',
        name: 'auth',
        component: () => import('./views/admin/auth/AuthPage.vue')
    },
    // Plugin-supplied routes (only plugins with a `FrontComponent` add
    // entries here). Each lives at `/<plugin-name>`.
    ...pluginRoutes()
];

export const router = createRouter({
    history: createWebHistory(),
    routes
});

router.beforeEach((to) => {
    if (to.meta.requiresAuth && !isAuthenticated.value) {
        return { name: 'auth' };
    }
});
