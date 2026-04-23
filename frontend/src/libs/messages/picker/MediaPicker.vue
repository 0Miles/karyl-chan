<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useMessageContext } from '../context';
import type { CustomEmoji, GuildBucket, GuildSticker } from '../types';
import {
    pushEmojiRecent,
    pushStickerRecent,
    useEmojiRecents,
    useStickerRecents,
    type EmojiRecent,
    type StickerRecent
} from './recents';

const ctx = useMessageContext();

export type MediaSelection =
    | { type: 'unicode'; value: string }
    | { type: 'custom'; id: string; name: string; animated: boolean }
    | { type: 'sticker'; id: string; name: string; formatType: number };

const emit = defineEmits<{ (e: 'select', selection: MediaSelection): void }>();

interface UnicodeEntry {
    id: string;
    native: string;
    name: string;
    keywords: string[];
}
interface UnicodeCategory {
    id: string;
    emojis: UnicodeEntry[];
}

type Tab = 'recent' | 'unicode' | 'custom' | 'sticker';

const search = ref('');
const activeTab = ref<Tab>('recent');
const unicodeCategories = ref<UnicodeCategory[]>([]);
const allUnicodeEmojis = ref<UnicodeEntry[]>([]);
const customGuilds = ref<GuildBucket<CustomEmoji>[]>([]);
const stickerGuilds = ref<GuildBucket<GuildSticker>[]>([]);
const loadingMedia = ref(false);
const emojiRecents = useEmojiRecents();
const stickerRecents = useStickerRecents();

const activeUnicodeCategory = ref<string>('');
const activeCustomGuild = ref<string>('');
const activeStickerGuild = ref<string>('');

const TABS: { id: Tab; label: string }[] = [
    { id: 'recent', label: 'Recent' },
    { id: 'unicode', label: 'Emoji' },
    { id: 'custom', label: 'Custom' },
    { id: 'sticker', label: 'Stickers' }
];

const activeUnicodeContent = computed(() =>
    unicodeCategories.value.find(c => c.id === activeUnicodeCategory.value) ?? null
);
const activeCustomBucket = computed(() =>
    customGuilds.value.find(g => g.guildId === activeCustomGuild.value) ?? null
);
const activeStickerBucket = computed(() =>
    stickerGuilds.value.find(g => g.guildId === activeStickerGuild.value) ?? null
);

const query = computed(() => search.value.trim().toLowerCase());

function customEmojiUrl(id: string, animated: boolean, name?: string): string {
    return ctx.mediaProvider?.customEmojiUrl({ id, animated, name }, 64) ?? '';
}

function stickerPreview(sticker: { id: string; formatType: number }): string {
    return ctx.mediaProvider?.stickerUrl(sticker, 80) ?? '';
}

const filteredUnicode = computed<UnicodeEntry[]>(() => {
    if (!query.value) return [];
    const q = query.value;
    const out: UnicodeEntry[] = [];
    for (const e of allUnicodeEmojis.value) {
        if (e.id.includes(q) || e.name.toLowerCase().includes(q) || e.keywords.some(k => k.includes(q))) {
            out.push(e);
            if (out.length >= 80) break;
        }
    }
    return out;
});

const filteredCustom = computed<{ guild: string; emoji: CustomEmoji }[]>(() => {
    if (!query.value) return [];
    const q = query.value;
    const out: { guild: string; emoji: CustomEmoji }[] = [];
    for (const bucket of customGuilds.value) {
        for (const e of bucket.items) {
            if (e.name.toLowerCase().includes(q)) out.push({ guild: bucket.guildName, emoji: e });
        }
    }
    return out;
});

const filteredStickers = computed<{ guild: string; sticker: GuildSticker }[]>(() => {
    if (!query.value) return [];
    const q = query.value;
    const out: { guild: string; sticker: GuildSticker }[] = [];
    for (const bucket of stickerGuilds.value) {
        for (const s of bucket.items) {
            const desc = (s.description ?? '').toLowerCase();
            if (s.name.toLowerCase().includes(q) || desc.includes(q)) {
                out.push({ guild: bucket.guildName, sticker: s });
            }
        }
    }
    return out;
});

const isSearching = computed(() => query.value.length > 0);

function selectUnicode(value: string) {
    pushEmojiRecent({ kind: 'unicode', value });
    emit('select', { type: 'unicode', value });
}

