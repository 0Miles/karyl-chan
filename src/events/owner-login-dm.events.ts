import type { ArgsOf } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType } from 'discord.js';
import { authStore } from '../web/auth-store.service.js';
import { resolveLoginRole } from '../web/authorized-user.service.js';

const LOGIN_KEYWORD = /^!?login\b/i;

function buildBaseUrl(): string {
    const explicit = process.env.WEB_BASE_URL?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const port = process.env.WEB_PORT ?? '3000';
    return `http://localhost:${port}`;
}

@Discord()
export class LoginDmEvents {
    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>): Promise<void> {
        try {
            if (message.author.bot) return;
            if (message.channel.type !== ChannelType.DM) return;
            if (!LOGIN_KEYWORD.test(message.content.trim())) return;

            // Owner OR anyone listed in authorized_users against a role that
            // carries at least one capability. resolveLoginRole returns null
            // for users who are in the table but whose role has been stripped
            // of all capabilities — they're effectively disabled.
            const role = await resolveLoginRole(message.author.id);
            if (!role) return;

            const { token, expiresAt } = authStore.createOneTimeToken(message.author.id);
            const url = `${buildBaseUrl()}/auth?token=${encodeURIComponent(token)}`;
            const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
            await message.reply(
                `Login link (role: ${role}, single-use, expires in ~${minutes} min):\n${url}`
            );
        } catch (ex) {
            console.error('login-dm failed:', ex);
        }
    }
}
