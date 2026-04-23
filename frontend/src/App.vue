<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { isAuthenticated } from './auth';
import { logout } from './api/client';

const router = useRouter();

async function signOut() {
    await logout();
    router.replace({ name: 'auth' });
}
</script>

<template>
    <div class="app-shell">
        <header class="app-header">
            <div class="brand">Karyl Chan</div>
            <nav>
                <template v-if="isAuthenticated">
                    <RouterLink to="/">Dashboard</RouterLink>
                    <button type="button" class="link-button" @click="signOut">Sign out</button>
                </template>
            </nav>
        </header>
        <main class="app-main">
            <RouterView />
        </main>
    </div>
</template>

<style scoped>
.app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}
.app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    background: #1f2937;
    color: #f9fafb;
}
.brand {
    font-weight: 600;
    letter-spacing: 0.05em;
}
.app-header nav {
    display: flex;
    gap: 1rem;
}
.app-header nav a {
    color: #cbd5f5;
    text-decoration: none;
}
.app-header nav a.router-link-active {
    color: #fff;
    font-weight: 500;
}
.link-button {
    background: none;
    border: none;
    color: #cbd5f5;
    cursor: pointer;
    font: inherit;
    padding: 0;
}
.link-button:hover {
    color: #fff;
}
.app-main {
    flex: 1;
    padding: 1.5rem;
    background: #f9fafb;
}
</style>
