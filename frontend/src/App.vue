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
                    <RouterLink to="/dm">DMs</RouterLink>
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
    background: var(--bg-header);
    color: var(--text-on-header);
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
    color: var(--text-on-header-muted);
    text-decoration: none;
}
.app-header nav a.router-link-active {
    color: var(--text-on-header);
    font-weight: 500;
}
.link-button {
    background: none;
    border: none;
    color: var(--text-on-header-muted);
    cursor: pointer;
    font: inherit;
    padding: 0;
}
.link-button:hover {
    color: var(--text-on-header);
}
.app-main {
    flex: 1;
    padding: 1.5rem;
    background: var(--bg-page);
}
</style>
