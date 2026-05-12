import { config } from "../../config.js";
import type { ButtonInteraction } from "discord.js";
import { findPluginByKey, type PluginRow } from "./models/plugin.model.js";
import type { PluginManifest } from "./plugin-registry.service.js";
import { resolveUserCapabilities } from "../admin/authorized-user.service.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import {
  assertPluginTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";
import { buildOutboundSignatureHeaders } from "../../utils/hmac.js";

/**
 * Inbound Discord *component* (button) interaction → plugin dispatcher.
 *
 * A plugin owns a button by giving it a custom_id of the form
 *   `kc:<pluginKey>:<rest>`
 * (`kc` = "karyl plugin component" — a reserved prefix so the bot knows
 * to route it; `<rest>` is the plugin's own action id, optionally with a
 * `:<tail>`). On such a click the bot:
 *   1. resolves the plugin (must be installed + enabled)
 *   2. `deferUpdate()`s — acks within Discord's 3 s budget, no visible
 *      change to the message
 *   3. HMAC-signs and POSTs the click to the plugin's component endpoint
 *      (manifest `endpoints.plugin_component`, default `/components`)
 *   4. does NOT await the body — the plugin completes the interaction by
 *      calling `interactions.respond` (which PATCHes the message the
 *      button is on, i.e. `@original`) within the 15-minute window, or
 *      `interactions.followup` for an ephemeral nudge.
 *
 * Because component interactions create a *new* interaction (with a fresh
 * 15-minute token) on every click, the buttons keep working for as long
 * as the message exists — no per-button token to expire.
 *
 * Returns true if a plugin claimed the interaction (caller should not
 * fall through); false if the custom_id isn't a `kc:` token.
 */

const DEFAULT_COMPONENT_PATH = "/components";
const COMPONENT_DISPATCH_TIMEOUT_MS = config.plugin.commandDispatchTimeoutMs;

