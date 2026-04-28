import { CommandInteraction, GuildMember } from 'discord.js';
import { FAILED_COLOR } from '../utils/constant.js';
import type { Capability } from './capabilities.js';
import { hasCapability } from './permission.service.js';

/**
 * Discord slash-command capability gate. Replies with an ephemeral
 * "Permission Denied" embed and returns false when the invoker lacks
 * the capability.
 *
 * Named with the `Discord` prefix to disambiguate from
 * `web/route-guards.ts:requireCapability`, which gates HTTP requests
 * against the admin-web capability set. The two are deliberately
 * separate systems (different namespaces, different permission
 * sources) and used to share a name — easy to import the wrong one.
 */
export async function requireDiscordCapability(command: CommandInteraction, capability: Capability): Promise<boolean> {
    if (!command.guild || !command.member) {
        await command.reply({ content: 'Guild only.', flags: 'Ephemeral' }).catch(() => {});
        return false;
    }
    const allowed = await hasCapability(command.guild, command.member as GuildMember, capability);
    if (!allowed) {
        await command.reply({
            embeds: [{
                color: FAILED_COLOR,
                title: 'Permission Denied',
                description: `缺少權限：\`${capability}\``
            }],
            flags: 'Ephemeral'
        }).catch(() => {});
    }
    return allowed;
}
