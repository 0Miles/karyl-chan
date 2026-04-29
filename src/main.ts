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
  ensureSystemLoginBehavior,
  findSystemBehaviorByKey,
  SYSTEM_BEHAVIOR_KEY_LOGIN,
} from "./models/behavior.model.js";
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
  await bot.initApplicationCommands();

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

// Static system commands: in-process commands (manual / break) that
// must be GLOBAL with DM-only contexts even though discordx's
// botGuilds=every-guild config tries to register them per-guild.
const STATIC_DM_ONLY_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "manual", description: "查看你在私訊可用的行為列表" },
  { name: "break", description: "結束目前正在進行的持續轉發" },
];

async function rebindDmOnlyCommandsAsGlobal(): Promise<void> {
  if (!bot.application) return;

  // Pull dynamic system-behavior slash commands from the DB. Today only
  // admin-login can set triggerType='slash_command'; future system
  // flows go in the same channel.
  const dynamicCommands: Array<{ name: string; description: string }> = [];
  const sysLogin = await findSystemBehaviorByKey(
    SYSTEM_BEHAVIOR_KEY_LOGIN,
  ).catch(() => null);
  if (
    sysLogin &&
    sysLogin.enabled &&
    sysLogin.triggerType === "slash_command" &&
    sysLogin.triggerValue.length > 0
  ) {
    dynamicCommands.push({
      name: sysLogin.triggerValue,
      description: "取得 admin 後台一次性登入連結(僅授權使用者)",
    });
  }

  const allCommands = [...STATIC_DM_ONLY_COMMANDS, ...dynamicCommands];
  const desiredNames = new Set(allCommands.map((c) => c.name));

  // 1) Remove from every guild discordx pushed them to. We can't tell
  //    discordx "register these globally" from the @Slash level, but
  //    we can clean up after it.
  for (const [, guild] of bot.guilds.cache) {
    try {
      const cmds = await guild.commands.fetch();
      for (const cmd of cmds.values()) {
        if (desiredNames.has(cmd.name)) {
          await guild.commands.delete(cmd.id).catch(() => {});
        }
      }
    } catch {
      /* skip guilds we can't access */
    }
  }

  // 2) Reconcile globals. Three outcomes per existing global command:
  //    - in desired list with matching shape: leave alone
  //    - in desired list but wrong shape: edit
  //    - not in desired list AND name was previously a system-managed
  //      one (e.g. user changed system login triggerValue from 'login'
  //      → 'auth'): delete the stale /login. We don't currently
  //      remember which commands we've ever registered, so the heuristic
  //      is: delete any global command whose name doesn't appear in any
  //      @Slash-decorated in-process command AND isn't in our desired
  //      list. discordx in-process commands are guild-only so we don't
  //      have to be too clever about distinguishing.
  const existing = await bot.application.commands.fetch();
  const existingByName = new Map(existing.map((c) => [c.name, c]));

  // Delete stale globals that look like ours but aren't desired.
  // STATIC commands' names are eternal; for dynamic ones, scan
  // global commands and drop unfamiliar ones if they have the
  // DM-only context shape (heuristic: short, lower-case slug).
  for (const [name, cmd] of existingByName) {
    if (desiredNames.has(name)) continue;
    if (STATIC_DM_ONLY_COMMANDS.some((c) => c.name === name)) continue;
    // Only sweep names this function might have created. Crude
    // signal: presence of BotDM context (set only by us right now).
    const ctxs = (cmd as unknown as { contexts?: number[] }).contexts;
    if (
      ctxs &&
      ctxs.length > 0 &&
      ctxs.every(
        (c) =>
          c === InteractionContextType.BotDM ||
          c === InteractionContextType.PrivateChannel,
      )
    ) {
      await bot.application.commands.delete(cmd.id).catch(() => {});
    }
  }

  for (const meta of allCommands) {
    const already = existingByName.get(meta.name);
    if (already) continue; // global registration sticks; no-op
    try {
      await bot.application.commands.create({
        type: ApplicationCommandType.ChatInput,
        name: meta.name,
        description: meta.description,
        contexts: [
          InteractionContextType.BotDM,
          InteractionContextType.PrivateChannel,
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `failed to register /${meta.name} as global DM-only command: ${msg}`,
      );
    }
  }
}

bot.on("guildCreate", async (guild) => {
  botEventLog.record("info", "bot", `Joined guild: ${guild.name}`, {
    guildId: guild.id,
    guildName: guild.name,
    memberCount: guild.memberCount,
  });
  await bot.initApplicationCommands();
});

bot.on("guildDelete", (guild) => {
  botEventLog.record("info", "bot", `Left guild: ${guild.name}`, {
    guildId: guild.id,
    guildName: guild.name,
  });
});

bot.on("interactionCreate", async (interaction: Interaction) => {
  // System slash-command behaviors take the highest-priority path:
  // an admin can edit the system login behavior's triggerValue (e.g.
  // change /login to /auth) and the registered slash command updates
  // accordingly. Match by behavior triggerValue rather than a hard-
  // coded command name so the BehaviorsPage stays the source of truth.
  if (interaction.isChatInputCommand()) {
    try {
      const sys = await findSystemBehaviorByKey(SYSTEM_BEHAVIOR_KEY_LOGIN);
      if (
        sys &&
        sys.enabled &&
        sys.triggerType === "slash_command" &&
        sys.triggerValue === interaction.commandName
      ) {
        await issueLoginLinkForInteraction(interaction);
        return;
      }
    } catch (error) {
      console.error("system slash-command dispatch failed:", error);
    }
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
    // Seed the admin-login system behavior. Idempotent — only inserts
    // a row when one isn't already present, so admin edits to trigger
    // type / value across restarts persist.
    await ensureSystemLoginBehavior(ALL_DMS_TARGET_ID);
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
