import {
    type APIMessage,
    type RESTPostAPIWebhookWithTokenJSONBody
} from 'discord.js';

/**
 * Sentinel that a downstream webhook returns in its response body when
 * it wants to terminate a continuous-forward session. Detected as a
 * standalone token inside `content` (case-insensitive). When found, we
 * strip the token before relaying the rest back to the user, so the
 * server can include human-readable text alongside the signal.
 */
export const BEHAVIOR_END_TOKEN = '[BEHAVIOR:END]';
const BEHAVIOR_END_RE = /\[BEHAVIOR:END\]/gi;

export interface DispatchResult {
    ok: boolean;
    /** HTTP status when ok=false; undefined when network error or ok=true. */
    status?: number;
    /** Short error description for telemetry/UI; only set when ok=false. */
    error?: string;
    /** Decoded webhook reply when ok=true; undefined when wait=false skipped. */
    response?: APIMessage;
    /**
     * True when the response body carried the [BEHAVIOR:END] sentinel.
     * Caller should tear down the session in this case.
     */
    ended: boolean;
    /**
     * `response.content` with [BEHAVIOR:END] tokens stripped. Already
     * trimmed; safe to relay verbatim to the user. Empty string when
     * the response had no usable content.
     */
    relayContent: string;
}

/**
 * POST a Discord-shaped webhook payload to the given URL with
 * `?wait=true` so we receive the resulting `APIMessage` in the same
 * round-trip. Returns a normalized result the event handler can act on.
 *
 * No retries: the caller (DM event handler) decides whether to surface
 * a failure to the user or quietly drop. Webhook URLs that return 4xx
 * usually indicate operator misconfiguration; surfacing the first
 * failure quickly is more useful than silently retrying.
 */
export async function dispatchWebhook(
    webhookUrl: string,
    payload: RESTPostAPIWebhookWithTokenJSONBody
): Promise<DispatchResult> {
    // Append wait=true so Discord returns the created message instead of
    // a 204 No Content. Preserves any pre-existing query string the URL
    // already carried (custom thread_id, etc.).
    let url: URL;
    try {
        url = new URL(webhookUrl);
    } catch {
        return { ok: false, error: 'invalid webhook URL', ended: false, relayContent: '' };
    }
    url.searchParams.set('wait', 'true');

    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network error: ${msg}`, ended: false, relayContent: '' };
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
            ok: false,
            status: res.status,
            error: text ? text.slice(0, 500) : `HTTP ${res.status}`,
            ended: false,
            relayContent: ''
        };
    }

    let response: APIMessage | undefined;
    try {
        response = (await res.json()) as APIMessage;
    } catch {
        // wait=true should always return JSON on success, but tolerate a
        // misbehaving webhook server that returns text — treat as a
        // successful POST with no relayable content.
        return { ok: true, ended: false, relayContent: '' };
    }

    const rawContent = typeof response.content === 'string' ? response.content : '';
    const ended = BEHAVIOR_END_RE.test(rawContent);
    // Reset the global regex's lastIndex; .test() advances it on /g
    // patterns and would mis-match on the next call otherwise.
    BEHAVIOR_END_RE.lastIndex = 0;
    const relayContent = ended
        ? rawContent.replace(BEHAVIOR_END_RE, '').trim()
        : rawContent.trim();

    return { ok: true, response, ended, relayContent };
}
