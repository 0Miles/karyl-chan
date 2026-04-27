<script setup lang="ts">
import { Icon } from '@iconify/vue';
import type { GuildRoleSummary } from '../../../../api/guilds';

defineProps<{
    roles: GuildRoleSummary[];
}>();

const emit = defineEmits<{
    (e: 'create'): void;
    (e: 'edit', role: GuildRoleSummary): void;
    (e: 'delete', role: GuildRoleSummary): void;
}>();
</script>

<template>
    <section class="card">
        <header class="head">
            <h3>
                {{ $t('guilds.rolesTitle') }}
                <span class="count-pill">{{ roles.length }}</span>
            </h3>
            <button type="button" class="primary small" @click="emit('create')">
                <Icon icon="material-symbols:add-rounded" width="14" height="14" />
                {{ $t('roleMgmt.createButton') }}
            </button>
        </header>
        <p v-if="roles.length === 0" class="muted">{{ $t('common.none') }}</p>
        <ul v-else class="role-list">
            <li v-for="r in roles" :key="r.id" class="role-row">
                <span class="role-swatch" :style="{ background: r.color ?? 'var(--bg-surface-2)' }"></span>
                <span class="role-name" :style="r.color ? { color: r.color } : undefined">@{{ r.name }}</span>
                <span v-if="r.memberCount !== undefined" class="muted role-count">
                    {{ $t('guilds.roleMembers', { count: r.memberCount }) }}
                </span>
                <span v-if="r.managed" class="role-flag">{{ $t('guilds.roleManaged') }}</span>
                <template v-else>
                    <button type="button" class="link" @click="emit('edit', r)">
                        {{ $t('roleMgmt.edit') }}
                    </button>
                    <button type="button" class="link danger" @click="emit('delete', r)">
                        {{ $t('roleMgmt.delete') }}
                    </button>
                </template>
            </li>
        </ul>
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

.role-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}
.role-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    padding: 0.2rem 0;
}
.role-swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid var(--border);
}
.role-name { font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role-count { font-size: 0.78rem; flex-shrink: 0; }
.role-flag {
    font-size: 0.7rem;
    text-transform: uppercase;
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 3px;
    padding: 0 0.35rem;
    flex-shrink: 0;
}
.link {
    background: none;
    border: none;
    color: var(--link-mask);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    padding: 0;
}
.link.danger { color: var(--danger); }
.muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
