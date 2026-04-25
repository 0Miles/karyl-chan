import { describe, it, expect } from 'vitest';
import type { MessageContext } from '../../libs/messages';
import { createDiscordComposerTokenCodec } from './composer-token-codec';

function emptyCtx(): MessageContext {
    return {};
}

function ctxWithResolvers(): MessageContext {
    return {
        resolveUser: (id) => id === '111111111111111111' ? { name: 'Alice' } : null,
        resolveRole: (id) => id === '222222222222222222' ? { name: 'Mods', color: '#ff0000' } : null,
        mediaProvider: {
            listEmojis: async () => [],
            listStickers: async () => [],
            loadLottieSticker: async () => null,
            stickerUrl: () => '',
            customEmojiUrl: ({ id }) => `https://cdn/${id}.png`
        }
    };
}

function applyTokenRe(re: RegExp, text: string): RegExpExecArray | null {
    re.lastIndex = 0;
    return re.exec(text);
}

describe('composer token regex', () => {
    it('matches a user mention', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const m = applyTokenRe(codec.tokenRe, '<@111111111111111111>');
        expect(m).not.toBeNull();
        expect(m![2]).toBe('111111111111111111');
    });

    it('matches a role mention', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const m = applyTokenRe(codec.tokenRe, '<@&222222222222222222>');
        expect(m).not.toBeNull();
        expect(m![1]).toBe('222222222222222222');
    });

    it('matches a static custom emoji', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const m = applyTokenRe(codec.tokenRe, '<:wave:333333333333333333>');
        expect(m).not.toBeNull();
        // m[3] = animated flag (undefined for static), m[4] = name, m[5] = id
        expect(m![3]).toBeUndefined();
        expect(m![4]).toBe('wave');
        expect(m![5]).toBe('333333333333333333');
    });

    it('matches an animated custom emoji', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const m = applyTokenRe(codec.tokenRe, '<a:dance:444444444444444444>');
        expect(m).not.toBeNull();
        expect(m![3]).toBe('a');
        expect(m![4]).toBe('dance');
        expect(m![5]).toBe('444444444444444444');
    });
});

describe('elementFromMatch', () => {
    it('builds a user mention chip with the resolved name', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<@111111111111111111>')!;
        const el = codec.elementFromMatch(m);
        expect(el.dataset.token).toBe('user');
        expect(el.dataset.id).toBe('111111111111111111');
        expect(el.textContent).toBe('@Alice');
        expect(el.contentEditable).toBe('false');
    });

    it('falls back to the id when the user resolver returns null', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const m = applyTokenRe(codec.tokenRe, '<@999999999999999999>')!;
        const el = codec.elementFromMatch(m);
        expect(el.textContent).toBe('@999999999999999999');
    });

    it('builds a role mention chip with the resolved color', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<@&222222222222222222>')!;
        const el = codec.elementFromMatch(m);
        expect(el.dataset.token).toBe('role');
        expect(el.textContent).toBe('@Mods');
        expect(el.style.color).toBe('rgb(255, 0, 0)');
    });

    it('builds a static custom emoji chip with an <img>', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<:wave:333333333333333333>')!;
        const el = codec.elementFromMatch(m);
        expect(el.dataset.token).toBe('custom-emoji');
        expect(el.dataset.animated).toBe('false');
        const img = el.querySelector('img');
        expect(img).not.toBeNull();
        expect(img!.src).toContain('333333333333333333');
        expect(img!.alt).toBe(':wave:');
    });

    it('builds an animated custom emoji chip with animated=true', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<a:dance:444444444444444444>')!;
        const el = codec.elementFromMatch(m);
        expect(el.dataset.animated).toBe('true');
    });

    it('falls back to text when no mediaProvider supplies a URL', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const m = applyTokenRe(codec.tokenRe, '<:wave:333333333333333333>')!;
        const el = codec.elementFromMatch(m);
        expect(el.querySelector('img')).toBeNull();
        expect(el.textContent).toBe(':wave:');
    });
});

describe('textFromElement (round-trip)', () => {
    it('user chip → "<@id>"', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<@111111111111111111>')!;
        const el = codec.elementFromMatch(m);
        expect(codec.textFromElement(el)).toBe('<@111111111111111111>');
    });

    it('role chip → "<@&id>"', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<@&222222222222222222>')!;
        const el = codec.elementFromMatch(m);
        expect(codec.textFromElement(el)).toBe('<@&222222222222222222>');
    });

    it('static custom emoji → "<:name:id>"', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<:wave:333333333333333333>')!;
        const el = codec.elementFromMatch(m);
        expect(codec.textFromElement(el)).toBe('<:wave:333333333333333333>');
    });

    it('animated custom emoji → "<a:name:id>"', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const m = applyTokenRe(codec.tokenRe, '<a:dance:444444444444444444>')!;
        const el = codec.elementFromMatch(m);
        expect(codec.textFromElement(el)).toBe('<a:dance:444444444444444444>');
    });

    it('returns null for an element without a known token type', () => {
        const codec = createDiscordComposerTokenCodec(emptyCtx());
        const span = document.createElement('span');
        span.textContent = 'plain';
        expect(codec.textFromElement(span)).toBeNull();
    });
});

describe('elementForCustomEmoji', () => {
    it('builds the same shape as the regex-driven path', () => {
        const codec = createDiscordComposerTokenCodec(ctxWithResolvers());
        const el = codec.elementForCustomEmoji({ id: '555555555555555555', name: 'pog', animated: true });
        expect(el.dataset.token).toBe('custom-emoji');
        expect(el.dataset.name).toBe('pog');
        expect(el.dataset.animated).toBe('true');
        expect(codec.textFromElement(el)).toBe('<a:pog:555555555555555555>');
    });
});