function selectCustom(emoji: CustomEmoji) {
    pushEmojiRecent({ kind: 'custom', id: emoji.id, name: emoji.name, animated: emoji.animated });
    emit('select', { type: 'custom', id: emoji.id, name: emoji.name, animated: emoji.animated });
}

function selectSticker(s: GuildSticker | StickerRecent) {
    const entry: StickerRecent = { id: s.id, name: s.name, formatType: s.formatType };
    pushStickerRecent(entry);
    emit('select', { type: 'sticker', ...entry });
}

function selectRecentEmoji(entry: EmojiRecent) {
    if (entry.kind === 'unicode') return selectUnicode(entry.value);
    return selectCustom({ id: entry.id, name: entry.name, animated: entry.animated });
}

watch(() => isSearching.value, () => {
    // When user clears the search, leave them on whatever tab they were on.
});

onMounted(async () => {
    loadingMedia.value = true;
    try {
        const provider = ctx.mediaProvider;
        const [emojiResp, stickerResp, dataMod] = await Promise.all([
            provider?.listEmojis().catch(() => [] as GuildBucket<CustomEmoji>[]) ?? Promise.resolve([] as GuildBucket<CustomEmoji>[]),
            provider?.listStickers().catch(() => [] as GuildBucket<GuildSticker>[]) ?? Promise.resolve([] as GuildBucket<GuildSticker>[]),
            import('@emoji-mart/data').then(m => m.default as { categories: { id: string; emojis: string[] }[]; emojis: Record<string, { id: string; name: string; keywords: string[]; skins: { native: string }[] }> })
        ]);
        customGuilds.value = emojiResp;
        stickerGuilds.value = stickerResp;
        const all: UnicodeEntry[] = [];
        unicodeCategories.value = dataMod.categories.map(cat => {
            const emojis: UnicodeEntry[] = [];
            for (const id of cat.emojis) {
                const e = dataMod.emojis[id];
                if (!e || !e.skins?.[0]?.native) continue;
                const entry: UnicodeEntry = {
                    id: e.id,
                    native: e.skins[0].native,
                    name: e.name,
                    keywords: e.keywords ?? []
                };
                emojis.push(entry);
                all.push(entry);
            }
            return { id: cat.id, emojis };
        });
        allUnicodeEmojis.value = all;
        if (unicodeCategories.value.length > 0) activeUnicodeCategory.value = unicodeCategories.value[0].id;
        if (customGuilds.value.length > 0) activeCustomGuild.value = customGuilds.value[0].guildId;
        if (stickerGuilds.value.length > 0) activeStickerGuild.value = stickerGuilds.value[0].guildId;
    } finally {
        loadingMedia.value = false;
    }
});

function categoryLabel(id: string): string {
    return id.charAt(0).toUpperCase() + id.slice(1);
}

