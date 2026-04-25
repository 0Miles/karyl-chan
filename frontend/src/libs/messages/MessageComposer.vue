<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { Icon } from '@iconify/vue';
import MediaPickerPopover from './picker/MediaPickerPopover.vue';
import type { MediaSelection } from './picker/MediaPicker.vue';
import type { StickerRecent } from './picker/recents';
import ComposerSuggestions from './ComposerSuggestions.vue';
import { findActiveTrigger } from './composer-suggestions';
import { useMessageContext } from './context';
import {
    buildEditorFragment,
    clearEditor,
    deleteBackwardChars,
    focusEditorEnd,
    getTextBeforeCursor,
    insertFragmentAtCursor,
    readEditorText,
    type ComposerTokenCodec
} from './composer-editor';
import { clearDraft, loadDraft, saveDraft } from './composer-draft';
import type { ComposerSuggestionItem, OutgoingMessage, MessageReference } from './types';

const NOOP_TOKEN_CODEC: ComposerTokenCodec = {
    tokenRe: /(?!)/g,
    elementFromMatch: () => document.createElement('span'),
    textFromElement: () => null,
    elementForCustomEmoji: (sel) => {
        const span = document.createElement('span');
        span.textContent = `:${sel.name}:`;
        return span;
    }
};

const props = defineProps<{
    placeholder?: string;
    replyTo?: MessageReference | null;
    disabled?: boolean;
    /** Used as the localStorage key for draft autosave. When the
     *  channelId changes, the current draft is persisted under the
     *  outgoing channel and any saved draft for the incoming channel
     *  is restored. Omit (or pass null) to disable persistence. */
    channelId?: string | null;
}>();

const emit = defineEmits<{
    (e: 'send', payload: OutgoingMessage): void;
    (e: 'cancel-reply'): void;
}>();

const content = ref('');
const attachments = shallowRef<File[]>([]);
const pendingStickers = ref<StickerRecent[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const showPicker = ref(false);
const editorRef = ref<HTMLDivElement | null>(null);

const ctx = useMessageContext();
const codec = ctx.composerTokenCodec ?? NOOP_TOKEN_CODEC;

const triggerChars = computed(() => {
    const set = new Set<string>();
    for (const p of ctx.suggestionProviders ?? []) for (const t of p.triggers) set.add(t);
    return [...set];
});

const suggestions = ref<ComposerSuggestionItem[]>([]);
const activeSuggestionIndex = ref(0);
const activeTrigger = ref<{ char: string; query: string } | null>(null);
let suggestionRequestId = 0;

function syncContentFromEditor() {
    const root = editorRef.value;
    content.value = root ? readEditorText(root, codec) : '';
}

// Draft autosave: throttle keystrokes through a single timer so we
// don't spam localStorage on every input event. Debounce window is
// short — the cost of writing the same key per keystroke isn't huge,
// but coalescing reduces churn when the user is typing fast.
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    const channelId = props.channelId;
    const text = content.value;
    draftSaveTimer = setTimeout(() => saveDraft(channelId, text), 250);
}

function loadDraftIntoEditor(channelId: string | null | undefined) {
    const root = editorRef.value;
    if (!root) return;
    clearEditor(root);
    const saved = loadDraft(channelId);
    if (!saved) {
        content.value = '';
        return;
    }
    insertFragmentAtCursor(root, buildEditorFragment(saved, codec));
    syncContentFromEditor();
}

async function refreshSuggestions() {
    const root = editorRef.value;
    if (!root || triggerChars.value.length === 0) {
        suggestions.value = [];
        activeTrigger.value = null;
        return;
    }
    const slice = getTextBeforeCursor(root);
    if (!slice) {
        suggestions.value = [];
        activeTrigger.value = null;
        return;
    }
    const trigger = findActiveTrigger(slice.text, slice.cursor, triggerChars.value);
    if (!trigger) {
        suggestions.value = [];
        activeTrigger.value = null;
        return;
    }
    const provider = ctx.suggestionProviders?.find(p => p.triggers.includes(trigger.char));
    if (!provider) {
        suggestions.value = [];
        activeTrigger.value = null;
        return;
    }
    const id = ++suggestionRequestId;
    const result = await provider.suggest(trigger);
    if (id !== suggestionRequestId) return;
    suggestions.value = result;
    activeSuggestionIndex.value = 0;
    activeTrigger.value = result.length > 0 ? { char: trigger.char, query: trigger.query } : null;
}

