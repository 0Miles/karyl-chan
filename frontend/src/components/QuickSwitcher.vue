<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { useDmStore } from '../modules/discord-chat/stores/dmStore';
import { useGuildChannelStore } from '../modules/discord-chat/stores/guildChannelStore';
import { listGuilds } from '../api/guilds';

/**
 * Cmd/Ctrl+K palette: search across DMs and guild channels and jump
 * to the result with a single keystroke. Indexes whatever's already
 * loaded in stores plus a fresh `listGuilds` so a session that's only
 * been to the dashboard still gets a useful list.
 */

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const router = useRouter();
const { t } = useI18n();
const dmStore = useDmStore();
const guildStore = useGuildChannelStore();

interface Item {
    /** Stable id used as the v-for :key; combination of surface + ids
     *  because a DM channel and a guild channel can theoretically
     *  share an id (they don't in practice, but belt and braces). */
    key: string;
    surface: 'dm' | string;
    channelId: string;
    label: string;
    sublabel: string;
    icon: string;
}

const inputRef = ref<HTMLInputElement | null>(null);
const query = ref('');
const activeIndex = ref(0);
const guildIndex = ref<{ id: string; name: string }[]>([]);

const allItems = computed<Item[]>(() => {
    const out: Item[] = [];
    for (const ch of dmStore.channels) {
        const label = ch.recipient.globalName ?? ch.recipient.username;
        out.push({
            key: `dm:${ch.id}`,
            surface: 'dm',
            channelId: ch.id,
            label,
            sublabel: t('quickSwitcher.directMessage'),
            icon: 'material-symbols:chat-bubble-outline-rounded'
        });
    }
    for (const guild of guildIndex.value) {
        const entry = guildStore.guilds[guild.id];
        if (!entry) continue;
        for (const cat of entry.categories) {
            for (const ch of cat.channels) {
                out.push({
                    key: `${guild.id}:${ch.id}`,
                    surface: guild.id,
                    channelId: ch.id,
                    label: `#${ch.name}`,
                    sublabel: guild.name,
                    icon: 'material-symbols:tag-rounded'
                });
            }
        }
    }
    return out;
});

const filtered = computed<Item[]>(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return allItems.value.slice(0, 50);
    const tokens = q.split(/\s+/);
    return allItems.value
        .filter(item => {
            const hay = `${item.label} ${item.sublabel}`.toLowerCase();
            return tokens.every(tok => hay.includes(tok));
        })
        .slice(0, 50);
});

watch(filtered, () => { activeIndex.value = 0; });

async function hydrateLists() {
    // DMs: ensure channel list is loaded so the switcher sees them
    // even if the user hasn't visited /admin/messages yet this session.
    void dmStore.ensureChannels().catch(() => {});
    // Guilds: list once, then ensure each guild's channels. We don't
    // need to wait for all of them — the computed list re-evaluates as
    // each guildStore entry resolves.
    try {
        const guilds = await listGuilds();
        guildIndex.value = guilds.map(g => ({ id: g.id, name: g.name }));
        for (const g of guilds) void guildStore.ensureChannels(g.id).catch(() => {});
    } catch {
        // Auth / network issue — palette still works against whatever
        // is already cached.
    }
}

function close() { emit('close'); }

function go(item: Item) {
    const target = item.surface === 'dm'
        ? { path: '/admin/messages', query: { channel: item.channelId } }
        : { path: '/admin/messages', query: { guild: item.surface, channel: item.channelId } };
    router.push(target).catch(() => {});
    close();
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        const max = filtered.value.length;
        if (max === 0) return;
        activeIndex.value = (activeIndex.value + 1) % max;
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        const max = filtered.value.length;
        if (max === 0) return;
        activeIndex.value = (activeIndex.value - 1 + max) % max;
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        const item = filtered.value[activeIndex.value];
        if (item) go(item);
    }
}

watch(() => props.visible, async (visible) => {
    if (!visible) return;
    query.value = '';
    activeIndex.value = 0;
    await hydrateLists();
    await nextTick();
    inputRef.value?.focus();
});

// Close on backdrop click is handled in the template; also wire up Esc
// at window level so a focus-lost state still dismisses cleanly.
function onWindowKey(event: KeyboardEvent) {
    if (!props.visible) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
    }
}

onMounted(() => window.addEventListener('keydown', onWindowKey));
onUnmounted(() => window.removeEventListener('keydown', onWindowKey));
</script>

<template>
    <Transition name="fade">
        <div v-if="visible" class="qs-backdrop" @click.self="close">
            <div class="qs-panel" role="dialog" aria-modal="true">
                <div class="qs-input-row">
                    <Icon icon="material-symbols:search-rounded" width="20" height="20" class="qs-search-icon" />
                    <input
                        ref="inputRef"
                        v-model="query"
                        type="text"
                        :placeholder="$t('quickSwitcher.placeholder')"
                        @keydown="onKeydown"
                        autocomplete="off"
                    />
                </div>
                <div class="qs-list-wrap">
                    <p v-if="filtered.length === 0" class="qs-empty">{{ $t('quickSwitcher.empty') }}</p>
                    <ul v-else class="qs-list">
                        <li
                            v-for="(item, idx) in filtered"
                            :key="item.key"
                            :class="['qs-item', { active: idx === activeIndex }]"
                            @click="go(item)"
                            @mouseenter="activeIndex = idx"
                        >
                            <Icon :icon="item.icon" width="18" height="18" class="qs-icon" />
                            <span class="qs-label">{{ item.label }}</span>
                            <span class="qs-sub">{{ item.sublabel }}</span>
                        </li>
                    </ul>
                </div>
                <footer class="qs-footer">
                    <kbd>↑</kbd><kbd>↓</kbd> {{ $t('quickSwitcher.navigate') }}
                    <kbd>↵</kbd> {{ $t('quickSwitcher.open') }}
                    <kbd>Esc</kbd> {{ $t('quickSwitcher.close') }}
                </footer>
            </div>
        </div>
    </Transition>
</template>

<style scoped>
.qs-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    z-index: 80;
}
.qs-panel {
    width: min(92vw, 560px);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.qs-input-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--border);
}
.qs-search-icon { color: var(--text-muted); flex-shrink: 0; }
.qs-input-row input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    outline: none;
}
.qs-list-wrap { max-height: 50vh; overflow-y: auto; }
.qs-empty { padding: 2rem 1rem; text-align: center; color: var(--text-muted); }
.qs-list { list-style: none; margin: 0; padding: 0.25rem 0; }
.qs-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    color: var(--text);
}
.qs-item.active { background: var(--bg-surface-active); }
.qs-icon { color: var(--text-muted); flex-shrink: 0; }
.qs-label { font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qs-sub { font-size: 0.78rem; color: var(--text-muted); flex-shrink: 0; }
.qs-footer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-top: 1px solid var(--border);
    font-size: 0.72rem;
    color: var(--text-muted);
}
.qs-footer kbd {
    background: var(--bg-surface-2);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 0.35rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.7rem;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.12s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
