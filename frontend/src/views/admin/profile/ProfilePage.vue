<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { DashboardLayout } from '../../../layouts';
import { useCurrentUserStore } from '../../../stores/currentUserStore';

const { t } = useI18n();
const store = useCurrentUserStore();

onMounted(() => {
    // Guard: if the cached user is missing (hard refresh, expired cache,
    // etc.) fetch on demand. Otherwise keep what App.vue already pulled
    // so the page renders immediately.
    if (!store.user) store.refresh();
});

const user = computed(() => store.user);

const displayName = computed(() =>
    user.value?.profile?.globalName
    ?? user.value?.profile?.username
    ?? t('admin.users.unknownProfile')
);

const initial = computed(() => {
    const name = user.value?.profile?.globalName ?? user.value?.profile?.username ?? user.value?.userId ?? '';
    return name.trim().charAt(0).toUpperCase() || '?';
});

const roleLabel = computed(() => {
    if (!user.value) return '';
    if (user.value.isOwner) return t('admin.users.ownerBadge');
    return user.value.role ?? '';
});
</script>

<template>
    <DashboardLayout :title="$t('profile.title')">
        <p v-if="store.loading && !user" class="muted">{{ $t('common.loading') }}</p>
        <article v-else-if="user" class="profile-card">
            <img v-if="user.profile?.avatarUrl" :src="user.profile.avatarUrl" alt="" class="avatar" />
            <div v-else class="avatar avatar-fallback">{{ initial }}</div>
            <div class="meta">
                <h2 class="name">
                    {{ displayName }}
                    <span v-if="user.isOwner" class="owner-pill">{{ $t('admin.users.ownerBadge') }}</span>
                </h2>
                <dl class="facts">
                    <dt>{{ $t('profile.userId') }}</dt>
                    <dd><code>{{ user.userId }}</code></dd>
                    <template v-if="user.profile?.username && user.profile.username !== displayName">
                        <dt>{{ $t('profile.username') }}</dt>
                        <dd>{{ user.profile.username }}</dd>
                    </template>
                    <dt>{{ $t('profile.role') }}</dt>
                    <dd>{{ roleLabel || '—' }}</dd>
                    <dt>{{ $t('profile.capabilities') }}</dt>
                    <dd class="caps">
                        <span v-if="user.capabilities.length === 0" class="muted">—</span>
                        <span v-for="cap in user.capabilities" :key="cap" class="cap-chip">
                            <code>{{ cap }}</code>
                        </span>
                    </dd>
                    <template v-if="user.note">
                        <dt>{{ $t('profile.note') }}</dt>
                        <dd>{{ user.note }}</dd>
                    </template>
                </dl>
            </div>
        </article>
        <p v-else class="muted">{{ $t('profile.unavailable') }}</p>

        <p v-if="user" class="login-hint muted">
            <Icon icon="material-symbols:info-outline-rounded" width="16" height="16" />
            {{ $t('profile.hint') }}
        </p>
    </DashboardLayout>
</template>

<style scoped>
.profile-card {
    display: flex;
    gap: 1.25rem;
    padding: 1.25rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    align-items: flex-start;
}
@media (max-width: 520px) {
    .profile-card { flex-direction: column; align-items: stretch; }
}
.avatar {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-surface-2);
}
.avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 2rem;
}
.meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.name {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.owner-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.1rem 0.6rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
}
.facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1rem;
    margin: 0;
}
.facts dt {
    color: var(--text-muted);
    font-size: 0.8rem;
    align-self: center;
}
.facts dd { margin: 0; font-size: 0.92rem; }
.caps {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}
.cap-chip {
    display: inline-flex;
    padding: 0.15rem 0.5rem;
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 999px;
    font-size: 0.78rem;
}
.cap-chip code { background: transparent; padding: 0; }
.login-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
}
.muted { color: var(--text-muted); }
</style>
