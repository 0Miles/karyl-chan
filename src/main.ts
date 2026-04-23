import 'reflect-metadata';

import { dirname, importx } from '@discordx/importer';
import type { DMChannel, Interaction, Message } from 'discord.js';
import { Events, IntentsBitField, Partials } from 'discord.js';
import { Client } from 'discordx';
import { sequelize } from './models/db.js';
import { startWebServer } from './web/server.js';

export const bot = new Client({
    botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],

    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.DirectMessages
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ],

    silent: false
});

bot.once('ready', async () => {
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

bot.on('guildCreate', async () => {
    await bot.initApplicationCommands();
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
        const message = (channel as DMChannel).messages._add(packet.d as never);
        bot.emit(Events.MessageCreate, message);
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

        const webPort = parseInt(process.env.WEB_PORT ?? '3000', 10);
        await startWebServer({ port: webPort, bot });
        console.log(`Web server listening on :${webPort}`);

        await bot.login(process.env.BOT_TOKEN ?? '');
    } catch (ex) {
        console.error(ex);
        resetBot();
    }
}

async function resetBot() {
    bot.destroy();
    await new Promise<void>(resolve => {
        setTimeout(() => {
            resolve();
        }, 10000);
    });
    console.log('Bot restarting...');
    run();
}

run();

