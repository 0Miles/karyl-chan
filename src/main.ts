import 'reflect-metadata';

import { dirname, importx } from '@discordx/importer';
import type { Guild, Interaction, Message } from 'discord.js';
import { IntentsBitField, Partials } from 'discord.js';
import { Client } from 'discordx';
import { sequelize } from './models/db.js';

export const bot = new Client({
    botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],

    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.MessageContent
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ],

    silent: false,
    
    simpleCommand: {
        prefix: '!',
    },
});

bot.once('ready', async () => {
    await bot.guilds.fetch();
    await bot.initApplicationCommands();

    console.log('Bot started');
});

bot.on('guildCreate', async (guild: Guild) => {
    await bot.initGuildApplicationCommands(guild.id, bot.applicationCommandSlashes as any);
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

