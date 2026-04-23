import type { ArgsOf } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType } from 'discord.js';
import { authStore } from '../web/auth-store.service.js';

const LOGIN_KEYWORD = /^!?login\b/i;

function buildBaseUrl(): string {
    const explicit = process.env.WEB_BASE_URL?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const port = process.env.WEB_PORT ?? '3000';
    return `http://localhost:${port}`;
}

@Discord()
export class OwnerLoginDmEvents {
    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>): Promise<void> {
        try {
            if (message.author.bot) return;
            if (message.channel.type !== ChannelType.DM) return;

            const ownerId = process.env.BOT_OWNER_ID?.trim();
            if (!ownerId) return;
            if (message.author.id !== ownerId) return;
            if (!LOGIN_KEYWORD.test(message.content.trim())) return;

            const { token, expiresAt } = authStore.createOneTimeToken(ownerId);
            const url = `${buildBaseUrl()}/auth?token=${encodeURIComponent(token)}`;
            const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
            await message.reply(
                `Login link (single-use, expires in ~${minutes} min):\n${url}`
            );
        } catch (ex) {
            console.error('owner-login-dm failed:', ex);
        }
    }
}
