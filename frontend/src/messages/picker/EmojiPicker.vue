<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import EmojiPickerNative from 'vue3-emoji-picker';
import 'vue3-emoji-picker/css';
import { listEmojis, type CustomEmoji, type GuildBucket } from '../../api/discord';
import { pushEmojiRecent, useEmojiRecents, type EmojiRecent } from './recents';

const emit = defineEmits<{
    (e: 'select', payload: { kind: 'unicode'; value: string } | { kind: 'custom'; id: string; name: string; animated: boolean }): void;
}>();

type Tab = 'recent' | 'unicode' | string;

const guilds = ref<GuildBucket<CustomEmoji>[]>([]);
const loadingGuilds = ref(false);
const recents = useEmojiRecents();
const activeTab = ref<Tab>('recent');

const tabs = computed(() => {
    const list: { id: Tab; label: string }[] = [
        { id: 'recent', label: '⏱' },
        { id: 'unicode', label: '😀' }
    ];
    for (const g of guilds.value) list.push({ id: g.guildId, label: g.guildName });
    return list;
});

const activeGuild = computed(() => guilds.value.find(g => g.guildId === activeTab.value) ?? null);

function customEmojiUrl(emoji: CustomEmoji): string {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=48&quality=lossless`;
}

function pickUnicode(payload: { i?: string; n?: string[] | string }) {
    const value = payload.i ?? (Array.isArray(payload.n) ? payload.n[0] : payload.n) ?? '';
    if (!value) return;
    const entry: EmojiRecent = { kind: 'unicode', value };
    pushEmojiRecent(entry);
    emit('select', entry);
}

function pickCustom(emoji: CustomEmoji) {
    const entry: EmojiRecent = { kind: 'custom', id: emoji.id, name: emoji.name, animated: emoji.animated };
    pushEmojiRecent(entry);
    emit('select', entry);
}

function pickRecent(entry: EmojiRecent) {
    pushEmojiRecent(entry);
    emit('select', entry);
}

function recentImageUrl(entry: EmojiRecent): string | null {
    if (entry.kind === 'unicode') return null;
    return `https://cdn.discordapp.com/emojis/${entry.id}.${entry.animated ? 'gif' : 'webp'}?size=48&quality=lossless`;
}

onMounted(async () => {
    loadingGuilds.value = true;
    try {
        guilds.value = await listEmojis();
    } catch {
        // ignore — picker still functional with unicode tab
    } finally {
        loadingGuilds.value = false;
    }
});
</script>

<template>
    <div class="picker">
        <nav class="tabs">
            <button
                v-for="tab in tabs"
                :key="String(tab.id)"
                type="button"
                :class="['tab', { active: tab.id === activeTab }]"
                :title="tab.label"
                @click="activeTab = tab.id"
            >{{ tab.label.charAt(0).toUpperCase() }}</button>
        </nav>
        <div class="body">
            <div v-if="activeTab === 'recent'" class="recent">
                <p v-if="recents.length === 0" class="muted">No recents yet.</p>
                <div v-else class="grid">
                    <button
                        v-for="entry in recents"
                        :key="entry.kind === 'unicode' ? 'u:' + entry.value : 'c:' + entry.id"
                        type="button"
                        class="cell"
                        :title="entry.kind === 'unicode' ? entry.value : ':' + entry.name + ':'"
                        @click="pickRecent(entry)"
                    >
                        <img v-if="recentImageUrl(entry)" :src="recentImageUrl(entry) ?? ''" class="emoji" />
                        <span v-else class="unicode">{{ (entry as any).value }}</span>
                    </button>
                </div>
            </div>
            <div v-else-if="activeTab === 'unicode'" class="unicode-wrap">
                <EmojiPickerNative :native="true" :hide-search="false" @select="pickUnicode" />
            </div>
            <div v-else-if="activeGuild" class="guild">
                <div class="grid">
                    <button
                        v-for="emoji in activeGuild.items"
                        :key="emoji.id"
                        type="button"
                        class="cell"
                        :title="':' + emoji.name + ':'"
                        @click="pickCustom(emoji)"
                    >
                        <img :src="customEmojiUrl(emoji)" :alt="emoji.name" class="emoji" />
                    </button>
                </div>
            </div>
            <p v-else-if="loadingGuilds" class="muted">Loading…</p>
        </div>
    </div>
</template>

<style scoped>
.picker {
    width: 320px;
    max-height: 360px;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
}
.tab {
    background: var(--bg-surface-2);
    border: 1px solid transparent;
    border-radius: 4px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    color: var(--text);
    flex-shrink: 0;
}
.tab.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
}
.body {
    flex: 1;
    overflow-y: auto;
    padding: 0.4rem;
}
.grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.25rem;
}
.cell {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
    border-radius: 4px;
}
.cell:hover {
    background: var(--bg-surface-hover);
}
.emoji {
    width: 22px;
    height: 22px;
    object-fit: contain;
}
.unicode {
    font-size: 1.2rem;
    line-height: 1;
}
.unicode-wrap :deep(.v3-emoji-picker) {
    border: none;
    box-shadow: none;
    width: 100%;
}
.muted {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1rem;
}
</style>
