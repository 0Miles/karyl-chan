import { parse } from 'discord-markdown-parser';

export interface ASTNode {
    type: string;
    [key: string]: unknown;
}

/**
 * discord-markdown-parser (built on simple-markdown) raises a numeric
 * SyntaxError code (e.g. `SyntaxError: 10`) on certain inputs — usually
 * messages with malformed markdown sequences (unbalanced code blocks,
 * stray tokens, etc.). One bad message in the timeline used to crash the
 * whole MessagesPage at mount because Vue render swallows nothing.
 *
 * Defensive try/catch: a single un-parseable message degrades to a
 * plain-text node instead of taking the page down. The console.warn
 * keeps the failure visible during development without spamming users.
 */
export function parseMessageContent(text: string): ASTNode[] {
    if (!text) return [];
    try {
        return parse(text, 'extended') as ASTNode[];
    } catch (err) {
        if (typeof console !== 'undefined') {
            // eslint-disable-next-line no-console
            console.warn('[markdown] parse failed, falling back to plain text:', err, text.slice(0, 200));
        }
        return [{ type: 'text', content: text } as ASTNode];
    }
}
