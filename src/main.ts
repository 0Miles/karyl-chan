import 'reflect-metadata';

import { dirname, importx } from '@discordx/importer';
import type { DMChannel, Interaction, Message } from 'discord.js';
import { Events, IntentsBitField, Partials } from 'discord.js';
import { Client } from 'discordx';
import { sequelize } from './models/db.js';
import { startWebServer } from './web/server.js';
import { authStore } from './web/auth-store.service.js';
import { sequelizeRefreshStore } from './web/refresh-token.repository.js';
import { seedDefaultRoles } from './web/authorized-user.service.js';
import { systemEventLog } from './web/system-event-log.js';

let webServer: Awaited<ReturnType<typeof startWebServer>> | null = null;

export const bot = new Client({
    botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],

    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.DirectMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ],

    silent: false
});

bot.once('ready', async () => {
    systemEventLog.record('bot-ready', `Logged in as ${bot.user?.tag ?? 'unknown'}`);
    await bot.guilds.fetch();
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
            console.error('Failed to cache owner DM channel:', err);
        }
    }

    console.log('Bot started');
});

bot.on('guildCreate', async (guild) => {
    systemEventLog.record('guild-join', `Joined guild: ${guild.name}`);
    await bot.initApplicationCommands();
});

bot.on('guildDelete', (guild) => {
    systemEventLog.record('guild-leave', `Left guild: ${guild.name}`);
});

bot.on('interactionCreate', async (interaction: Interaction) => {
    try {
        await bot.executeInteraction(interaction);
    } catch (error) {
        console.error('executeInteraction failed:', error);
    }
});

bot.on('messageCreate', async (message: Message) => {
    try {
        await bot.executeCommand(message);
    } catch (error) {
        console.error('executeCommand failed:', error);
    }
});

// Re-emit messageCreate for DMs from users whose DM channel wasn't already
// cached. discord.js's MessageCreateAction silently drops these because
// createChannel can't infer the DM type from a message-shaped payload, so
// the @On() handlers never see the first message from a new DM partner.
// We fetch the channel (which populates cache) and dispatch the event.
bot.on('raw', async (packet: { t?: string; d?: { id?: string; channel_id?: string; guild_id?: string | null } }) => {
    if (packet.t !== 'MESSAGE_CREATE') return;
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
        (bot.emit as (event: string, ...args: unknown[]) => boolean)(Events.MessageCreate, message);
    } catch (err) {
        console.error('failed to dispatch DM messageCreate fallback:', err);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

async function run() {
    try {
        await importx(dirname(import.meta.url) + '/{events,commands}/**/*.{ts,js}');
        await sequelize.sync();
        await seedDefaultRoles();

        authStore.attach(sequelizeRefreshStore);
        await authStore.init();

        const webPort = parseInt(process.env.WEB_PORT ?? '3000', 10);
        webServer = await startWebServer({ port: webPort, bot });
        systemEventLog.record('server-start', `Web server started on :${webPort}`);
        console.log(`Web server listening on :${webPort}`);

        await bot.login(process.env.BOT_TOKEN ?? '');
    } catch (ex) {
        console.error(ex);
        resetBot();
    }
}

async function resetBot() {
    bot.destroy();
    if (webServer) {
        await webServer.close();
        webServer = null;
    }
    await new Promise<void>(resolve => {
        setTimeout(() => {
            resolve();
        }, 10000);
    });
    console.log('Bot restarting...');
    run();
}

run();

