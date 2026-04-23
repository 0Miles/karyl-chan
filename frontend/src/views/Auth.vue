<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, exchangeOneTimeToken } from '../api/client';
import { setTokens } from '../auth';

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
        router.replace('/');
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
        <h1>Sign in</h1>
        <p v-if="state === 'exchanging'" class="muted">Exchanging login token…</p>
        <p v-else-if="state === 'success'" class="muted">Signed in. Redirecting…</p>
        <div v-else-if="state === 'no-token'">
            <p>To sign in, send a direct message to the bot:</p>
            <pre><code>login</code></pre>
            <p class="muted">The bot will reply with a single-use login link. Open the link in this browser.</p>
        </div>
        <div v-else-if="state === 'error'">
            <p class="error">{{ errorMessage }}</p>
            <p class="muted">Request a new link by sending <code>login</code> to the bot.</p>
        </div>
    </section>
</template>

<style scoped>
.auth {
    max-width: 420px;
    margin: 4rem auto;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 1.5rem 1.75rem;
}
.auth h1 {
    margin: 0 0 1rem;
    font-size: 1.2rem;
}
.muted {
    color: #6b7280;
    font-size: 0.9rem;
}
.error {
    color: #b91c1c;
    margin: 0 0 0.5rem;
}
pre {
    background: #f3f4f6;
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    font-size: 0.95rem;
    margin: 0.5rem 0;
}
code {
    background: #f3f4f6;
    padding: 0 0.3rem;
    border-radius: 3px;
}
</style>