function applySuggestion(key: string) {
    const root = editorRef.value;
    const trigger = activeTrigger.value;
    if (!root || !trigger) return;
    const item = suggestions.value.find(s => s.key === key);
    if (!item) return;
    deleteBackwardChars(trigger.query.length + 1);
    const frag = buildEditorFragment(item.insert, codec);
    frag.appendChild(document.createTextNode(' '));
    insertFragmentAtCursor(root, frag);
    suggestions.value = [];
    activeTrigger.value = null;
    syncContentFromEditor();
}

function cancelSuggestions() {
    suggestions.value = [];
    activeTrigger.value = null;
}

const stickerLimitReached = computed(() => pendingStickers.value.length >= 3);

function onMediaSelect(selection: MediaSelection) {
    const root = editorRef.value;
    if (selection.type === 'sticker') {
        if (stickerLimitReached.value) return;
        if (!content.value.trim() && attachments.value.length === 0 && pendingStickers.value.length === 0) {
            emit('send', {
                content: '',
                stickerIds: [selection.id],
                reference: props.replyTo ?? null
            });
            showPicker.value = false;
            return;
        }
        pendingStickers.value = [...pendingStickers.value, {
            id: selection.id,
            name: selection.name,
            formatType: selection.formatType
        }];
        return;
    }
    if (!root) return;
    if (!root.contains(window.getSelection()?.anchorNode ?? null)) {
        focusEditorEnd(root);
    } else {
        root.focus();
    }
    const frag = document.createDocumentFragment();
    if (selection.type === 'unicode') {
        frag.appendChild(document.createTextNode(selection.value));
    } else {
        frag.appendChild(codec.elementForCustomEmoji(selection));
    }
    insertFragmentAtCursor(root, frag);
    syncContentFromEditor();
}

function removeSticker(idx: number) {
    pendingStickers.value = pendingStickers.value.filter((_, i) => i !== idx);
}

function onAttach(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files) return;
    attachments.value = [...attachments.value, ...Array.from(target.files)];
    target.value = '';
}

const previewUrls = new WeakMap<File, string>();
function attachmentPreview(file: File): string | null {
    if (!file.type.startsWith('image/')) return null;
    let url = previewUrls.get(file);
    if (!url) {
        url = URL.createObjectURL(file);
        previewUrls.set(file, url);
    }
    return url;
}

function revokePreview(file: File) {
    const url = previewUrls.get(file);
    if (url) URL.revokeObjectURL(url);
    previewUrls.delete(file);
}

function removeAttachment(idx: number) {
    const file = attachments.value[idx];
    if (file) revokePreview(file);
    attachments.value = attachments.value.filter((_, i) => i !== idx);
}

function addFiles(files: File[]) {
    if (files.length === 0) return;
    attachments.value = [...attachments.value, ...files];
}

defineExpose({ addFiles });

function send() {
    const text = content.value.trim();
    if (!text && attachments.value.length === 0 && pendingStickers.value.length === 0) return;
    emit('send', {
        content: text,
        attachments: attachments.value.length ? attachments.value : undefined,
        stickerIds: pendingStickers.value.length ? pendingStickers.value.map(s => s.id) : undefined,
        reference: props.replyTo ?? null
    });
    if (editorRef.value) clearEditor(editorRef.value);
    content.value = '';
    cancelSuggestions();
    if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
    }
    clearDraft(props.channelId);
    for (const file of attachments.value) revokePreview(file);
    attachments.value = [];
    pendingStickers.value = [];
}

