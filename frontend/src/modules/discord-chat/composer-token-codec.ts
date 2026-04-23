import type { ComposerTokenCodec, MessageContext } from '../../libs/messages';

const TOKEN_RE = /<@(\d+)>|<(a)?:([\w-]+):(\d+)>/g;

function makeMentionElement(id: string, ctx: MessageContext): HTMLElement {
    const span = document.createElement('span');
    span.className = 'composer-token composer-mention';
    span.contentEditable = 'false';
    span.dataset.token = 'user';
    span.dataset.id = id;
    const resolved = ctx.resolveUser?.(id);
    span.textContent = `@${resolved?.name ?? id}`;
    return span;
}

function makeCustomEmojiElement(id: string, name: string, animated: boolean, ctx: MessageContext): HTMLElement {
    const span = document.createElement('span');
    span.className = 'composer-token composer-emoji';
    span.contentEditable = 'false';
    span.dataset.token = 'custom-emoji';
    span.dataset.id = id;
    span.dataset.name = name;
    span.dataset.animated = animated ? 'true' : 'false';
    const url = ctx.mediaProvider?.customEmojiUrl({ id, animated, name }, 32);
    if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = `:${name}:`;
        img.draggable = false;
        span.appendChild(img);
    } else {
        span.textContent = `:${name}:`;
    }
    return span;
}

export function createDiscordComposerTokenCodec(ctx: MessageContext): ComposerTokenCodec {
    return {
        tokenRe: TOKEN_RE,
        elementFromMatch(m) {
            if (m[1]) return makeMentionElement(m[1], ctx);
            return makeCustomEmojiElement(m[4], m[3], m[2] === 'a', ctx);
        },
        textFromElement(el) {
            if (el.dataset.token === 'user') return `<@${el.dataset.id}>`;
            if (el.dataset.token === 'custom-emoji') {
                const a = el.dataset.animated === 'true' ? 'a' : '';
                return `<${a}:${el.dataset.name}:${el.dataset.id}>`;
            }
            return null;
        },
        elementForCustomEmoji(sel) {
            return makeCustomEmojiElement(sel.id, sel.name, sel.animated, ctx);
        }
    };
}
