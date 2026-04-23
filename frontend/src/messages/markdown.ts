import { parse } from 'discord-markdown-parser';

export interface ASTNode {
    type: string;
    [key: string]: unknown;
}

export function parseMessageContent(text: string): ASTNode[] {
    if (!text) return [];
    return parse(text, 'extended') as ASTNode[];
}
