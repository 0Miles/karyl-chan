import "reflect-metadata";

import { dirname, importx } from "@discordx/importer";
import type { DMChannel, Interaction, Message } from "discord.js";
import { Events, IntentsBitField, Partials } from "discord.js";
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
import { runPendingMigrations } from "./migrations/runner.js";
import { ensureAllDmsTarget } from "./models/behavior-target.model.js";

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

  console.log("Bot started");
});

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
});

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
