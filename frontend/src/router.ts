import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isAuthenticated } from './auth';

const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'dashboard',
        component: () => import('./views/Dashboard.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/dm',
        name: 'dm',
        component: () => import('./views/DmInbox.vue'),
        meta: { requiresAuth: true }
    },
    {
        path: '/auth',
        name: 'auth',
        component: () => import('./views/Auth.vue')
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
