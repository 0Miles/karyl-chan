<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import {
    createGuildEmoji,
    createGuildSticker,
    deleteGuildEmoji,
    deleteGuildSticker,
    editGuildSticker,
    listGuildEmojis,
    listGuildStickers,
    renameGuildEmoji,
    type GuildEmojiRow,
    type GuildStickerRow
} from '../../../api/guilds';

const props = defineProps<{
    guildId: string | null;
}>();

const { t: $t } = useI18n();

const emojis = ref<GuildEmojiRow[]>([]);
const stickers = ref<GuildStickerRow[]>([]);
const error = ref<string | null>(null);

async function loadAll() {
    if (!props.guildId) {
        emojis.value = [];
        stickers.value = [];
        return;
    }
    error.value = null;
    const guildId = props.guildId;
    try {
        // Concurrent fetch — emoji and sticker lists are independent.
        const [es, ss] = await Promise.all([listGuildEmojis(guildId), listGuildStickers(guildId)]);
        if (props.guildId !== guildId) return;
        emojis.value = es;
        stickers.value = ss;
    } catch (err) {
        if (props.guildId !== guildId) return;
        error.value = err instanceof Error ? err.message : 'Failed to load assets';
    }
}

watch(() => props.guildId, () => { void loadAll(); });
onMounted(loadAll);

// ── Emoji upload modal ────────────────────────────────────────────
const emojiUploadOpen = ref(false);
const emojiUploadName = ref('');
const emojiUploadFile = ref<File | null>(null);
const emojiUploadSubmitting = ref(false);
function openEmojiUpload() {
    emojiUploadOpen.value = true;
    emojiUploadName.value = '';
    emojiUploadFile.value = null;
}
async function submitEmojiUpload() {
    if (!props.guildId || !emojiUploadFile.value || !emojiUploadName.value.trim()) return;
    emojiUploadSubmitting.value = true;
    try {
        await createGuildEmoji(props.guildId, emojiUploadName.value.trim(), emojiUploadFile.value);
        emojiUploadOpen.value = false;
        await loadAll();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Upload failed';
    } finally {
        emojiUploadSubmitting.value = false;
    }
}

async function onRenameEmoji(emoji: GuildEmojiRow) {
    if (!props.guildId) return;
    const next = window.prompt($t('emojiMgmt.renameTitle'), emoji.name ?? '');
    if (!next || next.trim() === emoji.name) return;
    try {
        await renameGuildEmoji(props.guildId, emoji.id, next.trim());
        await loadAll();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Rename failed';
    }
}

async function onDeleteEmoji(emoji: GuildEmojiRow) {
    if (!props.guildId) return;
    if (!confirm($t('emojiMgmt.deleteConfirm', { name: emoji.name ?? emoji.id }))) return;
    try {
        await deleteGuildEmoji(props.guildId, emoji.id);
        await loadAll();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Delete failed';
    }
}

// ── Sticker upload + edit modals ──────────────────────────────────
// `stickerEditing` is null in upload mode and the original row in edit
// mode — share the same modal markup so the form fields stay in one
// place.
const stickerModalOpen = ref(false);
const stickerEditing = ref<GuildStickerRow | null>(null);
const stickerForm = ref({
    name: '',
    tags: '',
    description: '',
    file: null as File | null
});
const stickerSubmitting = ref(false);

function openStickerUpload() {
    stickerEditing.value = null;
    stickerForm.value = { name: '', tags: '', description: '', file: null };
    stickerModalOpen.value = true;
}
function openStickerEdit(s: GuildStickerRow) {
    stickerEditing.value = s;
    stickerForm.value = {
        name: s.name,
        tags: s.tags,
        description: s.description ?? '',
        file: null
    };
    stickerModalOpen.value = true;
}
async function submitStickerModal() {
    if (!props.guildId) return;
    stickerSubmitting.value = true;
    try {
        if (stickerEditing.value) {
            await editGuildSticker(props.guildId, stickerEditing.value.id, {
                name: stickerForm.value.name.trim(),
                tags: stickerForm.value.tags.trim(),
                description: stickerForm.value.description.trim()
            });
        } else {
            if (!stickerForm.value.file) return;
            await createGuildSticker(props.guildId, {
                name: stickerForm.value.name.trim(),
                tags: stickerForm.value.tags.trim(),
                description: stickerForm.value.description.trim(),
                file: stickerForm.value.file
            });
        }
        stickerModalOpen.value = false;
        await loadAll();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Operation failed';
    } finally {
        stickerSubmitting.value = false;
    }
}

async function onDeleteSticker(s: GuildStickerRow) {
    if (!props.guildId) return;
    if (!confirm($t('stickerMgmt.deleteConfirm', { name: s.name }))) return;
    try {
        await deleteGuildSticker(props.guildId, s.id);
        await loadAll();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Delete failed';
    }
}

function onPickEmojiFile(event: Event) {
    const target = event.target as HTMLInputElement;
    emojiUploadFile.value = target.files?.[0] ?? null;
}
function onPickStickerFile(event: Event) {
    const target = event.target as HTMLInputElement;
    stickerForm.value.file = target.files?.[0] ?? null;
}
</script>

