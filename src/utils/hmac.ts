import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC signature helpers for bot ↔ plugin / webhook communication.
 *
 * Two scheme versions are supported:
 *
 *   v0  (legacy)   `v0:<timestamp>:<body>`
 *   v1  (current)  `v1:<METHOD>:<url-path>:<timestamp>:<body>`
 *
 * v1 binds the HTTP method and URL path into the signed payload so
 * that a signature captured on one endpoint cannot be replayed to a
 * different endpoint or with a different HTTP verb, even within the
 * REPLAY_WINDOW_SECONDS acceptance window.
 *
 * Outbound (bot → plugin / webhook):
 *   - Both X-Karyl-Signature (v0) and X-Karyl-Signature-V1 (v1)
 *     headers are sent. Old plugins that only know v0 keep working;
 *     upgraded plugins prefer v1.
 *
 * Inbound verify (plugin response → bot):
 *   - If X-Karyl-Signature-V1 is present, verify as v1.
 *   - Otherwise fall back to X-Karyl-Signature (v0).
 *   - Neither present → reject.
 */

/** Existing header name — must not be renamed (backward compat). */
export const SIGNATURE_HEADER = "x-karyl-signature";
/** New v1 header — added alongside the old one for dual-sign. */
export const SIGNATURE_HEADER_V1 = "x-karyl-signature-v1";
export const TIMESTAMP_HEADER = "x-karyl-timestamp";

export const SIGNATURE_VERSION_V0 = "v0";
export const SIGNATURE_VERSION_V1 = "v1";

// Replay window is deliberately not configurable here — it is a
// security constant, not a tuning knob. Callers that need visibility
// can re-export the constant.
export const REPLAY_WINDOW_SECONDS = 300;

// ─── Low-level sign helpers ───────────────────────────────────────────

/**
 * Compute v0 HMAC: `v0:<timestamp>:<body>`.
 * Returns the raw hex digest (no version prefix).
 */
export function signBodyV0(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION_V0}:${timestamp}:${body}`)
    .digest("hex");
}

/**
 * Compute v1 HMAC: `v1:<METHOD>:<url-path>:<timestamp>:<body>`.
 * `method` should be upper-cased (e.g. "POST").
 * `path` should be the URL pathname only (e.g. "/dm/greet/dispatch").
 * Returns the raw hex digest (no version prefix).
 */
export function signBodyV1(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(
      `${SIGNATURE_VERSION_V1}:${method.toUpperCase()}:${path}:${timestamp}:${body}`,
    )
    .digest("hex");
}

// ─── Timing-safe equality ─────────────────────────────────────────────

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ─── Outbound signing ─────────────────────────────────────────────────

/**
 * Build the full set of HMAC headers for an outbound POST request.
 * Always writes BOTH X-Karyl-Signature (v0) and X-Karyl-Signature-V1
 * (v1) so that receivers on either scheme version can verify.
 *
 * @param secret   Shared HMAC secret
 * @param method   HTTP method, e.g. "POST"
 * @param urlPath  URL pathname, e.g. "/dm/greet/dispatch"
 * @param body     Request body string (already serialised)
 * @param ts       Optional unix-epoch-seconds string; defaults to now
 */
export function buildOutboundSignatureHeaders(
  secret: string,
  method: string,
  urlPath: string,
  body: string,
  ts?: string,
): Record<string, string> {
  const timestamp = ts ?? Math.floor(Date.now() / 1000).toString();
  const v0sig = signBodyV0(secret, timestamp, body);
  const v1sig = signBodyV1(secret, method, urlPath, timestamp, body);
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `${SIGNATURE_VERSION_V0}=${v0sig}`,
    [SIGNATURE_HEADER_V1]: `${SIGNATURE_VERSION_V1}=${v1sig}`,
  };
}

// ─── Inbound verification ─────────────────────────────────────────────

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Verify HMAC headers on an inbound response (plugin → bot direction).
 *
 * Preference order:
 *   1. X-Karyl-Signature-V1 present → verify as v1
 *   2. X-Karyl-Signature present    → verify as v0
 *   3. Neither present              → reject
 *
 * `method` and `urlPath` are the method/path of the *original request*
 * that produced this response; v1 binds these into the signed payload.
 *
 * @param secret    Shared HMAC secret
 * @param headers   Response headers
 * @param rawBody   Raw response body string
 * @param nowSec    Current unix epoch seconds (for replay-window check)
 * @param method    HTTP method used for the original request (e.g. "POST")
 * @param urlPath   URL pathname of the original request
 */
export function verifyInboundSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
  nowSec: number,
  method: string,
  urlPath: string,
): SignatureCheck {
  const v1Header = headers.get(SIGNATURE_HEADER_V1);
  const v0Header = headers.get(SIGNATURE_HEADER);
  const tsHeader = headers.get(TIMESTAMP_HEADER);

  if (!tsHeader) {
    return { ok: false, reason: "missing X-Karyl-Timestamp on response" };
  }

  const tsNum = Number.parseInt(tsHeader, 10);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "malformed X-Karyl-Timestamp on response" };
  }
  if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "response timestamp outside replay window" };
  }

  // Prefer v1 if present
  if (v1Header) {
    const expected = `${SIGNATURE_VERSION_V1}=${signBodyV1(secret, method, urlPath, tsHeader, rawBody)}`;
    if (!constantTimeEq(v1Header, expected)) {
      return { ok: false, reason: "response v1 signature mismatch" };
    }
    return { ok: true };
  }

  // Fallback to v0
  if (v0Header) {
    const expected = `${SIGNATURE_VERSION_V0}=${signBodyV0(secret, tsHeader, rawBody)}`;
    if (!constantTimeEq(v0Header, expected)) {
      return { ok: false, reason: "response signature mismatch" };
    }
    return { ok: true };
  }

  return {
    ok: false,
    reason: "missing X-Karyl-Signature/Timestamp on response",
  };
}
