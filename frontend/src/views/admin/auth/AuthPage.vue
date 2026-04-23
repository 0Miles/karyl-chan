<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, exchangeOneTimeToken } from '../../../api/client';
import { setTokens } from '../../../auth';

const route = useRoute();
const router = useRouter();

const state = ref<'idle' | 'exchanging' | 'success' | 'error' | 'no-token'>('idle');
const errorMessage = ref<string | null>(null);

onMounted(async () => {
    const tokenParam = route.query.token;
    const token = typeof tokenParam === 'string' ? tokenParam.trim() : '';
    if (!token) {
        state.value = 'no-token';
        return;
    }
    state.value = 'exchanging';
    try {
        const tokens = await exchangeOneTimeToken(token);
        setTokens(tokens);
        state.value = 'success';
        router.replace({ name: 'dashboard' });
    } catch (err) {
        state.value = 'error';
        errorMessage.value = err instanceof ApiError
            ? err.message
            : err instanceof Error ? err.message : 'Login failed';
    }
});
</script>

<template>
    <section class="auth">
        <h1>{{ $t('auth.title') }}</h1>
        <p v-if="state === 'exchanging'" class="muted">{{ $t('auth.exchanging') }}</p>
        <p v-else-if="state === 'success'" class="muted">{{ $t('auth.success') }}</p>
        <div v-else-if="state === 'no-token'">
            <p>{{ $t('auth.noTokenLead') }}</p>
            <pre><code>login</code></pre>
            <p class="muted">{{ $t('auth.noTokenHint') }}</p>
        </div>
        <div v-else-if="state === 'error'">
            <p class="error">{{ errorMessage }}</p>
            <i18n-t keypath="auth.errorHint" tag="p" class="muted">
                <template #login><code>login</code></template>
            </i18n-t>
        </div>
    </section>
</template>

<style scoped>
.auth {
    max-width: 420px;
    margin: 4rem auto;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.5rem 1.75rem;
}
.auth h1 {
    margin: 0 0 1rem;
    font-size: 1.2rem;
}
.muted {
    color: var(--text-muted);
    font-size: 0.9rem;
}
.error {
    color: var(--danger);
    margin: 0 0 0.5rem;
}
pre {
    background: var(--code-bg);
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    font-size: 0.95rem;
    margin: 0.5rem 0;
}
code {
    background: var(--code-bg);
    padding: 0 0.3rem;
    border-radius: 3px;
}
</style>
