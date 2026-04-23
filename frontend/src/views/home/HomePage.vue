<script setup lang="ts">
import { EmptyLayout } from '../../layouts';
</script>

<template>
    <EmptyLayout max-width="520px">
        <section class="home">
            <h1>{{ $t('home.title') }}</h1>
            <p class="muted">{{ $t('home.lead') }}</p>
        </section>
    </EmptyLayout>
</template>

<style scoped>
.home {
    margin: 4rem 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.5rem 1.75rem;
}
.home h1 { margin: 0 0 0.75rem; font-size: 1.25rem; }
.muted { color: var(--text-muted); font-size: 0.95rem; margin: 0; }
</style>
