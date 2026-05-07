// importx + reflect-metadata removal: register* functions are
// explicit (bootstrap-events + bootstrap-in-process) so the
// decorator-driven importer-style glob scan is no longer needed.
// The events/ and commands/ files are imported transitively through
// those bootstraps.
import type {
  DMChannel,
  Interaction,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import { ChannelType, Events, IntentsBitField, Partials } from "discord.js";
import { Client } from "discord.js";
import { sequelize } from "./db.js";
import { config } from "./config.js";
import { moduleLogger } from "./logger.js";
import { startWebServer } from "./modules/web-core/server.js";
import { setReady } from "./modules/web-core/readiness.js";
import {
  setMetricsBotClient,
  botEventLogWritesTotal,
  auditLogWritesTotal,
} from "./modules/web-core/metrics.js";
import { setBotEventLogMetric } from "./modules/bot-events/bot-event-log.js";
import { setAuditLogMetric } from "./modules/admin/admin-audit.service.js";
import { dmInboxService } from "./modules/dm-inbox/dm-inbox.service.js";
import { authStore } from "./modules/web-core/auth-store.service.js";
import { sequelizeRefreshStore } from "./modules/web-core/refresh-token.repository.js";
import {
  auditStoredCapabilities,
  seedDefaultRoles,
} from "./modules/admin/authorized-user.service.js";
import { botEventLog } from "./modules/bot-events/bot-event-log.js";
import { ensureSystemBehaviors } from "./modules/behavior/system-seed.service.js";
import { shouldRecord } from "./modules/bot-events/bot-event-dedup.js";
import { runPendingMigrations } from "./migrations/runner.js";
// M1-C2: CommandReconciler / InteractionDispatcher / MessagePatternMatcher 接線。
// system slash command（admin-login / manual / break）+ user-defined slash trigger
// + DM message_pattern 由這三個模組接管（取代 v1 stub 路徑）。
import { pluginRegistry } from "./modules/plugin-system/plugin-registry.service.js";
import {
  dispatchEventToPlugins,
  rebuildEventIndex,
} from "./modules/plugin-system/plugin-event-bridge.service.js";
import {
  pluginCommandRegistry,
  setPluginCommandBotClient,
} from "./modules/plugin-system/plugin-command-registry.service.js";
import {
  syncInProcessCommandsForGuild,
  syncInProcessCommandsToDiscord,
} from "./modules/builtin-features/in-process-command-registry.service.js";
import { bootstrapInProcessFeatures } from "./bootstrap-in-process.js";
import { bootstrapEventHandlers } from "./bootstrap-events.js";
import { shutdownAllRconConnections } from "./modules/builtin-features/rcon-forward/rcon-forward-channel.events.js";
import { validateMetadataCoverage } from "./config-metadata.js";
// M1-C2 新增：command-system 三模組
import { CommandReconciler } from "./modules/command-system/reconcile.service.js";
import { InteractionDispatcher } from "./modules/command-system/interaction-dispatcher.service.js";
import { WebhookForwarder } from "./modules/command-system/webhook-forwarder.service.js";
import { MessagePatternMatcher } from "./modules/command-system/message-pattern-matcher.service.js";

const log = moduleLogger("main");

// Fail-closed boot assertion: every config leaf must have explicit
// classification in config-metadata.ts. We run this at module load
// (not inside run()) so a missing entry crashes the process once,
// instead of being caught by the resetBot retry loop and crash-looping
// every 10 seconds.
validateMetadataCoverage(config);

// Set to true once runPendingMigrations() completes so the process-level
// error handlers below know the bot_events table exists and is safe to write.
let migrationsApplied = false;

// Register process-level error handlers exactly once at module load, so
// repeated resetBot() → run() cycles never stack duplicate listeners.
// Before migrations finish we log-only (DB table may not exist yet);
// after that we also persist to bot_events.
// 4s flush window covers SQLite busy_timeout (3000 ms) so the bot_events
// row has a chance to land even when there's lock contention. We don't
// .unref() the timer — we want it to keep the event loop alive for the
// full window even if other refs (Discord WS, http server) have torn down.
const FATAL_FLUSH_MS = 4_000;

process.on("unhandledRejection", (reason) => {
  log.error({ err: reason }, "Unhandled promise rejection");
  // Don't schedule a fatal exit while gracefulShutdown is already in
  // flight — that 4s timer would race with shutdown's 30s budget and
  // could cut the cleanup short.
  if (shuttingDown) return;
  if (migrationsApplied) {
    // Stack stays in pino server log only. botEventLog feeds the
    // admin UI, which serializes context as-is — putting the stack
    // there would just relocate the leak issue 8.1 was meant to fix.
    botEventLog.record("error", "error", "Unhandled promise rejection", {
      errorType:
        reason instanceof Error ? reason.constructor.name : typeof reason,
    });
  }
  setTimeout(() => process.exit(1), FATAL_FLUSH_MS);
});

process.on("uncaughtException", (error) => {
  log.error({ err: error }, "Uncaught exception");
  if (shuttingDown) return;
  if (migrationsApplied) {
    botEventLog.record("error", "error", "Uncaught exception", {
      errorType: error.constructor.name,
    });
  }
  setTimeout(() => process.exit(1), FATAL_FLUSH_MS);
});

let webServer: Awaited<ReturnType<typeof startWebServer>> | null = null;

export const bot = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.DirectMessageReactions,
    // Typing intents are high-frequency/low-value; opt-in via BOT_ENABLE_TYPING.
    ...(config.bot.enableTyping
      ? [
          IntentsBitField.Flags.GuildMessageTyping,
          IntentsBitField.Flags.DirectMessageTyping,
        ]
      : []),
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// M1-C2：command-system 三模組 singleton 初始化。
// bot 已宣告，使用閉包安全存取（CommandReconciler.getBot 在 ready 後才被呼叫）。
const webhookForwarder = new WebhookForwarder();
const interactionDispatcher = new InteractionDispatcher(webhookForwarder);
const commandReconciler = new CommandReconciler(() =>
  bot.isReady() ? bot : null,
);
const messageMatcher = new MessagePatternMatcher(webhookForwarder);

let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30_000;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    // Second signal during shutdown = "I'm impatient, force exit now."
    // Common case: operator hits Ctrl+C twice when something hangs.
    log.warn({ signal }, "shutdown already in progress, forcing exit");
    process.exit(1);
  }
  shuttingDown = true;
  log.info({ signal }, "graceful shutdown begin");

  // Forced-exit guard: if any step hangs (SSE close, Discord WS handshake,
  // RCON socket close), we still die after SHUTDOWN_TIMEOUT_MS. We do NOT
  // .unref() the timer — its job is to fire even when other refs are gone.
  const timeout = setTimeout(() => {
    log.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // 1. Stop accepting new HTTP requests; fastify drains in-flight ones.
    if (webServer) {
      await webServer.close();
    }
    // 2. Stop background timers / cleanup.
    pluginRegistry.stopReaper();
    authStore.stop();
    // 3. Close RCON sockets (was registered as its own SIGTERM handler;
    // pulled in here so we don't race with this shutdown).
    await shutdownAllRconConnections();
    // 4. Close Discord gateway WS so the gateway flips us offline now.
    await bot.destroy();
    // 5. Close DB last — earlier steps may still be writing.
    await sequelize.close();
    clearTimeout(timeout);
    log.info({ signal }, "graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    log.error({ err, signal }, "graceful shutdown failed");
    process.exit(1);
  }
}

// Use process.on (not once) so a second signal during shutdown can hit
// the "force exit" branch above instead of being silently dropped.
process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
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
  const realToken = config.bot.token;
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
  setReady("bot", true);
  // discordx's initApplicationCommands previously registered the four
  // in-process commands (picture-only / role-emoji / todo-channel /
  // rcon-forward). Phase 2 of the discordx removal moved those onto
  // our own registry — discordx no longer owns any @Slash classes,
  // so calling initApplicationCommands now would just delete-then-
  // we-recreate the commands. Skip it; the registry handles sync.
  await syncInProcessCommandsToDiscord(bot);

  // Pre-cache each owner's DM channel. discord.js silently drops
  // MESSAGE_CREATE events for DM channels that aren't already cached
  // (createChannel can't infer DM type from a message-shaped payload),
  // so without this the owner-login-dm handler never fires.
  for (const ownerId of config.bot.ownerIds) {
    try {
      const owner = await bot.users.fetch(ownerId);
      await owner.createDM();
    } catch (err) {
      log.error({ err }, "Failed to cache owner DM channel");
      const errorType = err instanceof Error ? err.constructor.name : "unknown";
      botEventLog.record("warn", "bot", "Failed to cache owner DM channel", {
        ownerId,
        errorType,
      });
    }
  }

  // Reconcile plugin slash commands with Discord. Runs after the
  // discordx initApplicationCommands above so we don't fight over
  // the global command registry. Failures are logged inside the
  // registry, so we just await and move on.
  // M1-C2 注：pluginCommandRegistry.reconcileAll() 已改為 DB-only（不呼叫 Discord API）
  // 軌三 global 指令改由下方 commandReconciler.reconcileAll() 接管。
  await pluginCommandRegistry.reconcileAll();

  // M1-C2：CommandReconciler 接管軌二（behaviors）+ 軌三 global 指令。
  // 繼 syncInProcessCommandsToDiscord + pluginCommandRegistry.reconcileAll 之後執行。
  await commandReconciler.reconcileAll().catch((err: unknown) => {
    log.error({ err }, "commandReconciler.reconcileAll failed");
  });

  // M1-C2：MessagePatternMatcher 掛載 messageCreate listener（DM behaviors）。
  messageMatcher.register(bot);

  log.info({ stage: "boot" }, "bot started");
});

