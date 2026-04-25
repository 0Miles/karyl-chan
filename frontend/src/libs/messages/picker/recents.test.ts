import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import {
    pushEmojiRecent,
    pushStickerRecent,
    useEmojiRecents,
    useStickerRecents,
    type EmojiRecent
} from './recents';

beforeEach(() => {
    localStorage.clear();
    // The recents refs are module-level singletons; reset their
    // contents so cases don't bleed into each other.
    useEmojiRecents().value = [];
    useStickerRecents().value = [];
});

describe('emoji recents', () => {
    it('push prepends a unicode emoji', () => {
        pushEmojiRecent({ kind: 'unicode', value: '👍' });
        expect(useEmojiRecents().value).toEqual([{ kind: 'unicode', value: '👍' }]);
    });

    it('push prepends a custom emoji', () => {
        pushEmojiRecent({ kind: 'custom', id: '1', name: 'wave', animated: false });
        expect(useEmojiRecents().value).toEqual([{ kind: 'custom', id: '1', name: 'wave', animated: false }]);
    });

    it('dedups: re-pushing the same unicode emoji moves it to the front', () => {
        pushEmojiRecent({ kind: 'unicode', value: '👍' });
        pushEmojiRecent({ kind: 'unicode', value: '😀' });
        pushEmojiRecent({ kind: 'unicode', value: '👍' });
        expect(useEmojiRecents().value).toEqual([
            { kind: 'unicode', value: '👍' },
            { kind: 'unicode', value: '😀' }
        ]);
    });

    it('dedups custom emoji by id (not by name)', () => {
        pushEmojiRecent({ kind: 'custom', id: '1', name: 'wave', animated: false });
        // Same id, different name — should still dedup.
        pushEmojiRecent({ kind: 'custom', id: '1', name: 'renamed-wave', animated: false });
        expect(useEmojiRecents().value).toHaveLength(1);
        expect(useEmojiRecents().value[0].kind).toBe('custom');
        expect((useEmojiRecents().value[0] as Extract<EmojiRecent, { kind: 'custom' }>).name).toBe('renamed-wave');
    });

    it('caps at 30 entries (oldest fall off)', () => {
        for (let i = 0; i < 35; i++) pushEmojiRecent({ kind: 'unicode', value: `e${i}` });
        const list = useEmojiRecents().value;
        expect(list).toHaveLength(30);
        // Newest first → e34 at the head, e5 at the tail.
        expect((list[0] as Extract<EmojiRecent, { kind: 'unicode' }>).value).toBe('e34');
        expect((list[29] as Extract<EmojiRecent, { kind: 'unicode' }>).value).toBe('e5');
    });

    it('persists changes to localStorage', async () => {
        pushEmojiRecent({ kind: 'unicode', value: '🎉' });
        // The watch is async — wait a tick for the write.
        await nextTick();
        const raw = localStorage.getItem('karyl-emoji-recents');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        expect(parsed[0]).toEqual({ kind: 'unicode', value: '🎉' });
    });
});

describe('sticker recents', () => {
    it('push prepends a sticker', () => {
        pushStickerRecent({ id: 's-1', name: 'pog', formatType: 1 });
        expect(useStickerRecents().value).toEqual([{ id: 's-1', name: 'pog', formatType: 1 }]);
    });

    it('dedups by id, moving the existing entry to the front', () => {
        pushStickerRecent({ id: 's-1', name: 'pog', formatType: 1 });
        pushStickerRecent({ id: 's-2', name: 'sad', formatType: 1 });
        pushStickerRecent({ id: 's-1', name: 'pog', formatType: 1 });
        const list = useStickerRecents().value;
        expect(list.map(s => s.id)).toEqual(['s-1', 's-2']);
    });

    it('caps at 30', () => {
        for (let i = 0; i < 35; i++) pushStickerRecent({ id: `s-${i}`, name: `n${i}`, formatType: 1 });
        expect(useStickerRecents().value).toHaveLength(30);
        expect(useStickerRecents().value[0].id).toBe('s-34');
    });

    it('persists changes to localStorage', async () => {
        pushStickerRecent({ id: 's-1', name: 'pog', formatType: 1 });
        await nextTick();
        const raw = localStorage.getItem('karyl-sticker-recents');
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)[0]).toMatchObject({ id: 's-1' });
    });
});
