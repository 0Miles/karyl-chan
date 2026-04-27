import type { ArgsOf } from 'discordx';
import { Discord, On } from 'discordx';
import { ChannelType } from 'discord.js';
import { jwtService } from '../web/jwt.service.js';
import { resolveLoginRole } from '../web/authorized-user.service.js';
import { botEventLog } from '../web/bot-event-log.js';

// Full-message match — trimmed content must be exactly "login" (or
// "!login"). The old \b variant triggered on "loginwithus" or any prose
// that contained the substring, which was noisy and occasionally unsafe.
const LOGIN_KEYWORD = /^!?login$/i;

function buildBaseUrl(): string {
    const explicit = process.env.WEB_BASE_URL?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const port = process.env.WEB_PORT ?? '3000';
    return `http://localhost:${port}`;
}

@Discord()
export class AdminLoginDmEvents {
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

            // JWT carries the trigger-message context so the exchange
            // endpoint can apply policy decisions (re-check role, audit
            // which message produced the login) without keeping any
            // server-side token table. `purpose: 'login'` pins the
            // token to the login flow — the exchange endpoint refuses
            // tokens minted for any other purpose. Default 5-min TTL.
            const { token, expiresAt } = jwtService.sign({
                purpose: 'login',
                userId: message.author.id,
                guildId: message.guild?.id ?? null,
                channelId: message.channel.id,
                messageId: message.id
            });
            const url = `${buildBaseUrl()}/admin/auth?token=${encodeURIComponent(token)}`;
            const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
            await message.reply(
                `Login link (role: ${role}, expires in ~${minutes} min):\n${url}`
            );
            botEventLog.record('info', 'feature', `Admin login link issued to ${message.author.tag}`, {
                userId: message.author.id,
                role,
                expiresAt,
                guildId: message.guild?.id ?? null,
                channelId: message.channel.id,
            });
        } catch (ex) {
            console.error('admin-login-dm failed:', ex);
            botEventLog.record('error', 'feature', `Admin login DM failed: ${(ex as Error).message}`, {
                userId: message.author.id,
            });
        }
    }
}
