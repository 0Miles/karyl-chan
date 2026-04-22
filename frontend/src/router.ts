import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
    {
        path: '/',
        name: 'dashboard',
        component: () => import('./views/Dashboard.vue')
    }
];

export const router = createRouter({
    history: createWebHistory(),
    routes
});
