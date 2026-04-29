import "reflect-metadata";

import { dirname, importx } from "@discordx/importer";
import type {
  DMChannel,
  Interaction,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import {
  ApplicationCommandType,
  ChannelType,
  Events,
  IntentsBitField,
  InteractionContextType,
  Partials,
} from "discord.js";
import { Client } from "discordx";
import { sequelize } from "./models/db.js";
import { startWebServer } from "./web/server.js";
import { dmInboxService } from "./web/dm-inbox.service.js";
import { authStore } from "./web/auth-store.service.js";
import { sequelizeRefreshStore } from "./web/refresh-token.repository.js";
import {
  auditStoredCapabilities,
  seedDefaultRoles,
} from "./web/authorized-user.service.js";
import { botEventLog } from "./web/bot-event-log.js";
import { shouldRecord } from "./web/bot-event-dedup.js";
import { runPendingMigrations } from "./migrations/runner.js";
import {
  ALL_DMS_TARGET_ID,
  ensureAllDmsTarget,
} from "./models/behavior-target.model.js";
import {
  ensureSystemBreakBehavior,
  ensureSystemLoginBehavior,
  ensureSystemManualBehavior,
  findAllSystemBehaviors,
  findBehaviorsByTargets,
  SYSTEM_BEHAVIOR_KEY_BREAK,
  SYSTEM_BEHAVIOR_KEY_LOGIN,
  SYSTEM_BEHAVIOR_KEY_MANUAL,
} from "./models/behavior.model.js";
import {
  runBreakForInteraction,
  runManualForInteraction,
} from "./services/system-behavior.service.js";
import { dispatchUserSlashBehavior } from "./services/user-slash-behavior.service.js";
import { rebindDmOnlyCommandsAsGlobal as rebindDmSlashService } from "./services/dm-slash-rebind.service.js";
import { pluginRegistry } from "./services/plugin-registry.service.js";
import {
  dispatchEventToPlugins,
  rebuildEventIndex,
} from "./services/plugin-event-bridge.service.js";
import {
  pluginCommandRegistry,
  setPluginCommandBotClient,
} from "./services/plugin-command-registry.service.js";
import { dispatchInteractionToPlugin } from "./services/plugin-interaction-dispatch.service.js";
import {
  dispatchInProcessInteraction,
  syncInProcessCommandsForGuild,
  syncInProcessCommandsToDiscord,
} from "./services/in-process-command-registry.service.js";
import { bootstrapInProcessFeatures } from "./bootstrap-in-process.js";
import { issueLoginLinkForInteraction } from "./services/admin-login.service.js";

let webServer: Awaited<ReturnType<typeof startWebServer>> | null = null;

export const bot = new Client({
  botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],

  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildMessageTyping,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.DirectMessageReactions,
    IntentsBitField.Flags.DirectMessageTyping,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],

  silent: false,
});

// @discordjs/rest auto-clears its bearer token whenever ANY request
// returns 401 (see node_modules/@discordjs/rest/dist/index.js:759 —
// `if (status === 401 && requestData.auth) manager.setToken(null)`).
// Discord returns 401 for many resource-specific reasons that don't
// mean the bot token is invalid (a single user.fetch on an unknown
// id, a sticker fetch in a guild we lost permissions in, etc.). Once
// the token is cleared every subsequent REST call throws "Expected
// token to be set" and the dashboard / DM features all 502 until the
// bot is restarted.
//
// Workaround: wrap setToken so a null clear is rejected when we
// still hold the original BOT_TOKEN env. If the token is genuinely
// revoked, login() and other gateway-level handshakes fail loud; we
// don't need REST's heuristic to second-guess that. Logged once per
// 60s via shouldRecord so the operator notices but isn't drowned.
{
  const realToken = process.env.BOT_TOKEN?.trim() ?? "";
  if (realToken) {
    const restAny = bot.rest as unknown as {
      setToken: (t: string | null) => unknown;
    };
    const origSetToken = restAny.setToken.bind(restAny);
    restAny.setToken = (t: string | null) => {
      if (t === null) {
        if (shouldRecord("rest-token-auto-clear")) {
          botEventLog.record(
            "warn",
            "bot",
            "REST.setToken(null) ignored — likely a 401 from a single resource fetch, not a real auth failure",
          );
        }
        return origSetToken(realToken);
      }
      return origSetToken(t);
    };
  }
}

