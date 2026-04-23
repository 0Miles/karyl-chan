/**
 * Pluggable codec the composer uses to translate between canonical chat text
 * (platform-specific token syntax like Discord's `<@id>`) and inline DOM chips.
 * Platforms register their own codec via `MessageContext.composerTokenCodec`.
 */
export interface ComposerTokenCodec {
    /** Global regex that matches every recognized token in canonical text. */
    tokenRe: RegExp;
    /** Build the inline chip element for a `tokenRe` match. */
    elementFromMatch(match: RegExpExecArray): HTMLElement;
    /** Return the canonical text for a chip element, or null if `el` isn't one. */
    textFromElement(el: HTMLElement): string | null;
    /** Build a chip for a custom-emoji selection coming from the media picker. */
    elementForCustomEmoji(sel: { id: string; name: string; animated: boolean }): HTMLElement;
}

/** Convert canonical text into a DOM fragment with token chips. */
export function buildEditorFragment(text: string, codec: ComposerTokenCodec): DocumentFragment {
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    codec.tokenRe.lastIndex = 0;
    while ((m = codec.tokenRe.exec(text))) {
        if (m.index > last) {
            frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        frag.appendChild(codec.elementFromMatch(m));
        last = m.index + m[0].length;
    }
    if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
    }
    return frag;
}

/** Walk the DOM and rebuild the canonical text representation. */
export function readEditorText(root: HTMLElement, codec: ComposerTokenCodec): string {
    let out = '';
    function walk(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            out += (node as Text).data;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        if (el.tagName === 'BR') { out += '\n'; return; }
        const canonical = codec.textFromElement(el);
        if (canonical !== null) { out += canonical; return; }
        for (const child of Array.from(el.childNodes)) walk(child);
    }
    for (const child of Array.from(root.childNodes)) walk(child);
    return out;
}

/** Returns true if the cursor sits in a text node that's an editor descendant. */
export function isCursorInEditor(root: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    return root.contains(sel.getRangeAt(0).startContainer);
}

/**
 * Get the text leading up to the cursor within the current text node only.
 * Tokens are atomic siblings, so trigger detection only needs to consider
 * the contiguous text the user is typing.
 */
export function getTextBeforeCursor(root: HTMLElement): { text: string; cursor: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
    const text = (range.startContainer as Text).data;
    const cursor = range.startOffset;
    return { text, cursor };
}

export function insertFragmentAtCursor(root: HTMLElement, fragment: DocumentFragment) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
        root.appendChild(fragment);
        return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const lastChild = fragment.lastChild;
    range.insertNode(fragment);
    if (lastChild) {
        const after = document.createRange();
        after.setStartAfter(lastChild);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
    }
}

/**
 * If the cursor sits immediately before a token chip, replace the chip with
 * its raw canonical text and place the cursor at the end of it. Returns true
 * if a token was unwrapped — callers should preventDefault so the trigger key
 * (`\`) isn't also inserted.
 */
export function unwrapNextTokenAtCursor(root: HTMLElement, codec: ComposerTokenCodec): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    if (!root.contains(range.startContainer)) return false;
    let nextNode: Node | null;
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = range.startContainer as Text;
        if (range.startOffset < text.data.length) return false;
        nextNode = text.nextSibling;
    } else {
        nextNode = range.startContainer.childNodes[range.startOffset] ?? null;
    }
    if (!nextNode || nextNode.nodeType !== Node.ELEMENT_NODE) return false;
    const el = nextNode as HTMLElement;
    const canonical = codec.textFromElement(el);
    if (canonical === null) return false;
    const textNode = document.createTextNode(canonical);
    el.parentNode?.replaceChild(textNode, el);
    const after = document.createRange();
    after.setStart(textNode, canonical.length);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    return true;
}

/** Delete N characters backward from the cursor within the current text node. */
export function deleteBackwardChars(n: number) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || n <= 0) return;
    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return;
    const newOffset = Math.max(0, range.startOffset - n);
    range.setStart(range.startContainer, newOffset);
    range.deleteContents();
}

export function setEditorContent(root: HTMLElement, text: string, codec: ComposerTokenCodec) {
    while (root.firstChild) root.removeChild(root.firstChild);
    if (text) root.appendChild(buildEditorFragment(text, codec));
}

export function clearEditor(root: HTMLElement) {
    while (root.firstChild) root.removeChild(root.firstChild);
}

export function focusEditorEnd(root: HTMLElement) {
    root.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}
