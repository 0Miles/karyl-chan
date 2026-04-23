<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useMessageContext } from '../context';
import type { CustomEmoji, GuildBucket, GuildSticker } from '../types';
import EmojiGrid, { type EmojiCell } from './EmojiGrid.vue';
import StickerGrid, { type StickerCell } from './StickerGrid.vue';
import {
    pushEmojiRecent,
    pushStickerRecent,
    useEmojiRecents,
    useStickerRecents,
    type EmojiRecent,
    type StickerRecent
} from './recents';
import {
    getCachedUnicodeEmojiData,
    loadUnicodeEmojiData,
    type UnicodeCategory,
    type UnicodeEntry
} from './unicode-emoji-data';

const ctx = useMessageContext();

export type MediaSelection =
    | { type: 'unicode'; value: string }
    | { type: 'custom'; id: string; name: string; animated: boolean }
    | { type: 'sticker'; id: string; name: string; formatType: number };

const emit = defineEmits<{
    (e: 'select', selection: MediaSelection): void;
    (e: 'close'): void;
}>();

const pendingRecents: Array<() => void> = [];

function flushRecents() {
    for (const fn of pendingRecents) fn();
    pendingRecents.length = 0;
}

onBeforeUnmount(flushRecents);
defineExpose({ flushRecents });

type Tab = 'recent' | 'unicode' | 'custom' | 'sticker';

// Preseed from caches so reopening the picker never flashes "Loading…".
const cachedUnicode = getCachedUnicodeEmojiData();
const cachedEmojis = ctx.mediaProvider?.cachedEmojis?.() ?? null;
const cachedStickers = ctx.mediaProvider?.cachedStickers?.() ?? null;

const search = ref('');
const activeTab = ref<Tab>('recent');
const unicodeCategories = ref<UnicodeCategory[]>(cachedUnicode?.categories ?? []);
const allUnicodeEmojis = ref<UnicodeEntry[]>(cachedUnicode?.all ?? []);
const customGuilds = ref<GuildBucket<CustomEmoji>[]>(cachedEmojis ?? []);
const stickerGuilds = ref<GuildBucket<GuildSticker>[]>(cachedStickers ?? []);
const loadingMedia = ref(!cachedEmojis || !cachedStickers || !cachedUnicode);
const emojiRecents = useEmojiRecents();
const stickerRecents = useStickerRecents();

const activeUnicodeCategory = ref<string>(cachedUnicode?.categories[0]?.id ?? '');
const activeCustomGuild = ref<string>(cachedEmojis?.[0]?.guildId ?? '');
const activeStickerGuild = ref<string>(cachedStickers?.[0]?.guildId ?? '');

const TABS: { id: Tab; label: string }[] = [
    { id: 'recent', label: 'Recent' },
    { id: 'unicode', label: 'Emoji' },
    { id: 'custom', label: 'Custom' },
    { id: 'sticker', label: 'Stickers' }
];

const query = computed(() => search.value.trim().toLowerCase());
const isSearching = computed(() => query.value.length > 0);

function customEmojiUrl(emoji: { id: string; animated: boolean; name?: string }, size = 64): string {
    return ctx.mediaProvider?.customEmojiUrl(emoji, size) ?? '';
}

function stickerImageUrl(sticker: { id: string; formatType: number }, size = 80): string {
    return ctx.mediaProvider?.stickerUrl(sticker, size) ?? '';
}

function unicodeCells(entries: UnicodeEntry[]): EmojiCell[] {
    return entries.map(e => ({ key: `u:${e.native}`, title: e.name, glyph: e.native }));
}

function customCells(emojis: CustomEmoji[], guildName?: string): EmojiCell[] {
    return emojis.map(e => ({
        key: `c:${e.id}`,
        title: guildName ? `:${e.name}: — ${guildName}` : `:${e.name}:`,
        imageUrl: customEmojiUrl(e)
    }));
}

function stickerCells(stickers: { id: string; name: string; formatType: number }[], guildName?: string): StickerCell[] {
    return stickers.map(s => ({
        key: s.id,
        title: guildName ? `${s.name} — ${guildName}` : s.name,
        imageUrl: stickerImageUrl(s)
    }));
}

const filteredUnicodeCells = computed(() => {
    if (!query.value) return [];
    const q = query.value;
    const out: UnicodeEntry[] = [];
    for (const e of allUnicodeEmojis.value) {
        if (e.id.includes(q) || e.name.toLowerCase().includes(q) || e.keywords.some(k => k.includes(q))) {
            out.push(e);
            if (out.length >= 80) break;
        }
    }
    return unicodeCells(out);
});

const filteredCustomCells = computed(() => {
    if (!query.value) return [];
    const q = query.value;
    const out: EmojiCell[] = [];
    for (const bucket of customGuilds.value) {
        for (const e of bucket.items) {
            if (e.name.toLowerCase().includes(q)) {
                out.push({
                    key: `c:${e.id}`,
                    title: `:${e.name}: — ${bucket.guildName}`,
                    imageUrl: customEmojiUrl(e)
                });
            }
        }
    }
    return out;
});