<template>
    <section class="card">
        <h3>
            {{ $t('emojiMgmt.title') }}
            <span class="count-pill">{{ emojis.length }}</span>
            <button type="button" class="action-btn" @click="openEmojiUpload">{{ $t('emojiMgmt.uploadButton') }}</button>
        </h3>
        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="emojis.length === 0" class="muted">{{ $t('emojiMgmt.empty') }}</p>
        <ul v-else class="emoji-grid">
            <li v-for="e in emojis" :key="e.id" class="emoji-cell" :title="e.name ?? ''">
                <img :src="e.url" :alt="e.name ?? ''" class="emoji-img" />
                <span class="emoji-name">{{ e.name }}</span>
                <span class="emoji-actions">
                    <button type="button" class="link" @click="onRenameEmoji(e)">{{ $t('emojiMgmt.rename') }}</button>
                    <button type="button" class="link danger" @click="onDeleteEmoji(e)">{{ $t('emojiMgmt.delete') }}</button>
                </span>
            </li>
        </ul>
    </section>

    <section class="card">
        <h3>
            {{ $t('stickerMgmt.title') }}
            <span class="count-pill">{{ stickers.length }}</span>
            <button type="button" class="action-btn" @click="openStickerUpload">{{ $t('stickerMgmt.uploadButton') }}</button>
        </h3>
        <p v-if="stickers.length === 0" class="muted">{{ $t('stickerMgmt.empty') }}</p>
        <ul v-else class="sticker-grid">
            <li v-for="s in stickers" :key="s.id" class="sticker-cell">
                <img :src="s.url" :alt="s.name" class="sticker-img" />
                <span class="sticker-name">{{ s.name }}</span>
                <span class="sticker-tags muted">{{ s.tags }}</span>
                <span class="sticker-actions">
                    <button type="button" class="link" @click="openStickerEdit(s)">{{ $t('stickerMgmt.edit') }}</button>
                    <button type="button" class="link danger" @click="onDeleteSticker(s)">{{ $t('stickerMgmt.delete') }}</button>
                </span>
            </li>
        </ul>
    </section>

    <Teleport to="body">
        <div v-if="emojiUploadOpen" class="modal-backdrop" @click.self="emojiUploadOpen = false">
            <div class="modal" role="dialog" aria-modal="true">
                <header class="modal-head">
                    <span>{{ $t('emojiMgmt.uploadTitle') }}</span>
                    <button type="button" class="icon-btn" @click="emojiUploadOpen = false" :aria-label="$t('common.close')">
                        <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                    </button>
                </header>
                <form class="modal-body" @submit.prevent="submitEmojiUpload">
                    <label class="field">
                        <span>{{ $t('emojiMgmt.fieldName') }}</span>
                        <input v-model="emojiUploadName" type="text" maxlength="32" autofocus required />
                    </label>
                    <label class="field">
                        <span>{{ $t('emojiMgmt.fieldFile') }}</span>
                        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onPickEmojiFile" required />
                    </label>
                    <footer class="modal-actions">
                        <button type="button" class="ghost" @click="emojiUploadOpen = false">{{ $t('common.cancel') }}</button>
                        <button type="submit" class="primary" :disabled="emojiUploadSubmitting">{{ $t('common.save') ?? 'Save' }}</button>
                    </footer>
                </form>
            </div>
        </div>

        <div v-if="stickerModalOpen" class="modal-backdrop" @click.self="stickerModalOpen = false">
            <div class="modal" role="dialog" aria-modal="true">
                <header class="modal-head">
                    <span>{{ stickerEditing ? $t('stickerMgmt.editTitle') : $t('stickerMgmt.uploadTitle') }}</span>
                    <button type="button" class="icon-btn" @click="stickerModalOpen = false" :aria-label="$t('common.close')">
                        <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                    </button>
                </header>
                <form class="modal-body" @submit.prevent="submitStickerModal">
                    <label class="field">
                        <span>{{ $t('stickerMgmt.fieldName') }}</span>
                        <input v-model="stickerForm.name" type="text" maxlength="30" autofocus required />
                    </label>
                    <label class="field">
                        <span>{{ $t('stickerMgmt.fieldTags') }}</span>
                        <input v-model="stickerForm.tags" type="text" maxlength="200" required />
                    </label>
                    <label class="field">
                        <span>{{ $t('stickerMgmt.fieldDescription') }}</span>
                        <input v-model="stickerForm.description" type="text" maxlength="100" required />
                    </label>
                    <label v-if="!stickerEditing" class="field">
                        <span>{{ $t('stickerMgmt.fieldFile') }}</span>
                        <input type="file" accept="image/png,image/apng,application/json" @change="onPickStickerFile" required />
                    </label>
                    <footer class="modal-actions">
                        <button type="button" class="ghost" @click="stickerModalOpen = false">{{ $t('common.cancel') }}</button>
                        <button type="submit" class="primary" :disabled="stickerSubmitting">{{ $t('common.save') ?? 'Save' }}</button>
                    </footer>
                </form>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.75rem;
}
.card h3 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.78rem;
}
.action-btn {
    margin-left: auto;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.7rem;
    cursor: pointer;
    font-size: 0.78rem;
}
.muted { color: var(--text-muted); font-size: 0.85rem; }
.error { color: var(--danger); font-size: 0.85rem; }

.emoji-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.4rem;
}
.emoji-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface-2);
}
.emoji-img { width: 48px; height: 48px; object-fit: contain; }
.emoji-name {
    font-size: 0.78rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
}
.emoji-actions { display: flex; gap: 0.4rem; }

.sticker-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.4rem;
}
.sticker-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface-2);
}
.sticker-img { width: 80px; height: 80px; object-fit: contain; }
.sticker-name { font-size: 0.85rem; font-weight: 500; }
.sticker-tags { font-size: 0.72rem; }
.sticker-actions { display: flex; gap: 0.4rem; }

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

.modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}
.modal {
    width: min(420px, 92vw);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.modal-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
}
.modal-head span { flex: 1; }
.icon-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.2rem;
    display: inline-flex;
}
.modal-body {
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field span { color: var(--text-muted); }
.field input[type="text"],
.field input[type="file"] {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
.ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: 4px;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.ghost:hover { background: var(--bg-surface-hover); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
}
.primary:disabled { opacity: 0.55; cursor: default; }
</style>
