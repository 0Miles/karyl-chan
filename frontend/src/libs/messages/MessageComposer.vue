<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import MediaPicker, { type MediaSelection } from './picker/MediaPicker.vue';
import type { StickerRecent } from './picker/recents';
import type { OutgoingMessage, MessageReference } from './types';

const props = defineProps<{
    placeholder?: string;
    replyTo?: MessageReference | null;
    disabled?: boolean;
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
const textArea = ref<HTMLTextAreaElement | null>(null);
const pickerWrap = ref<HTMLDivElement | null>(null);
const pickerButton = ref<HTMLButtonElement | null>(null);

function onDocumentMousedown(event: MouseEvent) {
    if (!showPicker.value) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (pickerWrap.value?.contains(target)) return;
    if (pickerButton.value?.contains(target)) return;
    showPicker.value = false;
}

watch(showPicker, (open) => {
    if (open) document.addEventListener('mousedown', onDocumentMousedown);
    else document.removeEventListener('mousedown', onDocumentMousedown);
});

onUnmounted(() => {
    document.removeEventListener('mousedown', onDocumentMousedown);
});

const stickerLimitReached = computed(() => pendingStickers.value.length >= 3);

function onMediaSelect(selection: MediaSelection) {
    if (selection.type === 'sticker') {
        if (stickerLimitReached.value) return;
        // If the operator hasn't typed or attached anything yet, send the
        // sticker on its own immediately (Discord's behaviour).
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
    const text = selection.type === 'unicode'
        ? selection.value
        : `<${selection.animated ? 'a' : ''}:${selection.name}:${selection.id}>`;
    insertAtCursor(text);
    textArea.value?.focus();
}

function removeSticker(idx: number) {
    pendingStickers.value = pendingStickers.value.filter((_, i) => i !== idx);
}

function insertAtCursor(text: string) {
    const ta = textArea.value;
    if (!ta) {
        content.value += text;
        return;
    }
    const start = ta.selectionStart ?? content.value.length;
    const end = ta.selectionEnd ?? content.value.length;
    content.value = content.value.slice(0, start) + text + content.value.slice(end);
    requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + text.length;
    });
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
    content.value = '';
    for (const file of attachments.value) revokePreview(file);
    attachments.value = [];
    pendingStickers.value = [];
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
    }
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
    if (pasted.length === 0) return;
    event.preventDefault();
    attachments.value = [...attachments.value, ...pasted];
}

import { useMessageContext } from './context';
const composerCtx = useMessageContext();

function stickerPreview(sticker: StickerRecent): string {
    return composerCtx.mediaProvider?.stickerUrl({ id: sticker.id, formatType: sticker.formatType }, 60) ?? '';
}
</script>

<template>
    <div class="composer" @paste="onPaste">
        <div v-if="replyTo" class="reply-banner">
            <span>Replying</span>
            <button type="button" class="link" @click="$emit('cancel-reply')">Cancel</button>
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
        <div class="input-row">
            <button type="button" class="icon-button" :disabled="disabled" @click="fileInput?.click()" title="Attach files">+</button>
            <input ref="fileInput" type="file" multiple class="hidden" @change="onAttach" />
            <textarea
                ref="textArea"
                v-model="content"
                :placeholder="placeholder ?? 'Message…'"
                :disabled="disabled"
                rows="1"
                class="textarea"
                @keydown="onKeydown"
            />
            <button ref="pickerButton" type="button" class="icon-button" :disabled="disabled" @click="showPicker = !showPicker" title="Emoji & stickers">😊</button>
            <button type="button" class="send" :disabled="disabled" @click="send">Send</button>
        </div>
        <div v-if="showPicker" ref="pickerWrap" class="picker-pop">
            <MediaPicker @select="onMediaSelect" />
        </div>
    </div>
</template>

<style scoped>
.composer {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    background: var(--bg-surface);
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
    border: 1px solid var(--border);
    border-radius: 4px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    flex-shrink: 0;
    color: var(--text);
}
.icon-button:hover:not(:disabled) {
    background: var(--bg-surface-2);
}
.textarea {
    flex: 1;
    resize: vertical;
    min-height: 32px;
    max-height: 160px;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.send {
    padding: 0 0.9rem;
    height: 32px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
}
.send:disabled,
.icon-button:disabled {
    opacity: 0.5;
    cursor: default;
}
.picker-pop {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 0.35rem;
    z-index: 10;
}
.hidden {
    display: none;
}
</style>
