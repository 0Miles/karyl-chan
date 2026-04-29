import { createHmac } from "crypto";
import {
  findAllPlugins,
  findPluginById,
  type PluginRow,
} from "../models/plugin.model.js";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./webhook-dispatch.service.js";
import type { PluginManifest } from "./plugin-registry.service.js";
import { botEventLog } from "../web/bot-event-log.js";

/**
 * Bot → Plugin event dispatch. Plugins declare which event types
 * they're interested in via their manifest's
 *
 *   guild_features[].events_subscribed   (per-feature)
 *   events_subscribed_global             (plugin-wide fallback)
 *
 * fields. We index those at register / enable time so the hot path
 * (every Discord event the bot receives) doesn't have to walk the
 * full plugins table.
 *
 * Dispatch is fire-and-forget: we POST to plugin.url + manifest's
 * endpoints.events (default `/events`) with HMAC headers, then move
 * on. Plugins that want to act on the event call back through the
 * /api/plugin/* RPC routes.
 */

const SIGNATURE_VERSION = "v0";
const DEFAULT_EVENTS_PATH = "/events";
const DISPATCH_TIMEOUT_MS = 5_000;

/**
 * In-memory index: event_type → Set<pluginId>. Rebuilt on startup
 * and whenever a plugin registers / enables / disables. Reading is
 * synchronous; the actual fan-out POSTs are async.
 */
class EventIndex {
  private map = new Map<string, Set<number>>();

  set(map: Map<string, Set<number>>): void {
    this.map = map;
  }

  subscribers(eventType: string): number[] {
    const s = this.map.get(eventType);
    return s ? Array.from(s) : [];
  }

  hasSubscribers(eventType: string): boolean {
    const s = this.map.get(eventType);
    return !!s && s.size > 0;
  }

  size(): number {
    return this.map.size;
  }
}

const index = new EventIndex();

function parseManifest(plugin: PluginRow): PluginManifest | null {
  try {
    return JSON.parse(plugin.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

function collectSubscribedEvents(manifest: PluginManifest): Set<string> {
  const out = new Set<string>();
  for (const e of manifest.events_subscribed_global ?? []) {
    if (typeof e === "string" && e.length > 0) out.add(e);
  }
  for (const f of manifest.guild_features ?? []) {
    for (const e of f.events_subscribed ?? []) {
      if (typeof e === "string" && e.length > 0) out.add(e);
    }
  }
  return out;
}

/**
 * Walk the plugins table and rebuild the in-memory event subscription
 * index. Idempotent; safe to call after every register/enable/disable
 * even if multiple back-to-back changes happen.
 */
export async function rebuildEventIndex(): Promise<void> {
  const all = await findAllPlugins();
  const m = new Map<string, Set<number>>();
  for (const p of all) {
    if (!p.enabled || p.status !== "active") continue;
    const manifest = parseManifest(p);
    if (!manifest) continue;
    const events = collectSubscribedEvents(manifest);
    for (const ev of events) {
      let set = m.get(ev);
      if (!set) {
        set = new Set();
        m.set(ev, set);
      }
      set.add(p.id);
    }
  }
  index.set(m);
}

function signBody(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}:${ts}:${body}`)
    .digest("hex");
}

function resolveEventsUrl(plugin: PluginRow, manifest: PluginManifest): string | null {
  const path = manifest.endpoints?.events ?? DEFAULT_EVENTS_PATH;
  try {
    return new URL(path, plugin.url).toString();
  } catch {
    return null;
  }
}

async function postEventToPlugin(
  plugin: PluginRow,
  eventType: string,
  data: unknown,
  sharedSecret: string,
): Promise<void> {
  const manifest = parseManifest(plugin);
  if (!manifest) return;
  const url = resolveEventsUrl(plugin, manifest);
  if (!url) return;
  const body = JSON.stringify({ type: eventType, data });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = `${SIGNATURE_VERSION}=${signBody(sharedSecret, ts, body)}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: sig,
        [TIMESTAMP_HEADER]: ts,
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      botEventLog.record(
        "warn",
        "bot",
        `plugin event ${eventType} → ${plugin.pluginKey} returned HTTP ${res.status}`,
        { pluginId: plugin.id, eventType, status: res.status },
      );
    }
    // We deliberately don't read the response body. Plugins that
    // want to react call back through /api/plugin/* RPC.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "warn",
      "bot",
      `plugin event ${eventType} → ${plugin.pluginKey} dispatch failed: ${msg}`,
      { pluginId: plugin.id, eventType, error: msg },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fan out a Discord event to every plugin subscribed to its type.
 * Returns immediately; the dispatch itself runs in the background.
 * Plugins that are slow / down don't block the bot's main loop.
 */
export function dispatchEventToPlugins(eventType: string, data: unknown): void {
  if (!index.hasSubscribers(eventType)) return;
  const sharedSecret = process.env.KARYL_PLUGIN_SECRET?.trim();
  if (!sharedSecret) {
    // No secret configured → plugin signing is impossible. Logging
    // every event would spam, so just skip silently. The reaper /
    // boot logic already warns once that plugin mode is off.
    return;
  }
  const ids = index.subscribers(eventType);
  // Fire all dispatches in parallel; we do not await. Errors per
  // plugin are logged inside postEventToPlugin and do not propagate.
  void Promise.allSettled(
    ids.map(async (id) => {
      const plugin = await findPluginById(id);
      if (!plugin || !plugin.enabled || plugin.status !== "active") return;
      await postEventToPlugin(plugin, eventType, data, sharedSecret);
    }),
  );
}

/** Test-only / startup hook to read the current index snapshot. */
export function getEventIndexSize(): number {
  return index.size();
}
