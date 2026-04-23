export interface UnicodeEntry {
    id: string;
    native: string;
    name: string;
    keywords: string[];
}

export interface UnicodeCategory {
    id: string;
    emojis: UnicodeEntry[];
}

export interface UnicodeEmojiData {
    categories: UnicodeCategory[];
    all: UnicodeEntry[];
}

interface RawEmojiMart {
    categories: { id: string; emojis: string[] }[];
    emojis: Record<string, { id: string; name: string; keywords: string[]; skins: { native: string }[] }>;
}

// Module-level cache — parsed result is shared across every MediaPicker mount.
let cached: UnicodeEmojiData | null = null;
let loadPromise: Promise<UnicodeEmojiData> | null = null;

function parse(data: RawEmojiMart): UnicodeEmojiData {
    const all: UnicodeEntry[] = [];
    const categories = data.categories.map(cat => {
        const emojis: UnicodeEntry[] = [];
        for (const id of cat.emojis) {
            const e = data.emojis[id];
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
    return { categories, all };
}

export function getCachedUnicodeEmojiData(): UnicodeEmojiData | null {
    return cached;
}

export function loadUnicodeEmojiData(): Promise<UnicodeEmojiData> {
    if (cached) return Promise.resolve(cached);
    if (!loadPromise) {
        loadPromise = import('@emoji-mart/data')
            .then(m => {
                const parsed = parse(m.default as RawEmojiMart);
                cached = parsed;
                return parsed;
            })
            .catch((err) => {
                loadPromise = null;
                throw err;
            });
    }
    return loadPromise;
}
