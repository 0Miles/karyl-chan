<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
    <div class="app-shell">
        <header class="app-header">
            <div class="brand">Karyl Chan</div>
            <nav>
                <RouterLink to="/">Dashboard</RouterLink>
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
.app-main {
    flex: 1;
    padding: 1.5rem;
    background: #f9fafb;
}
</style>
