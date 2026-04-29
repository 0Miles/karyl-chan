import { createHmac, timingSafeEqual } from "crypto";
import type { RESTPostAPIWebhookWithTokenJSONBody } from "discord.js";
import type { APIMessage } from "discord.js";
import { findPluginById, type PluginRow } from "./models/plugin.model.js";
import type { PluginManifest } from "./plugin-registry.service.js";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  type DispatchResult,
} from "../behavior/webhook-dispatch.service.js";
import { botEventLog } from "../bot-events/bot-event-log.js";

/**
 * Dispatch DM behavior payloads through a registered plugin.
 *
 * Distinct from webhook-dispatch.service.dispatchWebhook in three ways:
 *   1. URL is built dynamically from the live plugin row's `url` plus
 *      the manifest's endpoint template — this lets a plugin restart
 *      and rebind without behavior rows pointing at a stale address.
 *   2. We do NOT append `?wait=true`. That's a Discord-webhook quirk;
 *      plugin endpoints are arbitrary HTTP and shouldn't have query
 *      strings forced on them.
 *   3. The HMAC key is the bot-wide KARYL_PLUGIN_SECRET, not a
 *      per-behavior secret. Plugins know this secret from their own
 *      env (used for registration) so the same key works in both
 *      directions. Per-plugin HMAC keys are deferred to Phase 2.
 *
 * Returns the same DispatchResult shape as the webhook path so the
 * caller (webhook-behavior.events) can use one branch's result without
 * caring which dispatcher produced it.
 */

const SIGNATURE_VERSION = "v0";
const REPLAY_WINDOW_SECONDS = 300;
const DEFAULT_DM_DISPATCH_PATH = "/dm/{behavior_key}/dispatch";
const BEHAVIOR_END_RE = /\[BEHAVIOR:END\]/gi;

function signBody(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}:${ts}:${body}`)
    .digest("hex");
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseManifest(plugin: PluginRow): PluginManifest | null {
  try {
    return JSON.parse(plugin.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

function resolveDispatchUrl(
  plugin: PluginRow,
  manifest: PluginManifest,
  behaviorKey: string,
): string | null {
  const tpl =
    manifest.endpoints?.dm_behavior_dispatch ?? DEFAULT_DM_DISPATCH_PATH;
  const path = tpl.replace("{behavior_key}", encodeURIComponent(behaviorKey));
  try {
    return new URL(path, plugin.url).toString();
  } catch {
    return null;
  }
}

/**
 * Verify the HMAC headers a plugin slapped onto its response. Mirrors
 * webhook-dispatch.service.verifyResponseSignature; duplicated rather
 * than imported to keep both dispatchers self-contained for now.
 */
function verifyResponseSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
  nowSec: number,
): { ok: true } | { ok: false; reason: string } {
  const sig = headers.get(SIGNATURE_HEADER);
  const ts = headers.get(TIMESTAMP_HEADER);
  if (!sig || !ts) {
    return {
      ok: false,
      reason: "missing X-Karyl-Signature/Timestamp on response",
    };
  }
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "malformed X-Karyl-Timestamp on response" };
  }
  if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "response timestamp outside replay window" };
  }
  const expected = `${SIGNATURE_VERSION}=${signBody(secret, ts, rawBody)}`;
  if (!constantTimeEq(sig, expected)) {
    return { ok: false, reason: "response signature mismatch" };
  }
  return { ok: true };
}

export interface PluginDispatchOptions {
  /** Plugin's id from behaviors.pluginId. */
  pluginId: number;
  /** dm_behaviors[].key from manifest. */
  behaviorKey: string;
  /**
   * Payload built by webhook-behavior.events.buildPayload — same shape
   * webhook plugins receive, so a plugin can implement DM forwarding
   * with the exact same payload contract as the legacy webhook path.
   */
  payload: RESTPostAPIWebhookWithTokenJSONBody;
}

export async function dispatchPluginDmBehavior(
  options: PluginDispatchOptions,
): Promise<DispatchResult> {
  const plugin = await findPluginById(options.pluginId);
  if (!plugin) {
    return failure(`plugin id=${options.pluginId} not found`);
  }
  if (plugin.status !== "active" || !plugin.enabled) {
    botEventLog.record(
      "warn",
      "bot",
      `plugin-dispatch: plugin ${plugin.pluginKey} not active+enabled (status=${plugin.status} enabled=${plugin.enabled})`,
      { pluginId: plugin.id, pluginKey: plugin.pluginKey },
    );
    return failure(
      `plugin ${plugin.pluginKey} unavailable (status=${plugin.status} enabled=${plugin.enabled})`,
    );
  }
  const manifest = parseManifest(plugin);
  if (!manifest) {
    return failure(`plugin ${plugin.pluginKey} has unparseable manifest`);
  }
  const url = resolveDispatchUrl(plugin, manifest, options.behaviorKey);
  if (!url) {
    return failure(`plugin ${plugin.pluginKey} dispatch URL invalid`);
  }
  const sharedSecret = process.env.KARYL_PLUGIN_SECRET?.trim();
  if (!sharedSecret) {
    return failure("KARYL_PLUGIN_SECRET not configured on bot");
  }

  const body = JSON.stringify(options.payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: `${SIGNATURE_VERSION}=${signBody(sharedSecret, ts, body)}`,
  };

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`network error: ${msg}`);
  }
  const rawText = await res.text().catch(() => "");

  if (!res.ok) {
    return failure(
      rawText ? rawText.slice(0, 500) : `HTTP ${res.status}`,
      res.status,
    );
  }

  // Plugin response signature is mandatory because the bot trusts the
  // returned content enough to relay it back into the user's DM. A
  // missing/bad signature could let an attacker on the network
  // hijack the response if KARYL_PLUGIN_SECRET wasn't shared.
  const verdict = verifyResponseSignature(
    sharedSecret,
    res.headers,
    rawText,
    Math.floor(Date.now() / 1000),
  );
  if (!verdict.ok) {
    return failure(verdict.reason, res.status);
  }

  let response: APIMessage | undefined;
  if (rawText.length > 0) {
    try {
      response = JSON.parse(rawText) as APIMessage;
    } catch {
      // Tolerate plugin sending a non-JSON success body — same as
      // dispatchWebhook does. Behave as success-with-empty-relay.
      return { ok: true, ended: false, relayContent: "" };
    }
  }
  const rawContent =
    typeof response?.content === "string" ? response.content : "";
  const ended = BEHAVIOR_END_RE.test(rawContent);
  BEHAVIOR_END_RE.lastIndex = 0;
  const relayContent = ended
    ? rawContent.replace(BEHAVIOR_END_RE, "").trim()
    : rawContent.trim();
  return { ok: true, response, ended, relayContent };
}

function failure(reason: string, status?: number): DispatchResult {
  return {
    ok: false,
    error: reason,
    status,
    ended: false,
    relayContent: "",
  };
}

// Re-export for convenience; same token semantics as webhook-dispatch.
export { BEHAVIOR_END_TOKEN } from "../behavior/webhook-dispatch.service.js";
