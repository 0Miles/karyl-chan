<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
    <section class="home">
        <h1>{{ $t('home.title') }}</h1>
        <p class="muted">{{ $t('home.lead') }}</p>
        <p>
            <RouterLink to="/admin" class="admin-link">
                {{ $t('home.adminLink') }} →
            </RouterLink>
        </p>
    </section>
</template>

<style scoped>
.home {
    max-width: 520px;
    margin: 4rem auto;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.5rem 1.75rem;
}
.home h1 { margin: 0 0 0.75rem; font-size: 1.25rem; }
.muted { color: var(--text-muted); font-size: 0.95rem; margin: 0 0 0.75rem; }
.admin-link {
    color: var(--accent-text);
    text-decoration: none;
    font-weight: 500;
}
.admin-link:hover { text-decoration: underline; }
</style>