// discord.js v14 emits 'ready' (with a one-time DeprecationWarning at
// boot); 'clientReady' is the v15 rename and is NOT emitted in v14
// yet. Stick with 'ready' until the v14→v15 migration; the warning is
// noisy but harmless.
bot.once("ready", async () => {
  const userTag = bot.user?.tag ?? "unknown";
  const userId = bot.user?.id ?? "unknown";
  await bot.guilds.fetch();
  const guildCount = bot.guilds.cache.size;
  botEventLog.record("info", "bot", `Bot ready: ${userTag}`, {
    userTag,
    userId,
    guildCount,
  });
  // discordx's initApplicationCommands previously registered the four
  // in-process commands (picture-only / role-emoji / todo-channel /
  // rcon-forward). Phase 2 of the discordx removal moved those onto
  // our own registry — discordx no longer owns any @Slash classes,
  // so calling initApplicationCommands now would just delete-then-
  // we-recreate the commands. Skip it; the registry handles sync.
  await syncInProcessCommandsToDiscord(bot);

  // Pre-cache the owner's DM channel. discord.js silently drops
  // MESSAGE_CREATE events for DM channels that aren't already cached
  // (createChannel can't infer DM type from a message-shaped payload),
  // so without this the owner-login-dm handler never fires.
  const ownerId = process.env.BOT_OWNER_ID?.trim();
  if (ownerId) {
    try {
      const owner = await bot.users.fetch(ownerId);
      await owner.createDM();
    } catch (err) {
      console.error("Failed to cache owner DM channel:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const errorType = err instanceof Error ? err.constructor.name : "unknown";
      botEventLog.record(
        "warn",
        "bot",
        `Failed to cache owner DM channel: ${msg}`,
        { ownerId, errorType },
      );
    }
  }

  // Reconcile plugin slash commands with Discord. Runs after the
  // discordx initApplicationCommands above so we don't fight over
  // the global command registry. Failures are logged inside the
  // registry, so we just await and move on.
  await pluginCommandRegistry.reconcileAll();

  // /manual and /break must be DM-only (they read user-private state
  // — DM session, applicable behaviors). discordx's Client.botGuilds
  // is set to "every guild the bot is in", so initApplicationCommands
  // unconditionally registers EVERY @Slash as a guild command — and
  // guild commands ignore the manifest's `contexts: [BotDM]` field
  // (only global commands honor it). That left both commands visible
  // in every guild's command picker but unusable inside DMs.
  //
  // Fix: after discordx finishes its sync, walk every guild and
  // delete /manual /break, then re-register them as GLOBAL commands
  // with `contexts: [BotDM, PrivateChannel]` so Discord shows them
  // ONLY in DMs. discordx keeps routing the interaction handler via
  // its decorators — we only changed how Discord lists the command.
  await rebindDmOnlyCommandsAsGlobal().catch((err) => {
    botEventLog.record(
      "warn",
      "bot",
      `rebindDmOnlyCommandsAsGlobal failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  console.log("Bot started");
});

/**
 * Bot-bound shim around the dm-slash-rebind service. main.ts uses
 * this from the ready handler; behavior-routes.ts gets its own
 * direct call to the service after admin CRUD so a freshly-created
 * `/foo` slash behavior shows up in Discord without a restart.
 */
async function rebindDmOnlyCommandsAsGlobal(): Promise<void> {
  await rebindDmSlashService(bot);
}

bot.on("guildCreate", async (guild) => {
  botEventLog.record("info", "bot", `Joined guild: ${guild.name}`, {
    guildId: guild.id,
    guildName: guild.name,
    memberCount: guild.memberCount,
  });
  await syncInProcessCommandsForGuild(guild);
});

bot.on("guildDelete", (guild) => {
  botEventLog.record("info", "bot", `Left guild: ${guild.name}`, {
    guildId: guild.id,
    guildName: guild.name,
  });
});

bot.on("interactionCreate", async (interaction: Interaction) => {
  // System slash-command behaviors take the highest-priority path.
  // An admin can edit a system behavior's triggerValue (e.g. rename
  // /login to /auth) and the registered slash command updates
  // accordingly — match by behavior.triggerValue rather than a hard-
  // coded command name so BehaviorsPage stays the source of truth.
  // All three current system behaviors (login / manual / break) flow
  // through this same loop; adding a new one means adding a key
  // constant + an ensure* seed + a case below.
  if (interaction.isChatInputCommand()) {
    try {
      const systems = await findAllSystemBehaviors();
      const matched = systems.find(
        (s) =>
          s.enabled &&
          s.triggerType === "slash_command" &&
          s.triggerValue === interaction.commandName,
      );
      if (matched) {
        switch (matched.pluginBehaviorKey) {
          case SYSTEM_BEHAVIOR_KEY_LOGIN:
            await issueLoginLinkForInteraction(interaction);
            return;
          case SYSTEM_BEHAVIOR_KEY_MANUAL:
            await runManualForInteraction(interaction);
            return;
          case SYSTEM_BEHAVIOR_KEY_BREAK:
            await runBreakForInteraction(interaction);
            return;
          default:
            // Unknown subkey on a system row — log + fall through so
            // discordx / plugin paths still get a chance.
            break;
        }
      }
    } catch (error) {
      console.error("system slash-command dispatch failed:", error);
    }
  }
  // User-created slash-command behaviors (target=all_dms,
  // triggerType='slash_command') after the system check. Looking
  // up by triggerValue lets admins rename a behavior's slash
  // command from BehaviorsPage and have it follow.
  if (interaction.isChatInputCommand()) {
    try {
      const claimed = await dispatchUserSlashBehavior(interaction);
      if (claimed) return;
    } catch (error) {
      console.error("user slash-command dispatch failed:", error);
    }
  }

  // In-process slash commands + modal-submit handlers (the bot's
  // own features: picture-only-channel / role-emoji / todo-channel /
  // rcon-forward-channel and any future ones). The registry dispatches
  // by name; returns false when nothing matched, so we fall through
  // to plugin / discordx.
  try {
    const claimed = await dispatchInProcessInteraction(interaction);
    if (claimed) return;
  } catch (error) {
    console.error("in-process interaction dispatch failed:", error);
  }

  // Plugin commands take a fast path: we look the command up in our
  // own table first. If it's a plugin command, we defer the reply
  // (Discord's 3-second clock starts ticking the moment the
  // interaction arrives) and POST the interaction details to the
  // owning plugin. The plugin calls back through
  // /api/plugin/interactions.respond to complete the deferred reply.
  // discordx executeInteraction never sees plugin commands —
  // dispatchInteractionToPlugin returns true when it claimed it.
  try {
    const claimed = await dispatchInteractionToPlugin(interaction);
    if (claimed) return;
  } catch (error) {
    console.error("plugin interaction dispatch failed:", error);
  }
  try {
    await bot.executeInteraction(interaction);
  } catch (error) {
    console.error("executeInteraction failed:", error);
  }
});

bot.on("messageCreate", async (message: Message) => {
  try {
    await bot.executeCommand(message);
  } catch (error) {
    console.error("executeCommand failed:", error);
  }
  // Plugin event fan-out. We classify the message into one of two
  // event types (dm.message_create / guild.message_create) and let
  // the bridge fan it out to every plugin that subscribed in its
  // manifest. Bot's own messages are excluded so a plugin that
  // sends via RPC doesn't get its own send echoed back.
  if (message.author.bot) return;
  if (message.channel.type === ChannelType.DM) {
    dispatchEventToPlugins(
      "dm.message_create",
      serializeMessageForPlugin(message),
    );
  } else if (message.guildId) {
    dispatchEventToPlugins(
      "guild.message_create",
      serializeMessageForPlugin(message),
    );
  }
});

bot.on(
  "messageReactionAdd",
  async (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) => {
    if (user.bot) return;
    // Only guild reactions for now — DM reactions don't carry a
    // guildId and most plugins that care (role-emoji etc.) want guild.
    if (!reaction.message.guildId) return;
    dispatchEventToPlugins("guild.message_reaction_add", {
      message_id: reaction.message.id,
      channel_id: reaction.message.channelId,
      guild_id: reaction.message.guildId,
      user_id: user.id,
      emoji: {
        id: reaction.emoji.id ?? null,
        name: reaction.emoji.name ?? null,
        animated: reaction.emoji.animated ?? false,
      },
    });
  },
);

bot.on(
  "messageReactionRemove",
  async (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ) => {
    if (user.bot) return;
    if (!reaction.message.guildId) return;
    dispatchEventToPlugins("guild.message_reaction_remove", {
      message_id: reaction.message.id,
      channel_id: reaction.message.channelId,
      guild_id: reaction.message.guildId,
      user_id: user.id,
      emoji: {
        id: reaction.emoji.id ?? null,
        name: reaction.emoji.name ?? null,
        animated: reaction.emoji.animated ?? false,
      },
    });
  },
);

/**
 * Trim a Discord message down to the JSON shape plugins receive.
 * Don't send the entire djs Message object — it's huge and includes
 * circular references. Plugins that need more can RPC back for it.
 */
function serializeMessageForPlugin(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    channel_id: message.channelId,
    guild_id: message.guildId ?? null,
    content: message.content ?? "",
    author: {
      id: message.author.id,
      username: message.author.username,
      global_name: message.author.globalName,
      bot: message.author.bot,
    },
    attachments: [...message.attachments.values()].map((a) => ({
      id: a.id,
      url: a.url,
      filename: a.name,
      content_type: a.contentType,
      size: a.size,
    })),
    timestamp: message.createdAt.toISOString(),
  };
}

// Re-emit messageCreate for DMs from users whose DM channel wasn't already
// cached. discord.js's MessageCreateAction silently drops these because
// createChannel can't infer the DM type from a message-shaped payload, so
// the @On() handlers never see the first message from a new DM partner.
// We fetch the channel (which populates cache) and dispatch the event.
bot.on(
  "raw",
  async (packet: {
    t?: string;
    d?: { id?: string; channel_id?: string; guild_id?: string | null };
  }) => {
    if (packet.t !== "MESSAGE_CREATE") return;
    if (packet.d?.guild_id) return;
    const channelId = packet.d?.channel_id;
    if (!channelId) return;
    if (bot.channels.cache.has(channelId)) return;
    try {
      const channel = await bot.channels.fetch(channelId);
      if (!channel || !channel.isDMBased() || !channel.isTextBased()) return;
      // _add is private in the published typings but is discord.js's only
      // supported path for hydrating a raw MESSAGE_CREATE payload into a
      // Message instance; the event-bus expects a fully constructed Message.
      const messagesMgr = (channel as DMChannel).messages as unknown as {
        _add(data: unknown): Message;
      };
      const message = messagesMgr._add(packet.d);
      (bot.emit as (event: string, ...args: unknown[]) => boolean)(
        Events.MessageCreate,
        message,
      );
    } catch (err) {
      console.error("failed to dispatch DM messageCreate fallback:", err);
    }
  },
);

async function run() {
  try {
    await importx(dirname(import.meta.url) + "/{events,commands}/**/*.{ts,js}");
    // Register in-process commands that have moved off discordx onto
    // our own registry. Subsequent phases of the migration will move
    // events + the remaining commands here too.
    bootstrapInProcessFeatures();
    // sync() creates any tables missing on fresh installs; migrations
    // layer on top for schema evolution that sync() wouldn't attempt
    // (new columns, renames, index changes). Migrations are expected
    // to be idempotent / guard against already-applied changes so
    // fresh-sync'd DBs don't trip over them.
    await sequelize.sync();
    const migrations = await runPendingMigrations();
    // The webhook-behavior migration seeds the all_dms singleton row,
    // but a fresh install where sequelize.sync() created the table
    // first leaves the migration's CREATE-guarded INSERT a no-op for
    // that branch. Belt-and-suspenders: ensure id=1 exists so the
    // sidebar's "all DMs" pinned tab always has a stable id to point at.
    await ensureAllDmsTarget();
    // Seed the system behaviors. Idempotent — only insert if missing,
    // so admin edits to trigger type / value across restarts persist.
    // /login, /manual, /break all live as system behaviors so the
    // operator can rename their slash commands (or switch to a chat-
    // text trigger) from BehaviorsPage with no code change.
    await ensureSystemLoginBehavior(ALL_DMS_TARGET_ID);
    await ensureSystemManualBehavior(ALL_DMS_TARGET_ID);
    await ensureSystemBreakBehavior(ALL_DMS_TARGET_ID);
    if (migrations.length > 0) {
      botEventLog.record(
        "info",
        "bot",
        `Migrations applied: ${migrations.length}`,
        { migrationNames: migrations.map((m) => m.name) },
      );
    }

    // Register process-level error handlers only after migrations have run
    // so bot_events table is guaranteed to exist before we attempt to write to it.
    process.on("unhandledRejection", (reason) => {
      console.error("Unhandled promise rejection:", reason);
      const msg = reason instanceof Error ? reason.message : String(reason);
      botEventLog.record(
        "error",
        "error",
        `Unhandled promise rejection: ${msg}`,
      );
    });

    process.on("uncaughtException", (error) => {
      console.error("Uncaught exception:", error);
      botEventLog.record(
        "error",
        "error",
        `Uncaught exception: ${error.message}`,
      );
    });
    await seedDefaultRoles();
    await auditStoredCapabilities();

    authStore.attach(sequelizeRefreshStore);
    await authStore.init();

    // Plugin heartbeat reaper. Marks plugins inactive after 75s with
    // no heartbeat (their own cadence is 30s, so a single dropped
    // beat doesn't trigger). Runs in-process; unref'd so it doesn't
    // hold the event loop alive on shutdown.
    pluginRegistry.startReaper();
    // Build the in-memory event subscription index from rows already
    // in the plugins table. Without this, plugins that registered
    // before the last bot restart wouldn't receive events until they
    // re-registered (next heartbeat). With this, events flow as soon
    // as plugins are alive again.
    await rebuildEventIndex();
    // Wire the bot client into the plugin command registry now that
    // we have it; reconcile slash commands once the bot reports
    // ready (deferred to the 'ready' handler below).
    setPluginCommandBotClient(bot);

    const webPort = parseInt(process.env.WEB_PORT ?? "3000", 10);
    const webHost = process.env.WEB_HOST ?? "0.0.0.0";
    webServer = await startWebServer({
      port: webPort,
      host: webHost,
      bot,
      dmInbox: dmInboxService,
    });
    const isHttps = !!(
      process.env.SSL_CERT_PATH?.trim() && process.env.SSL_KEY_PATH?.trim()
    );
    botEventLog.record("info", "web", `Web server started on :${webPort}`, {
      port: webPort,
      https: isHttps,
      host: webHost,
    });
    console.log(`Web server listening on :${webPort}`);

    await bot.login(process.env.BOT_TOKEN ?? "");
  } catch (ex) {
    console.error(ex);
    const msg = ex instanceof Error ? ex.message : String(ex);
    const errorType = ex instanceof Error ? ex.constructor.name : "unknown";
    botEventLog.record("error", "web", `Startup failed: ${msg}`, {
      phase: "main",
      errorType,
    });
    resetBot();
  }
}

async function resetBot(reason = "unknown") {
  botEventLog.record("error", "bot", `Bot reset triggered: ${reason}`, {
    phase: "startup",
  });
  bot.destroy();
  if (webServer) {
    await webServer.close();
    webServer = null;
  }
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 10000);
  });
  console.log("Bot restarting...");
  run();
}

run();
