import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isAuthenticated } from './auth';

const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'dashboard',
        component: () => import('./views/dashboard/DashboardPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/dm',
        name: 'dm',
        component: () => import('./views/dm/DmPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/guilds',
        name: 'guilds',
        component: () => import('./views/guilds/GuildsPage.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/auth',
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