function onKeydown(event: KeyboardEvent) {
    if (suggestions.value.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            activeSuggestionIndex.value = (activeSuggestionIndex.value + 1) % suggestions.value.length;
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            activeSuggestionIndex.value = (activeSuggestionIndex.value - 1 + suggestions.value.length) % suggestions.value.length;
            return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            const item = suggestions.value[activeSuggestionIndex.value];
            if (item) applySuggestion(item.key);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelSuggestions();
            return;
        }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
    }
    // Shift+Enter falls through to the browser default, which inserts a <br>
    // that readEditorText already converts back to '\n'.
}

function namedClipboardFile(file: File): File {
    const ext = (file.type.split('/')[1] || 'png').toLowerCase();
    const looksGeneric = !file.name || file.name === 'image.png' || file.name === 'image';
    if (!looksGeneric) return file;
    return new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
}

function onPaste(event: ClipboardEvent) {
    const cd = event.clipboardData;
    if (!cd) return;
    const pasted: File[] = [];
    if (cd.files && cd.files.length > 0) {
        for (let i = 0; i < cd.files.length; i++) {
            const file = cd.files.item(i);
            if (file && file.type.startsWith('image/')) pasted.push(namedClipboardFile(file));
        }
    }
    if (pasted.length === 0 && cd.items) {
        for (let i = 0; i < cd.items.length; i++) {
            const item = cd.items[i];
            if (item.kind !== 'file') continue;
            const blob = item.getAsFile();
            if (!blob || !blob.type.startsWith('image/')) continue;
            pasted.push(namedClipboardFile(blob));
        }
    }
    if (pasted.length > 0) {
        event.preventDefault();
        attachments.value = [...attachments.value, ...pasted];
        return;
    }
    // Plain text paste — strip formatting and let buildEditorFragment turn any
    // raw `<@id>`/`<:name:id>` tokens into chips.
    const text = cd.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    const root = editorRef.value;
    if (!root) return;
    insertFragmentAtCursor(root, buildEditorFragment(text, codec));
    syncContentFromEditor();
    refreshSuggestions();
}

function stickerPreview(sticker: StickerRecent): string {
    return ctx.mediaProvider?.stickerUrl({ id: sticker.id, formatType: sticker.formatType }, 60) ?? '';
}

function onEditorInput() {
    syncContentFromEditor();
    scheduleDraftSave();
    refreshSuggestions();
}

onMounted(() => {
    loadDraftIntoEditor(props.channelId);
});

// Switching channels: flush the in-flight draft for the OLD channel
// (otherwise the timer fires after we've already moved on and tags it
// against the new one), then restore whatever we saved last time we
// were on the new channel.
watch(() => props.channelId, (newId, oldId) => {
    if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
    }
    if (oldId !== undefined) saveDraft(oldId, content.value);
    loadDraftIntoEditor(newId);
});
</script>