const filteredStickerCells = computed(() => {
    if (!query.value) return [];
    const q = query.value;
    const out: StickerCell[] = [];
    for (const bucket of stickerGuilds.value) {
        for (const s of bucket.items) {
            const desc = (s.description ?? '').toLowerCase();
            if (s.name.toLowerCase().includes(q) || desc.includes(q)) {
                out.push({
                    key: s.id,
                    title: `${s.name} — ${bucket.guildName}`,
                    imageUrl: stickerImageUrl(s)
                });
            }
        }
    }
    return out;
});

const recentEmojiCells = computed<EmojiCell[]>(() => emojiRecents.value.map(entry => {
    if (entry.kind === 'unicode') {
        return { key: `u:${entry.value}`, title: entry.value, glyph: entry.value };
    }
    return {
        key: `c:${entry.id}`,
        title: `:${entry.name}:`,
        imageUrl: customEmojiUrl({ id: entry.id, animated: entry.animated, name: entry.name })
    };
}));

const recentStickerCells = computed<StickerCell[]>(() =>
    stickerRecents.value.map(s => ({
        key: s.id,
        title: s.name,
        imageUrl: stickerImageUrl(s)
    }))
);

const activeUnicodeCells = computed<EmojiCell[]>(() => {
    const cat = unicodeCategories.value.find(c => c.id === activeUnicodeCategory.value);
    return cat ? unicodeCells(cat.emojis) : [];
});

const activeCustomCells = computed<EmojiCell[]>(() => {
    const bucket = customGuilds.value.find(g => g.guildId === activeCustomGuild.value);
    return bucket ? customCells(bucket.items) : [];
});

const activeStickerCells = computed<StickerCell[]>(() => {
    const bucket = stickerGuilds.value.find(g => g.guildId === activeStickerGuild.value);
    return bucket ? stickerCells(bucket.items) : [];
});

function pickEmoji(key: string, event?: MouseEvent) {
    if (key.startsWith('u:')) {
        const value = key.slice(2);
        pendingRecents.push(() => pushEmojiRecent({ kind: 'unicode', value }));
        emit('select', { type: 'unicode', value });
    } else if (key.startsWith('c:')) {
        const id = key.slice(2);
        const found = findCustomEmoji(id);
        if (!found) return;
        pendingRecents.push(() => pushEmojiRecent({ kind: 'custom', id: found.id, name: found.name, animated: found.animated }));
        emit('select', { type: 'custom', id: found.id, name: found.name, animated: found.animated });
    } else { return; }
    if (!event?.shiftKey) emit('close');
}

function pickSticker(id: string, event?: MouseEvent) {
    const found = findSticker(id);
    if (!found) return;
    const entry: StickerRecent = { id: found.id, name: found.name, formatType: found.formatType };
    pendingRecents.push(() => pushStickerRecent(entry));
    emit('select', { type: 'sticker', ...entry });
    if (!event?.shiftKey) emit('close');
}

function findCustomEmoji(id: string): { id: string; name: string; animated: boolean } | null {
    for (const bucket of customGuilds.value) {
        const hit = bucket.items.find(e => e.id === id);
        if (hit) return hit;
    }
    for (const recent of emojiRecents.value) {
        if (recent.kind === 'custom' && recent.id === id) {
            return { id: recent.id, name: recent.name, animated: recent.animated };
        }
    }
    return null;
}

function findSticker(id: string): { id: string; name: string; formatType: number } | null {
    for (const bucket of stickerGuilds.value) {
        const hit = bucket.items.find(s => s.id === id);
        if (hit) return hit;
    }
    return stickerRecents.value.find(s => s.id === id) ?? null;
}

onMounted(async () => {
    const provider = ctx.mediaProvider;
    try {
        const [emojiResp, stickerResp, unicodeData] = await Promise.all([
            provider?.listEmojis().catch(() => [] as GuildBucket<CustomEmoji>[]) ?? Promise.resolve([] as GuildBucket<CustomEmoji>[]),
            provider?.listStickers().catch(() => [] as GuildBucket<GuildSticker>[]) ?? Promise.resolve([] as GuildBucket<GuildSticker>[]),
            loadUnicodeEmojiData().catch(() => ({ categories: [], all: [] }))
        ]);
        customGuilds.value = emojiResp;
        stickerGuilds.value = stickerResp;
        unicodeCategories.value = unicodeData.categories;
        allUnicodeEmojis.value = unicodeData.all;
        if (!activeUnicodeCategory.value && unicodeCategories.value.length > 0) {
            activeUnicodeCategory.value = unicodeCategories.value[0].id;
        }
        if (!activeCustomGuild.value && customGuilds.value.length > 0) {
            activeCustomGuild.value = customGuilds.value[0].guildId;
        }
        if (!activeStickerGuild.value && stickerGuilds.value.length > 0) {
            activeStickerGuild.value = stickerGuilds.value[0].guildId;
        }
    } finally {
        loadingMedia.value = false;
    }
});

