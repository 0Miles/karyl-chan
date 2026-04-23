<script lang="ts">
import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import MentionChip from './MentionChip.vue';
import { defaultContext, useMessageContext, type MessageContext } from './context';
import { twemojiUrl } from './twemoji';
import type { ASTNode } from './markdown';

type Renderable = VNode | string;

function renderChildren(children: unknown, ctx: MessageContext): Renderable[] {
    if (typeof children === 'string') return [children];
    if (!Array.isArray(children)) return [];
    return children.map(child => renderNode(child as ASTNode, ctx));
}

function renderTimestamp(ts: string, format: string | undefined): VNode {
    const date = new Date(Number(ts) * 1000);
    const valid = !Number.isNaN(date.getTime());
    const display = valid ? formatTimestamp(date, format) : ts;
    return h('time', { class: 'timestamp', datetime: valid ? date.toISOString() : undefined }, display);
}

function formatTimestamp(date: Date, format: string | undefined): string {
    switch (format) {
        case 't': return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case 'T': return date.toLocaleTimeString();
        case 'd': return date.toLocaleDateString();
        case 'D': return date.toLocaleDateString([], { dateStyle: 'long' });
        case 'F': return date.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
        case 'R': return relativeTime(date);
        case 'f':
        default: return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
}

function relativeTime(date: Date): string {
    const diffMs = date.getTime() - Date.now();
    const abs = Math.abs(diffMs);
    const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (abs < 60_000) return fmt.format(Math.round(diffMs / 1000), 'second');
    if (abs < 3_600_000) return fmt.format(Math.round(diffMs / 60_000), 'minute');
    if (abs < 86_400_000) return fmt.format(Math.round(diffMs / 3_600_000), 'hour');
    return fmt.format(Math.round(diffMs / 86_400_000), 'day');
}

function renderNode(node: ASTNode, ctx: MessageContext): Renderable {
    switch (node.type) {
        case 'text':
            return String(node.content ?? '');
        case 'br':
        case 'newline':
            return h('br');
        case 'escape':
            return Array.isArray(node.content) ? h('span', renderChildren(node.content, ctx)) : String(node.content ?? '');
        case 'em':
            return h('em', renderChildren(node.content, ctx));
        case 'strong':
            return h('strong', renderChildren(node.content, ctx));
        case 'underline':
            return h('u', renderChildren(node.content, ctx));
        case 'strikethrough':
            return h('s', renderChildren(node.content, ctx));
        case 'inlineCode':
            return h('code', { class: 'inline-code' }, String(node.content ?? ''));
        case 'codeBlock':
            return h('pre', { class: 'code-block', 'data-lang': String(node.lang ?? '') }, [
                h('code', String(node.content ?? ''))
            ]);
        case 'blockQuote':
            return h('blockquote', { class: 'block-quote' }, renderChildren(node.content, ctx));
        case 'heading':
            return h(`h${Math.min(3, Math.max(1, Number(node.level ?? 1)))}`, { class: 'heading' }, renderChildren(node.content, ctx));
        case 'subtext':
            return h('small', { class: 'subtext' }, renderChildren(node.content, ctx));
        case 'spoiler':
            return h(SpoilerSpan, null, () => renderChildren(node.content, ctx));
        case 'autolink':
        case 'url':
        case 'link': {
            const target = String(node.target ?? '');
            return h('a', {
                href: target,
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'link'
            }, renderChildren(node.content, ctx));
        }
        case 'user':
            return h(MentionChip, { kind: 'user', id: String(node.id) });
        case 'channel':
            return h(MentionChip, { kind: 'channel', id: String(node.id) });
        case 'role':
            return h(MentionChip, { kind: 'role', id: String(node.id) });
        case 'everyone':
            return h(MentionChip, { kind: 'everyone' });
        case 'here':
            return h(MentionChip, { kind: 'here' });
        case 'slashCommand':
            return h(MentionChip, { kind: 'slashCommand', name: String(node.name ?? '') });
        case 'guildNavigation':
            return h('span', { class: 'guild-navigation' }, `<${String(node.navigation ?? 'navigation')}>`);
        case 'timestamp':
            return renderTimestamp(String(node.timestamp ?? ''), node.format ? String(node.format) : undefined);
        case 'emoji': {
            const resolver = ctx.resolveCustomEmoji ?? defaultContext.resolveCustomEmoji;
            const meta = resolver(String(node.id), !!node.animated, String(node.name ?? ''));
            return h('img', { src: meta.url, alt: meta.alt, class: 'custom-emoji', loading: 'lazy' });
        }
        case 'twemoji': {
            const url = twemojiUrl(String(node.name ?? ''));
            if (!url) return String(node.name ?? '');
            return h('img', { src: url, alt: String(node.name ?? ''), class: 'unicode-emoji', loading: 'lazy' });
        }
        case 'emoticon':
            return Array.isArray(node.content) ? h('span', renderChildren(node.content, ctx)) : String(node.content ?? '');
        default:
            return Array.isArray(node.content) ? h('span', renderChildren(node.content, ctx)) : String(node.content ?? '');
    }
}

const SpoilerSpan = defineComponent({
    name: 'SpoilerSpan',
    setup(_, { slots }) {
        const revealed = ref(false);
        return () => h('span', {
            class: ['spoiler', { revealed: revealed.value }],
            onClick: () => { revealed.value = true; }
        }, slots.default?.());
    }
});

function isOnlyEmoji(nodes: ASTNode[]): boolean {
    let hasEmoji = false;
    for (const node of nodes) {
        if (node.type === 'emoji' || node.type === 'twemoji') {
            hasEmoji = true;
            continue;
        }
        if (node.type === 'text' && typeof node.content === 'string' && node.content.trim() === '') continue;
        if (node.type === 'newline' || node.type === 'br') continue;
        return false;
    }
    return hasEmoji;
}

export default defineComponent({
    name: 'MessageContent',
    props: {
        nodes: { type: Array as PropType<ASTNode[]>, required: true }
    },
    setup(props) {
        const ctx = useMessageContext();
        return () => h('div', {
            class: ['message-content', { 'only-emoji': isOnlyEmoji(props.nodes) }]
        }, props.nodes.map(n => renderNode(n, ctx)));
    }
});
</script>

<style scoped>
.message-content {
    line-height: 1.4;
    word-break: break-word;
}
.message-content :deep(.inline-code) {
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.9em;
}
.message-content :deep(.code-block) {
    background: var(--code-bg);
    padding: 0.6rem 0.8rem;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.85rem;
    overflow-x: auto;
    margin: 0.4rem 0;
}
.message-content :deep(.block-quote) {
    border-left: 3px solid var(--quote-border);
    padding-left: 0.75rem;
    margin: 0.2rem 0;
    color: var(--quote-text);
}
.message-content :deep(.heading) {
    font-weight: 600;
    margin: 0.4rem 0 0.2rem;
}
.message-content :deep(.subtext) {
    color: var(--text-muted);
    font-size: 0.85em;
}
.message-content :deep(.link) {
    color: var(--link-mask);
    text-decoration: underline;
}
.message-content :deep(.unicode-emoji),
.message-content :deep(.custom-emoji) {
    width: 2.4em;
    height: 2.4em;
    vertical-align: middle;
    display: inline-block;
}
.message-content.only-emoji :deep(.unicode-emoji),
.message-content.only-emoji :deep(.custom-emoji) {
    width: 3em;
    height: 3em;
}
.message-content :deep(.spoiler) {
    background: var(--spoiler-bg);
    color: transparent;
    border-radius: 3px;
    padding: 0 2px;
    cursor: pointer;
    transition: background 0.15s ease;
}
.message-content :deep(.spoiler.revealed) {
    background: var(--spoiler-revealed-bg);
    color: inherit;
    cursor: default;
}
.message-content :deep(.timestamp) {
    background: var(--code-bg);
    border-radius: 3px;
    padding: 0 4px;
}
.message-content :deep(.guild-navigation) {
    color: var(--accent-text);
    font-weight: 500;
}
</style>