<template>
    <div class="composer" @paste="onPaste">
        <div v-if="replyTo" class="reply-banner">
            <span>{{ $t('messages.replying') }}</span>
            <button type="button" class="link" @click="$emit('cancel-reply')">{{ $t('common.cancel') }}</button>
        </div>
        <div v-if="attachments.length || pendingStickers.length" class="attachments">
            <div v-for="(file, idx) in attachments" :key="'f' + idx" :class="['chip', { 'image-chip': attachmentPreview(file) }]">
                <img v-if="attachmentPreview(file)" :src="attachmentPreview(file) ?? ''" :alt="file.name" class="chip-thumb" />
                <span class="chip-name">{{ file.name }}</span>
                <button type="button" @click="removeAttachment(idx)">×</button>
            </div>
            <div v-for="(sticker, idx) in pendingStickers" :key="'s' + sticker.id" class="chip sticker-chip">
                <img :src="stickerPreview(sticker)" :alt="sticker.name" class="sticker-thumb" />
                <span>{{ sticker.name }}</span>
                <button type="button" @click="removeSticker(idx)">×</button>
            </div>
        </div>
        <div v-if="suggestions.length" class="suggestions-pop">
            <ComposerSuggestions
                :items="suggestions"
                :active-index="activeSuggestionIndex"
                @select="applySuggestion"
                @hover="(idx) => (activeSuggestionIndex = idx)"
            />
        </div>
        <div class="input-row">
            <button type="button" class="icon-button" :disabled="disabled" @click="fileInput?.click()" :title="$t('composer.attach')" :aria-label="$t('composer.attach')">
                <Icon icon="material-symbols:add-2-rounded" width="20" height="20" />
            </button>
            <input ref="fileInput" type="file" multiple class="hidden" @change="onAttach" />
            <div
                ref="editorRef"
                :class="['editor', { disabled }]"
                contenteditable="true"
                role="textbox"
                aria-multiline="true"
                :data-placeholder="placeholder ?? $t('composer.placeholder')"
                :aria-disabled="disabled || undefined"
                @keydown="onKeydown"
                @input="onEditorInput"
                @click="refreshSuggestions"
                @keyup="refreshSuggestions"
                @blur="cancelSuggestions"
            />
            <MediaPickerPopover
                :visible="showPicker"
                placement="top-end"
                @update:visible="(v) => (showPicker = v)"
                @select="onMediaSelect"
            >
                <template #trigger>
                    <button type="button" class="icon-button" :disabled="disabled" :title="$t('composer.picker')" :aria-label="$t('composer.picker')">
                        <Icon icon="ic:round-emoji-emotions" width="20" height="20" />
                    </button>
                </template>
            </MediaPickerPopover>
            <button type="button" class="icon-button" :disabled="disabled" @click="send" :title="$t('composer.send')" :aria-label="$t('composer.send')">
                <Icon icon="material-symbols:send-rounded" width="20" height="20" />
            </button>
        </div>
    </div>
</template>

<style scoped>
.composer {
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    background: var(--bg-surface-2);
    color: var(--text);
    position: relative;
}
.reply-banner {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 0.25rem;
}
.link {
    background: none;
    border: none;
    color: var(--link-mask);
    cursor: pointer;
    padding: 0;
    font: inherit;
}
.attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.4rem;
}
.chip {
    display: inline-flex;
    gap: 0.25rem;
    align-items: center;
    background: var(--bg-surface-2);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.8rem;
}
.sticker-chip .sticker-thumb {
    width: 20px;
    height: 20px;
    object-fit: contain;
}
.chip-thumb {
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 3px;
}
.image-chip {
    padding: 3px 6px 3px 3px;
}
.chip-name {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chip button {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
}
.input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
}
.icon-button {
    background: none;
    border: none;
    border-radius: 4px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--text);
    transition: background-color 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.icon-button:hover:not(:disabled) {
    background: var(--bg-surface-hover);
}
.editor {
    flex: 1;
    min-height: 32px;
    max-height: 160px;
    overflow-y: auto;
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font: inherit;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    outline: none;
    cursor: text;
}
.editor.disabled {
    opacity: 0.6;
    pointer-events: none;
}
.editor:empty::before {
    content: attr(data-placeholder);
    color: var(--text-muted);
    pointer-events: none;
}
.editor :deep(.composer-token) {
    display: inline-flex;
    align-items: center;
    vertical-align: baseline;
    user-select: all;
    -webkit-user-select: all;
}
.editor :deep(.composer-mention) {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    padding: 0 4px;
    border-radius: 3px;
    font-weight: 500;
}
.editor :deep(.composer-emoji img) {
    height: 1.4em;
    width: auto;
    vertical-align: -0.25em;
}
.icon-button:disabled {
    opacity: 0.5;
    cursor: default;
}
.suggestions-pop {
    position: absolute;
    bottom: 100%;
    left: 0.5rem;
    right: 0.5rem;
    margin-bottom: 0.4rem;
    z-index: 5;
}
.hidden {
    display: none;
}
</style>