function categoryLabel(id: string): string {
    return id.charAt(0).toUpperCase() + id.slice(1);
}
</script>

<template>
    <div class="picker">
        <div class="search-row">
            <input
                v-model="search"
                type="search"
                placeholder="Search emoji & stickers…"
                class="search"
            />
        </div>
        <nav v-if="!isSearching" class="tabs">
            <button
                v-for="tab in TABS"
                :key="tab.id"
                type="button"
                :class="['tab', { active: tab.id === activeTab }]"
                @click="activeTab = tab.id"
            >{{ tab.label }}</button>
        </nav>
        <nav v-if="!isSearching && activeTab === 'unicode' && unicodeCategories.length" class="subtabs">
            <button
                v-for="cat in unicodeCategories"
                :key="cat.id"
                type="button"
                :class="['subtab', { active: cat.id === activeUnicodeCategory }]"
                @click="activeUnicodeCategory = cat.id"
            >{{ categoryLabel(cat.id) }}</button>
        </nav>
        <nav v-if="!isSearching && activeTab === 'custom' && customGuilds.length" class="subtabs">
            <button
                v-for="bucket in customGuilds"
                :key="bucket.guildId"
                type="button"
                :class="['subtab', { active: bucket.guildId === activeCustomGuild }]"
                @click="activeCustomGuild = bucket.guildId"
            >{{ bucket.guildName }}</button>
        </nav>
        <nav v-if="!isSearching && activeTab === 'sticker' && stickerGuilds.length" class="subtabs">
            <button
                v-for="bucket in stickerGuilds"
                :key="bucket.guildId"
                type="button"
                :class="['subtab', { active: bucket.guildId === activeStickerGuild }]"
                @click="activeStickerGuild = bucket.guildId"
            >{{ bucket.guildName }}</button>
        </nav>
        <div class="body">
            <p v-if="loadingMedia && customGuilds.length === 0" class="muted">Loading…</p>

            <template v-else-if="isSearching">
                <section v-if="filteredCustomCells.length" class="section">
                    <h4>Custom emoji</h4>
                    <EmojiGrid :cells="filteredCustomCells" @pick="pickEmoji" />
                </section>
                <section v-if="filteredStickerCells.length" class="section">
                    <h4>Stickers</h4>
                    <StickerGrid :cells="filteredStickerCells" @pick="pickSticker" />
                </section>
                <section v-if="filteredUnicodeCells.length" class="section">
                    <h4>Emoji</h4>
                    <EmojiGrid :cells="filteredUnicodeCells" @pick="pickEmoji" />
                </section>
                <p v-if="!filteredCustomCells.length && !filteredStickerCells.length && !filteredUnicodeCells.length" class="muted">No matches.</p>
            </template>

            <template v-else-if="activeTab === 'recent'">
                <section v-if="recentEmojiCells.length" class="section">
                    <h4>Emoji</h4>
                    <EmojiGrid :cells="recentEmojiCells" @pick="pickEmoji" />
                </section>
                <section v-if="recentStickerCells.length" class="section">
                    <h4>Stickers</h4>
                    <StickerGrid :cells="recentStickerCells" @pick="pickSticker" />
                </section>
                <p v-if="!recentEmojiCells.length && !recentStickerCells.length" class="muted">Nothing recent yet.</p>
            </template>

            <template v-else-if="activeTab === 'unicode'">
                <EmojiGrid :cells="activeUnicodeCells" @pick="pickEmoji" />
            </template>

            <template v-else-if="activeTab === 'custom'">
                <EmojiGrid v-if="activeCustomCells.length" :cells="activeCustomCells" @pick="pickEmoji" />
                <p v-else class="muted">No custom emoji available.</p>
            </template>

            <template v-else-if="activeTab === 'sticker'">
                <StickerGrid v-if="activeStickerCells.length" :cells="activeStickerCells" @pick="pickSticker" />
                <p v-else class="muted">No guild stickers available.</p>
            </template>
        </div>
    </div>
</template>

<style scoped>
.picker {
    width: 420px;
    max-height: 460px;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
    overflow: hidden;
}
.search-row {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.search {
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface-2);
    color: var(--text);
    font: inherit;
}
.search:focus { outline: 1px solid var(--accent); }
.tabs,
.subtabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
}
.subtabs {
    background: var(--bg-surface-2);
    padding: 0.3rem 0.5rem;
}
.tab {
    background: var(--bg-surface-2);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.25rem 0.7rem;
    cursor: pointer;
    color: var(--text);
    font-size: 0.85rem;
    flex-shrink: 0;
}
.tab.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
}
.subtab {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.15rem 0.55rem;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.78rem;
    white-space: nowrap;
    flex-shrink: 0;
}
.subtab.active {
    background: var(--bg-surface);
    border-color: var(--border);
    color: var(--text-strong);
}
.body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem;
}
.section + .section { margin-top: 0.75rem; }
.section h4 {
    margin: 0 0 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}
.muted {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
}
</style>