const recentEmojiEntries = computed(() => emojiRecents.value);
const recentStickerEntries = computed(() => stickerRecents.value);
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
                <section v-if="filteredCustom.length" class="section">
                    <h4>Custom emoji</h4>
                    <div class="grid emoji-grid">
                        <button
                            v-for="entry in filteredCustom"
                            :key="entry.emoji.id"
                            type="button"
                            class="cell"
                            :title="`:${entry.emoji.name}: — ${entry.guild}`"
                            @click="selectCustom(entry.emoji)"
                        >
                            <img :src="customEmojiUrl(entry.emoji.id, entry.emoji.animated)" :alt="entry.emoji.name" class="emoji" />
                        </button>
                    </div>
                </section>
                <section v-if="filteredStickers.length" class="section">
                    <h4>Stickers</h4>
                    <div class="grid sticker-grid">
                        <button
                            v-for="entry in filteredStickers"
                            :key="entry.sticker.id"
                            type="button"
                            class="cell sticker-cell"
                            :title="`${entry.sticker.name} — ${entry.guild}`"
                            @click="selectSticker(entry.sticker)"
                        >
                            <img :src="stickerPreview(entry.sticker)" :alt="entry.sticker.name" class="sticker" />
                        </button>
                    </div>
                </section>
                <section v-if="filteredUnicode.length" class="section">
                    <h4>Emoji</h4>
                    <div class="grid emoji-grid">
                        <button
                            v-for="entry in filteredUnicode"
                            :key="entry.id"
                            type="button"
                            class="cell"
                            :title="`${entry.name}`"
                            @click="selectUnicode(entry.native)"
                        >
                            <span class="unicode">{{ entry.native }}</span>
                        </button>
                    </div>
                </section>
                <p v-if="!filteredCustom.length && !filteredStickers.length && !filteredUnicode.length" class="muted">No matches.</p>
            </template>

            <template v-else-if="activeTab === 'recent'">
                <section v-if="recentEmojiEntries.length" class="section">
                    <h4>Emoji</h4>
                    <div class="grid emoji-grid">
                        <button
                            v-for="entry in recentEmojiEntries"
                            :key="entry.kind === 'unicode' ? 'u:' + entry.value : 'c:' + entry.id"
                            type="button"
                            class="cell"
                            :title="entry.kind === 'unicode' ? entry.value : `:${entry.name}:`"
                            @click="selectRecentEmoji(entry)"
                        >
                            <img v-if="entry.kind === 'custom'" :src="customEmojiUrl(entry.id, entry.animated)" :alt="entry.name" class="emoji" />
                            <span v-else class="unicode">{{ entry.value }}</span>
                        </button>
                    </div>
                </section>
                <section v-if="recentStickerEntries.length" class="section">
                    <h4>Stickers</h4>
                    <div class="grid sticker-grid">
                        <button
                            v-for="sticker in recentStickerEntries"
                            :key="sticker.id"
                            type="button"
                            class="cell sticker-cell"
                            :title="sticker.name"
                            @click="selectSticker(sticker)"
                        >
                            <img :src="stickerPreview(sticker)" :alt="sticker.name" class="sticker" />
                        </button>
                    </div>
                </section>
                <p v-if="!recentEmojiEntries.length && !recentStickerEntries.length" class="muted">Nothing recent yet.</p>
            </template>

            <template v-else-if="activeTab === 'unicode'">
                <div v-if="activeUnicodeContent" class="grid emoji-grid">
                    <button
                        v-for="emoji in activeUnicodeContent.emojis"
                        :key="emoji.id"
                        type="button"
                        class="cell"
                        :title="emoji.name"
                        @click="selectUnicode(emoji.native)"
                    >
                        <span class="unicode">{{ emoji.native }}</span>
                    </button>
                </div>
            </template>

            <template v-else-if="activeTab === 'custom'">
                <div v-if="activeCustomBucket" class="grid emoji-grid">
                    <button
                        v-for="emoji in activeCustomBucket.items"
                        :key="emoji.id"
                        type="button"
                        class="cell"
                        :title="`:${emoji.name}:`"
                        @click="selectCustom(emoji)"
                    >
                        <img :src="customEmojiUrl(emoji.id, emoji.animated)" :alt="emoji.name" class="emoji" />
                    </button>
                </div>
                <p v-else-if="!customGuilds.length" class="muted">No custom emoji available.</p>
            </template>

            <template v-else-if="activeTab === 'sticker'">
                <div v-if="activeStickerBucket" class="grid sticker-grid">
                    <button
                        v-for="s in activeStickerBucket.items"
                        :key="s.id"
                        type="button"
                        class="cell sticker-cell"
                        :title="s.name"
                        @click="selectSticker(s)"
                    >
                        <img :src="stickerPreview(s)" :alt="s.name" class="sticker" />
                    </button>
                </div>
                <p v-else-if="!stickerGuilds.length" class="muted">No guild stickers available.</p>
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
.search:focus {
    outline: 1px solid var(--accent);
}
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
.section + .section {
    margin-top: 0.75rem;
}
.section h4 {
    margin: 0 0 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}
.capitalize {
    text-transform: capitalize;
}
.grid {
    display: grid;
    gap: 0.3rem;
}
.emoji-grid {
    grid-template-columns: repeat(8, 1fr);
}
.sticker-grid {
    grid-template-columns: repeat(4, 1fr);
}
.cell {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
}
.cell:hover {
    background: var(--bg-surface-hover);
}
.sticker-cell:hover {
    border-color: var(--border);
}
.emoji {
    width: 28px;
    height: 28px;
    object-fit: contain;
}
.sticker {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.unicode {
    font-size: 1.5rem;
    line-height: 1;
}
.muted {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
}
</style>
