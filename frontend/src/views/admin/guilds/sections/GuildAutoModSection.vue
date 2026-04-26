<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
    createAutoModRule,
    deleteAutoModRule,
    editAutoModRule,
    listAutoModRules,
    type AutoModRule,
    type AutoModRulePayload
} from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';
import { useI18n } from 'vue-i18n';
import GuildAutoModEditModal from '../GuildAutoModEditModal.vue';

const props = defineProps<{
    guildId: string;
}>();

const { t } = useI18n();
const { handle: handleApiError } = useApiError();

const rules = ref<AutoModRule[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

const modalOpen = ref(false);
const editing = ref<AutoModRule | null>(null);

async function load() {
    loading.value = true;
    loadError.value = null;
    try {
        rules.value = await listAutoModRules(props.guildId);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        loadError.value = err instanceof Error ? err.message : t('guilds.automod.loadFailed');
    } finally {
        loading.value = false;
    }
}

watch(() => props.guildId, load);
onMounted(load);

function openCreate() {
    editing.value = null;
    modalOpen.value = true;
}
function openEdit(rule: AutoModRule) {
    editing.value = rule;
    modalOpen.value = true;
}

async function onSaved(payload: AutoModRulePayload) {
    try {
        if (editing.value) {
            const updated = await editAutoModRule(props.guildId, editing.value.id, payload);
            rules.value = rules.value.map(r => r.id === updated.id ? updated : r);
        } else {
            const created = await createAutoModRule(props.guildId, payload);
            rules.value = [created, ...rules.value];
        }
        modalOpen.value = false;
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') throw err;
        throw err;
    }
}

async function toggleEnabled(rule: AutoModRule) {
    // Optimistic flip — Discord's PATCH is idempotent so we don't need
    // a defer-then-confirm dance; on failure we surface the error and
    // revert.
    const prev = rule.enabled;
    rule.enabled = !prev;
    try {
        const updated = await editAutoModRule(props.guildId, rule.id, { enabled: !prev });
        const idx = rules.value.findIndex(r => r.id === rule.id);
        if (idx >= 0) rules.value[idx] = updated;
    } catch (err) {
        rule.enabled = prev;
        if (handleApiError(err) !== 'unhandled') return;
        loadError.value = err instanceof Error ? err.message : 'toggle failed';
    }
}

async function onDelete(rule: AutoModRule) {
    if (!confirm(t('guilds.automod.deleteConfirm', { name: rule.name }))) return;
    try {
        await deleteAutoModRule(props.guildId, rule.id);
        rules.value = rules.value.filter(r => r.id !== rule.id);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        loadError.value = err instanceof Error ? err.message : 'delete failed';
    }
}

function triggerLabel(t1: number): string {
    const key = `guilds.automod.trigger.${t1}`;
    const v = t(key);
    return v === key ? `Trigger ${t1}` : v;
}
</script>

<template>
    <section class="card">
        <header class="card-head">
            <h3>{{ $t('guilds.automod.title') }} <span class="count-pill">{{ rules.length }}</span></h3>
            <button type="button" class="primary" @click="openCreate">{{ $t('guilds.automod.create') }}</button>
        </header>

        <p v-if="loadError" class="error">{{ loadError }}</p>
        <p v-if="loading && rules.length === 0" class="muted">{{ $t('common.loading') }}</p>
        <p v-else-if="rules.length === 0" class="muted">{{ $t('guilds.automod.empty') }}</p>

        <ul v-else class="rules">
            <li v-for="rule in rules" :key="rule.id" class="rule">
                <div class="rule-main">
                    <div class="name-line">
                        <span class="name">{{ rule.name }}</span>
                        <span class="trigger-tag">{{ triggerLabel(rule.triggerType) }}</span>
                        <span class="muted small">· {{ $t('guilds.automod.actionsCount', { count: rule.actions.length }) }}</span>
                    </div>
                </div>
                <label class="toggle">
                    <input type="checkbox" :checked="rule.enabled" @change="toggleEnabled(rule)" />
                    <span class="toggle-label">{{ rule.enabled ? $t('guilds.automod.enabled') : $t('guilds.automod.disabled') }}</span>
                </label>
                <div class="rule-actions">
                    <button type="button" class="ghost" @click="openEdit(rule)">{{ $t('guilds.automod.edit') }}</button>
                    <button type="button" class="ghost danger" @click="onDelete(rule)">{{ $t('guilds.automod.delete') }}</button>
                </div>
            </li>
        </ul>

        <GuildAutoModEditModal
            :visible="modalOpen"
            :rule="editing"
            @close="modalOpen = false"
            @save="onSaved"
        />
    </section>
</template>

<style scoped>
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}
.card-head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.4rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.78rem;
    font-weight: 500;
}
.rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rule {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--border);
}
.rule:last-child { border-bottom: none; }
.rule-main { min-width: 0; }
.name-line {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
}
.name { font-weight: 500; color: var(--text-strong); font-size: 0.9rem; }
.trigger-tag {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 3px;
    padding: 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
}
.toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--text-muted);
    cursor: pointer;
}
.rule-actions { display: flex; gap: 0.3rem; }
.ghost,
.primary {
    border-radius: 4px;
    padding: 0.3rem 0.65rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    border: 1px solid var(--border);
}
.ghost { background: none; color: var(--text); }
.ghost:hover { background: var(--bg-surface-hover); }
.ghost.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.45); }
.ghost.danger:hover { background: rgba(239, 68, 68, 0.1); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: var(--accent);
}
.muted { color: var(--text-muted); }
.small { font-size: 0.78rem; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
}
@media (max-width: 640px) {
    .rule {
        grid-template-columns: 1fr auto;
        grid-template-areas:
            "main toggle"
            "actions actions";
    }
    .rule-main { grid-area: main; }
    .toggle { grid-area: toggle; }
    .rule-actions { grid-area: actions; }
}
</style>
