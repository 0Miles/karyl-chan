import { ref, watch } from 'vue';

export type EmojiRecent =
    | { kind: 'unicode'; value: string }
    | { kind: 'custom'; id: string; name: string; animated: boolean };

export interface StickerRecent {
    id: string;
    name: string;
    formatType: number;
}

const EMOJI_KEY = 'karyl-emoji-recents';
const STICKER_KEY = 'karyl-sticker-recents';
const CAP = 30;

function load<T>(key: string): T[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
        return [];
    }
}

function save<T>(key: string, value: T[]): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage unavailable; recents stay session-only.
    }
}

const emojiRecents = ref<EmojiRecent[]>(load<EmojiRecent>(EMOJI_KEY));
const stickerRecents = ref<StickerRecent[]>(load<StickerRecent>(STICKER_KEY));

watch(emojiRecents, value => save(EMOJI_KEY, value), { deep: true });
watch(stickerRecents, value => save(STICKER_KEY, value), { deep: true });

function emojiKey(entry: EmojiRecent): string {
    return entry.kind === 'unicode' ? `u:${entry.value}` : `c:${entry.id}`;
}

export function pushEmojiRecent(entry: EmojiRecent): void {
    const key = emojiKey(entry);
    const filtered = emojiRecents.value.filter(e => emojiKey(e) !== key);
    emojiRecents.value = [entry, ...filtered].slice(0, CAP);
}

export function pushStickerRecent(entry: StickerRecent): void {
    const filtered = stickerRecents.value.filter(s => s.id !== entry.id);
    stickerRecents.value = [entry, ...filtered].slice(0, CAP);
}

export function useEmojiRecents() { return emojiRecents; }
export function useStickerRecents() { return stickerRecents; }
