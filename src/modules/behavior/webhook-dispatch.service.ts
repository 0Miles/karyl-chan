import { createHmac, timingSafeEqual } from "crypto";
import {
  type APIMessage,
  type RESTPostAPIWebhookWithTokenJSONBody,
} from "discord.js";

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
 *   X-Karyl-Timestamp  — unix epoch seconds (string), bound into the
 *                        signed payload to make replay attacks
 *                        infeasible inside a small acceptance window.
 *   X-Karyl-Signature  — versioned HMAC: `v0=<hex sha256>`. The
 *                        version prefix lets us evolve the scheme
 *                        later without ambiguity.
 *
 * Outbound: bot signs `v0:<timestamp>:<request body>` and sets both
 * headers on the POST so the server can verify the request.
 * Inbound:  the server is expected to return both headers on its
 * response (signed against `v0:<timestamp>:<response body>`); a
 * mismatch / missing header / stale timestamp marks the dispatch as
 * failed and the response is NOT relayed to the user.
 */
export const SIGNATURE_HEADER = "x-karyl-signature";
export const TIMESTAMP_HEADER = "x-karyl-timestamp";
const SIGNATURE_VERSION = "v0";
const REPLAY_WINDOW_SECONDS = 300;

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

function signBody(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}:${timestamp}:${body}`)
    .digest("hex");
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate `X-Karyl-Signature` + `X-Karyl-Timestamp` against the
 * received body using the same scheme as the outbound signer. The
 * caller invokes this only when a secret is configured; without one
 * we don't expect any signature on the response.
 */
function verifyResponseSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
  nowSec: number,
): SignatureCheck {
  const sigHeader = headers.get(SIGNATURE_HEADER);
  const tsHeader = headers.get(TIMESTAMP_HEADER);
  if (!sigHeader || !tsHeader) {
    return {
      ok: false,
      reason: "missing X-Karyl-Signature/Timestamp on response",
    };
  }
  const tsNum = Number.parseInt(tsHeader, 10);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "malformed X-Karyl-Timestamp on response" };
  }
  if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "response timestamp outside replay window" };
  }
  const expected = `${SIGNATURE_VERSION}=${signBody(secret, tsHeader, rawBody)}`;
  if (!constantTimeEq(sigHeader, expected)) {
    return { ok: false, reason: "response signature mismatch" };
  }
  return { ok: true };
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
 * When `options.secret` is set, the request is HMAC-signed and the
 * response's signature is verified before the body is treated as
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
    const ts = Math.floor(Date.now() / 1000).toString();
    headers[TIMESTAMP_HEADER] = ts;
    headers[SIGNATURE_HEADER] =
      `${SIGNATURE_VERSION}=${signBody(secret, ts, body)}`;
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
    const verdict = verifyResponseSignature(
      secret,
      res.headers,
      rawText,
      Math.floor(Date.now() / 1000),
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
