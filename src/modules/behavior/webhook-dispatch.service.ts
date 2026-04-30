import {
  type APIMessage,
  type RESTPostAPIWebhookWithTokenJSONBody,
} from "discord.js";
import {
  assertExternalTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";
import {
  buildOutboundSignatureHeaders,
  verifyInboundSignature,
} from "../../utils/hmac.js";

/**
 * Sentinel that a downstream webhook returns in its response body when
 * it wants to terminate a continuous-forward session. Detected as a
 * standalone token inside `content` (case-insensitive). When found, we
 * strip the token before relaying the rest back to the user, so the
 * server can include human-readable text alongside the signal.
 */
export const BEHAVIOR_END_TOKEN = "[BEHAVIOR:END]";
const BEHAVIOR_END_RE = /\[BEHAVIOR:END\]/gi;

/**
 * HMAC headers exchanged in both directions when a behavior has a
 * webhookSecret configured.
 *
 *   X-Karyl-Timestamp     — unix epoch seconds (string), bound into the
 *                           signed payload to make replay attacks
 *                           infeasible inside a small acceptance window.
 *   X-Karyl-Signature     — v0 HMAC: `v0=<hex sha256>` (backward-compat).
 *   X-Karyl-Signature-V1  — v1 HMAC: `v1=<hex sha256>`, binds method +
 *                           URL path so cross-endpoint replay is blocked.
 *
 * Outbound: bot sends both headers so old receivers (v0 only) and
 * new receivers (v1 preferred) both validate correctly.
 * Inbound:  bot prefers X-Karyl-Signature-V1 if present, falls back to
 * X-Karyl-Signature (v0). Both must fail for the response to be rejected.
 */
export {
  SIGNATURE_HEADER,
  SIGNATURE_HEADER_V1,
  TIMESTAMP_HEADER,
} from "../../utils/hmac.js";

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

export interface DispatchOptions {
  /**
   * When set, sign the outgoing request and require a matching
   * signature on the response. NULL / undefined disables both.
   */
  secret?: string | null;
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
 *
 * When `options.secret` is set, the request is HMAC-signed (dual v0+v1)
 * and the response's signature is verified before the body is treated as
 * trusted. A signature failure surfaces as `{ ok: false }` with no
 * `relayContent`, so the user never sees forged content.
 */
export async function dispatchWebhook(
  webhookUrl: string,
  payload: RESTPostAPIWebhookWithTokenJSONBody,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  // Append wait=true so Discord returns the created message instead of
  // a 204 No Content. Preserves any pre-existing query string the URL
  // already carried (custom thread_id, etc.).
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return {
      ok: false,
      error: "invalid webhook URL",
      ended: false,
      relayContent: "",
    };
  }
  url.searchParams.set("wait", "true");

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const secret = options.secret;
  if (secret) {
    const sigHeaders = buildOutboundSignatureHeaders(
      secret,
      "POST",
      url.pathname,
      body,
    );
    Object.assign(headers, sigHeaders);
  }

  const webhookPort = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  try {
    await assertExternalTarget(url.hostname, webhookPort);
  } catch (err) {
    if (!(err instanceof HostPolicyError)) throw err;
    return { ok: false, error: err.message, ended: false, relayContent: "" };
  }

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `network error: ${msg}`,
      ended: false,
      relayContent: "",
    };
  }

  // Read the response body once as text so we can both verify the
  // signature against the exact bytes the server sent and parse it
  // as JSON. fetch's response body can only be consumed once.
  const rawText = await res.text().catch(() => "");

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: rawText ? rawText.slice(0, 500) : `HTTP ${res.status}`,
      ended: false,
      relayContent: "",
    };
  }

  if (secret) {
    const verdict = verifyInboundSignature(
      secret,
      res.headers,
      rawText,
      Math.floor(Date.now() / 1000),
      "POST",
      url.pathname,
    );
    if (!verdict.ok) {
      return {
        ok: false,
        status: res.status,
        error: verdict.reason,
        ended: false,
        relayContent: "",
      };
    }
  }

  let response: APIMessage | undefined;
  if (rawText.length > 0) {
    try {
      response = JSON.parse(rawText) as APIMessage;
    } catch {
      // wait=true should always return JSON on success, but tolerate a
      // misbehaving webhook server that returns text — treat as a
      // successful POST with no relayable content.
      return { ok: true, ended: false, relayContent: "" };
    }
  }

  const rawContent =
    typeof response?.content === "string" ? response.content : "";
  const ended = BEHAVIOR_END_RE.test(rawContent);
  // Reset the global regex's lastIndex; .test() advances it on /g
  // patterns and would mis-match on the next call otherwise.
  BEHAVIOR_END_RE.lastIndex = 0;
  const relayContent = ended
    ? rawContent.replace(BEHAVIOR_END_RE, "").trim()
    : rawContent.trim();

  return { ok: true, response, ended, relayContent };
}
