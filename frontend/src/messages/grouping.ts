import type { Message } from './types';

const DEFAULT_GROUP_WINDOW_MS = 5 * 60 * 1000;

export function isContinuation(prev: Message | undefined, curr: Message, windowMs: number = DEFAULT_GROUP_WINDOW_MS): boolean {
    if (!prev) return false;
    if (prev.author.id !== curr.author.id) return false;
    if (curr.referencedMessage) return false;
    const diff = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
    return diff >= 0 && diff <= windowMs;
}
