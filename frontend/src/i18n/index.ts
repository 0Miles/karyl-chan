import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';
import zhCN from './locales/zh-CN.json';

export const SUPPORTED_LOCALES = ['en', 'zh-TW', 'zh-CN'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Map an arbitrary BCP-47 tag (navigator.language / languages[i]) to one of
 * our supported locales. We honor script subtags (Hant/Hans) before falling
 * back to region heuristics (TW/HK → zh-TW; CN/SG → zh-CN).
 */
export function resolveLocale(tag: string | null | undefined): SupportedLocale | null {
    if (!tag) return null;
    const normalized = tag.toLowerCase();
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
    if (normalized.startsWith('zh')) {
        if (normalized.includes('hant')) return 'zh-TW';
        if (normalized.includes('hans')) return 'zh-CN';
        if (/-(tw|hk|mo)\b/.test(normalized)) return 'zh-TW';
        if (/-(cn|sg|my)\b/.test(normalized)) return 'zh-CN';
        // Bare "zh" — default to Simplified since it's the more common form in
        // environments that don't send a region subtag.
        return 'zh-CN';
    }
    return null;
}

/** Detect the best match for the user's system language. */
export function detectSystemLocale(): SupportedLocale {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
    const candidates = [...(navigator.languages ?? []), navigator.language];
    for (const tag of candidates) {
        const resolved = resolveLocale(tag);
        if (resolved) return resolved;
    }
    return DEFAULT_LOCALE;
}

export const i18n = createI18n({
    legacy: false,
    locale: detectSystemLocale(),
    fallbackLocale: DEFAULT_LOCALE,
    messages: {
        'en': en,
        'zh-TW': zhTW,
        'zh-CN': zhCN
    }
});

export function setLocale(locale: SupportedLocale): void {
    i18n.global.locale.value = locale;
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

if (typeof document !== 'undefined') {
    document.documentElement.lang = i18n.global.locale.value;
}