bot.on("guildCreate", async (guild) => {
  botEventLog.record("info", "bot", `Joined guild: ${guild.name}`, {
    guildId: guild.id,
    guildName: guild.name,
    memberCount: guild.memberCount,
  });
  // 軌一：in-process 指令（guild feature commands）
  await syncInProcessCommandsForGuild(guild);
  // 軌二 + 軌三 scope=guild：增量 reconcile（OQ-8 補強）
  // 確保 bot 加入新 guild 時，scope='guild' 的 behaviors / plugin_commands 自動 register，
  // 不需重啟。catch 避免單 guild 失敗阻擋其他邏輯。
  commandReconciler.reconcileForGuild(guild).catch((err: unknown) => {
    log.error(
      { err, guildId: guild.id },
      "commandReconciler.reconcileForGuild failed",
    );
  });
});

bot.on("guildDelete", (guild) => {
  botEventLog.record("info", "bot", `Left guild: ${guild.name}`, {
    guildId: guild.id,
    guildName: guild.name,
  });
});

bot.on("interactionCreate", async (interaction: Interaction) => {
  // M1-C2：統一的 InteractionDispatcher 接管所有 interaction dispatch。
  // 派發順序（C-runtime §4.1）：
  //   [1] behaviors 表 slash_command trigger（source: system / custom / plugin）
  //   [2] plugin_commands（軌三）── plugin-interaction-dispatch.service.ts
  //   [3] in-process registry（builtin-features）
  //   fallback：claimed=false，log warn
  try {
    const outcome = await interactionDispatcher.dispatch(interaction);
    if (!outcome.claimed && interaction.isChatInputCommand()) {
      log.warn(
        { commandName: interaction.commandName, reason: outcome.reason },
        "interactionCreate: unhandled slash command",
      );
    }
  } catch (error) {
    log.error({ err: error }, "interactionDispatcher.dispatch failed");
    // 硬 error 時嘗試回覆讓 Discord 不顯示「指令失敗」轉圈
    if (
      interaction.isChatInputCommand() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction
        .reply({ content: "⚠ 內部錯誤，請稍後再試。", ephemeral: true })
        .catch(() => {});
    }
  }
});

