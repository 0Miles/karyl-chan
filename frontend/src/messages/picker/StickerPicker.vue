<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { listStickers, type GuildBucket, type GuildSticker } from '../../api/discord';
import { pushStickerRecent, useStickerRecents, type StickerRecent } from './recents';

const emit = defineEmits<{
    (e: 'select', sticker: StickerRecent): void;
}>();

const guilds = ref<GuildBucket<GuildSticker>[]>([]);
const loadingGuilds = ref(false);
const recents = useStickerRecents();
const activeTab = ref<'recent' | string>('recent');

const tabs = computed(() => {
    const list: { id: 'recent' | string; label: string }[] = [
        { id: 'recent', label: 'Recent' }
    ];
    for (const g of guilds.value) list.push({ id: g.guildId, label: g.guildName });
    return list;
});

const activeGuild = computed(() => guilds.value.find(g => g.guildId === activeTab.value) ?? null);

function previewUrl(id: string): string {
    return `https://cdn.discordapp.com/stickers/${id}.png`;
}

function pickGuildSticker(s: GuildSticker) {
    const entry: StickerRecent = { id: s.id, name: s.name, formatType: s.formatType };
    pushStickerRecent(entry);
    emit('select', entry);
}

function pickRecent(s: StickerRecent) {
    pushStickerRecent(s);
    emit('select', s);
}

onMounted(async () => {
    loadingGuilds.value = true;
    try {
        guilds.value = await listStickers();
        if (guilds.value.length > 0 && recents.value.length === 0) {
            activeTab.value = guilds.value[0].guildId;
        }
    } catch {
        // ignore
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
                @click="activeTab = tab.id"
            >{{ tab.label }}</button>
        </nav>
        <div class="body">
            <div v-if="activeTab === 'recent'">
                <p v-if="recents.length === 0" class="muted">No recents yet.</p>
                <div v-else class="grid">
                    <button
                        v-for="entry in recents"
                        :key="entry.id"
                        type="button"
                        class="cell"
                        :title="entry.name"
                        @click="pickRecent(entry)"
                    >
                        <img :src="previewUrl(entry.id)" :alt="entry.name" class="sticker" />
                    </button>
                </div>
            </div>
            <div v-else-if="activeGuild">
                <div class="grid">
                    <button
                        v-for="sticker in activeGuild.items"
                        :key="sticker.id"
                        type="button"
                        class="cell"
                        :title="sticker.name"
                        @click="pickGuildSticker(sticker)"
                    >
                        <img :src="previewUrl(sticker.id)" :alt="sticker.name" class="sticker" />
                    </button>
                </div>
            </div>
            <p v-else-if="loadingGuilds" class="muted">Loading…</p>
            <p v-else-if="guilds.length === 0" class="muted">No guild stickers available.</p>
        </div>
    </div>
</template>

<style scoped>
.picker {
    width: 360px;
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
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    color: var(--text);
    font-size: 0.8rem;
    white-space: nowrap;
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
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
}
.cell {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.25rem;
    cursor: pointer;
    aspect-ratio: 1 / 1;
}
.cell:hover {
    background: var(--bg-surface-hover);
    border-color: var(--border);
}
.sticker {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.muted {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1rem;
}
</style>