function parseManifest(plugin: PluginRow): PluginManifest | null {
  try {
    return JSON.parse(plugin.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

function buildHeaders(
  secret: string,
  url: string,
  body: string,
): Record<string, string> {
  const urlPath = new URL(url).pathname;
  return {
    "Content-Type": "application/json",
    ...buildOutboundSignatureHeaders(secret, "POST", urlPath, body),
  };
}

function resolveComponentUrl(plugin: PluginRow, manifest: PluginManifest):
  | string
  | null {
  const path = manifest.endpoints?.plugin_component ?? DEFAULT_COMPONENT_PATH;
  try {
    return new URL(path, plugin.url).toString();
  } catch {
    return null;
  }
}

/**
 * Parse `kc:<pluginKey>:<rest>` → `{ pluginKey }`. Returns null when the
 * custom_id isn't a `kc:` token (so the dispatcher falls through to the
 * in-process registry, which is free to use its own prefixes).
 */
function parsePluginComponentId(customId: string): { pluginKey: string } | null {
  if (!customId.startsWith("kc:")) return null;
  const rest = customId.slice(3);
  const sep = rest.indexOf(":");
  const pluginKey = sep === -1 ? rest : rest.slice(0, sep);
  if (!pluginKey || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginKey)) return null;
  return { pluginKey };
}

export async function dispatchComponentToPlugin(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parsePluginComponentId(interaction.customId);
  if (!parsed) return false;

  const plugin = await findPluginByKey(parsed.pluginKey);
  if (!plugin) {
    await interaction
      .reply({
        content: `⚠ 找不到 plugin \`${parsed.pluginKey}\`（按鈕已失效）。`,
        ephemeral: true,
      })
      .catch(() => {});
    return true;
  }
  if (!plugin.enabled || plugin.status !== "active") {
    await interaction
      .reply({
        content: "⚠ 此按鈕所屬的 plugin 目前離線或已被停用。",
        ephemeral: true,
      })
      .catch(() => {});
    return true;
  }
  const manifest = parseManifest(plugin);
  if (!manifest) {
    await interaction
      .reply({
        content: "⚠ 此 plugin 的 manifest 損壞,無法派送。",
        ephemeral: true,
      })
      .catch(() => {});
    return true;
  }
  const dispatchKey = plugin.dispatchHmacKey;
  if (!dispatchKey) {
    await interaction
      .reply({
        content: "⚠ Plugin 尚未完成 re-register,dispatch key 不存在。",
        ephemeral: true,
      })
      .catch(() => {});
    return true;
  }

  // Defer the update — acks the interaction without changing the message.
  // The plugin fills in the result via interactions.respond (PATCH the
  // message the button is on) within 15 minutes.
  try {
    await interaction.deferUpdate();
  } catch (err) {
    botEventLog.record(
      "warn",
      "bot",
      `plugin-component: deferUpdate failed for ${plugin.pluginKey} (${interaction.customId}): ${err instanceof Error ? err.message : String(err)}`,
      { pluginId: plugin.id },
    );
    return true;
  }

  const url = resolveComponentUrl(plugin, manifest);
  if (!url) {
    botEventLog.record(
      "warn",
      "bot",
      `plugin-component: cannot resolve component endpoint for ${plugin.pluginKey}`,
      { pluginId: plugin.id },
    );
    await interaction
      .followUp({ content: "⚠ 無法解析 plugin 的元件端點。", ephemeral: true })
      .catch(() => {});
    return true;
  }
  const parsedUrl = new URL(url);
  const port = parsedUrl.port
    ? Number(parsedUrl.port)
    : parsedUrl.protocol === "https:"
      ? 443
      : 80;
  try {
    await assertPluginTarget(parsedUrl.hostname, port);
  } catch (err) {
    if (!(err instanceof HostPolicyError)) throw err;
    botEventLog.record(
      "warn",
      "bot",
      `plugin-component: pre-flight host-policy rejected ${plugin.pluginKey}: ${err.message}`,
      { pluginId: plugin.id },
    );
    await interaction
      .followUp({
        content: `⚠ Plugin 端點不被允許: ${err.message}`,
        ephemeral: true,
      })
      .catch(() => {});
    return true;
  }

  // Member-scoped RBAC tokens narrowed to what THIS plugin may act on
  // (mirrors plugin command dispatch). Voice channel id is exposed so a
  // plugin can gate controls on "must be in the bot's voice channel".
  const allCaps = await resolveUserCapabilities(interaction.user.id);
  const pluginCaps = [...allCaps].filter(
    (c) => c === "admin" || c.startsWith(`plugin:${plugin.pluginKey}:`),
  );
  const payload = {
    interaction_id: interaction.id,
    interaction_token: interaction.token,
    application_id: interaction.applicationId,
    custom_id: interaction.customId,
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    message_id: interaction.message.id,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      global_name: interaction.user.globalName,
    },
    member: interaction.member
      ? {
          permissions:
            interaction.memberPermissions?.bitfield.toString() ?? null,
          voice_channel_id:
            (
              interaction.member as unknown as {
                voice?: { channelId?: string | null };
              }
            ).voice?.channelId ?? null,
          capabilities: pluginCaps,
        }
      : null,
    locale: interaction.locale ?? null,
  };
  const body = JSON.stringify(payload);
  const headers = buildHeaders(dispatchKey, url, body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COMPONENT_DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      botEventLog.record(
        "warn",
        "bot",
        `plugin-component: ${plugin.pluginKey} (${interaction.customId}) POST returned ${res.status}: ${text.slice(0, 200)}`,
        { pluginId: plugin.id },
      );
      await interaction
        .followUp({
          content: `⚠ Plugin 拒絕了此按鈕 (HTTP ${res.status})`,
          ephemeral: true,
        })
        .catch(() => {});
    }
    // Body not consumed — plugin completes via interactions.respond.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "warn",
      "bot",
      `plugin-component: ${plugin.pluginKey} (${interaction.customId}) POST failed: ${msg}`,
      { pluginId: plugin.id },
    );
    await interaction
      .followUp({ content: `⚠ 無法連接 plugin: ${msg}`, ephemeral: true })
      .catch(() => {});
  } finally {
    clearTimeout(timer);
  }
  return true;
}
