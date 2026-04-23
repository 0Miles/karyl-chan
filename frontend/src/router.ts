import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isAuthenticated } from './auth';

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
        component: () => import('./views/dashboard/DashboardPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/messages',
        name: 'messages',
        component: () => import('./views/messages/MessagesPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/guilds',
        name: 'guilds',
        component: () => import('./views/guilds/GuildsPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/users',
        name: 'admin-users',
        component: () => import('./views/admin/AdminAccessPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/admin/auth',
        name: 'auth',
        component: () => import('./views/auth/AuthPage.vue')
    }
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
