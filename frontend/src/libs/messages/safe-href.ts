/**
 * Reject any URL whose scheme isn't `http:` or `https:`.
 *
 * Anything from the Discord wire format (embed urls, attachment urls,
 * markdown autolinks) and anything that came from a plugin manifest
 * (homepage, support link, …) reaches the DOM as an `<a href>` /
 * `window.open` target. A `javascript:` href executes in the admin
 * origin and trivially exfiltrates the access token, so every such
 * binding must funnel through here. Mail and other schemes are
 * intentionally rejected too — the admin chat surface only needs web
 * links; if a real use case for `mailto:` etc. comes up later, add the
 * scheme to the allowlist explicitly.
 *
 * Returns an empty string (renders as a dead, but harmless, anchor)
 * for null/empty/un-parseable/non-http inputs.
 */
export function safeHref(url: string | null | undefined): string {
    if (!url) return '';
    let parsed: URL;
    try {
        parsed = new URL(url, window.location.href);
    } catch {
        return '';
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
}