bot.on("messageCreate", async (message: Message) => {
  // discordx's executeCommand routed legacy `@SimpleCommand` text
  // commands. We've never used those — every command surface lives
  // on slash / behavior triggers — so nothing to dispatch here.
  // (Left as a hook: future "react to a message text" path could
  // plug in.)
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
      log.error({ err }, "failed to dispatch DM messageCreate fallback");
    }
  },
);

async function run() {
  try {
    bootstrapEventHandlers(bot);
    bootstrapInProcessFeatures();
    // sync() creates any tables missing on fresh installs; migrations
    // layer on top for schema evolution that sync() wouldn't attempt
    // (new columns, renames, index changes). Migrations are expected
    // to be idempotent / guard against already-applied changes so
    // fresh-sync'd DBs don't trip over them.
    await sequelize.sync();
    setReady("db", true);
    const migrations = await runPendingMigrations();
    setReady("migrations", true);
    migrationsApplied = true;
    // v2 system behavior seed（admin-login / manual / break）。
    // v1 → v2 重構期間 ensureSystem* helpers 被改成 no-op 但 main.ts 也不再
    // 呼叫，導致 behaviors 表沒 source='system' row → CommandReconciler 的
    // desired set 不含 /login，Discord 不註冊。這裡 idempotent 補建，
    // 必須在 reconcileAll（bot ready handler 內）之前完成。
    await ensureSystemBehaviors().catch((err: unknown) => {
      log.error({ err }, "ensureSystemBehaviors failed");
    });
    if (migrations.length > 0) {
      botEventLog.record(
        "info",
        "bot",
        `Migrations applied: ${migrations.length}`,
        { migrationNames: migrations.map((m) => m.name) },
      );
    }

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
    setMetricsBotClient(bot);
    setBotEventLogMetric(botEventLogWritesTotal);
    setAuditLogMetric(auditLogWritesTotal);

    const webPort = config.web.port;
    const webHost = config.web.host;
    webServer = await startWebServer({
      port: webPort,
      host: webHost,
      bot,
      dmInbox: dmInboxService,
    });
    const isHttps = !!(config.web.sslCertPath && config.web.sslKeyPath);
    botEventLog.record("info", "web", `Web server started on :${webPort}`, {
      port: webPort,
      https: isHttps,
      host: webHost,
    });
    log.info({ port: webPort, host: webHost }, "web server listening");

    await bot.login(config.bot.token);
  } catch (ex) {
    log.error({ err: ex }, "startup failed");
    const errorType = ex instanceof Error ? ex.constructor.name : "unknown";
    botEventLog.record("error", "web", "Startup failed", {
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
  log.warn({ stage: "restart" }, "bot restarting");
  run();
}

run();
