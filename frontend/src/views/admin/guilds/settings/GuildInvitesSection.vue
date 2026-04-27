<script setup lang="ts">
import { Icon } from '@iconify/vue';
import type { GuildInvite } from '../../../../api/guilds';

defineProps<{
    invites: GuildInvite[];
    creating: boolean;
    createdUrl: string | null;
    error: string | null;
}>();

const emit = defineEmits<{
    (e: 'create'): void;
    (e: 'revoke', invite: GuildInvite): void;
    (e: 'copy', url: string): void;
}>();
</script>

<template>
    <section class="card">
        <header class="head">
            <h3>
                {{ $t('guilds.invites.title') }}
                <span class="count-pill">{{ invites.length }}</span>
            </h3>
            <button type="button" class="primary small" :disabled="creating" @click="emit('create')">
                <Icon icon="material-symbols:add-link-rounded" width="14" height="14" />
                {{ creating ? $t('common.loading') : $t('guilds.invites.create') }}
            </button>
        </header>
        <p v-if="createdUrl" class="invite-fresh">
            {{ $t('guilds.invites.created') }}
            <code>{{ createdUrl }}</code>
            <button type="button" class="link" @click="emit('copy', createdUrl)">{{ $t('messages.copyLink') }}</button>
        </p>
        <p v-if="error" class="error">{{ error }}</p>
        <ul v-if="invites.length" class="invite-list">
            <li v-for="inv in invites" :key="inv.code" class="invite-row">
                <code class="invite-code">{{ inv.code }}</code>
                <span class="muted invite-meta">
                    {{ inv.channelName ? `#${inv.channelName}` : '—' }}
                    · {{ $t('guilds.invites.uses', { uses: inv.uses, max: inv.maxUses || '∞' }) }}
                    <template v-if="inv.expiresAt">
                        · {{ $t('guilds.invites.expires', { date: new Date(inv.expiresAt).toLocaleString() }) }}
                    </template>
                    <template v-else>· {{ $t('guilds.invites.neverExpires') }}</template>
                </span>
                <button type="button" class="link" @click="emit('copy', inv.url)">{{ $t('messages.copyLink') }}</button>
                <button type="button" class="link danger" @click="emit('revoke', inv)">{{ $t('inviteMgmt.revoke') }}</button>
            </li>
        </ul>
        <p v-else-if="!error" class="muted">{{ $t('common.none') }}</p>
    </section>
</template>

<style scoped>
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}
.head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: space-between;
}
.head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.45rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: var(--radius-pill);
    padding: 0 0.5rem;
    font-size: 0.78rem;
}
.primary {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-base);
    padding: 0.3rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
}
.primary:disabled { opacity: 0.55; cursor: default; }
.invite-fresh {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.invite-fresh code { background: transparent; padding: 0; }
.invite-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}
.invite-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
}
.invite-code { font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 600; }
.invite-meta { font-size: 0.78rem; }
.link {
    background: none;
    border: none;
    color: var(--link-mask);
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    padding: 0;
}
.link.danger { color: var(--danger); }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.error { color: var(--danger); font-size: 0.85rem; }
</style>
