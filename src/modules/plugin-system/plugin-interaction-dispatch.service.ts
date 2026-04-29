import { createHmac } from "crypto";
import {
  type Interaction,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import {
  findPluginCommandByName,
  type PluginCommandRow,
} from "./models/plugin-command.model.js";
import { findPluginById, type PluginRow } from "./models/plugin.model.js";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "../../services/webhook-dispatch.service.js";
import type { PluginManifest } from "./plugin-registry.service.js";
import { botEventLog } from "../../web/bot-event-log.js";

/**
 * Inbound Discord interaction → plugin dispatcher.
 *
 * Returns true if the interaction was claimed by a plugin (caller
 * should NOT pass it to discordx); false if no plugin owns the
 * command and the caller should fall through to the in-process
 * dispatcher.
 *
 * Two interaction kinds are handled:
 *   - ChatInputCommand: defer reply (3s budget), POST interaction
 *     details to plugin's /commands/<name> endpoint. Plugin calls
 *     back via /api/plugin/interactions.respond to populate the
 *     deferred reply. We don't await the plugin — Discord's 15-min
 *     followup window is plenty even for slow plugins.
 *   - Autocomplete: must respond synchronously (no defer), so we
 *     await the plugin's POST with a 1.5s budget and forward the
 *     choices it returns. Failure / timeout → return empty choices
 *     so the user sees no suggestions but the input box still works.
 *
 * Component / modal interactions land here too via the prefix-routed
 * customId convention; handled in a follow-up.
 */

const SIGNATURE_VERSION = "v0";
const DEFAULT_COMMAND_PATH = "/commands/{command_name}";
const DEFAULT_AUTOCOMPLETE_PATH = "/commands/{command_name}/autocomplete";
const COMMAND_DISPATCH_TIMEOUT_MS = 5_000;
const AUTOCOMPLETE_TIMEOUT_MS = 1_500;

function parseManifest(plugin: PluginRow): PluginManifest | null {
  try {
    return JSON.parse(plugin.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

function signBody(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}:${ts}:${body}`)
    .digest("hex");
}

function buildHeaders(secret: string, body: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    "Content-Type": "application/json",
    [SIGNATURE_HEADER]: `${SIGNATURE_VERSION}=${signBody(secret, ts, body)}`,
    [TIMESTAMP_HEADER]: ts,
  };
}

function resolveUrl(
  plugin: PluginRow,
  manifest: PluginManifest,
  template: string,
  variables: Record<string, string>,
): string | null {
  let path = template;
  for (const [k, v] of Object.entries(variables)) {
    path = path.split(`{${k}}`).join(encodeURIComponent(v));
  }
  try {
    return new URL(path, plugin.url).toString();
  } catch {
    return null;
  }
}

interface OptionEntry {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: OptionEntry[];
}

/**
 * Walk the option tree from a ChatInputCommandInteraction. discord.js
 * stores options as a CommandInteractionOptionResolver under the hood;
 * the public API gives us the resolved values but not the raw shape
 * — we serialize down to a plugin-friendly tree.
 */
function serializeOptions(interaction: ChatInputCommandInteraction): {
  sub_command?: string;
  sub_command_group?: string;
  options: OptionEntry[];
} {
  const subGroup = interaction.options.getSubcommandGroup(false) ?? undefined;
  const sub = interaction.options.getSubcommand(false) ?? undefined;
  // discord.js' resolver doesn't directly expose a raw tree; rebuild
  // from the data on the interaction.
  const raw = (
    interaction.options as unknown as { _hoistedOptions?: OptionEntry[] }
  )._hoistedOptions;
  return {
    sub_command: sub,
    sub_command_group: subGroup,
    options: raw ?? [],
  };
}

async function dispatchChatInputCommand(
  interaction: ChatInputCommandInteraction,
  plugin: PluginRow,
  manifest: PluginManifest,
): Promise<void> {
  const sharedSecret = process.env.KARYL_PLUGIN_SECRET?.trim();
  if (!sharedSecret) {
    await interaction.reply({
      content: "⚠ KARYL_PLUGIN_SECRET 未設定,plugin 派送已停用。",
      ephemeral: true,
    });
    return;
  }
  // Defer immediately. The plugin gets ~15 minutes to respond via
  // /api/plugin/interactions.respond. Default to ephemeral=true so
  // a plugin that crashes doesn't leave a public "thinking…" message
  // in everyone's faces; plugins that want public output can use
  // followup messages or include flags in their respond call.
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    // Already acknowledged or token expired — nothing else we can do.
    botEventLog.record(
      "warn",
      "bot",
      `plugin-interaction: defer failed for ${plugin.pluginKey}/${interaction.commandName}: ${err instanceof Error ? err.message : String(err)}`,
      { pluginId: plugin.id },
    );
    return;
  }

  const url = resolveUrl(
    plugin,
    manifest,
    manifest.endpoints?.command ?? DEFAULT_COMMAND_PATH,
    { command_name: interaction.commandName },
  );
  if (!url) {
    await interaction.editReply({
      content: "⚠ 無法解析 plugin 的指令端點。",
    });
    return;
  }

  const opts = serializeOptions(interaction);
  const payload = {
    interaction_id: interaction.id,
    interaction_token: interaction.token,
    application_id: interaction.applicationId,
    command_name: interaction.commandName,
    sub_command_name: opts.sub_command ?? null,
    sub_command_group: opts.sub_command_group ?? null,
    options: opts.options,
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      global_name: interaction.user.globalName,
    },
    member: interaction.member
      ? {
          permissions:
            interaction.memberPermissions?.bitfield.toString() ?? null,
        }
      : null,
    locale: interaction.locale ?? null,
  };
  const body = JSON.stringify(payload);
  const headers = buildHeaders(sharedSecret, body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COMMAND_DISPATCH_TIMEOUT_MS);
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
        `plugin-interaction: ${plugin.pluginKey}/${interaction.commandName} POST returned ${res.status}: ${text.slice(0, 200)}`,
        { pluginId: plugin.id },
      );
      await interaction
        .editReply({ content: `⚠ Plugin 拒絕了此指令 (HTTP ${res.status})` })
        .catch(() => {});
    }
    // We do NOT consume res body. Plugin completes the deferred
    // reply via RPC interactions.respond. Synchronous body action
    // would race the plugin's own RPC call.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "warn",
      "bot",
      `plugin-interaction: ${plugin.pluginKey}/${interaction.commandName} POST failed: ${msg}`,
      { pluginId: plugin.id },
    );
    await interaction
      .editReply({ content: `⚠ 無法連接 plugin: ${msg}` })
      .catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchAutocomplete(
  interaction: AutocompleteInteraction,
  plugin: PluginRow,
  manifest: PluginManifest,
): Promise<void> {
  const sharedSecret = process.env.KARYL_PLUGIN_SECRET?.trim();
  if (!sharedSecret) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  const url = resolveUrl(plugin, manifest, DEFAULT_AUTOCOMPLETE_PATH, {
    command_name: interaction.commandName,
  });
  if (!url) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  const focused = interaction.options.getFocused(true);
  const payload = {
    interaction_id: interaction.id,
    command_name: interaction.commandName,
    focused: { name: focused.name, value: focused.value, type: focused.type },
    guild_id: interaction.guildId,
    user: { id: interaction.user.id },
  };
  const body = JSON.stringify(payload);
  const headers = buildHeaders(sharedSecret, body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AUTOCOMPLETE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ name: string; value: string | number }>;
    } | null;
    await interaction.respond(data?.choices ?? []).catch(() => {});
  } catch {
    await interaction.respond([]).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchInteractionToPlugin(
  interaction: Interaction,
): Promise<boolean> {
  // Only command + autocomplete for now; component/modal routing
  // (custom_id prefix) is a follow-up.
  if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
    const cmd: PluginCommandRow | null = await findPluginCommandByName(
      interaction.commandName,
      interaction.guildId,
    );
    if (!cmd) return false;
    const plugin = await findPluginById(cmd.pluginId);
    if (!plugin) return false;
    if (!plugin.enabled || plugin.status !== "active") {
      // Plugin's command still registered with Discord but the plugin
      // isn't accepting traffic right now. Reply ephemeral so the
      // user knows why nothing happened.
      if (interaction.isChatInputCommand()) {
        await interaction
          .reply({
            content: "⚠ 此指令所屬的 plugin 目前離線或已被停用。",
            ephemeral: true,
          })
          .catch(() => {});
      } else {
        await interaction.respond([]).catch(() => {});
      }
      return true;
    }
    const manifest = parseManifest(plugin);
    if (!manifest) {
      if (interaction.isChatInputCommand()) {
        await interaction
          .reply({
            content: "⚠ 此 plugin 的 manifest 損壞,無法派送指令。",
            ephemeral: true,
          })
          .catch(() => {});
      } else {
        await interaction.respond([]).catch(() => {});
      }
      return true;
    }
    if (interaction.isAutocomplete()) {
      await dispatchAutocomplete(interaction, plugin, manifest);
    } else {
      await dispatchChatInputCommand(interaction, plugin, manifest);
    }
    return true;
  }
  return false;
}
