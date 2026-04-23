import { parse as parseTwemoji } from '@twemoji/parser';

export function twemojiUrl(emoji: string, assetType: 'svg' | 'png' = 'svg'): string | null {
    const entities = parseTwemoji(emoji, { assetType });
    return entities[0]?.url ?? null;
}
